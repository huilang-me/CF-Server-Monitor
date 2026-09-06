# Daily IP quality reports

This extension uses xykt/IPQuality commit
`3c0eb8856c67ad351020d1edd1bfd4e2515d32fe` (v2026-09-04).
The installer and collector verify its SHA256 and never auto-update it.
The script runs IPv4 checks with online report sharing disabled (`-p`).

## Provisioning

1. Apply `scripts/ip-quality-schema.sql` to the Worker's D1 database.
2. Generate a separate random 32-byte hex token for each server. Store only its
   SHA256 in `ip_quality_reports.token_hash`, keyed by the existing server ID.
3. On that server, create `~/.cf-probe/ip-quality/config.json` with mode 600:

   ```json
   {"url":"https://your-worker.workers.dev","server_id":"SERVER_ID","report_token":"PER_SERVER_TOKEN"}
   ```

4. Install Python 3, bash, curl, jq, bc, nc, dig and ip. Enable systemd user
   lingering, then run `sh scripts/install-ip-quality.sh` as the probe user.
   Keep the collector and the two unit files next to the installer.

Do not put administrator credentials or the main probe API_SECRET in this
configuration. Configuration files and raw reports must not be committed.

## Operation

The timer runs once daily at 19:15 UTC with up to ten minutes of jitter
(03:15-03:25 Asia/Shanghai). It catches up after downtime. A run has a ten-minute
measurement timeout, reduced CPU priority and a 256 MB memory limit.

As the probe user:

```sh
systemctl --user list-timers cf-ip-quality.timer
systemctl --user start cf-ip-quality.service
journalctl --user -u cf-ip-quality.service -n 30
systemctl --user disable --now cf-ip-quality.timer
```

The collector keeps `last-check.log`, `last-success.json` and, on upload failure,
`pending.json` under `~/.cf-probe/ip-quality/`. A later run retries pending data.
The ordinary `cf-probe` service operates independently.

## Display and validation

The public dashboard and server detail page display the latest successful
result, masked IPv4, provider scores and flags, and ChatGPT reachability.
Missing provider data remains unknown. A failed run retains the previous
successful result; data older than 36 hours is marked stale. Reachability is
not a guarantee that any particular ChatGPT account or session will work.
Public reads follow existing site visibility and hidden-server rules.

Run focused tests with Node 24 or newer:

```sh
node --test test/ip-quality.test.js
npm run build:frontend
```

Deploy the D1 table before deploying the Worker routes. Back up this table with
the main database. When updating from upstream, retain the IP quality routes,
component imports, collector files and D1 table.
