export const AGENT_NETWORK_URL_MAX_LENGTH = 512;

function parseHttpUrl(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return { valid: true, url: null, value: '' };
  if (raw.length > AGENT_NETWORK_URL_MAX_LENGTH) {
    return { valid: false, error: 'urlTooLong' };
  }

  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
      return { valid: false, error: 'invalidProtocol' };
    }
    return { valid: true, url, value: raw };
  } catch (_) {
    return { valid: false, error: 'invalidUrl' };
  }
}

export function normalizeAgentBaseUrl(value) {
  const parsed = parseHttpUrl(value);
  if (!parsed.valid) return parsed;
  if (!parsed.url) return { valid: true, value: '' };

  const { url } = parsed;
  if (url.username || url.password || url.search || url.hash) {
    return { valid: false, error: 'invalidAgentBaseUrl' };
  }

  const path = url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, '');
  return { valid: true, value: `${url.origin}${path}` };
}

export function normalizeAgentProxyUrl(value) {
  const parsed = parseHttpUrl(value);
  if (!parsed.valid) return parsed;
  if (!parsed.url) return { valid: true, value: '' };

  const { url } = parsed;
  if ((url.pathname && url.pathname !== '/') || url.search || url.hash) {
    return { valid: false, error: 'invalidAgentProxyUrl' };
  }
  if (url.password && !url.username) {
    return { valid: false, error: 'invalidAgentProxyUrl' };
  }
  try {
    decodeURIComponent(url.username);
    decodeURIComponent(url.password);
  } catch (_) {
    return { valid: false, error: 'invalidAgentProxyUrl' };
  }

  const auth = url.username
    ? `${url.username}${url.password ? `:${url.password}` : ''}@`
    : '';
  return { valid: true, value: `${url.protocol}//${auth}${url.host}` };
}

export function resolveAgentBaseUrl(value, fallback) {
  const preferred = normalizeAgentBaseUrl(value);
  if (preferred.valid && preferred.value) return preferred.value;
  const defaultBase = normalizeAgentBaseUrl(fallback);
  return defaultBase.valid ? defaultBase.value : '';
}

export function buildAgentResourceUrl(baseUrl, resourcePath) {
  const normalized = normalizeAgentBaseUrl(baseUrl);
  if (!normalized.valid || !normalized.value) return '';
  const cleanPath = String(resourcePath || '').replace(/^\/+/, '');
  return cleanPath ? `${normalized.value}/${cleanPath}` : normalized.value;
}

export function quotePosixShell(value) {
  return `'${String(value ?? '').replace(/'/g, `'"'"'`)}'`;
}

export function quotePowerShell(value) {
  return `'${String(value ?? '').replace(/'/g, "''")}'`;
}

export function buildPosixAgentDownloadCommand(url, proxyUrl = '') {
  const args = ['curl', '--noproxy', quotePosixShell(proxyUrl ? '' : '*'), '-fsSL'];
  if (proxyUrl) args.push('--proxy', quotePosixShell(proxyUrl));
  args.push(quotePosixShell(url));
  return args.join(' ');
}

export function buildPowerShellAgentDownloadCommand(url, proxyUrl = '', outputFile = 'cf-server-monitor.ps1') {
  const output = quotePowerShell(outputFile);
  if (!proxyUrl) {
    return `$defaultProxy = [System.Net.WebRequest]::DefaultWebProxy; ` +
      `try { [System.Net.WebRequest]::DefaultWebProxy = $null; ` +
      `Invoke-WebRequest -UseBasicParsing -Uri ${quotePowerShell(url)} -OutFile ${output} } ` +
      `finally { [System.Net.WebRequest]::DefaultWebProxy = $defaultProxy }`;
  }

  const normalized = normalizeAgentProxyUrl(proxyUrl);
  if (!normalized.valid || !normalized.value) {
    throw new Error('Invalid agent proxy URL');
  }
  const parsed = new URL(normalized.value);
  const proxyOrigin = `${parsed.protocol}//${parsed.host}`;
  if (!parsed.username) {
    return `Invoke-WebRequest -UseBasicParsing -Uri ${quotePowerShell(url)} -OutFile ${output} -Proxy ${quotePowerShell(proxyOrigin)}`;
  }

  const username = decodeURIComponent(parsed.username);
  const password = decodeURIComponent(parsed.password || '');
  const securePassword = password
    ? `ConvertTo-SecureString ${quotePowerShell(password)} -AsPlainText -Force`
    : 'New-Object System.Security.SecureString';
  return `$proxyPassword = ${securePassword}; ` +
    `$proxyCredential = New-Object System.Management.Automation.PSCredential (${quotePowerShell(username)}, $proxyPassword); ` +
    `Invoke-WebRequest -UseBasicParsing -Uri ${quotePowerShell(url)} -OutFile ${output} -Proxy ${quotePowerShell(proxyOrigin)} -ProxyCredential $proxyCredential`;
}
