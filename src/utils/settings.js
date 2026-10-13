import {
  DEFAULT_SITE_TITLE,
  JWT_SECRET_MIN_LENGTH,
  SITE_SETTINGS_CACHE_TTL_MS
} from './config.js';
import { normalizePct } from './traffic.js';

export const APPEARANCE_FIELDS = ['site_title', 'custom_bg', 'custom_bg_mobile', 'favicon', 'custom_head', 'custom_script', 'csp_static', 'csp_api', 'display_mode', 'preferred_theme', 'default_language', 'theme_options'];

export const SITE_FIELDS = ['is_public', 'show_price', 'show_expire', 'show_tf', 'show_three_net_details', 'wss_report_enabled', 'wss_report_hours', 'frontend_ws_timeout_minutes', 'long_history_points', 'tg_notify', 'tg_bot_token', 'tg_chat_id', 'notification_timezone', 'notification_language', 'expire_notification_time', 'notification_webhook_enabled', 'notification_webhook_url', 'notification_webhook_method', 'notification_webhook_format', 'notification_webhook_headers', 'notification_webhook_body', 'notification_template', 'turnstile_enabled', 'turnstile_login_enabled', 'turnstile_site_key', 'turnstile_secret_key', 'jwt_secret', 'username', 'password', 'cloudflare_account_id', 'cloudflare_token', 'custom_ct', 'custom_cu', 'custom_cm', 'custom_bd', 'node_1', 'node_2', 'node_3', 'node_4', 'custom_ct_name', 'custom_cu_name', 'custom_cm_name', 'custom_bd_name', 'node_1_name', 'node_2_name', 'node_3_name', 'node_4_name', 'expire_reminder', 'resource_alert_rules', 'traffic_alert_threshold', 'theme_url', 'servers_optimized'];

export const TG_NOTIFY_MINUTES_MIN = 2;
export const TG_NOTIFY_MINUTES_MAX = 30;
export const TG_NOTIFY_LEGACY_TRUE_MINUTES = 5;
export const EXPIRE_REMINDER_DAYS_MAX = 365;
export const LONG_HISTORY_POINT_OPTIONS = [60, 120, 180, 240];
export const DEFAULT_LONG_HISTORY_POINTS = 120;
export const FRONTEND_WS_TIMEOUT_MINUTES_MAX = 1440;
export const DEFAULT_NOTIFICATION_TIMEZONE = 'UTC';
export const NOTIFICATION_LANGUAGES = ['zh', 'en', 'es'];
export const DEFAULT_NOTIFICATION_LANGUAGE = 'zh';
export const DEFAULT_EXPIRE_NOTIFICATION_TIME = '12';
export const ALL_WSS_REPORT_HOURS = Object.freeze(Array.from({ length: 24 }, (_, hour) => hour));
export const RESOURCE_ALERT_WINDOW_MIN = 5;
export const RESOURCE_ALERT_WINDOW_MAX = 10;
export const RESOURCE_ALERT_MODE_CONTINUOUS = 'continuous';
export const RESOURCE_ALERT_MODE_AVERAGE = 'average';
export const RESOURCE_ALERT_RULES_MAX = 20;
export const DEFAULT_NOTIFICATION_TEMPLATE = '{{emoji}}【CF Server Monitor】{{event}}\n\n{{message}}\n\n{{time}}';
export const DEFAULT_NOTIFICATION_WEBHOOK_BODY = '{\n  "title": "{{emoji}} {{event}}",\n  "content": "{{notification}}"\n}';
const LEGACY_DEFAULT_NOTIFICATION_TEMPLATES = [
  '{{emoji}}【CF Server Monitor】{{event}}\n\n{{message}}\n\n时间: {{time}}',
  '{{emoji}}【CF Server Monitor】{{event}}\n服务器: {{client}}\n详情:\n{{message}}\n时间: {{time}}',
  '事件: {{event}}\n服务名: {{client}}\n消息: {{message}}\n时间: {{time}}',
  '【CF Server Monitor】{{event}}\n服务器: {{client}}\n数量: {{count}}\n详情:\n{{message}}\n时间: {{time}}',
  '{{emoji}}【CF Server Monitor】{{event}}\n服务器: {{client}}\n数量: {{count}}\n详情:\n{{message}}\n时间: {{time}}'
];
const LEGACY_DEFAULT_NOTIFICATION_WEBHOOK_BODIES = [
  '{\n  "event": "{{event}}",\n  "client": "{{client}}",\n  "message": "{{message}}",\n  "time": "{{time}}"\n}',
  '{\n  "title": "{{title}}",\n  "event": "{{event}}",\n  "client": "{{client}}",\n  "clients": "{{clients}}",\n  "count": "{{count}}",\n  "message": "{{message}}",\n  "notification": "{{notification}}",\n  "time": "{{time}}"\n}',
  '{\n  "title": "{{event}}",\n  "content": "{{notification}}"\n}'
];
export const NOTIFICATION_WEBHOOK_METHODS = ['GET', 'POST'];
export const NOTIFICATION_WEBHOOK_FORMATS = ['json', 'form', 'text'];
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
  custom_bg_mobile: '',
  favicon: '',
  custom_head: '',
  custom_script: '',
  csp_static: '',
  csp_api: '',
  display_mode: 'ring',
  preferred_theme: 'auto',
  default_language: 'auto',
  theme_options: {},
  is_public: 'true',
  show_price: 'true',
  show_expire: 'true',
  show_tf: 'true',
  show_three_net_details: 'true',
  wss_report_enabled: 'true',
  wss_report_hours: [...ALL_WSS_REPORT_HOURS],
  frontend_ws_timeout_minutes: '0',
  long_history_points: String(DEFAULT_LONG_HISTORY_POINTS),
  tg_notify: '0',
  tg_bot_token: '',
  tg_chat_id: '',
  notification_timezone: DEFAULT_NOTIFICATION_TIMEZONE,
  notification_language: DEFAULT_NOTIFICATION_LANGUAGE,
  expire_notification_time: DEFAULT_EXPIRE_NOTIFICATION_TIME,
  notification_webhook_enabled: 'false',
  notification_webhook_url: '',
  notification_webhook_method: 'POST',
  notification_webhook_format: 'json',
  notification_webhook_headers: '',
  notification_webhook_body: DEFAULT_NOTIFICATION_WEBHOOK_BODY,
  notification_template: DEFAULT_NOTIFICATION_TEMPLATE,
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
  node_1: '',
  node_2: '',
  node_3: '',
  node_4: '',
  custom_ct_name: '电信',
  custom_cu_name: '联通',
  custom_cm_name: '移动',
  custom_bd_name: 'BGP',
  node_1_name: 'Node 1',
  node_2_name: 'Node 2',
  node_3_name: 'Node 3',
  node_4_name: 'Node 4',
  expire_reminder: '0',
  resource_alert_rules: [],
  traffic_alert_threshold: '0',
  theme_url: '',
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

export function normalizeFrontendWsTimeoutMinutes(value) {
  const minutes = Number(value);
  return String(
    Number.isInteger(minutes) && minutes >= 0 && minutes <= FRONTEND_WS_TIMEOUT_MINUTES_MAX
      ? minutes
      : 0
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

// 月流量告警全局阈值：百分比整数，夹 0..100（'0'/''=关闭），以字符串存储与其它数值设置一致
export function normalizeTrafficAlertThreshold(value) {
  return String(normalizePct(value));
}

export function normalizeNotificationTimezone(value) {
  const timezone = String(value || '').trim();
  if (!timezone || timezone.length > 64) return DEFAULT_NOTIFICATION_TIMEZONE;

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date(0));
    return timezone;
  } catch (_) {
    return DEFAULT_NOTIFICATION_TIMEZONE;
  }
}

export function normalizeExpireNotificationTime(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return DEFAULT_EXPIRE_NOTIFICATION_TIME;
  const legacyTimeMatch = raw.match(/^([01]?\d|2[0-3]):[0-5]\d$/);
  const hour = Number(legacyTimeMatch ? legacyTimeMatch[1] : raw);
  return Number.isInteger(hour) && hour >= 0 && hour <= 23
    ? String(hour)
    : DEFAULT_EXPIRE_NOTIFICATION_TIME;
}

export function normalizeNotificationWebhookMethod(value) {
  const method = String(value || '').trim().toUpperCase();
  return NOTIFICATION_WEBHOOK_METHODS.includes(method) ? method : 'POST';
}

export function normalizeNotificationWebhookFormat(value) {
  const format = String(value || '').trim().toLowerCase();
  return NOTIFICATION_WEBHOOK_FORMATS.includes(format) ? format : 'json';
}

export function normalizeNotificationWebhookHeaders(value) {
  return String(value || '').slice(0, 4000);
}

export function normalizeNotificationWebhookBody(value) {
  const body = String(value || '').trim();
  if (LEGACY_DEFAULT_NOTIFICATION_WEBHOOK_BODIES.includes(body)) {
    return DEFAULT_NOTIFICATION_WEBHOOK_BODY;
  }
  return (body || DEFAULT_NOTIFICATION_WEBHOOK_BODY).slice(0, 8000);
}

export function normalizeNotificationTemplate(value) {
  const template = String(value || '').trim();
  if (LEGACY_DEFAULT_NOTIFICATION_TEMPLATES.includes(template)) {
    return DEFAULT_NOTIFICATION_TEMPLATE;
  }
  return (template || DEFAULT_NOTIFICATION_TEMPLATE).slice(0, 4000);
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
        const suffix = `_${index + 1}`;
        id = `${id.slice(0, Math.max(0, 64 - suffix.length))}${suffix}`;
        let attempt = index + 1;
        while (seenIds.has(id)) {
          attempt += 1;
          const nextSuffix = `_${attempt}`;
          id = `${rule.id.slice(0, Math.max(0, 64 - nextSuffix.length))}${nextSuffix}`;
        }
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

export function normalizePreferredTheme(value, fallback = 'auto') {
  const theme = String(value || '').trim().toLowerCase();
  if (theme === 'dark' || theme === 'light' || theme === 'auto') return theme;
  return fallback === 'dark' || fallback === 'light' ? fallback : 'auto';
}

export function normalizeDefaultLanguage(value, fallback = 'auto') {
  const language = String(value || '').trim().toLowerCase();
  if (language === 'zh' || language === 'en' || language === 'es' || language === 'auto') return language;
  return fallback === 'zh' || fallback === 'en' || fallback === 'es' ? fallback : 'auto';
}

export function normalizeNotificationLanguage(value) {
  const language = String(value || '').trim().toLowerCase();
  return NOTIFICATION_LANGUAGES.includes(language) ? language : DEFAULT_NOTIFICATION_LANGUAGE;
}

export function normalizeBooleanSetting(value, fallback = 'false') {
  if (value === true || value === 1) return 'true';
  if (value === false || value === 0) return 'false';
  if (value === null || value === undefined || value === '') {
    return fallback === 'true' ? 'true' : 'false';
  }

  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return 'true';
  if (['false', '0', 'no', 'off'].includes(normalized)) return 'false';
  return fallback === 'true' ? 'true' : 'false';
}

export function normalizeWssReportHours(value) {
  if (value === undefined || value === null || value === '') {
    return [...ALL_WSS_REPORT_HOURS];
  }

  let source = value;
  if (typeof source === 'string') {
    try {
      source = JSON.parse(source);
    } catch (_) {
      source = source.split(',').map(item => item.trim()).filter(Boolean);
    }
  }
  if (!Array.isArray(source)) return [...ALL_WSS_REPORT_HOURS];

  return Array.from(new Set(source
    .map(hour => {
      if (typeof hour === 'number') return hour;
      if (typeof hour === 'string' && /^\d{1,2}$/.test(hour.trim())) return Number(hour);
      return NaN;
    })
    .filter(hour => Number.isInteger(hour) && hour >= 0 && hour <= 23)))
    .sort((a, b) => a - b);
}

export function isWssReportConfigured(settings = {}) {
  return normalizeBooleanSetting(settings?.wss_report_enabled) === 'true';
}

export function getWssReportScheduleState(settings = {}, now = Date.now()) {
  const date = now instanceof Date ? now : new Date(now);
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;

  if (!isWssReportConfigured(settings)) {
    return {
      configured: false,
      active: false,
      mode: 'disabled',
      reason: 'wss_disabled'
    };
  }

  const hours = normalizeWssReportHours(settings?.wss_report_hours);
  if (hours.length === 0) {
    return {
      configured: true,
      active: false,
      mode: 'inactive',
      reason: 'wss_schedule_empty'
    };
  }

  const currentHour = safeDate.getUTCHours();
  if (hours.includes(currentHour)) {
    return {
      configured: true,
      active: true,
      mode: 'active',
      reason: 'wss_schedule_active'
    };
  }

  return {
    configured: true,
    active: false,
    mode: 'inactive',
    reason: 'wss_schedule_inactive'
  };
}

export function isWssReportEnabled(settings = {}, now = Date.now()) {
  return getWssReportScheduleState(settings, now).active;
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
    result.show_three_net_details = normalizeBooleanSetting(result.show_three_net_details, defaults.show_three_net_details);
    result.wss_report_enabled = normalizeBooleanSetting(result.wss_report_enabled, defaults.wss_report_enabled);
    result.wss_report_hours = normalizeWssReportHours(result.wss_report_hours);
    result.frontend_ws_timeout_minutes = normalizeFrontendWsTimeoutMinutes(result.frontend_ws_timeout_minutes);
    result.notification_webhook_enabled = normalizeBooleanSetting(result.notification_webhook_enabled);
    result.notification_webhook_method = normalizeNotificationWebhookMethod(result.notification_webhook_method);
    result.notification_webhook_format = normalizeNotificationWebhookFormat(result.notification_webhook_format);
    result.notification_webhook_headers = normalizeNotificationWebhookHeaders(result.notification_webhook_headers);
    result.notification_webhook_body = normalizeNotificationWebhookBody(result.notification_webhook_body);
    result.notification_template = normalizeNotificationTemplate(result.notification_template);
    result.notification_timezone = normalizeNotificationTimezone(result.notification_timezone);
    result.notification_language = normalizeNotificationLanguage(result.notification_language);
    result.expire_notification_time = normalizeExpireNotificationTime(result.expire_notification_time);
    result.traffic_alert_threshold = normalizeTrafficAlertThreshold(result.traffic_alert_threshold);
  } catch (e) {
    console.error('加载站点设置失败:', e);
  }

  cachedSiteSettings = result;
  siteSettingsCacheExpiry = now + SITE_SETTINGS_CACHE_TTL_MS;
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
    result.display_mode = normalizeDisplayMode(result.display_mode, defaults.display_mode);
    result.preferred_theme = normalizePreferredTheme(result.preferred_theme);
    result.default_language = normalizeDefaultLanguage(result.default_language);
  } catch (e) {
    console.error('加载外观设置失败:', e);
  }

  cachedAppearanceOptions = result;
  appearanceOptionsCacheExpiry = now + SITE_SETTINGS_CACHE_TTL_MS;
  return result;
}

export function clearAppearanceSettingsCache() {
  cachedAppearanceOptions = null;
  appearanceOptionsCacheExpiry = 0;
}

export function isValidThemeOptions(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export async function saveThemeOptions(db, themeOptions) {
  await db.prepare(
    `INSERT INTO settings (key, value)
     VALUES ('appearance_options', json_object('theme_options', json(?)))
     ON CONFLICT(key) DO UPDATE SET value = CASE
       WHEN json_valid(value) THEN CASE
         WHEN json_type(value) = 'object' THEN json_set(value, '$.theme_options', json(?))
         ELSE json_object('theme_options', json(?))
       END
       ELSE json_object('theme_options', json(?))
     END`
  ).bind(
    JSON.stringify(themeOptions),
    JSON.stringify(themeOptions),
    JSON.stringify(themeOptions),
    JSON.stringify(themeOptions)
  ).run();

  clearAppearanceSettingsCache();
  return themeOptions;
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
  
  const merged = { ...legacySiteOptions, ...existingSiteOptions, ...updates };
  const siteOptions = {};
  for (const field of SITE_FIELDS) {
    if (field in merged) siteOptions[field] = merged[field];
  }
  siteOptions.tg_notify = normalizeTgNotify(siteOptions.tg_notify);
  siteOptions.expire_reminder = normalizeExpireReminder(siteOptions.expire_reminder);
  siteOptions.long_history_points = normalizeLongHistoryPoints(siteOptions.long_history_points);
  siteOptions.resource_alert_rules = normalizeResourceAlertRules(siteOptions.resource_alert_rules);
  siteOptions.show_three_net_details = normalizeBooleanSetting(siteOptions.show_three_net_details, defaults.show_three_net_details);
  siteOptions.wss_report_enabled = normalizeBooleanSetting(siteOptions.wss_report_enabled, defaults.wss_report_enabled);
  siteOptions.wss_report_hours = normalizeWssReportHours(siteOptions.wss_report_hours);
  siteOptions.frontend_ws_timeout_minutes = normalizeFrontendWsTimeoutMinutes(siteOptions.frontend_ws_timeout_minutes);
  siteOptions.notification_webhook_enabled = normalizeBooleanSetting(siteOptions.notification_webhook_enabled);
  siteOptions.notification_webhook_method = normalizeNotificationWebhookMethod(siteOptions.notification_webhook_method);
  siteOptions.notification_webhook_format = normalizeNotificationWebhookFormat(siteOptions.notification_webhook_format);
  siteOptions.notification_webhook_headers = normalizeNotificationWebhookHeaders(siteOptions.notification_webhook_headers);
  siteOptions.notification_webhook_body = normalizeNotificationWebhookBody(siteOptions.notification_webhook_body);
  siteOptions.notification_template = normalizeNotificationTemplate(siteOptions.notification_template);
  siteOptions.notification_timezone = normalizeNotificationTimezone(siteOptions.notification_timezone);
  siteOptions.notification_language = normalizeNotificationLanguage(siteOptions.notification_language);
  siteOptions.expire_notification_time = normalizeExpireNotificationTime(siteOptions.expire_notification_time);
  siteOptions.traffic_alert_threshold = normalizeTrafficAlertThreshold(siteOptions.traffic_alert_threshold);
  
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
