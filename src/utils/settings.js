const CURRENT_VERSION = 'V2.7.9';
export const DEFAULT_SITE_TITLE = 'Cloudflare Server Monitor';
const APPEARANCE_FIELDS = ['site_title', 'custom_bg', 'custom_head', 'custom_script'];
const SITE_FIELDS = ['is_public', 'show_price', 'show_expire', 'show_bw', 'show_tf', 'show_time', 'show_long_history', 'tg_notify', 'tg_bot_token', 'tg_chat_id', 'turnstile_enabled', 'turnstile_login_enabled', 'turnstile_site_key', 'turnstile_secret_key', 'jwt_secret', 'username', 'password', 'cloudflare_account_id', 'cloudflare_token', 'custom_ct', 'custom_cu', 'custom_cm', 'custom_bd', 'expire_reminder','history_id_optimized','servers_optimized'];

const SITE_SETTINGS_TTL = 120 * 1000;
let cachedSiteSettings = null;
let siteSettingsCacheExpiry = 0;
let cachedAppearanceOptions = null;
let appearanceOptionsCacheExpiry = 0;

const defaults = {
  site_title: DEFAULT_SITE_TITLE,
  custom_bg: '',
  custom_head: '',
  custom_script: '',
  is_public: 'true',
  show_price: 'true',
  show_expire: 'true',
  show_bw: 'true',
  show_tf: 'true',
  show_time: 'true',
  show_long_history: 'false',
  tg_notify: 'false',
  tg_bot_token: '',
  tg_chat_id: '',
  turnstile_enabled: 'false',
  turnstile_login_enabled: 'false',
  turnstile_site_key: '',
  turnstile_secret_key: '',
  cloudflare_account_id: '',
  cloudflare_token: '',
  custom_ct: 'gd-ct-dualstack.ip.zstaticcdn.com',
  custom_cu: 'gd-cu-dualstack.ip.zstaticcdn.com',
  custom_cm: 'gd-cm-dualstack.ip.zstaticcdn.com',
  custom_bd: 'lf3-ips.zstaticcdn.com',
  expire_reminder: 'false',
  history_id_optimized: 'false',
  servers_optimized: 'false'
};

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
      copyFields(result, await loadLegacySettings(db, APPEARANCE_FIELDS), APPEARANCE_FIELDS);
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
