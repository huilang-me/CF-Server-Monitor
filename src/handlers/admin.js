import { checkAuth, simpleAuthResponse, validateCredentials, generateToken } from '../middleware/auth.js';
import { getLatestMetricsForAllServers } from '../database/schema.js';
import { getAllServers, clearServersListCache } from '../utils/cache.js';
import { clearAppearanceSettingsCache, normalizeDisplayMode, normalizeExpireReminder, normalizeLongHistoryPoints, normalizeResourceAlertRules, normalizeTgNotify, saveSiteOptions, SITE_FIELDS, APPEARANCE_FIELDS } from '../utils/settings.js';
import { mergeMetricsIntoServer } from '../utils/metrics.js';
import { verifyTurnstileToken, hashPassword } from '../utils/common.js';
import { AppError, createSuccessResponse, createBadRequestResponse, createUnauthorizedResponse, createErrorResponse } from '../utils/errors.js';
import { addServerColumns } from '../database/updateDatabase.js';
import { clearResourceAlertState, sendNotification } from '../services/notification.js';
import { getNextServerHistoryPartitionId, HISTORY_MAX_PARTITION_ID } from '../database/indexOptimization.js';
import { isValidTrafficCorrection, validateAgentConfigInput, validatePingNode } from '../utils/agentConfig.js';
import { detectBillingCycle, detectCurrencySymbol, normalizeBillingCycle, normalizeCurrency, normalizePrice, renewExpireDateIfNeeded } from '../utils/serverBilling.js';

const PING_NODE_FIELDS = ['custom_ct', 'custom_cu', 'custom_cm', 'custom_bd'];
const THEME_PREVIEW_AUTH_COOKIE = 'cfsm_theme_preview_auth';
const THEME_PREVIEW_AUTH_TTL = 600;

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
    const result = validatePingNode(source?.[field]);
    if (!result.valid) {
      return { valid: false, field };
    }
    values[field] = result.value;
  }
  return { valid: true, values };
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
  return `${THEME_PREVIEW_AUTH_COOKIE}=${encodeURIComponent(token)}; Max-Age=${THEME_PREVIEW_AUTH_TTL}; Path=/; HttpOnly; SameSite=Lax${secure}`;
}

function buildClearThemePreviewAuthCookie(request) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${THEME_PREVIEW_AUTH_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${secure}`;
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

function getLast24HoursRange() {
  const now = new Date();
  const end = now;
  const start = new Date(now.getTime() - 86400000);
  return {
    date: start.toISOString().slice(0, 10) + ' ~ ' + end.toISOString().slice(0, 10),
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

async function fetchCloudflareUsage(token, accountId, range) {
  const query = `query CloudflareUsage($accountTag: string!, $start: Date, $end: Date, $startTime: string, $endTime: string) {
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
      }
    }
  }`;
  const data = await cloudflareGraphql(query, {
    accountTag: accountId,
    start: range.start || range.startTime.slice(0, 10),
    end: range.end || range.endTime.slice(0, 10),
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
  return { rowsRead: usage.rowsRead, rowsWritten: usage.rowsWritten, workersRequests, databaseCount: groups.length };
}

async function getD1DailyUsage(token, accountId) {
  if (!token) throw new Error('cloudflareTokenRequired');
  if (!accountId) throw new Error('cloudflareAccountIdRequired');

  const todayRange = getUtcTodayRange();
  const last24Range = getLast24HoursRange();

  const [todayUsage, last24Usage] = await Promise.all([
    fetchCloudflareUsage(token, accountId, todayRange),
    fetchCloudflareUsage(token, accountId, last24Range)
  ]);

  return {
    today: {
      rowsRead: todayUsage.rowsRead,
      rowsWritten: todayUsage.rowsWritten,
      workersRequests: todayUsage.workersRequests
    },
    last24Hours: {
      rowsRead: last24Usage.rowsRead,
      rowsWritten: last24Usage.rowsWritten,
      workersRequests: last24Usage.workersRequests
    }
  };
}

export async function handleAdminAPI(request, env, sys, loadFullSettings = null) {
  try {
    const data = await request.json();

    if (data.action === 'login') {
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

      const authHeader = 'Basic ' + btoa(username + ':' + password);
      const mockRequest = {
        headers: {
          get: (key) => key === 'Authorization' ? authHeader : null
        }
      };

      const credentialResult = await validateCredentials(mockRequest, env, sys);
      
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
        });
      } catch (e) {
        return createErrorResponse(e);
      }
    }

    if (data.action === 'clear_theme_preview_auth') {
      return createSuccessResponse({
        success: true
      }, {
        'Set-Cookie': buildClearThemePreviewAuthCookie(request)
      });
    }

    if (!await checkAuth(request, env, sys)) {
      return simpleAuthResponse();
    }

    if (data.action === 'get_settings') {
      const fullSettings = loadFullSettings ? await loadFullSettings() : sys;
      const { jwt_secret, ...safeSettings } = fullSettings || {};
      return createSuccessResponse({
        success: true,
        settings: safeSettings,
        api_secret: env.API_SECRET
      });
    }
    else if (data.action === 'start_theme_preview') {
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
    else if (data.action === 'list') {
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
          item.ip = latestMetrics.ip || '';
        } else {
          item.last_updated = 0;
          item.is_online = false;
          item.cpu_cores = 0;
          item.cpu_info = '';
          item.arch = '';
          item.os = '';
          item.agent_version = '';
          item.ip = '';
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
    else if (data.action === 'd1_usage') {
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
    else if (data.action === 'send_test_notification') {
      const { tg_bot_token, tg_chat_id } = data;
      if (!tg_bot_token || tg_bot_token.trim().length === 0) {
        return createBadRequestResponse('tgBotTokenRequired');
      }
      try {
        const testMsg = `✅ **测试通知**\n\n这是一条来自 CF Server Monitor 的测试消息。\n\n**时间:** ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`;
        const result = await sendNotification({ tg_bot_token, tg_chat_id: tg_chat_id || '' }, testMsg);
        if(result) {
          console.warn('Test notification failed:', result);
          return createBadRequestResponse('testNotificationFailed');
        }
        return createSuccessResponse({ success: true, message: 'testNotificationSent' });
      } catch (e) {
        return createBadRequestResponse('testNotificationFailed');
      }
    }
    else if (data.action === 'save_settings') {
      const settings = data.settings || {};
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
        const effectiveTgBotToken = settings.tg_bot_token !== undefined
          ? settings.tg_bot_token
          : sys?.tg_bot_token;
        if (!effectiveTgBotToken || String(effectiveTgBotToken).trim().length === 0) {
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
            } else if (field === 'theme_options') {
              if (value === null || typeof value !== 'object' || Array.isArray(value)) {
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
          } else if (field === 'resource_alert_rules') {
            siteOptions[field] = normalizedResourceAlertRules;
          } else if (field === 'theme_url') {
            siteOptions[field] = normalizedThemeUrl;
          } else {
            siteOptions[field] = settings[field];
          }
        }
      }
      await saveSiteOptions(env.DB, siteOptions);
      // Keep existing states on rule edits so threshold increases can emit recovery notifications.
      // checkResourceAlerts prunes states for removed rules or servers on the next evaluation.
      if (hasResourceAlertRulesInput && !resourceAlertEnabled) {
        await clearResourceAlertState(env.DB);
      }
      Object.assign(sys, shouldSaveAppearanceOptions ? appearanceOptions : {}, siteOptions);
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
      
      const id = crypto.randomUUID();
      const group = data.server_group || 'Default';
      const region = normalizeServerRegion(data.region);

      try {
        const { max_order } = await env.DB.prepare('SELECT COALESCE(MAX(sort_order), -1) as max_order FROM servers').first();
        const sortOrder = (max_order || 0) + 1;

        const historyPartitionId = await getNextServerHistoryPartitionId(env.DB);

        await env.DB.prepare(`
          INSERT INTO servers
          (id, name, server_group, region, sort_order, history_partition_id, timestamp)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).bind(id, name, group, region, sortOrder, historyPartitionId, Date.now()).run();
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
      const { id, name, server_group, region, tags, note, price, billing_cycle, auto_renewal, currency, expire_date, traffic_limit, traffic_calc_type, reset_day, collect_interval, report_interval, auto_update, custom_ct, custom_cu, custom_cm, custom_bd, rx_correction, tx_correction, offline_notify_disabled, is_hidden } = data;
      if (!id || !isValidUUID(id)) {
        return createBadRequestResponse('invalidServerId');
      }
      const agentConfigResult = validateAgentConfigInput({
        collect_interval,
        report_interval,
        reset_day
      });
      if (!agentConfigResult.valid) {
        return createBadRequestResponse(agentConfigResult.error);
      }
      const normalizedAgentConfig = agentConfigResult.config;

      const pingNodes = normalizePingNodeFields({ custom_ct, custom_cu, custom_cm, custom_bd });
      if (!pingNodes.valid) {
        return createBadRequestResponse('invalidPingNodeFormat');
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
          SET name = ?, server_group = ?, region = ?, tags = ?, note = ?, price = ?, billing_cycle = ?, auto_renewal = ?, currency = ?, expire_date = ?, traffic_limit = ?, traffic_calc_type = ?, reset_day = ?, collect_interval = ?, report_interval = ?, auto_update = ?, custom_ct = ?, custom_cu = ?, custom_cm = ?, custom_bd = ?, rx_correction = ?, tx_correction = ?, offline_notify_disabled = ?, is_hidden = ?
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
          normalizedAgentConfig.reset_day,
          normalizedAgentConfig.collect_interval,
          normalizedAgentConfig.report_interval,
          normalizeBooleanFlag(auto_update),
          pingNodes.values.custom_ct,
          pingNodes.values.custom_cu,
          pingNodes.values.custom_cm,
          pingNodes.values.custom_bd,
          safeRx,
          safeTx,
          normalizeBooleanFlag(offline_notify_disabled),
          normalizeBooleanFlag(is_hidden),
          id
        ).run();
      } catch (e) {
        return handleServerMutationError(env.DB, e, 'serverUpdateFailed');
      }
      
      clearServersListCache();
      
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

        try {
          await env.DB.prepare(`
            INSERT INTO servers (id, name, server_group, region, tags, note, price, billing_cycle, auto_renewal,
              currency, expire_date,
              traffic_limit, traffic_calc_type, reset_day, collect_interval, report_interval,
              auto_update, custom_ct, custom_cu, custom_cm, custom_bd, rx_correction, tx_correction,
              offline_notify_disabled, is_hidden, sort_order, history_partition_id, timestamp)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            server.reset_day ?? 1,
            server.collect_interval ?? 0,
            server.report_interval ?? 60,
            normalizeBooleanFlag(server.auto_update),
            server.custom_ct || '',
            server.custom_cu || '',
            server.custom_cm || '',
            server.custom_bd || '',
            server.rx_correction ?? null,
            server.tx_correction ?? null,
            normalizeBooleanFlag(server.offline_notify_disabled),
            normalizeBooleanFlag(server.is_hidden),
            server.sort_order ?? 0,
            partitionId,
            server.timestamp || Date.now()
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
