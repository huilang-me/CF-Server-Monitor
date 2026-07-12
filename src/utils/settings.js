import {
  VersionConflictError,
  patchJsonSetting,
  readSettingsRows,
  refreshConfigCache,
  saveSettingsBundle
} from '../services/configStore.js';

const CURRENT_VERSION = 'V2.7.9 Beta';
export const DEFAULT_SITE_TITLE = 'Cloudflare Server Monitor';
export const APPEARANCE_FIELDS = ['site_title', 'custom_bg', 'custom_head', 'custom_script'];
export const SITE_FIELDS = [
  'is_public', 'show_price', 'show_expire', 'show_bw', 'show_tf', 'show_time',
  'show_long_history', 'tg_notify', 'tg_bot_token', 'tg_chat_id',
  'turnstile_enabled', 'turnstile_login_enabled', 'turnstile_site_key',
  'turnstile_secret_key', 'jwt_secret', 'username', 'password',
  'cloudflare_account_id', 'cloudflare_token', 'custom_ct', 'custom_cu',
  'custom_cm', 'custom_bd', 'expire_reminder', 'history_id_optimized',
  'servers_optimized'
];

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
  } catch (_) {
    return null;
  }
}

function copyFields(target, source, fields) {
  if (!source || typeof source !== 'object') return;
  for (const field of fields) {
    if (source[field] !== undefined) target[field] = source[field];
  }
}

function hasMissingFields(source, fields) {
  if (!source || typeof source !== 'object') return true;
  return fields.some(field => source[field] === undefined);
}

function mapRows(rows) {
  return new Map((rows || []).map(row => [row.key, row]));
}

function loadLegacySettings(rows, fields) {
  const legacy = {};
  const fieldSet = new Set(fields);
  for (const row of rows || []) {
    if (fieldSet.has(row.key)) legacy[row.key] = row.value;
  }
  return legacy;
}

function buildVersions(rowsByKey) {
  return {
    site_options: Number(rowsByKey.get('site_options')?.version || 0),
    appearance_options: Number(rowsByKey.get('appearance_options')?.version || 0)
  };
}

export async function loadSiteSettings(env) {
  const rows = await readSettingsRows(env);
  const rowsByKey = mapRows(rows);
  const result = { ...defaults };
  const siteOptions = tryParseJSON(rowsByKey.get('site_options')?.value);

  if (hasMissingFields(siteOptions, SITE_FIELDS)) {
    copyFields(result, loadLegacySettings(rows, SITE_FIELDS), SITE_FIELDS);
  }
  copyFields(result, siteOptions, SITE_FIELDS);
  result._versions = buildVersions(rowsByKey);
  return result;
}

export async function clearSiteSettingsCache(env) {
  if (env?.DB) await refreshConfigCache(env, 'settings');
}

export async function loadSettings(env) {
  const rows = await readSettingsRows(env);
  const rowsByKey = mapRows(rows);
  const result = { ...defaults };
  const appearanceOptions = tryParseJSON(rowsByKey.get('appearance_options')?.value);
  const siteOptions = tryParseJSON(rowsByKey.get('site_options')?.value);

  const needsLegacyAppearance = hasMissingFields(appearanceOptions, APPEARANCE_FIELDS);
  const needsLegacySite = hasMissingFields(siteOptions, SITE_FIELDS);
  if (needsLegacyAppearance || needsLegacySite) {
    const legacy = loadLegacySettings(rows, [...APPEARANCE_FIELDS, ...SITE_FIELDS]);
    if (needsLegacyAppearance) copyFields(result, legacy, APPEARANCE_FIELDS);
    if (needsLegacySite) copyFields(result, legacy, SITE_FIELDS);
  }

  copyFields(result, appearanceOptions, APPEARANCE_FIELDS);
  copyFields(result, siteOptions, SITE_FIELDS);
  result._versions = buildVersions(rowsByKey);
  return result;
}

export async function saveSiteOptions(env, updates, expectedVersion = null) {
  try {
    const row = await patchJsonSetting(env, 'site_options', updates, expectedVersion);
    return tryParseJSON(row?.value) || {};
  } catch (error) {
    // 内部字段级更新允许在冲突后基于最新值重试一次；用户提交必须显式处理冲突。
    if (expectedVersion === null && error instanceof VersionConflictError) {
      const row = await patchJsonSetting(env, 'site_options', updates, null);
      return tryParseJSON(row?.value) || {};
    }
    throw error;
  }
}

export async function saveAllSettings(env, appearanceOptions, siteUpdates, expectedVersions) {
  const rows = await readSettingsRows(env);
  const rowsByKey = mapRows(rows);
  const currentAppearance = tryParseJSON(rowsByKey.get('appearance_options')?.value) || {};
  const currentSite = tryParseJSON(rowsByKey.get('site_options')?.value) || {};

  const values = {
    appearance_options: { ...currentAppearance, ...appearanceOptions },
    site_options: { ...currentSite, ...siteUpdates }
  };
  await saveSettingsBundle(env, values, expectedVersions);
  return loadSettings(env);
}

export async function getSettingByKey(env, key, returnBoolean = false) {
  const settings = await loadSiteSettings(env);
  if (returnBoolean) {
    const value = String(settings[key] ?? '').trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(value)) return true;
    if (['false', '0', 'no', 'off', ''].includes(value)) return false;
  }
  return settings[key];
}

let isDebugEnabled = false;

export function setDebug(enabled) {
  isDebugEnabled = enabled === 1 || enabled === '1' || enabled === true;
  if (isDebugEnabled) console.log('DEBUG模式:', isDebugEnabled);
}

export function debug(...args) {
  if (isDebugEnabled) console.debug('[DEBUG]', ...args);
}

export function getCurrentVersion() {
  return CURRENT_VERSION;
}
