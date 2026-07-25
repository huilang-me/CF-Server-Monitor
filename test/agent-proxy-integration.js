import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';

const listen = server => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => resolve(server.address().port));
});

const close = server => new Promise(resolve => server.close(resolve));

const runCurl = (args, env = {}) => new Promise((resolve, reject) => {
  const child = spawn('curl', args, {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.once('error', reject);
  child.once('close', code => {
    if (code !== 0) {
      reject(new Error(`curl exited ${code}: ${stderr}`));
      return;
    }
    resolve(stdout);
  });
});

let targetRequests = 0;
let proxyRequests = 0;
const target = http.createServer((request, response) => {
  targetRequests++;
  response.writeHead(200, { 'content-type': 'text/plain' });
  if (request.url === '/trace') {
    assert.equal(request.headers.host, 'cloudflare.com');
    response.end('ip=203.0.113.10\nloc=JP\n');
    return;
  }
  response.end(`target:${request.url}`);
});

const expectedAuth = `Basic ${Buffer.from('agent:p ass').toString('base64')}`;
const proxy = http.createServer((request, response) => {
  proxyRequests++;
  if (request.headers['proxy-authorization'] !== expectedAuth) {
    response.writeHead(407, { 'proxy-authenticate': 'Basic realm="agent"' });
    response.end('proxy auth required');
    return;
  }

  const destination = new URL(request.url);
  const upstream = http.request({
    hostname: destination.hostname,
    port: destination.port,
    path: `${destination.pathname}${destination.search}`,
    method: request.method,
    headers: Object.fromEntries(
      Object.entries(request.headers).filter(([name]) => name !== 'proxy-authorization')
    )
  }, upstreamResponse => {
    response.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
    upstreamResponse.pipe(response);
  });
  upstream.once('error', error => {
    response.writeHead(502);
    response.end(error.message);
  });
  request.pipe(upstream);
});

const targetPort = await listen(target);
const proxyPort = await listen(proxy);
const targetUrl = `http://127.0.0.1:${targetPort}/update`;
const proxyUrl = `http://agent:p%20ass@127.0.0.1:${proxyPort}`;

try {
  const proxiedBody = await runCurl([
    '--noproxy', '', '--proxy', proxyUrl, '-fsSL', targetUrl
  ]);
  assert.equal(proxiedBody, 'target:/update');
  assert.equal(proxyRequests, 1);
  assert.equal(targetRequests, 1);

  const directBody = await runCurl([
    '--noproxy', '*', '-fsSL', targetUrl
  ], {
    HTTP_PROXY: proxyUrl,
    http_proxy: proxyUrl,
    NO_PROXY: '',
    no_proxy: ''
  });
  assert.equal(directBody, 'target:/update');
  assert.equal(proxyRequests, 1, 'direct request must bypass configured environment proxy');
  assert.equal(targetRequests, 2);

  const traceBody = await runCurl([
    '--noproxy', '*', '--interface', '127.0.0.1', '-H', 'Host: cloudflare.com',
    '-fsSL', `http://127.0.0.1:${targetPort}/trace`
  ], {
    HTTP_PROXY: proxyUrl,
    http_proxy: proxyUrl,
    NO_PROXY: '',
    no_proxy: ''
  });
  assert.match(traceBody, /^loc=JP$/m);
  assert.equal(proxyRequests, 1, 'direct region detection must bypass the configured proxy');
  assert.equal(targetRequests, 3);

  console.log('authenticated proxy plus forced-direct IP and region checks passed');
} finally {
  await Promise.all([close(proxy), close(target)]);
}
