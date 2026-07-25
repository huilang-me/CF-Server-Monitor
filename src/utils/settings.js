const CURRENT_VERSION = '2.7.13 Beta5';
export const AGENT_VERSION = '1.3.3';
export const DEFAULT_SITE_TITLE = 'Cloudflare Server Monitor';
export const APPEARANCE_FIELDS = ['site_title', 'custom_bg', 'custom_head', 'custom_script', 'csp_static', 'csp_api', 'display_mode', 'theme_options'];

export const SITE_FIELDS = ['is_public', 'show_price', 'show_expire', 'show_tf', 'show_time', 'show_long_history', 'tg_notify', 'tg_bot_token', 'tg_chat_id', 'turnstile_enabled', 'turnstile_login_enabled', 'turnstile_site_key', 'turnstile_secret_key', 'jwt_secret', 'username', 'password', 'cloudflare_account_id', 'cloudflare_token', 'custom_ct', 'custom_cu', 'custom_cm', 'custom_bd', 'expire_reminder','history_id_optimized','servers_optimized'];

const SITE_SETTINGS_TTL = 120 * 1000;
const JWT_SECRET_MIN_LENGTH = 32;
const LEGACY_CUSTOM_BD = 'lf3-ips.zstaticcdn.com';
const CURRENT_CUSTOM_BD = 'ip.zstaticcdn.com';
export const TG_NOTIFY_MINUTES_MIN = 2;
export const TG_NOTIFY_MINUTES_MAX = 30;
export const TG_NOTIFY_LEGACY_TRUE_MINUTES = 5;
let cachedSiteSettings = null;
let siteSettingsCacheExpiry = 0;
let cachedAppearanceOptions = null;
let appearanceOptionsCacheExpiry = 0;

const defaults = {
  site_title: DEFAULT_SITE_TITLE,
  custom_bg: '',
  custom_head: '',
  custom_script: '',
  csp_static: '',
  csp_api: '',
  display_mode: 'bar',
  theme_options: {},
  is_public: 'true',
  show_price: 'true',
  show_expire: 'true',
  show_tf: 'true',
  show_time: 'true',
  show_long_history: 'false',
  tg_notify: '0',
  tg_bot_token: '',
  tg_chat_id: '',
  turnstile_enabled: 'false',
  turnstile_login_enabled: 'false',
  turnstile_site_key: '',
  turnstile_secret_key: '',
  jwt_secret: '',
  cloudflare_account_id: '',
  cloudflare_token: '',
  custom_ct: 'gd-ct-dualstack.ip.zstaticcdn.com',
  custom_cu: 'gd-cu-dualstack.ip.zstaticcdn.com',
  custom_cm: 'gd-cm-dualstack.ip.zstaticcdn.com',
  custom_bd: 'ip.zstaticcdn.com',
  expire_reminder: 'false',
  history_id_optimized: 'false',
  servers_optimized: 'false'
};

export function normalizeTgNotify(value) {
  if (value === true || value === 'true') return String(TG_NOTIFY_LEGACY_TRUE_MINUTES);
  if (
    value === false ||
    value === 'false' ||
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return '0';
  }

  const minutes = Number(value);
  if (
    Number.isInteger(minutes) &&
    (minutes === 0 || (minutes >= TG_NOTIFY_MINUTES_MIN && minutes <= TG_NOTIFY_MINUTES_MAX))
  ) {
    return String(minutes);
  }

  return '0';
}

export function getTgNotifyMinutes(value) {
  return Number(normalizeTgNotify(value));
}

export function generateRandomSecret(byteLength = 32) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  let result = '';
  for (const byte of bytes) {
    result += byte.toString(16).padStart(2, '0');
  }
  return result;
}

export function isValidJwtSecret(secret) {
  return typeof secret === 'string' && secret.length >= JWT_SECRET_MIN_LENGTH;
}

function tryParseJSON(str) {
  if (!str) return null;
  try {
    return JSON.parse(str);
  } catch (e) {
    return null;
  }
}

function copyFields(target, source, fields) {
  if (!source || typeof source !== 'object') return;
  for (const field of fields) {
    if (source[field] !== undefined) {
      target[field] = source[field];
    }
  }
}

function normalizeCustomBd(value) {
  return value === LEGACY_CUSTOM_BD ? CURRENT_CUSTOM_BD : value;
}

export function normalizeDisplayMode(value, fallback = 'bar') {
  const mode = String(value || '').trim().toLowerCase();
  if (mode === 'list') return 'table';
  if (mode === 'bar' || mode === 'ring' || mode === 'table') return mode;
  return fallback === 'ring' || fallback === 'table' ? fallback : 'bar';
}

function hasMissingFields(source, fields) {
  if (!source || typeof source !== 'object') return true;
  return fields.some(field => source[field] === undefined);
}

async function loadLegacySettings(db, fields) {
  const legacy = {};
  const fieldSet = new Set(fields);
  const { results } = await db.prepare('SELECT * FROM settings').all();
  if (results && results.length > 0) {
    results.forEach(r => {
      if (fieldSet.has(r.key)) {
        legacy[r.key] = r.value;
      }
    });
  }
  return legacy;
}

async function saveJwtSecretIfMissing(db, secret) {
  await db.prepare(`
    INSERT INTO settings (key, value)
    VALUES ('site_options', json_object('jwt_secret', ?))
    ON CONFLICT(key) DO UPDATE SET value = CASE
      WHEN json_valid(value)
        AND typeof(json_extract(value, '$.jwt_secret')) = 'text'
        AND length(json_extract(value, '$.jwt_secret')) >= ?
      THEN value
      WHEN json_valid(value)
      THEN json_set(value, '$.jwt_secret', ?)
      ELSE json_object('jwt_secret', ?)
    END
  `).bind(secret, JWT_SECRET_MIN_LENGTH, secret, secret).run();

  const siteRow = await db.prepare(
    "SELECT value FROM settings WHERE key = 'site_options'"
  ).first();
  const siteOptions = siteRow && siteRow.value
    ? tryParseJSON(siteRow.value)
    : null;

  return isValidJwtSecret(siteOptions?.jwt_secret) ? siteOptions.jwt_secret : secret;
}

async function ensurePersistedJwtSecret(db, result, siteOptions) {
  if (isValidJwtSecret(siteOptions?.jwt_secret)) {
    return siteOptions.jwt_secret;
  }

  const secret = isValidJwtSecret(result.jwt_secret)
    ? result.jwt_secret
    : generateRandomSecret(32);

  return saveJwtSecretIfMissing(db, secret);
}

export async function loadSiteSettings(db) {
  const now = Date.now();
  if (cachedSiteSettings && now < siteSettingsCacheExpiry) {
    debug('Settings缓存命中');
    return cachedSiteSettings;
  }
  debug('Settings缓存更新');

  const result = { ...defaults };
  let siteOptions = null;

  try {
    const siteRow = await db.prepare(
      "SELECT value FROM settings WHERE key = 'site_options'"
    ).first();
    if (siteRow) {
      const parsed = tryParseJSON(siteRow.value);
      if (parsed) {
        siteOptions = parsed;
      }
    }

    if (hasMissingFields(siteOptions, SITE_FIELDS)) {
      copyFields(result, await loadLegacySettings(db, SITE_FIELDS), SITE_FIELDS);
    }
    copyFields(result, siteOptions, SITE_FIELDS);

    if (!isValidJwtSecret(siteOptions?.jwt_secret) || !isValidJwtSecret(result.jwt_secret)) {
      result.jwt_secret = await ensurePersistedJwtSecret(db, result, siteOptions);
    }
    result.tg_notify = normalizeTgNotify(result.tg_notify);
    const normalizedCustomBd = normalizeCustomBd(result.custom_bd);
    if (normalizedCustomBd !== result.custom_bd) {
      result.custom_bd = normalizedCustomBd;
      await saveSiteOptions(db, { custom_bd: normalizedCustomBd });
    } else {
      result.custom_bd = normalizedCustomBd;
    }
  } catch (e) {
    console.error('加载站点设置失败:', e);
  }

  cachedSiteSettings = result;
  siteSettingsCacheExpiry = now + SITE_SETTINGS_TTL;
  return result;
}

export function clearSiteSettingsCache() {
  cachedSiteSettings = null;
  siteSettingsCacheExpiry = 0;
}

export async function loadAppearanceOptions(db) {
  const now = Date.now();
  if (cachedAppearanceOptions && now < appearanceOptionsCacheExpiry) {
    debug('Appearance缓存命中');
    return cachedAppearanceOptions;
  }
  debug('Appearance缓存更新');

  const result = {};
  copyFields(result, defaults, APPEARANCE_FIELDS);
  let appearanceOptions = null;

  try {
    const appearanceRow = await db.prepare(
      "SELECT value FROM settings WHERE key = 'appearance_options'"
    ).first();
    if (appearanceRow) {
      const parsed = tryParseJSON(appearanceRow.value);
      if (parsed) {
        appearanceOptions = parsed;
      }
    }

    const needsLegacyAppearance = hasMissingFields(appearanceOptions, APPEARANCE_FIELDS);
    if (needsLegacyAppearance) {
      const legacy = await loadLegacySettings(db, APPEARANCE_FIELDS);
      copyFields(result, legacy, APPEARANCE_FIELDS);
    }
    copyFields(result, appearanceOptions, APPEARANCE_FIELDS);
  } catch (e) {
    console.error('加载外观设置失败:', e);
  }

  cachedAppearanceOptions = result;
  appearanceOptionsCacheExpiry = now + SITE_SETTINGS_TTL;
  return result;
}

export function clearAppearanceSettingsCache() {
  cachedAppearanceOptions = null;
  appearanceOptionsCacheExpiry = 0;
}

export async function loadSettings(db) {
  const [siteSettings, appearanceOptions] = await Promise.all([
    loadSiteSettings(db),
    loadAppearanceOptions(db)
  ]);
  return { ...defaults, ...siteSettings, ...appearanceOptions };
}

export async function saveSiteOptions(db, updates) {
  const siteRow = await db.prepare(
    "SELECT value FROM settings WHERE key = 'site_options'"
  ).first();
  
  const existingSiteOptions = siteRow && siteRow.value
    ? tryParseJSON(siteRow.value) || {}
    : {};
  const legacySiteOptions = hasMissingFields(existingSiteOptions, SITE_FIELDS)
    ? await loadLegacySettings(db, SITE_FIELDS)
    : {};
  
  const siteOptions = { ...legacySiteOptions, ...existingSiteOptions, ...updates };
  siteOptions.tg_notify = normalizeTgNotify(siteOptions.tg_notify);
  siteOptions.custom_bd = normalizeCustomBd(siteOptions.custom_bd);
  
  await db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).bind('site_options', JSON.stringify(siteOptions)).run();
  
  clearSiteSettingsCache();
  return siteOptions;
}

export async function getSettingByKey(db, key, returnBoolean = false) {
  const settings = await loadSiteSettings(db);
  if(returnBoolean){
    const value = String(settings[key] ?? '').trim().toLowerCase();
    if(['true', '1', 'yes', 'on'].includes(value)) return true;
    if(['false', '0', 'no', 'off', ''].includes(value)) return false;
  }
  return settings[key];
}

let isDebugEnabled = false;

export function setDebug(debug) {
  isDebugEnabled = debug === 1 || debug === '1' || debug === true;
  if(isDebugEnabled) console.log('DEBUG模式:', isDebugEnabled);
}

export function debug(...args) {
  if (isDebugEnabled) {
    console.debug('[DEBUG]', ...args);
  }
}

export function getCurrentVersion() {
  return CURRENT_VERSION;
}
