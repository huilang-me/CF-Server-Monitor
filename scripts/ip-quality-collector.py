#!/usr/bin/env python3
"""Run the pinned IPQuality release and upload through a per-server token."""
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

SCRIPT_SHA256 = 'ffb17dae790341c13023a94c5141775974dd73a3653ca5fba5c4648fc5588402'


def upload(config, payload):
    url = config['url'].rstrip('/')
    if urllib.parse.urlparse(url).scheme != 'https':
        raise ValueError('HTTPS is required')
    url += '/ip-quality/report?id=' + urllib.parse.quote(config['server_id'], safe='')
    request = urllib.request.Request(url, data=json.dumps(payload).encode(), headers={
        'Content-Type': 'application/json',
        'User-Agent': 'CF-Server-Monitor-IPQuality/1.0',
        'Authorization': 'Bearer ' + config['report_token'],
    })
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                result = json.load(response)
                if result.get('success') is not True:
                    raise ValueError('Upload was not accepted')
                return
        except (urllib.error.URLError, TimeoutError, ValueError):
            if attempt == 2:
                raise
            time.sleep(10)


def collect(directory):
    script = directory / 'ipquality.sh'
    if hashlib.sha256(script.read_bytes()).hexdigest() != SCRIPT_SHA256:
        raise ValueError('Pinned script checksum mismatch')
    with tempfile.TemporaryDirectory(prefix='check-', dir=directory) as temporary:
        output = Path(temporary) / 'report.json'
        with (directory / 'last-check.log').open('w') as log:
            process = subprocess.Popen(
                ['bash', str(script), '-4', '-E', '-n', '-p', '-f', '-o', str(output)],
                stdout=log, stderr=log, start_new_session=True,
            )
            try:
                code = process.wait(timeout=600)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
                return {'error': 'timeout'}
        # The pinned script ends with a disabled IPv6 condition, returning 1
        # even when its IPv4 JSON report was generated successfully.
        if code not in (0, 1):
            return {'error': 'check_failed'}
        try:
            report = json.loads(output.read_text())
            if not isinstance(report, dict) or not report.get('Head', {}).get('IP'):
                raise ValueError('Missing IP')
        except (OSError, ValueError, AttributeError):
            return {'error': 'invalid_report'}
        return {'report': report}


def main():
    os.umask(0o077)
    directory = Path(__file__).resolve().parent
    config = json.loads((directory / 'config.json').read_text())
    pending = directory / 'pending.json'
    # Retry a completed report before doing another measurement.
    if pending.exists():
        previous = json.loads(pending.read_text())
        if time.time() * 1000 - previous['checked_at'] < 7 * 86400000:
            try:
                upload(config, previous)
                pending.unlink()
                print('Previous pending report uploaded.', flush=True)
            except (urllib.error.URLError, TimeoutError, ValueError):
                print('Previous upload still unavailable; running the scheduled check.', flush=True)
    try:
        payload = collect(directory)
    except (OSError, ValueError):
        payload = {'error': 'check_failed'}
    payload['checked_at'] = int(time.time() * 1000)
    pending.write_text(json.dumps(payload))
    upload(config, payload)
    if 'report' in payload:
        (directory / 'last-success.json').write_text(json.dumps(payload))
    pending.unlink()
    print('IP quality result uploaded: ' + ('success' if 'report' in payload else payload['error']), flush=True)
    return 0 if 'report' in payload else 1


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as error:
        print('IP quality collector failed: ' + type(error).__name__, file=sys.stderr)
        sys.exit(1)
