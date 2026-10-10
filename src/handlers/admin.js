import { buildAuthCookie, buildClearAuthCookie, checkAuth, simpleAuthResponse, validateCredentials, generateToken } from '../middleware/auth.js';
import { getLatestMetricsForAllServers } from '../database/schema.js';
import { getAllServers, clearServersListCache } from '../utils/cache.js';
import { clearAppearanceSettingsCache, isValidThemeOptions, isWssReportConfigured, isWssReportEnabled, normalizeBooleanSetting, normalizeDefaultLanguage, normalizeDisplayMode, normalizeExpireNotificationTime, normalizeExpireReminder, normalizeFrontendWsTimeoutMinutes, normalizeLongHistoryPoints, normalizeNotificationTemplate, normalizeNotificationTimezone, normalizeNotificationWebhookBody, normalizeNotificationWebhookFormat, normalizeNotificationWebhookHeaders, normalizeNotificationWebhookMethod, normalizePreferredTheme, normalizeResourceAlertRules, normalizeTgNotify, normalizeWssReportHours, saveSiteOptions, saveThemeOptions, SITE_FIELDS, APPEARANCE_FIELDS } from '../utils/settings.js';
import { mergeMetricsIntoServer } from '../utils/metrics.js';
import { normalizePctOrNull } from '../utils/traffic.js';
import { verifyTurnstileToken, hashPassword } from '../utils/common.js';
import { AppError, createSuccessResponse, createBadRequestResponse, createUnauthorizedResponse, createErrorResponse } from '../utils/errors.js';
import { addServerColumns } from '../database/updateDatabase.js';
import { clearResourceAlertState, isSmtpNotificationTarget, sendNotification } from '../services/notification.js';
import { getNextServerHistoryPartitionId, HISTORY_MAX_PARTITION_ID } from '../database/indexOptimization.js';
import { isValidTrafficCorrection, normalizeConnectionMode, normalizePingMode, normalizeWssReportInterval, validateAgentConfigInput, validatePingNode, validateNetworkInterfaces } from '../utils/agentConfig.js';
import { scheduleAgentConfigChanged, scheduleAgentReportModeChanged } from '../utils/agentConfigNotify.js';
import { detectBillingCycle, detectCurrencySymbol, normalizeBillingCycle, normalizeCurrency, normalizePrice, renewExpireDateIfNeeded } from '../utils/serverBilling.js';
import { THEME_PREVIEW_AUTH_TTL_SECONDS } from '../utils/config.js';

const PING_NODE_FIELDS = ['custom_ct', 'custom_cu', 'custom_cm', 'custom_bd', 'node_1', 'node_2', 'node_3', 'node_4'];
const THEME_PREVIEW_AUTH_COOKIE = 'cfsm_theme_preview_auth';
const DURABLE_OBJECTS_WEBSOCKET_MESSAGE_BILLING_RATIO = 20;

function toUsageNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function isDurableObjectsHibernationInvocationType(value) {
  const type = String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (!type) return false;
  return type.includes('hibernation') || (type.includes('websocket') && type.includes('message'));
}

function normalizeBooleanFlag(value) {
  return value === true || value === 1 || value === '1' || value === 'true' ? '1' : '0';
}

function normalizeServerRegion(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 16);
}

function normalizeServerBillingData(data = {}) {
  const billingCycle = normalizeBillingCycle(data.billing_cycle || detectBillingCycle(data.price));
  const autoRenewal = normalizeBooleanFlag(data.auto_renewal);

  return {
    price: normalizePrice(data.price),
    billing_cycle: billingCycle,
    auto_renewal: autoRenewal,
    currency: normalizeCurrency(data.currency || detectCurrencySymbol(data.price) || '¥'),
    expire_date: renewExpireDateIfNeeded(
      data.expire_date || '',
      billingCycle,
      autoRenewal
    ).expire_date
  };
}

function isValidUUID(id) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

function isValidName(name) {
  return name && typeof name === 'string' && name.trim().length > 0 && name.length <= 100;
}

function isMissingColumnError(error) {
  const message = error?.message || String(error);
  return /no such column|has no column/i.test(message);
}

async function handleServerMutationError(db, error, fallbackMessage) {
  if (isMissingColumnError(error)) {
    console.warn('检测到数据库字段缺失，尝试添加缺失字段...');
    await addServerColumns(db);
    return createBadRequestResponse('dbColumnsAdded');
  }

  const errMsg = error?.message || String(error);
  return createBadRequestResponse(errMsg || fallbackMessage);
}

function sanitizeCspDomains(input) {
  if (!input || typeof input !== 'string') return '';
  return input
    .split(',')
    .map(s => s.trim())
    .map(normalizeCspOrigin)
    .filter(Boolean)
    .filter((domain, index, arr) => arr.indexOf(domain) === index)
    .join(',');
}

function normalizeCspOrigin(value) {
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

function normalizePingNodeFields(source, fields = PING_NODE_FIELDS) {
  const values = {};
  for (const field of fields) {
    if (source?.[field] === undefined) continue;
    const result = validatePingNode(source[field]);
    if (!result.valid) {
      return { valid: false, field };
    }
    // Keep the disabled-node sentinel as text so D1 does not coerce it to 0.0 in TEXT columns.
    values[field] = source[field] === 0 || source[field] === '0' ? '0' : result.value;
  }
  return { valid: true, values };
}

function normalizeImportedPingNodeValue(value) {
  return value === null || value === undefined ? '' : value;
}

function normalizeNetworkInterfaceField(value) {
  const result = validateNetworkInterfaces(value);
  if (!result.valid) {
    return { valid: false, value: '' };
  }
  return { valid: true, value: result.value };
}

function hasAppearanceInput(settings) {
  if (settings.appearance_options !== undefined) return true;
  return APPEARANCE_FIELDS
    .filter(field => field !== 'theme_options')
    .some(field => settings[field] !== undefined);
}

function extractBearerToken(request) {
  const authHeader = request.headers.get('Authorization') || '';
  const parts = authHeader.trim().split(/\s+/);
  return parts[0] === 'Bearer' && parts[1] ? parts[1] : '';
}

function buildThemePreviewUrl(request, themeUrl) {
  const previewUrl = new URL('/', request.url);
  previewUrl.searchParams.set('theme_url', themeUrl);
  return previewUrl.toString();
}

function buildThemePreviewAuthCookie(request, token) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${THEME_PREVIEW_AUTH_COOKIE}=${encodeURIComponent(token)}; Max-Age=${THEME_PREVIEW_AUTH_TTL_SECONDS}; Path=/; HttpOnly; SameSite=Lax${secure}`;
}

function buildClearThemePreviewAuthCookie(request) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${THEME_PREVIEW_AUTH_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${secure}`;
}

function createSuccessResponseWithCookies(data, cookies = []) {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  for (const cookie of cookies) {
    if (cookie) headers.append('Set-Cookie', cookie);
  }
  return new Response(JSON.stringify(data), { status: 200, headers });
}

function normalizeThemeUrl(value) {
  if (value === undefined) return undefined;
  const raw = String(value || '').trim();
  if (!raw) return '';

  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return null;
    if (url.hostname !== 'github.com') return null;
    if (url.username || url.password || url.search || url.hash) return null;

    const parts = url.pathname.split('/').filter(Boolean);
    const ref = parts[3];
    if (
      parts.length < 4 ||
      parts[2] !== 'tree' ||
      !/^[A-Za-z0-9._-]+$/.test(parts[0]) ||
      !/^[A-Za-z0-9._-]+$/.test(parts[1]) ||
      !/^[A-Za-z0-9._-]+$/.test(ref) ||
      parts.some(part => part === '.' || part === '..' || /[%\\]/.test(part))
    ) {
      return null;
    }

    return `https://github.com/${parts.join('/')}`;
  } catch (_) {
    return null;
  }
}

function getThemeRawIndexUrl(themeUrl) {
  const normalized = normalizeThemeUrl(themeUrl);
  if (!normalized) return '';

  const url = new URL(normalized);
  const parts = url.pathname.split('/').filter(Boolean);
  const owner = parts[0];
  const repo = parts[1];
  const ref = parts[3];
  const themePath = [owner, repo, ref, ...parts.slice(4)]
    .map(part => encodeURIComponent(part))
    .join('/');
  return `https://raw.githubusercontent.com/${themePath}/index.html`;
}

async function validateThemeUrlAvailable(themeUrl) {
  if (!themeUrl) return true;

  const rawIndexUrl = getThemeRawIndexUrl(themeUrl);
  if (!rawIndexUrl) return false;

  try {
    const res = await fetch(rawIndexUrl, {
      method: 'GET',
      headers: { 'User-Agent': 'CFSM-Theme-Validate' }
    });
    return res.ok;
  } catch (_) {
    return false;
  }
}

async function deleteServer(db, id) {
  try {
    const stmt1 = db.prepare(`PRAGMA foreign_key_list(metrics_history)`);
    const result1 = await stmt1.all();
    if (result1.results.length > 0) {
      await db.prepare('DELETE FROM metrics_history WHERE server_id = ?').bind(id).run();
    }

    const stmt2 = db.prepare(`PRAGMA foreign_key_list(metrics_history_old)`);
    const result2 = await stmt2.all();
    if (result2.results.length > 0) {
      await db.prepare('DELETE FROM metrics_history_old WHERE server_id = ?').bind(id).run();
    }

    await db.prepare('DELETE FROM servers WHERE id = ?').bind(id).run();
  } catch (err) {
    throw err;
  }
}

function getUtcTodayRange() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end = new Date(start.getTime() + 86400000 - 1);
  return {
    date: start.toISOString().slice(0, 10),
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
    startTime: start.toISOString(),
    endTime: end.toISOString()
  };
}

function getUtcYesterdayRange() {
  const now = new Date();
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = new Date(todayStart.getTime() - 86400000);
  const end = new Date(todayStart.getTime() - 1);
  return {
    date: start.toISOString().slice(0, 10),
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
    startTime: start.toISOString(),
    endTime: end.toISOString()
  };
}

async function cloudflareGraphql(query, variables, token) {
  const response = await fetch('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query, variables })
  });
  const data = await response.json();
  if (!response.ok || data.errors) {
    const message = data.errors && data.errors.length > 0 ? data.errors.map(e => e.message).join('; ') : 'Cloudflare GraphQL request failed';
    throw new Error(message);
  }
  return data.data;
}

function estimateDurableObjectsWebSocketBillableRequests(messages) {
  const count = toUsageNumber(messages);
  if (count <= 0) return 0;
  return Math.ceil(count / DURABLE_OBJECTS_WEBSOCKET_MESSAGE_BILLING_RATIO);
}

export function estimateDurableObjectsBillableRequests(breakdown = {}) {
  if (breakdown === null || typeof breakdown !== 'object') {
    return estimateDurableObjectsWebSocketBillableRequests(breakdown);
  }

  const httpRequests = toUsageNumber(breakdown.httpRequests);
  const hibernationWakeups = toUsageNumber(breakdown.hibernationWakeups);
  const inboundWebSocketMessages = toUsageNumber(breakdown.inboundWebSocketMessages);

  return Math.ceil(httpRequests) +
    Math.ceil(hibernationWakeups) +
    estimateDurableObjectsWebSocketBillableRequests(inboundWebSocketMessages);
}

export function summarizeDurableObjectsUsage(invocationGroups = [], periodicGroups = []) {
  const summary = {
    httpRequests: 0,
    hibernationWakeups: 0,
    inboundWebSocketMessages: 0,
    outboundWebSocketMessages: 0,
    rawRequests: 0,
    billableRequests: 0
  };

  for (const group of invocationGroups || []) {
    const requests = toUsageNumber(group?.sum?.requests);
    summary.rawRequests += requests;
    if (isDurableObjectsHibernationInvocationType(group?.dimensions?.type)) {
      summary.hibernationWakeups += requests;
    } else {
      summary.httpRequests += requests;
    }
  }

  for (const group of periodicGroups || []) {
    summary.inboundWebSocketMessages += toUsageNumber(group?.sum?.inboundWebsocketMsgCount);
    summary.outboundWebSocketMessages += toUsageNumber(group?.sum?.outboundWebsocketMsgCount);
  }

  summary.billableRequests = estimateDurableObjectsBillableRequests(summary);
  return summary;
}

async function fetchCloudflareUsage(token, accountId, range) {
  const query = `query CloudflareUsage($accountTag: string!, $start: Date, $end: Date, $startTime: Time!, $endTime: Time!) {
    viewer {
      accounts(filter: { accountTag: $accountTag }) {
        d1AnalyticsAdaptiveGroups(
          limit: 10000
          filter: { date_geq: $start, date_leq: $end }
        ) {
          sum { rowsRead rowsWritten }
          dimensions { databaseId }
        }
        workersInvocationsAdaptive(
          limit: 10000
          filter: { datetime_geq: $startTime, datetime_leq: $endTime }
        ) {
          sum { requests }
        }
        durableObjectsInvocationsAdaptiveGroups(
          limit: 10000
          filter: { date_geq: $start, date_leq: $end }
        ) {
          sum { requests }
          dimensions { type }
        }
        durableObjectsPeriodicGroups(
          limit: 10000
          filter: { date_geq: $start, date_leq: $end }
        ) {
          sum { duration inboundWebsocketMsgCount outboundWebsocketMsgCount }
        }
      }
    }
  }`;
  const data = await cloudflareGraphql(query, {
    accountTag: accountId,
    start: range.start,
    end: range.end,
    startTime: range.startTime,
    endTime: range.endTime
  }, token);
  const account = data.viewer?.accounts?.[0] || {};
  const groups = account.d1AnalyticsAdaptiveGroups || [];
  const usage = groups.reduce((total, group) => {
    total.rowsRead += Number(group.sum?.rowsRead || 0);
    total.rowsWritten += Number(group.sum?.rowsWritten || 0);
    return total;
  }, { rowsRead: 0, rowsWritten: 0 });
  const workersRequests = (account.workersInvocationsAdaptive || []).reduce((total, group) => {
    return total + Number(group.sum?.requests || 0);
  }, 0);
  const durableObjectsUsage = summarizeDurableObjectsUsage(
    account.durableObjectsInvocationsAdaptiveGroups || [],
    account.durableObjectsPeriodicGroups || []
  );
  const durableObjectsDuration = (account.durableObjectsPeriodicGroups || []).reduce((total, group) => {
    return total + Number(group.sum?.duration || 0);
  }, 0);
  return {
    rowsRead: usage.rowsRead,
    rowsWritten: usage.rowsWritten,
    workersRequests,
    durableObjectsRequests: durableObjectsUsage.billableRequests,
    durableObjectsHttpRequests: durableObjectsUsage.httpRequests,
    durableObjectsHibernationWakeups: durableObjectsUsage.hibernationWakeups,
    durableObjectsInboundWebSocketMessages: durableObjectsUsage.inboundWebSocketMessages,
    durableObjectsOutboundWebSocketMessages: durableObjectsUsage.outboundWebSocketMessages,
    durableObjectsRawRequests: durableObjectsUsage.rawRequests,
    durableObjectsRequestsEstimated: true,
    durableObjectsRequestBillingRatio: DURABLE_OBJECTS_WEBSOCKET_MESSAGE_BILLING_RATIO,
    durableObjectsDuration,
    databaseCount: groups.length
  };
}

async function getD1DailyUsage(token, accountId) {
  if (!token) throw new Error('cloudflareTokenRequired');
  if (!accountId) throw new Error('cloudflareAccountIdRequired');

  const todayRange = getUtcTodayRange();
  const yesterdayRange = getUtcYesterdayRange();

  const [todayUsage, yesterdayUsage] = await Promise.all([
    fetchCloudflareUsage(token, accountId, todayRange),
    fetchCloudflareUsage(token, accountId, yesterdayRange)
  ]);

  const yesterday = {
    rowsRead: yesterdayUsage.rowsRead,
    rowsWritten: yesterdayUsage.rowsWritten,
    workersRequests: yesterdayUsage.workersRequests,
    durableObjectsRequests: yesterdayUsage.durableObjectsRequests,
    durableObjectsHttpRequests: yesterdayUsage.durableObjectsHttpRequests,
    durableObjectsHibernationWakeups: yesterdayUsage.durableObjectsHibernationWakeups,
    durableObjectsInboundWebSocketMessages: yesterdayUsage.durableObjectsInboundWebSocketMessages,
    durableObjectsOutboundWebSocketMessages: yesterdayUsage.durableObjectsOutboundWebSocketMessages,
    durableObjectsRawRequests: yesterdayUsage.durableObjectsRawRequests,
    durableObjectsRequestsEstimated: yesterdayUsage.durableObjectsRequestsEstimated,
    durableObjectsRequestBillingRatio: yesterdayUsage.durableObjectsRequestBillingRatio,
    durableObjectsDuration: yesterdayUsage.durableObjectsDuration
  };

  return {
    today: {
      rowsRead: todayUsage.rowsRead,
      rowsWritten: todayUsage.rowsWritten,
      workersRequests: todayUsage.workersRequests,
      durableObjectsRequests: todayUsage.durableObjectsRequests,
      durableObjectsHttpRequests: todayUsage.durableObjectsHttpRequests,
      durableObjectsHibernationWakeups: todayUsage.durableObjectsHibernationWakeups,
      durableObjectsInboundWebSocketMessages: todayUsage.durableObjectsInboundWebSocketMessages,
      durableObjectsOutboundWebSocketMessages: todayUsage.durableObjectsOutboundWebSocketMessages,
      durableObjectsRawRequests: todayUsage.durableObjectsRawRequests,
      durableObjectsRequestsEstimated: todayUsage.durableObjectsRequestsEstimated,
      durableObjectsRequestBillingRatio: todayUsage.durableObjectsRequestBillingRatio,
      durableObjectsDuration: todayUsage.durableObjectsDuration
    },
    yesterday
  };
}

async function handleLoginAction({ request, env, sys, data }) {
  const { username, password } = data;

  if (!username || !password) {
    return createBadRequestResponse('missingCredentials');
  }

  const turnstileEnabled = sys && (sys.turnstile_enabled === 'true' || sys.turnstile_enabled === true);
  const turnstileLoginEnabled = sys && (sys.turnstile_login_enabled === 'true' || sys.turnstile_login_enabled === true);
  const turnstileSecretKey = sys && sys.turnstile_secret_key || '';

  if (turnstileEnabled || turnstileLoginEnabled) {
    const turnstileToken = request.headers.get('X-Turnstile-Token');
    const isTurnstileVerified = await verifyTurnstileToken(turnstileToken, turnstileSecretKey);

    if (!isTurnstileVerified) {
      return createErrorResponse(new AppError('verificationFailed', 403));
    }
  }

  const credentialResult = await validateCredentials(username, password, env, sys);

  if (!credentialResult.valid) {
    return createUnauthorizedResponse('invalidCredentials');
  }

  if (credentialResult.needsPasswordUpgrade) {
    try {
      const upgradedPasswordHash = await hashPassword(password);
      await saveSiteOptions(env.DB, { password: upgradedPasswordHash });
      if (sys) {
        sys.password = upgradedPasswordHash;
      }
    } catch (e) {
      console.error('Password hash upgrade failed:', e);
    }
  }

  try {
    const token = await generateToken(env, sys);
    return createSuccessResponse({
      success: true,
      token: token,
      message: 'loginSuccessful'
    }, {
      'Set-Cookie': buildAuthCookie(request, token)
    });
  } catch (e) {
    return createErrorResponse(e);
  }
}

function handleLogoutAction({ request }) {
  return createSuccessResponseWithCookies({
    success: true
  }, [
    buildClearAuthCookie(request),
    buildClearThemePreviewAuthCookie(request)
  ]);
}

function handleClearThemePreviewAuthAction({ request }) {
  return createSuccessResponseWithCookies({
    success: true
  }, [
    buildClearThemePreviewAuthCookie(request)
  ]);
}

const PUBLIC_ADMIN_ACTION_HANDLERS = {
  login: handleLoginAction,
  logout: handleLogoutAction,
  clear_theme_preview_auth: handleClearThemePreviewAuthAction
};

export function sanitizeAdminSettings(fullSettings = {}) {
  const { jwt_secret, password, ...safeSettings } = fullSettings || {};
  return {
    ...safeSettings,
    password_configured: Boolean(String(password || '').trim())
  };
}

async function handleGetSettingsAction({ env, sys, loadFullSettings }) {
  const fullSettings = loadFullSettings ? await loadFullSettings() : sys;
  return createSuccessResponse({
    success: true,
    settings: sanitizeAdminSettings(fullSettings),
    api_secret: env.API_SECRET
  });
}

async function handleStartThemePreviewAction({ request, data }) {
  const normalizedThemeUrl = normalizeThemeUrl(data.theme_url);
  if (!normalizedThemeUrl) {
    return createBadRequestResponse('invalidThemeUrl');
  }
  if (!await validateThemeUrlAvailable(normalizedThemeUrl)) {
    return createBadRequestResponse('invalidThemeUrl');
  }

  const token = extractBearerToken(request);
  if (!token) {
    return simpleAuthResponse();
  }

  return createSuccessResponse({
    success: true,
    preview_url: buildThemePreviewUrl(request, normalizedThemeUrl)
  }, {
    'Set-Cookie': buildThemePreviewAuthCookie(request, token)
  });
}

async function handleSaveThemeOptionsAction({ env, sys, data }) {
  const themeOptions = data.theme_options ?? data.settings?.theme_options;
  if (!isValidThemeOptions(themeOptions)) {
    return createBadRequestResponse('invalidThemeOptionsFormat');
  }

  await saveThemeOptions(env.DB, themeOptions);
  if (sys) {
    sys.theme_options = themeOptions;
  }

  return createSuccessResponse({
    success: true,
    theme_options: themeOptions,
    message: 'updateSuccess'
  });
}

async function handleListAction({ env }) {
  const servers = await getAllServers(env.DB);
  const latestMetricsMap = await getLatestMetricsForAllServers(env.DB);

  const now = Date.now();
  const ONLINE_THRESHOLD = 300000;
  const stats = {
    total: servers.length,
    online: 0,
    offline: 0,
    total_cpu: 0,
    total_net_in: 0,
    total_net_out: 0,
    avg_cpu: 0
  };

  const serversWithStatus = servers.map(server => {
    const latestMetrics = latestMetricsMap.get(server.id);
    const item = { ...server, region_override: server.region || '' };
    let isOnline = false;

    if (latestMetrics) {
      isOnline = (now - latestMetrics.timestamp) < ONLINE_THRESHOLD;
      mergeMetricsIntoServer(item, latestMetrics);
    } else {
      item.last_updated = 0;
      item.is_online = false;
      item.cpu_cores = 0;
      item.cpu_info = '';
      item.arch = '';
      item.os = '';
      item.agent_version = '';
      item.ip_v4 = '0';
      item.ip_v6 = '0';
      item.boot_time = '';
    }

    item.is_online = isOnline;
    if (!item.region) item.region = server.region || '';
    delete item.bandwidth;

    if (isOnline) {
      stats.online++;
      stats.total_cpu += parseFloat(item.cpu) || 0;
      stats.total_net_in += parseFloat(item.net_in_speed) || 0;
      stats.total_net_out += parseFloat(item.net_out_speed) || 0;
    } else {
      stats.offline++;
    }

    return item;
  });

  if (stats.online > 0) {
    stats.avg_cpu = (stats.total_cpu / stats.online).toFixed(2);
  }

  return createSuccessResponse({
    success: true,
    servers: serversWithStatus,
    stats
  });
}

async function handleD1UsageAction({ data, sys }) {
  const hasCloudflareToken = Object.prototype.hasOwnProperty.call(data, 'cloudflare_token');
  const hasCloudflareAccountId = Object.prototype.hasOwnProperty.call(data, 'cloudflare_account_id');
  const cloudflareToken = hasCloudflareToken ? data.cloudflare_token : (sys?.cloudflare_token || '');
  const cloudflareAccountId = hasCloudflareAccountId ? data.cloudflare_account_id : (sys?.cloudflare_account_id || '');

  try {
    const usage = await getD1DailyUsage(String(cloudflareToken || '').trim(), String(cloudflareAccountId || '').trim());
    return createSuccessResponse({
      success: true,
      usage,
      message: 'd1UsageQueried'
    });
  } catch (e) {
    return createBadRequestResponse(e.message);
  }
}

async function handleSendTestNotificationAction({ data }) {
  const {
    tg_bot_token,
    tg_chat_id,
    notification_webhook_enabled,
    notification_webhook_url,
    notification_webhook_method,
    notification_webhook_format,
    notification_webhook_headers,
    notification_webhook_body,
    notification_template,
    notification_timezone,
    expire_notification_time
  } = data;
  const webhookEnabled = normalizeBooleanSetting(notification_webhook_enabled) === 'true';
  if (webhookEnabled) {
    if (!notification_webhook_url || String(notification_webhook_url).trim().length === 0) {
      return createBadRequestResponse('notificationWebhookUrlRequired');
    }
  } else if (isSmtpNotificationTarget(tg_bot_token)) {
    // SMTP 邮件渠道（smtp:// 前缀）视为有效的内置通知目标
  } else if (!tg_bot_token || tg_bot_token.trim().length === 0) {
    return createBadRequestResponse('tgBotTokenRequired');
  }
  try {
    const testMsg = '这是一条来自 CF Server Monitor 的测试消息。';
    const result = await sendNotification({
      tg_bot_token,
      tg_chat_id: tg_chat_id || '',
      notification_webhook_enabled: normalizeBooleanSetting(notification_webhook_enabled),
      notification_webhook_url: notification_webhook_url || '',
      notification_webhook_method: normalizeNotificationWebhookMethod(notification_webhook_method),
      notification_webhook_format: normalizeNotificationWebhookFormat(notification_webhook_format),
      notification_webhook_headers: normalizeNotificationWebhookHeaders(notification_webhook_headers),
      notification_webhook_body: normalizeNotificationWebhookBody(notification_webhook_body),
      notification_template: normalizeNotificationTemplate(notification_template),
      notification_timezone: normalizeNotificationTimezone(notification_timezone),
      expire_notification_time: normalizeExpireNotificationTime(expire_notification_time)
    }, testMsg, {
      event: '测试通知',
      emoji: '✅',
      clients: ['CF Server Monitor'],
      count: 1,
      message: '这是一条来自 CF Server Monitor 的测试消息。'
    });
    if(result) {
      console.warn('Test notification failed:', result);
      // 附带具体失败原因，前端 i18n 未命中时会原样展示（不含密码等敏感信息）
      return createBadRequestResponse(`testNotificationFailed: ${result}`);
    }
    return createSuccessResponse({ success: true, message: 'testNotificationSent' });
  } catch (e) {
    return createBadRequestResponse(`testNotificationFailed: ${e?.message || e}`);
  }
}

const AUTHENTICATED_ADMIN_ACTION_HANDLERS = {
  get_settings: handleGetSettingsAction,
  start_theme_preview: handleStartThemePreviewAction,
  save_theme_options: handleSaveThemeOptionsAction,
  list: handleListAction,
  d1_usage: handleD1UsageAction,
  send_test_notification: handleSendTestNotificationAction
};

export async function handleAdminAPI(request, env, sys, loadFullSettings = null, ctx = null) {
  try {
    const data = await request.json();

    const publicActionHandler = PUBLIC_ADMIN_ACTION_HANDLERS[data.action];
    if (publicActionHandler) {
      return publicActionHandler({ request, env, sys, data, loadFullSettings, ctx });
    }

    if (!await checkAuth(request, env, sys)) {
      return simpleAuthResponse();
    }

    const authenticatedActionHandler = AUTHENTICATED_ADMIN_ACTION_HANDLERS[data.action];
    if (authenticatedActionHandler) {
      return authenticatedActionHandler({ request, env, sys, data, loadFullSettings, ctx });
    }

    if (data.action === 'save_settings') {
      const settings = data.settings || {};
      if (!String(sys?.password || '').trim() && !String(settings.password || '')) {
        return createBadRequestResponse('passwordRequired');
      }
      const normalizedThemeUrl = normalizeThemeUrl(settings.theme_url);
      if (normalizedThemeUrl === null) {
        return createBadRequestResponse('invalidThemeUrl');
      }
      if (normalizedThemeUrl && !await validateThemeUrlAvailable(normalizedThemeUrl)) {
        return createBadRequestResponse('invalidThemeUrl');
      }

      // 如果 turnstile_enabled 或 turnstile_login_enabled 开启，验证 turnstile_site_key 和 turnstile_secret_key 都不为空
      if (settings.turnstile_enabled === 'true' || settings.turnstile_enabled === true || settings.turnstile_login_enabled === 'true' || settings.turnstile_login_enabled === true) {
        if (!settings.turnstile_site_key || settings.turnstile_site_key.trim().length === 0) {
          return createBadRequestResponse('turnstileSiteKeyRequired');
        }
        if (!settings.turnstile_secret_key || settings.turnstile_secret_key.trim().length === 0) {
          return createBadRequestResponse('turnstileSecretKeyRequired');
        }
      }

      // 如果 tg_notify 或 expire_reminder 开启，验证 tg_bot_token 不为空
      const hasResourceAlertRulesInput = settings.resource_alert_rules !== undefined;
      const tgNotify = settings.tg_notify !== undefined
        ? normalizeTgNotify(settings.tg_notify)
        : normalizeTgNotify(sys?.tg_notify);
      const expireReminder = settings.expire_reminder !== undefined
        ? normalizeExpireReminder(settings.expire_reminder)
        : normalizeExpireReminder(sys?.expire_reminder);
      const currentResourceAlertRules = normalizeResourceAlertRules(sys?.resource_alert_rules);
      const normalizedResourceAlertRules = hasResourceAlertRulesInput
        ? normalizeResourceAlertRules(settings.resource_alert_rules)
        : currentResourceAlertRules;
      const resourceAlertEnabled = normalizedResourceAlertRules.length > 0;
      if (tgNotify !== '0' || expireReminder !== '0' || resourceAlertEnabled) {
        const webhookEnabled = settings.notification_webhook_enabled !== undefined
          ? normalizeBooleanSetting(settings.notification_webhook_enabled) === 'true'
          : normalizeBooleanSetting(sys?.notification_webhook_enabled) === 'true';
        const effectiveWebhookUrl = settings.notification_webhook_url !== undefined
          ? settings.notification_webhook_url
          : sys?.notification_webhook_url;
        const effectiveTgBotToken = settings.tg_bot_token !== undefined
          ? settings.tg_bot_token
          : sys?.tg_bot_token;
        if (webhookEnabled) {
          if (!effectiveWebhookUrl || String(effectiveWebhookUrl).trim().length === 0) {
            return createBadRequestResponse('notificationWebhookUrlRequired');
          }
        } else if (isSmtpNotificationTarget(effectiveTgBotToken)) {
          // SMTP 邮件渠道（smtp:// 前缀）视为有效的内置通知目标，允许通过告警门槛校验
        } else if (!effectiveTgBotToken || String(effectiveTgBotToken).trim().length === 0) {
          return createBadRequestResponse('tgBotTokenRequired');
        }
      }

      const pingNodes = normalizePingNodeFields(settings);
      if (!pingNodes.valid) {
        return createBadRequestResponse('invalidPingNodeFormat');
      }

      if (settings.appearance_options !== undefined && (
        settings.appearance_options === null ||
        typeof settings.appearance_options !== 'object' ||
        Array.isArray(settings.appearance_options)
      )) {
        return createBadRequestResponse('invalidThemeOptionsFormat');
      }

      const shouldSaveAppearanceOptions = hasAppearanceInput(settings);
      const appearanceOptions = {};

      if (shouldSaveAppearanceOptions) {
        const nestedAppearanceOptions = settings.appearance_options || {};
        for (const field of APPEARANCE_FIELDS) {
          const value = field === 'theme_options' ? nestedAppearanceOptions.theme_options : settings[field];
          if (value !== undefined) {
            // CSP 字段格式校验：只允许 https:// 开头的域名，逗号分隔
            if (field === 'csp_static' || field === 'csp_api') {
              appearanceOptions[field] = sanitizeCspDomains(value);
            } else if (field === 'display_mode') {
              appearanceOptions[field] = normalizeDisplayMode(value);
            } else if (field === 'preferred_theme') {
              appearanceOptions[field] = normalizePreferredTheme(value);
            } else if (field === 'default_language') {
              appearanceOptions[field] = normalizeDefaultLanguage(value);
            } else if (field === 'theme_options') {
              if (!isValidThemeOptions(value)) {
                return createBadRequestResponse('invalidThemeOptionsFormat');
              }
              appearanceOptions[field] = value;
            } else {
              appearanceOptions[field] = value;
            }
          }
        }
        await env.DB.prepare(
          'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
        ).bind('appearance_options', JSON.stringify(appearanceOptions)).run();
        clearAppearanceSettingsCache();
      }

      const siteOptions = {};
      for (const field of SITE_FIELDS) {
        if (settings[field] !== undefined) {
          if (field === 'password') {
            if (settings[field] && settings[field].length > 0) {
              siteOptions[field] = await hashPassword(settings[field]);
            }
          } else if (PING_NODE_FIELDS.includes(field)) {
            siteOptions[field] = pingNodes.values[field];
          } else if (field === 'tg_notify') {
            siteOptions[field] = tgNotify;
          } else if (field === 'expire_reminder') {
            siteOptions[field] = expireReminder;
          } else if (field === 'long_history_points') {
            siteOptions[field] = normalizeLongHistoryPoints(settings[field]);
          } else if (field === 'frontend_ws_timeout_minutes') {
            siteOptions[field] = normalizeFrontendWsTimeoutMinutes(settings[field]);
          } else if (field === 'resource_alert_rules') {
            siteOptions[field] = normalizedResourceAlertRules;
          } else if (field === 'wss_report_enabled') {
            siteOptions[field] = normalizeBooleanSetting(settings[field]);
          } else if (field === 'wss_report_hours') {
            siteOptions[field] = normalizeWssReportHours(settings[field]);
          } else if (field === 'show_three_net_details') {
            siteOptions[field] = normalizeBooleanSetting(settings[field]);
          } else if (field === 'notification_timezone') {
            siteOptions[field] = normalizeNotificationTimezone(settings[field]);
          } else if (field === 'expire_notification_time') {
            siteOptions[field] = normalizeExpireNotificationTime(settings[field]);
          } else if (field === 'notification_webhook_enabled') {
            siteOptions[field] = normalizeBooleanSetting(settings[field]);
          } else if (field === 'notification_webhook_method') {
            siteOptions[field] = normalizeNotificationWebhookMethod(settings[field]);
          } else if (field === 'notification_webhook_format') {
            siteOptions[field] = normalizeNotificationWebhookFormat(settings[field]);
          } else if (field === 'notification_webhook_headers') {
            siteOptions[field] = normalizeNotificationWebhookHeaders(settings[field]);
          } else if (field === 'notification_webhook_body') {
            siteOptions[field] = normalizeNotificationWebhookBody(settings[field]);
          } else if (field === 'notification_template') {
            siteOptions[field] = normalizeNotificationTemplate(settings[field]);
          } else if (field === 'theme_url') {
            siteOptions[field] = normalizedThemeUrl;
          } else {
            siteOptions[field] = settings[field];
          }
        }
      }
      await saveSiteOptions(env.DB, siteOptions);
      // 保存设置后非致命补列：确保 servers 表的告警相关列存在，避免启用月流量阈值后
      // 告警状态因缺列无法持久化而重复发送通知。设置已保存成功，补列失败不回滚、不报错。
      try {
        await addServerColumns(env.DB);
      } catch (e) {
        console.error('[settings-save] 保存设置后补列失败:', e);
      }
      const shouldCloseAgentWssReports = !isWssReportEnabled({ ...sys, ...siteOptions });
      // Keep existing states on rule edits so threshold increases can emit recovery notifications.
      // checkResourceAlerts prunes states for removed rules or servers on the next evaluation.
      if (hasResourceAlertRulesInput && !resourceAlertEnabled) {
        await clearResourceAlertState(env.DB);
      }
      Object.assign(sys, shouldSaveAppearanceOptions ? appearanceOptions : {}, siteOptions);
      if (shouldCloseAgentWssReports && (
        settings.wss_report_enabled !== undefined ||
        settings.wss_report_hours !== undefined
      )) {
        scheduleAgentReportModeChanged(env, ctx);
      }
      return createSuccessResponse({
        success: true,
        message: 'updateSuccess'
      });
    } 
    else if (data.action === 'add') {
      const name = data.name || 'New Server';
      if (!isValidName(name)) {
        return createBadRequestResponse('invalidServerName');
      }
      const networkInterfaces = normalizeNetworkInterfaceField(data.interface);
      if (!networkInterfaces.valid) {
        return createBadRequestResponse('invalidNetworkInterface');
      }
      
      const id = crypto.randomUUID();
      const group = data.server_group || 'Default';
      const region = normalizeServerRegion(data.region);

      try {
        const { max_order } = await env.DB.prepare('SELECT COALESCE(MAX(sort_order), -1) as max_order FROM servers').first();
        const sortOrder = (max_order || 0) + 1;

        const historyPartitionId = await getNextServerHistoryPartitionId(env.DB);

        await env.DB.prepare(`
          INSERT INTO servers
          (id, name, server_group, region, "interface", sort_order, history_partition_id, timestamp)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(id, name, group, region, networkInterfaces.value, sortOrder, historyPartitionId, Date.now()).run();
      } catch (e) {
        return handleServerMutationError(env.DB, e, 'serverAddFailed');
      }
      
      clearServersListCache();
      
      return createSuccessResponse({ 
        success: true, 
        id: id,
        message: 'serverAdded'
      });
    } 
    else if (data.action === 'delete') {
      const { id } = data;
      if (!id || !isValidUUID(id)) {
        return createBadRequestResponse('invalidServerId');
      }
      
      await deleteServer(env.DB, id);
      
      clearServersListCache();
      
      return createSuccessResponse({ 
        success: true, 
        message: 'serverDeleted'
      });
    } 
    else if (data.action === 'save_order') {
      const { orders } = data;
      if (!orders || !Array.isArray(orders) || orders.length === 0) {
        return createBadRequestResponse('missingSortData');
      }
      
      for (let i = 0; i < orders.length; i++) {
        if (!isValidUUID(orders[i])) {
          return createBadRequestResponse('invalidSortId');
        }
        await env.DB.prepare('UPDATE servers SET sort_order = ? WHERE id = ?').bind(i, orders[i]).run();
      }
      
      clearServersListCache();
      
      return createSuccessResponse({ 
        success: true, 
        message: 'sortOrderSaved'
      });
    }
    else if (data.action === 'edit') {
      const { id, name, server_group, region, tags, note, price, billing_cycle, auto_renewal, currency, expire_date, traffic_limit, traffic_calc_type, traffic_alert_percent, interface: networkInterfaceInput, reset_day, collect_interval, report_interval, wss_report_interval, connection_mode, ping_mode, auto_update, custom_ct, custom_cu, custom_cm, custom_bd, node_1, node_2, node_3, node_4, rx_correction, tx_correction, offline_notify_disabled, is_hidden } = data;
      if (!id || !isValidUUID(id)) {
        return createBadRequestResponse('invalidServerId');
      }
      const effectiveConnectionMode = isWssReportConfigured(sys) ? connection_mode : 'http';
      const agentConfigResult = validateAgentConfigInput({
        collect_interval,
        report_interval,
        wss_report_interval,
        reset_day,
        connection_mode: effectiveConnectionMode,
        ping_mode
      });
      if (!agentConfigResult.valid) {
        return createBadRequestResponse(agentConfigResult.error);
      }
      const normalizedAgentConfig = agentConfigResult.config;

      const pingNodes = normalizePingNodeFields({ custom_ct, custom_cu, custom_cm, custom_bd, node_1, node_2, node_3, node_4 });
      if (!pingNodes.valid) {
        return createBadRequestResponse('invalidPingNodeFormat');
      }
      const networkInterfaces = normalizeNetworkInterfaceField(networkInterfaceInput);
      if (!networkInterfaces.valid) {
        return createBadRequestResponse('invalidNetworkInterface');
      }
      const safeTags = String(tags || '')
        .split(',')
        .map(tag => tag.trim().replace(/[^\p{L}\p{N} ._\-]/gu, '').slice(0, 32))
        .filter(Boolean)
        .slice(0, 12)
        .join(',');
      const safeNote = String(note || '').trim().slice(0, 500);

      const toNullCorrection = (v) => {
        if (v === null || v === undefined || v === '') return null;
        return isValidTrafficCorrection(v) ? Number(v) : undefined;
      };
      const safeRx = toNullCorrection(rx_correction);
      const safeTx = toNullCorrection(tx_correction);
      if (safeRx === undefined || safeTx === undefined) {
        return createBadRequestResponse('invalidTrafficCorrection');
      }

      const billingData = normalizeServerBillingData({
        price,
        billing_cycle,
        auto_renewal,
        currency,
        expire_date
      });
      
      try {
        await env.DB.prepare(`
          UPDATE servers
          SET name = ?, server_group = ?, region = ?, tags = ?, note = ?, price = ?, billing_cycle = ?, auto_renewal = ?, currency = ?, expire_date = ?, traffic_limit = ?, traffic_calc_type = ?, "interface" = ?, reset_day = ?, collect_interval = ?, report_interval = ?, wss_report_interval = ?, connection_mode = ?, ping_mode = ?, auto_update = ?, custom_ct = ?, custom_cu = ?, custom_cm = ?, custom_bd = ?, node_1 = ?, node_2 = ?, node_3 = ?, node_4 = ?, rx_correction = ?, tx_correction = ?, offline_notify_disabled = ?, is_hidden = ?, traffic_alert_percent = ?
          WHERE id = ?
        `).bind(
          name || '',
          server_group || 'Default',
          normalizeServerRegion(region),
          safeTags,
          safeNote,
          billingData.price,
          billingData.billing_cycle,
          billingData.auto_renewal,
          billingData.currency,
          billingData.expire_date,
          traffic_limit || '',
          traffic_calc_type || 'total',
          networkInterfaces.value,
          normalizedAgentConfig.reset_day,
          normalizedAgentConfig.collect_interval,
          normalizedAgentConfig.report_interval,
          normalizedAgentConfig.wss_report_interval,
          normalizedAgentConfig.connection_mode,
          normalizedAgentConfig.ping_mode,
          normalizeBooleanFlag(auto_update),
          pingNodes.values.custom_ct ?? null,
          pingNodes.values.custom_cu ?? null,
          pingNodes.values.custom_cm ?? null,
          pingNodes.values.custom_bd ?? null,
          pingNodes.values.node_1 ?? null,
          pingNodes.values.node_2 ?? null,
          pingNodes.values.node_3 ?? null,
          pingNodes.values.node_4 ?? null,
          safeRx,
          safeTx,
          normalizeBooleanFlag(offline_notify_disabled),
          normalizeBooleanFlag(is_hidden),
          normalizePctOrNull(traffic_alert_percent),
          id
        ).run();
      } catch (e) {
        return handleServerMutationError(env.DB, e, 'serverUpdateFailed');
      }
      
      clearServersListCache();
      scheduleAgentConfigChanged(env, ctx, id);
      
      return createSuccessResponse({ 
        success: true, 
        message: 'serverUpdated'
      });
    }
    else if (data.action === 'batch_delete') {
      const { ids } = data;
      if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return createBadRequestResponse('selectServersToDelete');
      }
      
      for (const id of ids) {
        if (!isValidUUID(id)) {
          return createBadRequestResponse('invalidServerIdInList');
        }
      }
      
      for (const id of ids) {
        await deleteServer(env.DB, id);
      }
      
      clearServersListCache();
      
      return createSuccessResponse({ 
        success: true, 
        message: 'batchDeleted'
      });
    }
    
    else if (data.action === 'export_servers') {
      try {
        const servers = await env.DB.prepare('SELECT * FROM servers ORDER BY sort_order ASC').all();
        return createSuccessResponse({
          success: true,
          servers: servers.results || [],
          message: 'serversExported'
        });
      } catch (e) {
        return createBadRequestResponse('serversExportFailed');
      }
    }
    else if (data.action === 'import_servers') {
      const { servers: importData } = data;
      if (!importData || !Array.isArray(importData) || importData.length === 0) {
        return createBadRequestResponse('noServersToImport');
      }

      // 导入前先补列：INSERT 显式写入 traffic_alert_percent，缺列会导致每条导入全部跳过
      // 且不自动补列，与单个新增/编辑的行为不一致。此处先确保列存在（非致命，失败仍继续导入）。
      try {
        await addServerColumns(env.DB);
      } catch (e) {
        console.error('[import_servers] 导入前补列失败:', e);
      }

      const existingServers = await env.DB.prepare('SELECT id FROM servers').all();
      const existingIds = new Set((existingServers.results || []).map(s => s.id));

      const existingPartitionIds = await env.DB.prepare('SELECT history_partition_id FROM servers').all();
      const usedPartitionIds = new Set(
        (existingPartitionIds.results || []).map(s => s.history_partition_id).filter(id => id > 0)
      );

      let imported = 0;
      let skipped = 0;
      const skippedIds = [];

      for (const server of importData) {
        if (!server.id || !isValidUUID(server.id)) {
          skipped++;
          skippedIds.push(server.id || '(invalid)');
          continue;
        }

        if (existingIds.has(server.id)) {
          skipped++;
          skippedIds.push(server.id);
          continue;
        }

        let partitionId = Number(server.history_partition_id) || 0;
        if (partitionId <= 0 || partitionId > HISTORY_MAX_PARTITION_ID || usedPartitionIds.has(partitionId)) {
          partitionId = 0;
          for (let id = 1; id <= HISTORY_MAX_PARTITION_ID; id++) {
            if (!usedPartitionIds.has(id)) {
              partitionId = id;
              break;
            }
          }
          if (partitionId === 0) {
            skipped++;
            skippedIds.push(server.id);
            continue;
          }
        }

        usedPartitionIds.add(partitionId);
        existingIds.add(server.id);

        const billingData = normalizeServerBillingData(server);
        const networkInterfaces = normalizeNetworkInterfaceField(server.interface);
        if (!networkInterfaces.valid) {
          skipped++;
          skippedIds.push(server.id);
          continue;
        }

        try {
          await env.DB.prepare(`
            INSERT INTO servers (id, name, server_group, region, tags, note, price, billing_cycle, auto_renewal,
              currency, expire_date,
              traffic_limit, traffic_calc_type, "interface", reset_day, collect_interval, report_interval, wss_report_interval, connection_mode, ping_mode,
              auto_update, custom_ct, custom_cu, custom_cm, custom_bd, node_1, node_2, node_3, node_4, rx_correction, tx_correction,
              offline_notify_disabled, is_hidden, sort_order, history_partition_id, timestamp, traffic_alert_percent)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(
            server.id,
            server.name || '',
            server.server_group || 'Default',
            normalizeServerRegion(server.region),
            server.tags || '',
            server.note || '',
            billingData.price,
            billingData.billing_cycle,
            billingData.auto_renewal,
            billingData.currency,
            billingData.expire_date,
            server.traffic_limit || '',
            server.traffic_calc_type || 'total',
            networkInterfaces.value,
            server.reset_day ?? 1,
            server.collect_interval ?? 0,
            server.report_interval ?? 60,
            normalizeWssReportInterval(server.wss_report_interval),
            normalizeConnectionMode(server.connection_mode) || 'auto',
            normalizePingMode(server.ping_mode) || 'tcp',
            normalizeBooleanFlag(server.auto_update),
            normalizeImportedPingNodeValue(server.custom_ct),
            normalizeImportedPingNodeValue(server.custom_cu),
            normalizeImportedPingNodeValue(server.custom_cm),
            normalizeImportedPingNodeValue(server.custom_bd),
            normalizeImportedPingNodeValue(server.node_1), normalizeImportedPingNodeValue(server.node_2),
            normalizeImportedPingNodeValue(server.node_3), normalizeImportedPingNodeValue(server.node_4),
            server.rx_correction ?? null,
            server.tx_correction ?? null,
            normalizeBooleanFlag(server.offline_notify_disabled),
            normalizeBooleanFlag(server.is_hidden),
            server.sort_order ?? 0,
            partitionId,
            server.timestamp || Date.now(),
            normalizePctOrNull(server.traffic_alert_percent)
          ).run();
          imported++;
        } catch (e) {
          skipped++;
          skippedIds.push(server.id);
        }
      }

      clearServersListCache();

      return createSuccessResponse({
        success: true,
        imported,
        skipped,
        skippedIds,
        message: imported > 0 ? 'serversImported' : 'noServersImported'
      });
    }
    
    return createBadRequestResponse('unknownAction');
    
  } catch (e) {
    console.error('Admin API 错误:', e);
    return createErrorResponse(e);
  }
}
