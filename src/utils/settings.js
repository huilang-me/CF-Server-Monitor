const CURRENT_VERSION = '2.8.0 Beta1';
export const AGENT_VERSION = '1.3.4';
export const DEFAULT_SITE_TITLE = 'Cloudflare Server Monitor';
export const APPEARANCE_FIELDS = ['site_title', 'custom_bg', 'favicon', 'custom_head', 'custom_script', 'csp_static', 'csp_api', 'display_mode', 'theme_options'];

export const SITE_FIELDS = ['is_public', 'show_price', 'show_expire', 'show_tf', 'show_time', 'show_long_history', 'long_history_points', 'tg_notify', 'tg_bot_token', 'tg_chat_id', 'turnstile_enabled', 'turnstile_login_enabled', 'turnstile_site_key', 'turnstile_secret_key', 'jwt_secret', 'username', 'password', 'cloudflare_account_id', 'cloudflare_token', 'custom_ct', 'custom_cu', 'custom_cm', 'custom_bd', 'expire_reminder', 'resource_alert_rules', 'theme_url', 'history_id_optimized','servers_optimized'];

const SITE_SETTINGS_TTL = 120 * 1000;
const JWT_SECRET_MIN_LENGTH = 32;
export const TG_NOTIFY_MINUTES_MIN = 2;
export const TG_NOTIFY_MINUTES_MAX = 30;
export const TG_NOTIFY_LEGACY_TRUE_MINUTES = 5;
export const EXPIRE_REMINDER_DAYS_MAX = 7;
export const LONG_HISTORY_POINT_OPTIONS = [30, 60, 90, 120];
export const DEFAULT_LONG_HISTORY_POINTS = 60;
export const RESOURCE_ALERT_WINDOW_MIN = 5;
export const RESOURCE_ALERT_WINDOW_MAX = 10;
export const RESOURCE_ALERT_MODE_CONTINUOUS = 'continuous';
export const RESOURCE_ALERT_MODE_AVERAGE = 'average';
export const RESOURCE_ALERT_RULES_MAX = 20;
export const RESOURCE_ALERT_METRIC_CPU = 'cpu';
export const RESOURCE_ALERT_METRIC_RAM = 'ram';
export const RESOURCE_ALERT_METRIC_DISK = 'disk';
export const RESOURCE_ALERT_METRIC_NET_IN = 'netIn';
export const RESOURCE_ALERT_METRIC_NET_OUT = 'netOut';
export const RESOURCE_ALERT_METRICS = [
  RESOURCE_ALERT_METRIC_CPU,
  RESOURCE_ALERT_METRIC_RAM,
  RESOURCE_ALERT_METRIC_DISK,
  RESOURCE_ALERT_METRIC_NET_IN,
  RESOURCE_ALERT_METRIC_NET_OUT
];
const BYTES_PER_MEGABIT = 1000 * 1000 / 8;
let cachedSiteSettings = null;
let siteSettingsCacheExpiry = 0;
let cachedAppearanceOptions = null;
let appearanceOptionsCacheExpiry = 0;

const defaults = {
  site_title: DEFAULT_SITE_TITLE,
  custom_bg: '',
  favicon: '',
  custom_head: '',
  custom_script: '',
  csp_static: '',
  csp_api: '',
  display_mode: 'ring',
  theme_options: {},
  is_public: 'true',
  show_price: 'true',
  show_expire: 'true',
  show_tf: 'true',
  show_time: 'true',
  show_long_history: 'false',
  long_history_points: String(DEFAULT_LONG_HISTORY_POINTS),
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
  custom_bd: '',
  expire_reminder: '0',
  resource_alert_rules: [],
  theme_url: '',
  history_id_optimized: 'false',
  servers_optimized: 'false'
};

export function normalizeLongHistoryPoints(value) {
  const points = Number(value);
  return String(
    LONG_HISTORY_POINT_OPTIONS.includes(points)
      ? points
      : DEFAULT_LONG_HISTORY_POINTS
  );
}

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

export function normalizeExpireReminder(value) {
  if (value === true || value === 'true') return String(EXPIRE_REMINDER_DAYS_MAX);
  if (
    value === false ||
    value === 'false' ||
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return '0';
  }

  const days = Number(value);
  if (Number.isInteger(days) && days >= 0 && days <= EXPIRE_REMINDER_DAYS_MAX) {
    return String(days);
  }

  return '0';
}

export function getExpireReminderDays(value) {
  return Number(normalizeExpireReminder(value));
}

export function normalizeResourceAlertWindowMinutes(value) {
  const minutes = Number(value);
  if (
    Number.isInteger(minutes) &&
    (minutes === 0 || (minutes >= RESOURCE_ALERT_WINDOW_MIN && minutes <= RESOURCE_ALERT_WINDOW_MAX))
  ) {
    return String(minutes);
  }
  return '0';
}

export function normalizeResourceAlertIntervalMinutes(value) {
  const normalized = normalizeResourceAlertWindowMinutes(value);
  return normalized === '0' ? String(RESOURCE_ALERT_WINDOW_MIN) : normalized;
}

export function normalizeResourceAlertPercent(value) {
  if (value === undefined || value === null || value === '') return '0';
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 100) return '0';
  return String(Math.round(number * 100) / 100);
}

export function normalizeResourceAlertMbps(value) {
  if (value === undefined || value === null || value === '') return '0';
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 100000) return '0';
  return String(Math.round(number * 100) / 100);
}

export function normalizeResourceAlertMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  return mode === RESOURCE_ALERT_MODE_CONTINUOUS
    ? RESOURCE_ALERT_MODE_CONTINUOUS
    : RESOURCE_ALERT_MODE_AVERAGE;
}

export function normalizeResourceAlertMetric(value) {
  const metric = String(value || '').trim();
  return RESOURCE_ALERT_METRICS.includes(metric) ? metric : RESOURCE_ALERT_METRIC_CPU;
}

function parseResourceAlertRulesValue(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }
  return [];
}

function hasExplicitResourceAlertRulesValue(value) {
  if (Array.isArray(value)) return true;
  return typeof value === 'string' && value.trim() !== '';
}

function normalizeResourceAlertRuleId(value, index) {
  const id = String(value || '').trim().replace(/[^A-Za-z0-9._:-]/g, '').slice(0, 64);
  return id || `rule_${index + 1}`;
}

function normalizeResourceAlertRuleName(value, metric, index) {
  const name = String(value || '').trim().slice(0, 80);
  if (name) return name;
  const labels = {
    [RESOURCE_ALERT_METRIC_CPU]: 'CPU',
    [RESOURCE_ALERT_METRIC_RAM]: 'RAM',
    [RESOURCE_ALERT_METRIC_DISK]: 'DISK',
    [RESOURCE_ALERT_METRIC_NET_IN]: 'NET In',
    [RESOURCE_ALERT_METRIC_NET_OUT]: 'NET Out'
  };
  return `${labels[metric] || 'Resource'} Alert ${index + 1}`;
}

function normalizeResourceAlertServers(value) {
  const source = Array.isArray(value)
    ? value
    : (Array.isArray(value?.servers) ? value.servers : []);
  const seen = new Set();
  const servers = [];
  for (const item of source) {
    const id = String(item || '').trim();
    if (!id || id.length > 64 || !/^[A-Za-z0-9._:-]+$/.test(id) || seen.has(id)) continue;
    seen.add(id);
    servers.push(id);
  }
  return servers.slice(0, 1000);
}

function getDefaultResourceAlertThreshold(metric) {
  return metric === RESOURCE_ALERT_METRIC_NET_IN || metric === RESOURCE_ALERT_METRIC_NET_OUT
    ? '100'
    : '80';
}

export function normalizeResourceAlertThreshold(value, metric) {
  const fallback = getDefaultResourceAlertThreshold(metric);
  const normalized = metric === RESOURCE_ALERT_METRIC_NET_IN || metric === RESOURCE_ALERT_METRIC_NET_OUT
    ? normalizeResourceAlertMbps(value)
    : normalizeResourceAlertPercent(value);
  return Number(normalized) > 0 ? normalized : fallback;
}

export function normalizeResourceAlertRule(rule, index = 0) {
  if (!rule || typeof rule !== 'object' || Array.isArray(rule)) return null;
  const metric = normalizeResourceAlertMetric(rule.metric);
  const intervalMinutes = normalizeResourceAlertIntervalMinutes(
    rule.intervalMinutes ?? rule.windowMinutes ?? rule.interval ?? rule.minutes
  );

  return {
    id: normalizeResourceAlertRuleId(rule.id, index),
    name: normalizeResourceAlertRuleName(rule.name, metric, index),
    metric,
    threshold: normalizeResourceAlertThreshold(rule.threshold, metric),
    servers: normalizeResourceAlertServers(rule.servers ?? rule.serverIds),
    intervalMinutes,
    mode: normalizeResourceAlertMode(rule.mode)
  };
}

export function normalizeResourceAlertRules(value) {
  const explicitRulesValue = hasExplicitResourceAlertRulesValue(value);
  const source = parseResourceAlertRulesValue(value);
  const seenIds = new Set();
  const rules = source
    .slice(0, RESOURCE_ALERT_RULES_MAX)
    .map((rule, index) => normalizeResourceAlertRule(rule, index))
    .filter(Boolean)
    .map((rule, index) => {
      let id = rule.id;
      if (seenIds.has(id)) {
        id = `${id}_${index + 1}`.slice(0, 64);
      }
      seenIds.add(id);
      return { ...rule, id };
    });

  if (rules.length > 0 || explicitRulesValue) return rules;
  return [];
}

export function getResourceAlertRuleThresholds(rule) {
  const metric = normalizeResourceAlertMetric(rule?.metric);
  const threshold = Number(normalizeResourceAlertThreshold(rule?.threshold, metric));
  return {
    cpuPercent: metric === RESOURCE_ALERT_METRIC_CPU ? threshold : 0,
    ramPercent: metric === RESOURCE_ALERT_METRIC_RAM ? threshold : 0,
    diskPercent: metric === RESOURCE_ALERT_METRIC_DISK ? threshold : 0,
    netInBps: metric === RESOURCE_ALERT_METRIC_NET_IN ? threshold * BYTES_PER_MEGABIT : 0,
    netOutBps: metric === RESOURCE_ALERT_METRIC_NET_OUT ? threshold * BYTES_PER_MEGABIT : 0,
    netTotalBps: 0
  };
}

export function getResourceAlertConfig(settings = {}) {
  const rules = normalizeResourceAlertRules(settings.resource_alert_rules, settings);

  return {
    enabled: rules.length > 0,
    rules,
    hasRules: rules.length > 0
  };
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

export async function loadSiteSettings(db, options = {}) {
  const forceRefresh = options === true || Boolean(options && options.forceRefresh);
  const now = Date.now();
  if (!forceRefresh && cachedSiteSettings && now < siteSettingsCacheExpiry) {
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
    result.expire_reminder = normalizeExpireReminder(result.expire_reminder);
    result.long_history_points = normalizeLongHistoryPoints(result.long_history_points);
    result.resource_alert_rules = normalizeResourceAlertRules(result.resource_alert_rules);
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
  siteOptions.expire_reminder = normalizeExpireReminder(siteOptions.expire_reminder);
  siteOptions.long_history_points = normalizeLongHistoryPoints(siteOptions.long_history_points);
  siteOptions.resource_alert_rules = normalizeResourceAlertRules(siteOptions.resource_alert_rules);
  
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
