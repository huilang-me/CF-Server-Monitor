import { tryServeThemeProxy } from '../src/handlers/themeProxy.js';

const ALLOWED_THEME = 'https://huilang-me.github.io/cf-server-monitor-theme-emerald';
const calls = [];
const originalFetch = globalThis.fetch;
let redirectNextFetch = false;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

globalThis.fetch = async (input, init) => {
  const url = String(input);
  calls.push({ url, init });

  if (redirectNextFetch) {
    redirectNextFetch = false;
    return new Response(null, {
      status: 302,
      headers: { Location: 'https://evil.example/theme' }
    });
  }

  if (url.endsWith('/')) {
    return new Response(`<!doctype html><html><head>
      <meta name="viewport" content="width=device-width">
      <meta name="apiBase" content="https://a.example,https://b.example"/>
      <meta content="dynamic-value" data-test="true" name="APIBASE">
    </head><body>theme</body></html>`, {
      headers: {
        'Content-Type': 'text/html; charset=UTF-8',
        'Content-Length': '999',
        'Content-Encoding': 'gzip',
        'Set-Cookie': 'secret=1',
        'ETag': 'abc'
      }
    });
  }

  return new Response('asset-body', {
    headers: {
      'Content-Type': 'application/javascript',
      'Set-Cookie': 'secret=1'
    }
  });
};

try {
  const rootResponse = await tryServeThemeProxy(new Request(
    `https://monitor.example/?theme-url=${encodeURIComponent(ALLOWED_THEME)}`,
    { headers: { Cookie: 'session=secret', Authorization: 'Bearer secret' } }
  ));
  const html = await rootResponse.text();

  assert(rootResponse.status === 200, 'allowed theme should be proxied');
  assert(!/<meta\b[^>]*\sname=["']apiBase["']/i.test(html), 'apiBase meta should be removed');
  assert(/name="viewport"/.test(html), 'unrelated meta should remain');
  assert(!rootResponse.headers.get('Content-Length'), 'rewritten content length should be removed');
  assert(!rootResponse.headers.get('Content-Encoding'), 'rewritten content encoding should be removed');
  assert(!rootResponse.headers.get('Set-Cookie'), 'upstream cookie should be removed');
  assert(rootResponse.headers.get('Cache-Control') === 'no-store', 'proxy response should not be cached');
  assert(calls[0].url === `${ALLOWED_THEME}/`, 'theme document target is incorrect');
  assert(calls[0].init.redirect === 'manual', 'redirects must be handled manually');
  assert(!calls[0].init.headers.has('Cookie'), 'cookie must not be forwarded');
  assert(!calls[0].init.headers.has('Authorization'), 'authorization must not be forwarded');

  const invalidResponse = await tryServeThemeProxy(new Request(
    `https://monitor.example/?theme-url=${encodeURIComponent('https://evil.example/theme')}`
  ));
  assert(invalidResponse.status === 403, 'disallowed theme should be rejected');
  assert(calls.length === 1, 'disallowed theme must not reach fetch');

  redirectNextFetch = true;
  const redirectResponse = await tryServeThemeProxy(new Request(
    `https://monitor.example/?theme-url=${encodeURIComponent(ALLOWED_THEME)}`
  ));
  assert(redirectResponse.status === 502, 'theme redirects should be rejected');
  assert(calls.length === 2, 'allowed theme should reach fetch before redirect rejection');

  const assetResponse = await tryServeThemeProxy(new Request(
    'https://monitor.example/assets/app.js?v=7',
    {
      headers: {
        Referer: `https://monitor.example/?theme-url=${encodeURIComponent(ALLOWED_THEME)}`,
        Cookie: 'session=secret'
      }
    }
  ));
  assert(await assetResponse.text() === 'asset-body', 'asset body should be proxied');
  assert(calls[2].url === `${ALLOWED_THEME}/assets/app.js?v=7`, 'asset target is incorrect');
  assert(!assetResponse.headers.get('Set-Cookie'), 'asset cookie should be removed');
  assert(assetResponse.headers.get('Cache-Control') === 'no-store', 'asset response should not be cached');

  const foreignRefererResponse = await tryServeThemeProxy(new Request(
    'https://monitor.example/assets/app.js',
    { headers: { Referer: `https://evil.example/?theme-url=${encodeURIComponent(ALLOWED_THEME)}` } }
  ));
  assert(foreignRefererResponse === null, 'cross-origin referer must not activate theme proxy');
  assert(calls.length === 3, 'cross-origin referer must not reach fetch');

  console.log('Theme proxy tests passed');
} finally {
  globalThis.fetch = originalFetch;
}
