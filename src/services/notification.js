import { getLatestTimestampsForAllServers } from '../database/schema.js';
import { clearServersListCache, getAllServers } from '../utils/cache.js';
import {
  DEFAULT_NOTIFICATION_TEMPLATE,
  getExpireReminderDays,
  getResourceAlertConfig,
  getResourceAlertRuleThresholds,
  getTgNotifyMinutes,
  loadSiteSettings,
  normalizeExpireNotificationTime,
  normalizeBooleanSetting,
  normalizeNotificationTemplate,
  normalizeNotificationTimezone,
  normalizeNotificationWebhookBody,
  normalizeNotificationWebhookFormat,
  normalizeNotificationWebhookHeaders,
  normalizeNotificationWebhookMethod,
  debug
} from '../utils/settings.js';
import {
  GB,
  getTrafficUsageBytes,
  normalizePct,
  normalizePctOrNull,
  normalizeTrafficLimitGb
} from '../utils/traffic.js';
import { detectBillingCycle, isEnabledFlag, normalizeBillingCycle, renewExpireDateIfNeeded } from '../utils/serverBilling.js';
import {
  NOTIFICATION_MAX_RETRIES,
  NOTIFICATION_RETRY_DELAY_MS,
  RESOURCE_ALERT_EVALUATE_RULE_BATCH_SIZE,
  RESOURCE_ALERT_EVALUATE_SERVER_BATCH_SIZE,
  RESOURCE_ALERT_NOTIFICATION_SOFT_LIMIT
} from '../utils/config.js';
import { getNotificationMessages } from './notificationMessages.js';

const RESOURCE_ALERT_STATE_ACTIVE = 'active';
const RESOURCE_ALERT_STATE_RECOVERED = 'recovered';
const RESOURCE_ALERT_STATE_KEY = 'resource_alert_state';
const DAY_MS = 24 * 60 * 60 * 1000;

// 记录本 isolate 是否已确认资源告警状态为空，避免每分钟重复执行一次 DELETE
let resourceAlertStateKnownEmpty = false;

function getZonedDateParts(timestamp = Date.now(), timezone = 'UTC') {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  const timeZone = normalizeNotificationTimezone(timezone);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map(part => [part.type, part.value])
  );
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second
  };
}

function formatNotificationTime(timestamp = Date.now(), settings = {}) {
  const parts = getZonedDateParts(timestamp, settings?.notification_timezone);
  if (!parts) return getNotificationMessages(settings).invalidTime;
  const pad = value => String(value).padStart(2, '0');
  return `${Number(parts.year)}/${Number(parts.month)}/${Number(parts.day)} ` +
    `${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}`;
}

function formatLastReportTime(timestamp, settings = {}) {
  if (!timestamp) return getNotificationMessages(settings).noReport;

  return formatNotificationTime(timestamp, settings);
}

function isExpireNotificationTimeDue(settings = {}, timestamp = Date.now()) {
  const parts = getZonedDateParts(timestamp, settings.notification_timezone);
  if (!parts) return false;
  return Number(parts.hour) === Number(normalizeExpireNotificationTime(settings.expire_notification_time));
}

function getZonedDateSerial(timestamp, timezone) {
  const parts = getZonedDateParts(timestamp, timezone);
  if (!parts) return NaN;
  return Math.floor(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)) / DAY_MS);
}

function parseDateSerial(dateString) {
  const match = String(dateString || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return NaN;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return NaN;
  }
  return Math.floor(date.getTime() / DAY_MS);
}

function formatMegabitsPerSecond(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return '0 Mbps';
  const mbps = number * 8 / 1000 / 1000;
  return `${mbps >= 10 ? mbps.toFixed(1) : mbps.toFixed(2)} Mbps`;
}

function formatPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '0%';
  return `${number.toFixed(number >= 10 ? 1 : 2)}%`;
}

function getResourceMetricLabel(metric, messages) {
  const metricLabels = {
    cpu: 'CPU',
    ram: 'RAM',
    disk: 'DISK',
    ...messages.metrics
  };
  return metricLabels[metric?.metric] || metric?.metric || '';
}

function formatResourceMetricValue(metric, value) {
  if (metric?.metric === 'cpu' || metric?.metric === 'ram' || metric?.metric === 'disk') {
    return formatPercent(value);
  }
  return formatMegabitsPerSecond(value);
}

function parseResourceAlertState(row) {
  if (!row || !row.value) return { signature: '', servers: {} };
  try {
    const parsed = JSON.parse(row.value);
    if (parsed && typeof parsed === 'object' && parsed.servers && typeof parsed.servers === 'object') {
      return {
        signature: String(parsed.signature || ''),
        servers: parsed.servers
      };
    }
  } catch (_) {}
  return { signature: '', servers: {} };
}

function hasResourceAlertStateEntries(alertState) {
  return alertState && typeof alertState === 'object' && Object.keys(alertState).length > 0;
}

function getD1Changes(result) {
  const changes = Number(result?.meta?.changes ?? result?.changes ?? 0);
  return Number.isFinite(changes) && changes > 0 ? changes : 0;
}

export async function clearResourceAlertState(db) {
  if (!db) return false;
  const result = await db.prepare(
    `DELETE FROM settings WHERE key = ?`
  ).bind(RESOURCE_ALERT_STATE_KEY).run();
  resourceAlertStateKnownEmpty = true;
  return getD1Changes(result) > 0;
}

async function saveResourceAlertState(db, configSignature, alertState, hadStoredState) {
  if (hasResourceAlertStateEntries(alertState)) {
    await db.prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    ).bind(RESOURCE_ALERT_STATE_KEY, JSON.stringify({ signature: configSignature, servers: alertState })).run();
    resourceAlertStateKnownEmpty = false;
    return;
  }

  if (hadStoredState) {
    await clearResourceAlertState(db);
  }
}

function getResourceAlertStateStatus(state) {
  if (!state || typeof state !== 'object') return RESOURCE_ALERT_STATE_ACTIVE;
  return state.status === RESOURCE_ALERT_STATE_RECOVERED
    ? RESOURCE_ALERT_STATE_RECOVERED
    : RESOURCE_ALERT_STATE_ACTIVE;
}

function getResourceAlertStateTimestamp(state, key) {
  if (!state || typeof state !== 'object') return 0;
  const timestamp = Number(state[key] || 0);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : 0;
}

function getStoredResourceAlertMetrics(alert) {
  return (alert?.metrics || []).map(m => ({
    metric: m.metric,
    mode: m.mode,
    threshold: m.threshold,
    triggerValue: m.triggerValue ?? m.current
  }));
}

function canRecoverResourceAlert(evaluation) {
  const metrics = Array.isArray(evaluation?.metrics) ? evaluation.metrics : [];
  return metrics.length > 0 && metrics.every(metric => {
    const current = Number(metric?.current);
    const threshold = Number(metric?.threshold);
    return Number.isFinite(current) && Number.isFinite(threshold) && current < threshold;
  });
}

function getResourceAlertRuleIntervalMs(rule) {
  const minutes = Number(rule?.intervalMinutes);
  const normalizedMinutes = Number.isFinite(minutes) && minutes > 0 ? minutes : 5;
  return Math.max(5, normalizedMinutes) * 60 * 1000;
}

function formatCurrentTime(settings = {}) {
  return formatNotificationTime(Date.now(), settings);
}

function getResourceAlertRuleStateKey(rule, serverId) {
  return `${rule.id}:${serverId}`;
}

function getResourceAlertRuleServerIds(rule, servers) {
  const allServerIds = servers.map(server => String(server.id)).filter(Boolean);
  if (!Array.isArray(rule.servers) || rule.servers.length === 0) {
    return allServerIds;
  }

  const allowed = new Set(allServerIds);
  const seen = new Set();
  const ids = [];
  for (const serverId of rule.servers) {
    const id = String(serverId || '').trim();
    if (!id || !allowed.has(id) || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function formatConciseResourceMetric(metric, valueKey, messages) {
  const label = getResourceMetricLabel(metric, messages);
  const value = metric?.[valueKey] ?? metric?.current;
  return `${label} ${formatResourceMetricValue(metric, value)}`;
}

function buildGroupedResourceAlertEntries(nodes, valueKey, messages) {
  const groups = new Map();

  for (const item of Array.isArray(nodes) ? nodes : []) {
    const serverName = String(item?.server?.name || '').trim();
    if (!serverName) continue;

    const sourceMetrics = item.alert?.metrics || item.metrics || [];
    if (!Array.isArray(sourceMetrics) || sourceMetrics.length === 0) continue;

    let group = groups.get(serverName);
    if (!group) {
      group = { serverName, metrics: [], seen: new Set() };
      groups.set(serverName, group);
    }

    for (const metric of sourceMetrics) {
      const text = formatConciseResourceMetric(metric, valueKey, messages);
      if (!text || group.seen.has(text)) continue;
      group.seen.add(text);
      group.metrics.push(text);
    }
  }

  return Array.from(groups.values())
    .filter(group => group.metrics.length > 0)
    .map(group => ({
      serverName: group.serverName,
      text: `${group.serverName}  ${group.metrics.join('  ')}`
    }));
}

function appendResourceAlertNotificationChunks(payloads, entries, options) {
  if (!Array.isArray(entries) || entries.length === 0) return;

  let chunkEntries = [];
  let chunkClients = [];
  const flush = () => {
    if (chunkEntries.length === 0) return;

    const nodeList = chunkEntries.map(entry => entry.text).join('\n');
    payloads.push({
      msg: nodeList,
      context: {
        event: options.event,
        emoji: options.emoji,
        clients: chunkClients,
        count: new Set(chunkClients).size || chunkEntries.length,
        message: nodeList
      }
    });
    chunkEntries = [];
    chunkClients = [];
  };

  for (const entry of entries) {
    const candidateEntries = [...chunkEntries, entry];
    const candidateNodeList = candidateEntries.map(item => item.text).join('\n');
    const candidate = candidateNodeList;
    if (chunkEntries.length > 0 && candidate.length > RESOURCE_ALERT_NOTIFICATION_SOFT_LIMIT) {
      flush();
    }
    chunkEntries.push(entry);
    if (entry.serverName) chunkClients.push(entry.serverName);
  }

  flush();
}

export function buildResourceAlertNotificationPayloads(alertNodes, recoveredNodes, settings = {}) {
  const messages = getNotificationMessages(settings);
  const payloads = [];
  appendResourceAlertNotificationChunks(
    payloads,
    buildGroupedResourceAlertEntries(alertNodes, 'triggerValue', messages),
    {
      event: messages.events.resourceAlert,
      emoji: '❌'
    }
  );
  appendResourceAlertNotificationChunks(
    payloads,
    buildGroupedResourceAlertEntries(recoveredNodes, 'current', messages),
    {
      event: messages.events.resourceRecovered,
      emoji: '✅'
    }
  );
  return payloads;
}

async function evaluateResourceAlertRules(stub, ruleRequests) {
  const resultMap = new Map();
  const requests = [];

  for (const item of Array.isArray(ruleRequests) ? ruleRequests : []) {
    const serverIds = Array.isArray(item?.serverIds) ? item.serverIds : [];
    for (let offset = 0; offset < serverIds.length; offset += RESOURCE_ALERT_EVALUATE_SERVER_BATCH_SIZE) {
      requests.push({
        rule: item.rule,
        serverIds: serverIds.slice(offset, offset + RESOURCE_ALERT_EVALUATE_SERVER_BATCH_SIZE)
      });
    }
  }

  for (let offset = 0; offset < requests.length; offset += RESOURCE_ALERT_EVALUATE_RULE_BATCH_SIZE) {
    const batch = requests.slice(offset, offset + RESOURCE_ALERT_EVALUATE_RULE_BATCH_SIZE);
    if (batch.length === 0) continue;

    try {
      const response = await stub.fetch('http://internal/evaluate-resource-alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rules: batch.map(({ rule, serverIds }) => ({
            ruleId: rule.id,
            serverIds,
            mode: rule.mode,
            windowMinutes: Number(rule.intervalMinutes),
            thresholds: getResourceAlertRuleThresholds(rule)
          }))
        })
      });

      if (!response.ok) {
        console.warn('[ResourceAlert] DO evaluate failed:', response.status);
        continue;
      }

      const result = await response.json();
      for (const item of Array.isArray(result?.results) ? result.results : []) {
        const ruleId = String(item?.ruleId || '').trim();
        if (!ruleId) continue;
        const existing = resultMap.get(ruleId) || {
          alerts: [],
          evaluatedServerIds: [],
          evaluations: []
        };
        existing.alerts.push(...(Array.isArray(item.alerts) ? item.alerts : []));
        existing.evaluatedServerIds.push(...(
          Array.isArray(item.evaluatedServerIds)
            ? item.evaluatedServerIds.map(id => String(id)).filter(Boolean)
            : []
        ));
        existing.evaluations.push(...(
          Array.isArray(item.evaluations)
            ? item.evaluations.filter(evaluation => evaluation && evaluation.serverId)
            : []
        ));
        resultMap.set(ruleId, existing);
      }
    } catch (e) {
      console.warn('[ResourceAlert] DO evaluate failed:', e?.message || e);
    }
  }

  return resultMap;
}

async function fetchWithRetry(url, options, retries = NOTIFICATION_MAX_RETRIES) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, options);
      if (response.ok) return response;
      
      if (i < retries - 1) {
        await new Promise(resolve => setTimeout(resolve, NOTIFICATION_RETRY_DELAY_MS));
      }
    } catch (e) {
      if (i < retries - 1) {
        await new Promise(resolve => setTimeout(resolve, NOTIFICATION_RETRY_DELAY_MS));
      } else {
        throw e;
      }
    }
  }
  throw new Error('Max retries exceeded');
}

function stripMarkdown(value) {
  return String(value || '')
    .replace(/\*\*/g, '')
    .replace(/^[\s✅⚠️⏰💌•-]+/u, '')
    .trim();
}

function inferNotificationEvent(msg, fallback) {
  const firstLine = String(msg || '').split('\n').find(line => line.trim());
  return stripMarkdown(firstLine || fallback) || fallback;
}

function escapeJsonStringFragment(value) {
  return JSON.stringify(String(value ?? '')).slice(1, -1);
}

function renderTemplate(template, data, options = {}) {
  const source = String(template || '');
  return source.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_, key) => {
    const value = data[key] ?? '';
    return options.jsonString ? escapeJsonStringFragment(value) : String(value);
  });
}

function normalizeNotificationClients(context = {}) {
  const source = Array.isArray(context.clients)
    ? context.clients
    : (context.client ? String(context.client).split(',') : []);
  const clients = source
    .map(client => String(client || '').trim())
    .filter(Boolean);
  if (clients.length > 0) return Array.from(new Set(clients));
  return ['CF Server Monitor'];
}

function inferNotificationEmoji(event) {
  const normalizedEvent = String(event || '');
  if (/恢复|测试|成功/.test(normalizedEvent)) return '✅';
  if (/到期|提醒/.test(normalizedEvent)) return '⚠️';
  if (/离线|告警|失败|异常/.test(normalizedEvent)) return '❌';
  return 'ℹ️';
}

function buildNotificationContext(settings, msg, context = {}) {
  const now = formatCurrentTime(settings);
  const clients = normalizeNotificationClients(context);
  const count = Number.isFinite(Number(context.count)) && Number(context.count) > 0
    ? Number(context.count)
    : clients.length;
  const event = context.event || inferNotificationEvent(msg, getNotificationMessages(settings).events.notification);
  return {
    title: '💌 Cloudflare Server Monitor',
    event,
    emoji: context.emoji || inferNotificationEmoji(event),
    client: context.client || clients.join(', '),
    clients: clients.join(', '),
    count: String(count),
    message: context.message || String(msg || ''),
    time: context.time || now
  };
}

function formatNotificationMessage(settings, msg, context) {
  const template = normalizeNotificationTemplate(settings?.notification_template || DEFAULT_NOTIFICATION_TEMPLATE);
  return renderTemplate(template, context) || String(msg || '');
}

function parseWebhookHeaders(rawHeaders, context) {
  const raw = renderTemplate(normalizeNotificationWebhookHeaders(rawHeaders), context).trim();
  const headers = {};
  if (!raw) return headers;

  if (raw.startsWith('{')) {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('headers must be an object');
    }
    for (const [key, value] of Object.entries(parsed)) {
      const normalizedKey = String(key || '').trim();
      if (!normalizedKey || /^(host|content-length)$/i.test(normalizedKey)) continue;
      headers[normalizedKey] = String(value ?? '');
    }
    return headers;
  }

  for (const line of raw.split(/\r?\n/)) {
    const index = line.indexOf(':');
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    if (!key || /^(host|content-length)$/i.test(key)) continue;
    headers[key] = line.slice(index + 1).trim();
  }
  return headers;
}

function buildWebhookQueryParams(settings, context) {
  const rawBody = normalizeNotificationWebhookBody(settings.notification_webhook_body);
  try {
    const body = renderTemplate(rawBody, context, { jsonString: true });
    const parsed = JSON.parse(body);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return Object.entries(parsed).map(([key, value]) => [key, String(value ?? '')]);
    }
  } catch (_) {}

  const params = new URLSearchParams(renderTemplate(rawBody, context));
  return Array.from(params.entries());
}

function buildWebhookUrl(settings, context, method) {
  const rawUrl = settings.notification_webhook_url;
  const renderedUrl = renderTemplate(String(rawUrl || '').trim(), context);
  if (!renderedUrl) throw new Error('missing webhook url');

  const url = new URL(renderedUrl);
  if (method === 'GET') {
    for (const [key, value] of buildWebhookQueryParams(settings, context)) {
      if (!key) continue;
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

function buildWebhookBody(settings, context, format) {
  const rawBody = normalizeNotificationWebhookBody(settings.notification_webhook_body);
  if (format === 'json') {
    const body = renderTemplate(rawBody, context, { jsonString: true });
    return JSON.stringify(JSON.parse(body));
  }
  if (format === 'form') {
    try {
      const body = renderTemplate(rawBody, context, { jsonString: true });
      const parsed = JSON.parse(body);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const params = new URLSearchParams();
        for (const [key, value] of Object.entries(parsed)) {
          params.set(key, String(value ?? ''));
        }
        return params.toString();
      }
    } catch (_) {}
  }
  return renderTemplate(rawBody, context);
}

async function sendCustomWebhookNotification(settings, context) {
  const method = normalizeNotificationWebhookMethod(settings.notification_webhook_method);
  const format = normalizeNotificationWebhookFormat(settings.notification_webhook_format);
  const endpoint = buildWebhookUrl(settings, context, method);
  const headers = parseWebhookHeaders(settings.notification_webhook_headers, context);
  const options = { method, headers };

  if (method !== 'GET') {
    const contentTypeHeader = Object.keys(headers).find(key => key.toLowerCase() === 'content-type');
    if (!contentTypeHeader) {
      headers['Content-Type'] = format === 'json'
        ? 'application/json'
        : (format === 'form' ? 'application/x-www-form-urlencoded' : 'text/plain; charset=utf-8');
    }
    options.body = buildWebhookBody(settings, context, format);
  }

  await fetchWithRetry(endpoint, options);
}

// SMTP 通知复用 tg_bot_token 字段，配置以 "smtp:" 前缀协议存储（方案 A）。
// 格式: smtp://<user>:<password>@<host>:<port>?from=<from>&to=<to1,to2>&secure=<auto|tls|starttls>
export function isSmtpNotificationTarget(token) {
  // 与前端保持一致：协议头大小写不敏感（SMTP:// 同样识别）
  return String(token || '').trim().toLowerCase().indexOf('smtp:') === 0;
}

function hasNotificationTarget(settings) {
  if (normalizeBooleanSetting(settings?.notification_webhook_enabled) === 'true') {
    return String(settings?.notification_webhook_url || '').trim().length > 0;
  }
  // 内置渠道（含 SMTP）只要 tg_bot_token 非空即视为已配置目标
  return String(settings?.tg_bot_token || '').trim().length > 0;
}

// ===== 月流量阈值告警（上报路径触发，账期重置=数值回落，状态={u,th,lim}）=====
const TRAFFIC_ALERT_STATE_KEY = 'traffic_alert_state';
const TRAFFIC_ALERT_RESET_FACTOR = 0.5;

function parseTrafficAlertState(raw) {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    if (o && Number.isFinite(o.u) && o.u > 0) {
      return { u: Math.round(o.u), th: normalizePct(o.th), lim: normalizeTrafficLimitGb(o.lim) };
    }
  } catch (_) {}
  return null;
}

// hooks.patchCache?.(serverId, valueOrNull) —— 缓存实现由调用方注入，本函数不 import 任何 cache 模块
export async function evaluateTrafficAlert(env, server, metrics, hooks = {}) {
  try {
    if (!env?.DB || !server || !metrics) return;

    const limit = normalizeTrafficLimitGb(server.traffic_limit);
    if (limit <= 0) return; // 未设限额：不监控

    const settings = await loadSiteSettings(env.DB);
    const globalPct = normalizePct(settings?.traffic_alert_threshold);
    // 逐台阈值三态：null/未设置 → 跟随全局；数字（含 0）→ 覆盖，0 = 显式关闭该服务器告警
    const pctServer = normalizePctOrNull(server.traffic_alert_percent);
    const effectivePct = pctServer === null ? globalPct : pctServer;
    if (effectivePct <= 0) return;                 // 阈值关闭 / 该服务器显式关闭
    if (!hasNotificationTarget(settings)) return;  // 未配置通知渠道：不发也不写

    const used = Math.round(getTrafficUsageBytes(
      metrics.net_rx_monthly,
      metrics.net_tx_monthly,
      server.traffic_calc_type
    ));
    const limitBytes = limit * GB;
    const percent = (used / limitBytes) * 100;

    const oldStr = server[TRAFFIC_ALERT_STATE_KEY] == null ? '' : String(server[TRAFFIC_ALERT_STATE_KEY]);
    const state = parseTrafficAlertState(server[TRAFFIC_ALERT_STATE_KEY]);

    if (state) {
      // ① 回落=新账期/重装/大校正 → 持久清零（不可只在内存即时重算）
      if (used < state.u * TRAFFIC_ALERT_RESET_FACTOR) {
        const { meta } = await env.DB.prepare(
          `UPDATE servers SET traffic_alert_state = NULL WHERE id = ? AND COALESCE(traffic_alert_state,'') = ?`
        ).bind(server.id, oldStr).run();
        if (meta && meta.changes > 0) hooks.patchCache?.(server.id, null);
        return;
      }
      // ② 规则签名一致且未回落 → 同账期已发，抑制
      if (state.th === effectivePct && state.lim === limit) return;
      // ③ th/lim 变 → 重新可发，继续
    }

    if (percent < effectivePct) return; // 未达阈值

    // 先发后写
    const serverName = server.name || server.id;
    const messages = getNotificationMessages(settings);
    const usage = messages.trafficUsed({
      usedGb: (used / GB).toFixed(1),
      limitGb: limit,
      percent: percent.toFixed(1),
      threshold: effectivePct
    });
    const msg = `${serverName}  ${usage}`;
    const err = await sendNotification(settings, msg, {
      event: messages.events.trafficAlert,
      emoji: '📈',
      clients: [serverName],
      count: 1,
      message: msg
    });
    if (err) return; // 失败：不写，下次上报重试

    const newStr = JSON.stringify({ u: used, th: effectivePct, lim: limit });
    const { meta } = await env.DB.prepare(
      `UPDATE servers SET traffic_alert_state = ? WHERE id = ? AND COALESCE(traffic_alert_state,'') = ?`
    ).bind(newStr, server.id, oldStr).run();
    if (meta && meta.changes > 0) hooks.patchCache?.(server.id, newStr);
  } catch (e) {
    console.error('[traffic-alert] evaluate failed:', e);
  }
}

const SMTP_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// 信封地址防注入：剥离 CR/LF 并校验邮箱格式（subject/body 已有 sanitize，信封同样需要）
function normalizeSmtpAddress(value) {
  return String(value || '').replace(/[\r\n]/g, '').trim();
}

function parseSmtpNotificationConfig(rawToken) {
  const url = new URL(String(rawToken).trim());
  const host = url.hostname;
  if (!host) throw new Error('缺少 SMTP 主机');

  const secureParam = (url.searchParams.get('secure') || 'auto').toLowerCase();
  // 不提供 'off'（明文传输），避免凭据被静默降级为明文发送
  const allowedSecure = ['auto', 'tls', 'starttls'];
  const secureTransport = allowedSecure.includes(secureParam) ? secureParam : 'auto';
  const port = url.port ? Number(url.port) : (secureTransport === 'tls' ? 465 : 587);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error('SMTP 端口无效');
  }
  // Cloudflare Workers 永久封禁 25 端口出站
  if (port === 25) {
    throw new Error('Cloudflare Workers 不支持 25 端口，请使用 465(implicit TLS) 或 587(STARTTLS)');
  }
  // auto 模式下非 465/587 端口会被库推导为明文连接，必须显式指定加密方式
  if (secureTransport === 'auto' && port !== 465 && port !== 587) {
    throw new Error('非 465/587 端口必须显式指定加密方式 (secure=tls 或 secure=starttls)');
  }

  const decode = value => {
    try {
      return decodeURIComponent(value);
    } catch (_) {
      return value;
    }
  };
  const username = decode(url.username || '');
  const password = decode(url.password || '');
  if (!username) throw new Error('缺少 SMTP 用户名');
  if (!password) throw new Error('缺少 SMTP 密码');

  const from = normalizeSmtpAddress(url.searchParams.get('from') || username);
  if (!SMTP_EMAIL_PATTERN.test(from)) throw new Error('SMTP 发件人地址无效');
  const to = (url.searchParams.get('to') || '')
    .split(',')
    .map(normalizeSmtpAddress)
    .filter(Boolean);
  if (to.length === 0) throw new Error('缺少收件人 (to)');
  if (to.some(address => !SMTP_EMAIL_PATTERN.test(address))) {
    throw new Error('SMTP 收件人地址无效');
  }

  return { host, port, username, password, from, to, secureTransport };
}

// 仅对临时性失败重试：连接类异常与 4xx（如 421/450 限流、暂时不可用）；
// 5xx 为永久性拒绝（550 收件人拒绝等），454 为认证失败（部分邮箱如 QQ 使用 4xx 码），
// 两者重试无意义且易触发邮箱风控
function isSmtpRetryableError(error) {
  const match = String(error?.message || error).match(/SMTP error (\d{3})/);
  if (!match) return true;
  const code = Number(match[1]);
  return code >= 400 && code < 500 && code !== 454;
}

async function withSmtpRetry(task, retries = NOTIFICATION_MAX_RETRIES) {
  let lastError;
  for (let i = 0; i < retries; i++) {
    try {
      await task();
      return;
    } catch (e) {
      lastError = e;
      if (!isSmtpRetryableError(e)) break;
      if (i < retries - 1) {
        await new Promise(resolve => setTimeout(resolve, NOTIFICATION_RETRY_DELAY_MS));
      }
    }
  }
  throw lastError || new Error('Max retries exceeded');
}

async function sendSmtpNotification(settings, context, formattedMsg) {
  let config;
  try {
    config = parseSmtpNotificationConfig(settings.tg_bot_token);
  } catch (e) {
    return `SMTP 通知配置错误: ${e.message}`;
  }
  try {
    // 动态导入：cloudflare-smtp 依赖 cloudflare:sockets，仅在运行时（Workers）加载
    const { sendMail } = await import('cloudflare-smtp');
    const subject = `${context.emoji || ''} ${context.event || getNotificationMessages(settings).events.notification}`.trim();
    const text = String(formattedMsg || '').replace(/\*/g, '');
    await withSmtpRetry(() => sendMail(
      {
        host: config.host,
        port: config.port,
        username: config.username,
        password: config.password,
        from: config.from,
        to: config.to,
        secureTransport: config.secureTransport
      },
      { subject, text }
    ));
    return;
  } catch (e) {
    return `SMTP 邮件通知发送失败: ${e.message}`;
  }
}

export async function sendNotification(settings, msg, notificationContext = {}) {
  const context = buildNotificationContext(settings || {}, msg, notificationContext);
  const formattedMsg = formatNotificationMessage(settings || {}, msg, context);
  context.notification = formattedMsg;
  const title = context.title;

  if (normalizeBooleanSetting(settings?.notification_webhook_enabled) === 'true') {
    if (!String(settings?.notification_webhook_url || '').trim()) return "自定义 Webhook 通知失败: 缺少 URL";
    try {
      await sendCustomWebhookNotification(settings, context);
      return;
    } catch (e) {
      return "自定义 Webhook 通知发送失败: " + e.message;
    }
  }

  if(!settings.tg_bot_token) return;
  if (isSmtpNotificationTarget(settings.tg_bot_token)) {
    // SMTP 邮件通知（前缀协议: smtp://...），置于内置渠道分发链最前
    return await sendSmtpNotification(settings, context, formattedMsg);
  }
  if(settings.tg_bot_token.indexOf("onebot:") == 0) {
    // OneBot 协议 (QQ 等)，私聊格式: onebot:http://127.0.0.1:3000/send_private_msg?access_token=xxx
    // 群聊格式: onebot:http://127.0.0.1:3000/send_group_msg?access_token=xxx
    let onebotUrl = settings.tg_bot_token.replace("onebot:", "");
    const targetId = settings.tg_chat_id || '';
    const isGroup = onebotUrl.indexOf("send_group_msg") != -1;
    if (!targetId) {
      return "OneBot 通知失败: 缺少 tg_chat_id（私人: QQ号，群: group:群号）";
    }
    try {
      const endpoint = onebotUrl.trim();
      const body = {
        [isGroup ? 'group_id' : 'user_id']: targetId,
        message: [
          {
            type: 'text',
            data: {
              text: `${title}\n${String(formattedMsg || '').replace(/\*/g, '')}\n`
            }
          }
        ]
      };
      await fetchWithRetry(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
    } catch (e) {
      return "OneBot 通知发送失败: " + e.message;
    }
  }else if(settings.tg_bot_token.includes("open.feishu.cn")) {
    // 飞书机器人 Webhook
    try {
      await fetchWithRetry(settings.tg_bot_token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({
          msg_type: "interactive",
          card: {
            schema: "2.0",
            header: { template: "blue", title: { content: title, tag: "plain_text" } },
            body: { elements: [{ tag: "markdown", content: formattedMsg }] }
          }
        })
      });
    } catch (e) {
      return "飞书通知发送失败: " + e.message;
    }
  }else if(settings.tg_bot_token.includes("oapi.dingtalk.com") || settings.tg_bot_token.includes("api.dingtalk.com")) {
    // 钉钉机器人 Webhook
    try {
      await fetchWithRetry(settings.tg_bot_token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          msgtype: "markdown",
          markdown: { title: title, text: formattedMsg }
        })
      });
    } catch (e) {
      return "钉钉通知发送失败: " + e.message;
    }
  }else if(settings.tg_bot_token.includes("https://api.day.app/") || settings.tg_bot_token.indexOf("bark:") == 0) {
    let barkUrl = settings.tg_bot_token;
    if(barkUrl.indexOf("bark:") == 0) {
      barkUrl = barkUrl.replace("bark:", "");
    }
    try {
      await fetchWithRetry(barkUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title,
          markdown: formattedMsg,
          group: "Cloudflare Server Monitor"
        })
      });
    } catch (e) {
      return "Bark通知发送失败: " + e.message;
    }
  }else if(settings.tg_bot_token.includes("https://qyapi.weixin.qq.com")){
    try {
      await fetchWithRetry(settings.tg_bot_token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          msgtype: "text",
          text: {
            content: formattedMsg.replace(/\*/g, '')
          }
        })
      });
    } catch (e) {
      return "企业微信通知发送失败: " + e.message;
    }
  // Server 酱（使用 sendkey）
  }else if(settings.tg_bot_token.includes("https://sctapi.ftqq.com/") || settings.tg_bot_token.indexOf("server:") == 0) {
    let serverUrl = settings.tg_bot_token;
    if(serverUrl.indexOf("server:") == 0) {
      serverUrl = serverUrl.replace("server:", "");
    }
    try {
      await fetchWithRetry(serverUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title,
          desp: formattedMsg
        })
      });
    } catch (e) {
      return "Server酱通知发送失败: " + e.message;
    }
  }else if(settings.tg_bot_token.includes("https://wxpusher.zjiecode.com/api/send/message/SPT_")) {
    const match = settings.tg_bot_token.match(/\/message\/([^/]+)/);
    const spt = match ? match[1] : null;
    if (!spt) return "WxPusher 通知失败: 无法提取 SPT";
    try {
      await fetchWithRetry("https://wxpusher.zjiecode.com/api/send/message/simple-push", {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          "content": formattedMsg,
          "summary": title,
          "contentType":3,
          "spt": spt,
        })
      });
    } catch (e) {
      return "WxPusher通知发送失败: " + e.message;
    }
  }else if(settings.tg_bot_token.includes("/message?token=")) {
    try {
      await fetchWithRetry(settings.tg_bot_token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title,
          message: formattedMsg,
          priority: 5,
          extras: {
            "client::display": { "contentType": "text/markdown" }
          }
        })
      });
    } catch (e) {
      return "Gotify通知发送失败: " + e.message;
    }
  }else if(settings.tg_chat_id) {
    // Telegram Bot (最后 fallback，通过 chat_id 判断)
    try {
      await fetchWithRetry(`https://api.telegram.org/bot${settings.tg_bot_token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: settings.tg_chat_id,
          text: formattedMsg
        })
      });
    } catch (e) {
      return "Telegram 通知发送失败: " + e.message;
    }
  }else {
    return "未知的通知方式";
  }
}

export async function checkOfflineNodes(db) {
  const siteSettings = await loadSiteSettings(db);
  const tgNotifyMinutes = getTgNotifyMinutes(siteSettings.tg_notify);

  if (tgNotifyMinutes === 0 || !hasNotificationTarget(siteSettings)) return;

  try {
    const allServers = await getAllServers(db);
    
    const latestTimestampsMap = await getLatestTimestampsForAllServers(db);
    if (!latestTimestampsMap) {
      // 获取失败时跳过本次检测，避免把所有服务器误判为离线
      debug('[Cron] 获取最新上报时间戳失败，跳过本次离线检测');
      return;
    }

    let alertState = {};
    const stateRes = await db.prepare(
      "SELECT value FROM settings WHERE key = 'alert_state'"
    ).first();
    
    if (stateRes) {
      try {
        alertState = JSON.parse(stateRes.value);
      } catch (e) {
        alertState = {};
      }
    }

    const now = Date.now();
    const offlineThreshold = tgNotifyMinutes * 60 * 1000;
    const offlineNodes = [];
    const recoveredNodes = [];

    for (const s of allServers) {
      if (s.offline_notify_disabled === '1') continue;

      const hasLatestReport = latestTimestampsMap.has(s.id);
      const lastReportTime = latestTimestampsMap.get(s.id);

      let isOffline = true;
      if (hasLatestReport) {
        isOffline = now - lastReportTime > offlineThreshold;
      }

      if (isOffline && !alertState[s.id]) {
        offlineNodes.push({
          name: s.name,
          lastReportTime
        });
        alertState[s.id] = true;
      } else if (!isOffline && alertState[s.id]) {
        recoveredNodes.push(s);
        delete alertState[s.id];
      }
    }

    if (offlineNodes.length > 0 || recoveredNodes.length > 0) {
      await db.prepare(
        'INSERT INTO settings (key, value) VALUES ("alert_state", ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
      ).bind(JSON.stringify(alertState)).run();
    }

    const messages = getNotificationMessages(siteSettings);
    if (offlineNodes.length > 0) {
      const nodeList = offlineNodes
        .map(n => `${n.name}  ${messages.lastReport(formatLastReportTime(n.lastReportTime, siteSettings))}`)
        .join('\n');
      const msg = nodeList;
      await sendNotification(siteSettings, msg, {
        event: messages.events.offline,
        emoji: '❌',
        clients: offlineNodes.map(n => n.name),
        count: offlineNodes.length,
        message: nodeList
      });
    }

    if (recoveredNodes.length > 0) {
      const nodeList = recoveredNodes.map(n => n.name).join('\n');
      const msg = nodeList;
      await sendNotification(siteSettings, msg, {
        event: messages.events.recovered,
        emoji: '✅',
        clients: recoveredNodes.map(n => n.name),
        count: recoveredNodes.length,
        message: nodeList
      });
    }
  } catch (e) {
    console.error('离线检测失败:', e);
  }
}

export async function checkResourceAlerts(env, options = {}) {
  if (!env?.DB || !env?.METRICS_BROADCASTER) return;

  const db = env.DB;
  const minute = Number.isFinite(options?.minute) ? options.minute : new Date().getUTCMinutes();
  // 每 2 分钟强制刷新一次设置，其余分钟复用缓存（TTL 120s），降低每分钟的 CPU 开销
  const forceRefresh = minute % 2 === 0;
  const siteSettings = await loadSiteSettings(db, { forceRefresh });
  if (!hasNotificationTarget(siteSettings)) return;

  const resourceConfig = getResourceAlertConfig(siteSettings);

  if (!resourceConfig.enabled || !resourceConfig.hasRules) {
    if (!resourceAlertStateKnownEmpty) {
      await clearResourceAlertState(db);
    }
    return;
  }

  try {
    const allServers = await getAllServers(db);
    if (allServers.length === 0) {
      await clearResourceAlertState(db);
      return;
    }

    const serverMap = new Map(allServers.map(server => [String(server.id), server]));
    const id = env.METRICS_BROADCASTER.idFromName('global');
    const stub = env.METRICS_BROADCASTER.get(id);
    const activeMap = new Map();
    const evaluationMap = new Map();
    const configuredRules = [];
    const configuredRuleServers = [];
    const evaluatedRuleServers = [];

    const configSignature = JSON.stringify({
      rules: resourceConfig.rules.map(rule => ({
        id: rule.id,
        name: rule.name,
        metric: rule.metric,
        threshold: rule.threshold,
        servers: rule.servers,
        intervalMinutes: rule.intervalMinutes,
        mode: rule.mode
      }))
    });

    for (const rule of resourceConfig.rules) {
      const serverIds = getResourceAlertRuleServerIds(rule, allServers);
      if (serverIds.length === 0) continue;

      const ruleServers = [];
      for (const serverId of serverIds) {
        const server = serverMap.get(String(serverId));
        if (!server) continue;
        ruleServers.push({
          key: getResourceAlertRuleStateKey(rule, serverId),
          rule,
          server,
          serverId: String(serverId)
        });
      }
      if (ruleServers.length === 0) continue;
      configuredRuleServers.push(...ruleServers);
      configuredRules.push({ rule, serverIds, ruleServers });
    }

    if (configuredRuleServers.length === 0) {
      await clearResourceAlertState(db);
      return;
    }

    const evaluationResults = await evaluateResourceAlertRules(stub, configuredRules);
    for (const { rule, ruleServers } of configuredRules) {
      const result = evaluationResults.get(String(rule.id));
      if (!result) continue;
      const evaluatedServerIdSet = new Set(result.evaluatedServerIds);
      evaluatedRuleServers.push(...ruleServers.filter(item => evaluatedServerIdSet.has(item.serverId)));
      for (const alert of result.alerts) {
        activeMap.set(getResourceAlertRuleStateKey(rule, alert.serverId), { rule, alert });
      }
      for (const evaluation of result.evaluations || []) {
        evaluationMap.set(getResourceAlertRuleStateKey(rule, evaluation.serverId), evaluation);
      }
    }

    const stateRow = await db.prepare(
      `SELECT value FROM settings WHERE key = ?`
    ).bind(RESOURCE_ALERT_STATE_KEY).first();
    const hadStoredState = !!stateRow;
    const parsedState = parseResourceAlertState(stateRow);
    let alertState = parsedState.servers || {};

    const now = Date.now();
    const alertNodes = [];
    const recoveredNodes = [];
    const validStateKeys = new Set(configuredRuleServers.map(item => item.key));
    let stateChanged = hadStoredState && parsedState.signature !== configSignature;

    for (const key of Object.keys(alertState)) {
      if (!validStateKeys.has(key)) {
        delete alertState[key];
        stateChanged = true;
      }
    }

    for (const { key, rule, server } of evaluatedRuleServers) {
      const active = activeMap.get(key);
      const alert = active?.alert;
      const evaluation = evaluationMap.get(key);
      const currentState = alertState[key];
      const currentStatus = currentState
        ? getResourceAlertStateStatus(currentState)
        : '';
      const ruleIntervalMs = getResourceAlertRuleIntervalMs(rule);

      if (alert) {
        const isActiveAlert = currentStatus === RESOURCE_ALERT_STATE_ACTIVE;
        const recoveredAt = currentStatus === RESOURCE_ALERT_STATE_RECOVERED
          ? getResourceAlertStateTimestamp(currentState, 'recoveredAt')
          : 0;
        if (recoveredAt > 0 && now - recoveredAt < ruleIntervalMs) {
          continue;
        }

        if (!isActiveAlert) {
          alertNodes.push({ rule, server, alert });
          alertState[key] = {
            status: RESOURCE_ALERT_STATE_ACTIVE,
            alertAt: now,
            lastTriggeredAt: now,
            metrics: getStoredResourceAlertMetrics(alert)
          };
          stateChanged = true;
        } else {
          const lastTriggeredAt = getResourceAlertStateTimestamp(currentState, 'lastTriggeredAt');
          if (lastTriggeredAt === 0 || now - lastTriggeredAt >= ruleIntervalMs) {
            alertState[key] = {
              ...currentState,
              status: RESOURCE_ALERT_STATE_ACTIVE,
              alertAt: getResourceAlertStateTimestamp(currentState, 'alertAt') || now,
              lastTriggeredAt: now,
              metrics: getStoredResourceAlertMetrics(alert)
            };
            stateChanged = true;
          }
        }
      } else if (currentState) {
        if (currentStatus === RESOURCE_ALERT_STATE_ACTIVE) {
          if (!canRecoverResourceAlert(evaluation)) {
            continue;
          }

          recoveredNodes.push({ rule, server, metrics: evaluation?.metrics || [] });
          alertState[key] = {
            ...currentState,
            status: RESOURCE_ALERT_STATE_RECOVERED,
            recoveredAt: now,
            metrics: evaluation?.metrics || currentState.metrics
          };
          stateChanged = true;
        } else {
          const recoveredAt = getResourceAlertStateTimestamp(currentState, 'recoveredAt');
          if (recoveredAt === 0 || now - recoveredAt >= ruleIntervalMs) {
            delete alertState[key];
            stateChanged = true;
          }
        }
      }
    }

    if (stateChanged) {
      await saveResourceAlertState(db, configSignature, alertState, hadStoredState);
    }

    const notificationPayloads = buildResourceAlertNotificationPayloads(alertNodes, recoveredNodes, siteSettings);
    for (const payload of notificationPayloads) {
      const notificationError = await sendNotification(siteSettings, payload.msg, payload.context);
      if (notificationError) {
        console.warn('[ResourceAlert] notification failed:', notificationError);
      }
    }
  } catch (e) {
    console.error('资源负载告警检测失败:', e);
  }
}

export async function checkExpiringServers(db, options = {}) {
  const siteSettings = await loadSiteSettings(db);
  const now = Number(options?.now || Date.now());

  if (options?.scheduled && !isExpireNotificationTimeDue(siteSettings, now)) {
    return false;
  }

  try {
    const allServers = await getAllServers(db);
    const expiringServers = [];
    const reminderDays = getExpireReminderDays(siteSettings.expire_reminder);
    const shouldNotify = reminderDays > 0 && hasNotificationTarget(siteSettings);
    const renewedServers = [];
    const currentDateSerial = getZonedDateSerial(now, siteSettings.notification_timezone);

    for (const s of allServers) {
      if (!s.expire_date) continue;

      const billingCycle = normalizeBillingCycle(detectBillingCycle(s.price) || s.billing_cycle);
      // 续费时机 = 到期日 - min(提醒天数, 5)，最长提前 5 天
      const renewal = renewExpireDateIfNeeded(s.expire_date, billingCycle, s.auto_renewal, now, Math.min(reminderDays, 5));
      if (renewal.renewed) {
        await db.prepare(
          'UPDATE servers SET expire_date = ?, billing_cycle = ? WHERE id = ?'
        ).bind(renewal.expire_date, billingCycle, s.id).run();
        s.expire_date = renewal.expire_date;
        s.billing_cycle = billingCycle;
        renewedServers.push({ name: s.name, expire_date: renewal.expire_date });
        debug(`[Cron] 服务器 ${s.name} 已自动续费，到期日期更新为 ${s.expire_date}`);
      }

      // 勾选自动续费的节点只走「续费成功」提醒，不计入到期提醒
      if (isEnabledFlag(s.auto_renewal)) continue;

      if (!shouldNotify) continue;

      const expireDateSerial = parseDateSerial(s.expire_date);
      if (!Number.isFinite(expireDateSerial) || !Number.isFinite(currentDateSerial)) continue;

      const days = expireDateSerial - currentDateSerial;

      debug(`[Cron] 检测到服务器 ${s.name} 到期日期 ${s.expire_date}，剩余天数 ${days} 天`);

      if (days > 0 && days <= reminderDays) {
        expiringServers.push({ name: s.name, expire_date: s.expire_date, days });
      }
    }

    const messages = getNotificationMessages(siteSettings);
    if (renewedServers.length > 0) {
      clearServersListCache();

      // 续费成功提醒：与「到期提醒」开关解耦，只要配置了通知渠道就发送
      if (hasNotificationTarget(siteSettings)) {
        const renewalList = renewedServers.map(s => `${s.name}  ${messages.renewedUntil(s.expire_date)}`).join('\n');
        debug(`[Cron] 发送自动续费成功通知: ${renewalList}`);
        try {
          await sendNotification(siteSettings, renewalList, {
            event: messages.events.renewed,
            emoji: '✅',
            clients: renewedServers.map(s => s.name),
            count: renewedServers.length,
            message: renewalList
          });
        } catch (e) {
          console.error('自动续费成功通知发送失败:', e);
        }
      }
    }

    if (expiringServers.length > 0) {
      const serverList = expiringServers.map(s => `${s.name}  ${messages.daysLeft(s.days)}  ${s.expire_date}`).join('\n');
      const msg = serverList;
      debug(`[Cron] 发送到期提醒通知: ${msg}`);
      try {
        await sendNotification(siteSettings, msg, {
          event: messages.events.expiring,
          emoji: '⚠️',
          clients: expiringServers.map(s => s.name),
          count: expiringServers.length,
          message: serverList
        });
      } catch (e) {
        console.error('服务器到期提醒通知发送失败:', e);
      }
    }
    return true;
  } catch (e) {
    console.error('到期检测失败:', e);
    return false;
  }
}
