export function normalizeCspOrigin(value) {
  const raw = String(value || '').trim();
  if (!raw || /[\s;"']/.test(raw)) return '';
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return '';
    if (url.username || url.password || url.search || url.hash) return '';
    if (url.pathname && url.pathname !== '/') return '';
    return url.origin;
  } catch (_) {
    return '';
  }
}

export function parseCspOrigins(value) {
  return [...new Set(String(value || '')
    .split(',')
    .map(normalizeCspOrigin)
    .filter(Boolean))];
}

export function buildApiDomainsWithWs(rawApiDomains) {
  const domains = [];
  for (const domain of [...new Set(rawApiDomains)]) {
    domains.push(domain);
    if (domain.startsWith('https://')) {
      domains.push(domain.replace('https://', 'wss://'));
    }
  }
  return domains;
}

export function rebuildCsp(html, { staticDomains, apiDomains }) {
  const cspMatch = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/);
  if (!cspMatch) return html;

  const existingCsp = cspMatch[1];
  const domainRegex = /https?:\/\/[^\s';]+|wss?:\/\/[^\s';]+/g;
  const existingDomains = existingCsp.match(domainRegex) || [];

  const turnstileDomain = 'https://challenges.cloudflare.com';
  const insightsDomain = 'https://static.cloudflareinsights.com';
  const fontsApiDomain = 'https://fonts.googleapis.com';
  const fontsStaticDomain = 'https://fonts.gstatic.com';
  const rawGithubDomain = 'https://raw.githubusercontent.com';

  const scriptSrcDomains = [...new Set([
    ...existingDomains.filter(d => [turnstileDomain, insightsDomain].includes(d)),
    ...staticDomains
  ])].join(' ');

  const styleSrcDomains = [...new Set([
    ...existingDomains.filter(d => [turnstileDomain, fontsApiDomain].includes(d)),
    ...staticDomains
  ])].join(' ');

  const imgSrcDomains = [...new Set([
    ...existingDomains.filter(d => [turnstileDomain, rawGithubDomain].includes(d)),
    ...staticDomains
  ])].join(' ');

  const fontSrcDomains = [...new Set([
    ...existingDomains.filter(d => [turnstileDomain, fontsStaticDomain].includes(d)),
    ...staticDomains
  ])].join(' ');

  const connectSrcDomains = [...new Set([
    ...existingDomains.filter(d => [turnstileDomain, insightsDomain].includes(d)),
    ...apiDomains
  ])].join(' ');

  const newCsp = [
    `default-src 'self'`,
    `script-src 'self' 'unsafe-inline' ${scriptSrcDomains}`,
    `style-src 'self' 'unsafe-inline' ${styleSrcDomains}`,
    `img-src 'self' ${imgSrcDomains} data:`,
    `font-src 'self' ${fontSrcDomains}`,
    `connect-src 'self' ${connectSrcDomains}`,
    `frame-src ${turnstileDomain}`,
    `form-action 'self'`,
    `object-src 'none'`,
    `base-uri 'self'`
  ].join(';');

  return html.replace(cspMatch[0],
    `<meta http-equiv="Content-Security-Policy" content="${newCsp}">`);
}

export function injectTitle(html, title) {
  if (!title) return html;
  return html.replace(/<title>.*?<\/title>/, `<title>${String(title).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')}</title>`);
}

export function injectApiBase(html, apiBases) {
  if (!apiBases || apiBases.length === 0) return html;
  const content = Array.isArray(apiBases) ? apiBases.join(',') : String(apiBases);
  return html.replace(
    /<meta name="apiBase" content="[^"]*">/,
    `<meta name="apiBase" content="${content.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}">`
  );
}

export function buildBackgroundStyle(url) {
  if (!url) return '';
  const safe = String(url).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"');
  return `<style>body{background-image:url('${safe}') !important;background-size:cover !important;background-attachment:fixed !important;background-position:center !important;}</style>`;
}
