const THEME_URL_PARAM = 'theme-url';
const ALLOWED_THEME_BASE_URLS = new Set([
  'https://huilang-me.github.io/cf-server-monitor-theme-emerald'
]);

function getAllowedThemeBaseUrl(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;

  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null;
    const pathname = url.pathname.replace(/\/+$/, '');
    const normalized = `${url.origin}${pathname}`;
    return ALLOWED_THEME_BASE_URLS.has(normalized) ? normalized : null;
  } catch (_) {
    return null;
  }
}

function getThemeRequest(request) {
  if (request.method !== 'GET') return null;

  const requestUrl = new URL(request.url);
  if (requestUrl.pathname === '/' && requestUrl.searchParams.has(THEME_URL_PARAM)) {
    return {
      baseUrl: getAllowedThemeBaseUrl(requestUrl.searchParams.get(THEME_URL_PARAM)),
      hasThemeUrl: true,
      isDocument: true,
      requestUrl
    };
  }

  if (!requestUrl.pathname.startsWith('/assets/')) return null;

  const referer = request.headers.get('Referer');
  if (!referer) return null;

  try {
    const refererUrl = new URL(referer);
    if (refererUrl.origin !== requestUrl.origin || !refererUrl.searchParams.has(THEME_URL_PARAM)) return null;
    return {
      baseUrl: getAllowedThemeBaseUrl(refererUrl.searchParams.get(THEME_URL_PARAM)),
      hasThemeUrl: true,
      isDocument: false,
      requestUrl
    };
  } catch (_) {
    return null;
  }
}

function buildUpstreamUrl(baseUrl, requestUrl, isDocument) {
  if (isDocument) return new URL(`${baseUrl}/`);
  const themeBaseUrl = new URL(`${baseUrl}/`);
  const upstreamUrl = new URL(requestUrl.pathname.replace(/^\/+/, ''), themeBaseUrl);
  const assetsPathPrefix = `${themeBaseUrl.pathname}assets/`;
  if (upstreamUrl.origin !== themeBaseUrl.origin || !upstreamUrl.pathname.startsWith(assetsPathPrefix)) {
    return null;
  }
  upstreamUrl.search = requestUrl.search;
  return upstreamUrl;
}

function buildUpstreamHeaders(request) {
  const headers = new Headers();
  for (const name of ['Accept', 'Accept-Language', 'Range']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  return headers;
}

function buildResponseHeaders(upstreamHeaders, bodyWasRewritten = false) {
  const headers = new Headers(upstreamHeaders);
  headers.delete('Set-Cookie');
  headers.set('Cache-Control', 'no-store');
  if (bodyWasRewritten) {
    headers.delete('Content-Encoding');
    headers.delete('Content-Length');
    headers.delete('ETag');
    headers.delete('Last-Modified');
  }
  return headers;
}

export function removeApiBaseMeta(html) {
  return String(html).replace(
    /<meta\b(?=[^>]*\sname\s*=\s*(['"])apiBase\1)[^>]*>/gi,
    ''
  );
}

function createThemeProxyError(message, status) {
  return new Response(message, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/plain; charset=UTF-8'
    }
  });
}

export async function tryServeThemeProxy(request) {
  const themeRequest = getThemeRequest(request);
  if (!themeRequest) return null;
  if (themeRequest.hasThemeUrl && !themeRequest.baseUrl) {
    return createThemeProxyError('Theme URL is not allowed', 403);
  }

  const upstreamUrl = buildUpstreamUrl(
    themeRequest.baseUrl,
    themeRequest.requestUrl,
    themeRequest.isDocument
  );
  if (!upstreamUrl) {
    return createThemeProxyError('Theme asset path is not allowed', 403);
  }

  let upstreamResponse;
  try {
    upstreamResponse = await fetch(upstreamUrl, {
      method: 'GET',
      headers: buildUpstreamHeaders(request),
      redirect: 'manual'
    });
  } catch (_) {
    return createThemeProxyError('Theme upstream is unavailable', 502);
  }

  if (upstreamResponse.status >= 300 && upstreamResponse.status < 400) {
    return createThemeProxyError('Theme upstream redirect is not allowed', 502);
  }

  const contentType = upstreamResponse.headers.get('Content-Type') || '';
  if (themeRequest.isDocument && contentType.toLowerCase().includes('text/html')) {
    const html = removeApiBaseMeta(await upstreamResponse.text());
    return new Response(html, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: buildResponseHeaders(upstreamResponse.headers, true)
    });
  }

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: buildResponseHeaders(upstreamResponse.headers)
  });
}
