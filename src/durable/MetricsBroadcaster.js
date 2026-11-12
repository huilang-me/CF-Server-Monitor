// Durable Object: 服务器监控指标广播中心
// 负责维护 WebSocket 连接并在收到新指标时向订阅者实时推送
//
// - 连接通过 /api/ws?subscribe=<scope> 建立
//   scope = 'all'        -> 订阅所有服务器更新（首页）
//   scope = <serverId>   -> 只订阅某台服务器的更新（详情页）
//
// - 后端 /update WSS 由本 DO 接收 Agent 指标，并向所有订阅者广播。
// - 兼容旧 POST 上报，/update 处理器在成功写入 DB 后会调用 /__do_push/<id>。
//
// - 前端订阅连接使用 DO WebSocket Hibernation API，闲置时休眠以节省资源。
//   通过 setWebSocketAutoResponse 自动响应 ping，无需唤醒 DO。
// - Agent 上报连接使用标准 WebSocket API，避免高频指标消息计为 hibernation wakeup。

import { saveMetricsHistory } from '../database/schema.js';
import { evaluateTrafficAlert } from '../services/notification.js';
import { ensureServerOptimization } from '../database/indexOptimization.js';
import { getServerDetail, clearServerDetailCache } from '../utils/cache.js';
import { getWssReportScheduleState, loadSiteSettings } from '../utils/settings.js';
import {
  AGENT_CONFIG_MD5_HEADER,
  AGENT_CONFIG_LEGACY_SCHEMA_VERSION,
  AGENT_CONFIG_SCHEMA_HEADER,
  AGENT_CONFIG_SCHEMA_VERSION,
  DEFAULT_WSS_REPORT_INTERVAL,
  describeAgentConfig,
  normalizeWssReportInterval,
  normalizeAgentConfigSchemaVersion,
  serializeCorrection
} from '../utils/agentConfig.js';
import {
  applyHistoryMetricAggregates,
  collectHistoryMetricAggregates,
  getReportMetrics,
  mergeHistoryMetricAggregates,
  normalizeAgentVersion,
  normalizeCorrectionValue,
  normalizeMetricSamples,
  toBroadcastSamples
} from '../handlers/update.js';
import {
  applyClientIpFallback,
  resolveClientIpFromRequest
} from '../utils/metrics.js';
import {
  AGENT_DEFAULT_HISTORY_WRITE_INTERVAL_MS,
  AGENT_MIN_IDLE_WSS_REPORT_INTERVAL_MS,
  AGENT_SERVER_DETAIL_TTL_MS,
  AGENT_WSS_FRONTEND_BATCH_WINDOW_MS,
  LATEST_REPORT_CACHE_MAX_SERVERS,
  LATEST_REPORT_CACHE_TTL_MS,
  RESOURCE_ALERT_COMPACT_RESULT_FORMAT,
  UPDATE_MAX_BATCH_SAMPLES,
  UPDATE_MAX_REQUEST_BYTES
} from '../utils/config.js';

const MAX_SUBSCRIBE_IDS = 500;
const MAX_SERVER_ID_LENGTH = 64;
const SERVER_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;
const WS_POLICY_VIOLATION = 1008;
const WS_MESSAGE_TOO_BIG = 1009;
const WS_TRY_AGAIN_LATER = 1013;
const AGENT_REPORT_KIND = 'agent-report';
const AGENT_WSS_MODE_HEADER = 'X-Agent-Wss-Mode';
const AGENT_WSS_REASON_HEADER = 'X-Agent-Wss-Reason';
const AGENT_WSS_SCHEDULE_INACTIVE = 'wss_schedule_inactive';
const AGENT_WSS_SCHEDULE_DISABLED = 'wss_disabled';
const ALLOWED_AGENT_REPORT_INTERVALS = new Set([30, 60, 120, 180]);
const RESOURCE_ALERT_STORAGE_KEY = 'resource_alert_windows_v1';
const RESOURCE_ALERT_BUCKET_MS = 60 * 1000;
const RESOURCE_ALERT_MAX_BUCKETS = 10;
const RESOURCE_ALERT_MAX_SERVERS = 1000;
const RESOURCE_ALERT_EVALUATE_RULE_BATCH_MAX = 20;
const RESOURCE_ALERT_SNAPSHOT_INTERVAL_MS = 60 * 1000;
const RESOURCE_ALERT_CACHE_ACTIVE_GRACE_MS = 3 * 60 * 1000;
const RESOURCE_ALERT_LATEST_TOLERANCE_MS = 2 * 60 * 1000;
const RESOURCE_ALERT_MIN_SAMPLE_RATIO = 0.4;
const RESOURCE_ALERT_MIN_SAMPLE_COUNT = 2;
const RESOURCE_ALERT_MODE_AVERAGE = 'average';
const RESOURCE_ALERT_MODE_CONTINUOUS = 'continuous';
function getAlertCutoffMinute(now, buckets) {
  return Math.floor(now / RESOURCE_ALERT_BUCKET_MS) * RESOURCE_ALERT_BUCKET_MS -
    Math.max(0, buckets - 1) * RESOURCE_ALERT_BUCKET_MS;
}

function parseAllowedOrigins(corsAllowedOrigins) {
  if (!corsAllowedOrigins || corsAllowedOrigins.trim() === '') {
    return [];
  }
  return corsAllowedOrigins
    .split(',')
    .map(o => o.trim())
    .filter(o => o !== '');
}

function toFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeMetricTimestamp(value, fallback = Date.now()) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return number < 10000000000 ? number * 1000 : number;
}

function toPublicIpReachability(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized && normalized !== '0' && normalized !== 'false' ? '1' : '0';
}

function normalizeConfigSchema(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const number = Number(raw);
  return Number.isInteger(number) && number > 0 ? String(number) : raw;
}

function normalizeConfigMd5(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  return raw || 'none';
}

function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

function maskPublicIpFields(data) {
  if (!data || typeof data !== 'object') return data;
  let masked = data;
  const ensureMaskedCopy = () => {
    if (masked === data) masked = { ...data };
  };

  if (Object.prototype.hasOwnProperty.call(data, 'ip_v4')) {
    ensureMaskedCopy();
    masked.ip_v4 = toPublicIpReachability(data.ip_v4);
  }
  if (Object.prototype.hasOwnProperty.call(data, 'ip_v6')) {
    ensureMaskedCopy();
    masked.ip_v6 = toPublicIpReachability(data.ip_v6);
  }
  for (const field of ['data', 'payload', 'metrics']) {
    if (data[field] && typeof data[field] === 'object' && !Array.isArray(data[field])) {
      const nested = maskPublicIpFields(data[field]);
      if (nested !== data[field]) {
        ensureMaskedCopy();
        masked[field] = nested;
      }
    }
  }
  return masked;
}

function maskPublicIpSample(sample) {
  if (!sample || typeof sample !== 'object') return sample;
  if (sample.data && typeof sample.data === 'object') {
    return { ...sample, data: maskPublicIpFields(sample.data) };
  }
  if (sample.payload && typeof sample.payload === 'object') {
    return { ...sample, payload: maskPublicIpFields(sample.payload) };
  }
  if (sample.metrics && typeof sample.metrics === 'object') {
    return { ...sample, metrics: maskPublicIpFields(sample.metrics) };
  }
  return sample;
}

function maskPublicIpUpdate(update) {
  if (!update || !Array.isArray(update.samples)) return update;
  return {
    ...update,
    samples: update.samples.map(maskPublicIpSample)
  };
}

// 连接数缺失时必须保持 null：兜底成 0 会让不报该字段的旧 agent 被判为“已恢复”。
function toOptionalCount(value) {
  if (value === undefined || value === null || value === '') return null;
  return toFiniteNumber(value);
}

function normalizeResourceAlertSample(sample) {
  if (!sample || typeof sample !== 'object') {
    return null;
  }

  const data = sample.data || sample.payload || sample.metrics;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return null;
  }

  const metrics = data.metrics || data.payload || data;
  const ts = normalizeMetricTimestamp(sample.ts || sample.timestamp || metrics.sample_timestamp || metrics.last_updated || metrics.timestamp);
  const cpu = toFiniteNumber(metrics.cpu);
  const ramTotal = toFiniteNumber(metrics.ram_total);
  const ramUsed = toFiniteNumber(metrics.ram_used);
  const ram = ramTotal && ramTotal > 0 && ramUsed !== null
    ? (ramUsed / ramTotal) * 100
    : null;
  const diskTotal = toFiniteNumber(metrics.disk_total);
  const diskUsed = toFiniteNumber(metrics.disk_used);
  const disk = diskTotal && diskTotal > 0 && diskUsed !== null
    ? (diskUsed / diskTotal) * 100
    : null;
  const netIn = Math.max(0, toFiniteNumber(metrics.net_in_speed) ?? 0);
  const netOut = Math.max(0, toFiniteNumber(metrics.net_out_speed) ?? 0);
  const tcpConn = toOptionalCount(metrics.tcp_conn);
  const udpConn = toOptionalCount(metrics.udp_conn);

  return {
    ts,
    minuteTs: Math.floor(ts / RESOURCE_ALERT_BUCKET_MS) * RESOURCE_ALERT_BUCKET_MS,
    cpu,
    ram,
    disk,
    netIn,
    netOut,
    netTotal: netIn + netOut,
    tcpConn,
    udpConn
  };
}

function normalizeThresholds(thresholds = {}) {
  const normalize = value => {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 0;
  };

  return {
    cpu: normalize(thresholds.cpuPercent),
    ram: normalize(thresholds.ramPercent),
    disk: normalize(thresholds.diskPercent),
    netIn: normalize(thresholds.netInBps),
    netOut: normalize(thresholds.netOutBps),
    netTotal: normalize(thresholds.netTotalBps),
    tcpConn: normalize(thresholds.tcpConn),
    udpConn: normalize(thresholds.udpConn)
  };
}

function normalizeResourceAlertMode(value) {
  return String(value || '').trim().toLowerCase() === RESOURCE_ALERT_MODE_CONTINUOUS
    ? RESOURCE_ALERT_MODE_CONTINUOUS
    : RESOURCE_ALERT_MODE_AVERAGE;
}

function getMetricValue(sample, metric) {
  const value = sample?.[metric];
  return Number.isFinite(value) ? value : null;
}

function summarizeMetric(samples, metric) {
  const values = samples
    .map(sample => getMetricValue(sample, metric))
    .filter(value => value !== null);
  if (values.length === 0) return null;
  const sum = values.reduce((total, value) => total + value, 0);
  return {
    current: values[values.length - 1],
    min: Math.min(...values),
    max: Math.max(...values),
    avg: sum / values.length
  };
}

function getResourceAlertSampleSpan(samples) {
  if (!Array.isArray(samples) || samples.length < 2) return 0;
  return Math.max(0, samples[samples.length - 1].minuteTs - samples[0].minuteTs);
}

function getResourceAlertLatestTolerance(samples) {
  if (!Array.isArray(samples) || samples.length < 2) return RESOURCE_ALERT_LATEST_TOLERANCE_MS;
  const avgSpacing = getResourceAlertSampleSpan(samples) / (samples.length - 1);
  return Math.max(RESOURCE_ALERT_LATEST_TOLERANCE_MS, avgSpacing * 1.5);
}

function hasSufficientResourceAlertSamples(samples, windowMinutes) {
  if (!Array.isArray(samples) || samples.length < RESOURCE_ALERT_MIN_SAMPLE_COUNT) return false;

  const requiredByCount = Math.ceil(windowMinutes * RESOURCE_ALERT_MIN_SAMPLE_RATIO);
  if (samples.length >= requiredByCount) return true;

  const targetSpan = Math.max(1, windowMinutes - 1) *
    RESOURCE_ALERT_BUCKET_MS *
    RESOURCE_ALERT_MIN_SAMPLE_RATIO;
  return getResourceAlertSampleSpan(samples) >= targetSpan;
}

export class MetricsBroadcaster {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    // 仅用于新页面快速接上最近一包数据；DO 重启或休眠回收后允许自然丢失。
    this.latestReportUpdates = new Map();
    this.resourceAlertWindows = new Map();
    this.resourceAlertSnapshotLoaded = false;
    this.resourceAlertSnapshotDirty = false;
    this.resourceAlertLastSnapshotSave = 0;
    this.resourceAlertCacheActiveUntil = 0;
    this.agentServerDetails = new Map();
    this.agentHistoryWrites = new Map();
    this.standardAgentWebSocketCount = 0;
    this.standardAgentWebSockets = new Set();
    this.lastAgentRealtimeHintAt = 0;
    this.pendingFrontendBroadcasts = new Map();
    this.frontendBroadcastTimer = null;
    this.pendingFrontendBroadcastTs = 0;

    // 自动响应 ping 心跳，DO 无需被唤醒
    // @ts-ignore - Cloudflare Workers 运行时提供 WebSocketRequestResponsePair
    this.state.setWebSocketAutoResponse(
      // @ts-ignore
      new WebSocketRequestResponsePair(
        JSON.stringify({ type: 'ping' }),
        JSON.stringify({ type: 'pong' })
      )
    );
  }

  _isValidServerId(id) {
    return (
      typeof id === 'string' &&
      id.length > 0 &&
      id.length <= MAX_SERVER_ID_LENGTH &&
      SERVER_ID_PATTERN.test(id)
    );
  }

  _isValidScope(scope) {
    return scope === 'all' || this._isValidServerId(scope);
  }

  _normalizeServerIds(ids) {
    if (ids === undefined) return { ok: true, ids: [] };
    if (!Array.isArray(ids) || ids.length > MAX_SUBSCRIBE_IDS) {
      return { ok: false, ids: [] };
    }

    const seen = new Set();
    const normalized = [];
    for (const id of ids) {
      if (typeof id !== 'string') {
        return { ok: false, ids: [] };
      }

      const value = id.trim();
      if (!this._isValidServerId(value)) {
        return { ok: false, ids: [] };
      }

      if (seen.has(value)) continue;
      seen.add(value);
      normalized.push(value);
    }
    return { ok: true, ids: normalized };
  }

  _normalizeResourceAlertServerIds(ids) {
    if (!Array.isArray(ids) || ids.length > RESOURCE_ALERT_MAX_SERVERS) {
      return { ok: false, ids: [] };
    }

    const seen = new Set();
    const normalized = [];
    for (const id of ids) {
      if (typeof id !== 'string') {
        return { ok: false, ids: [] };
      }

      const value = id.trim();
      if (!this._isValidServerId(value)) {
        return { ok: false, ids: [] };
      }

      if (seen.has(value)) continue;
      seen.add(value);
      normalized.push(value);
    }
    return { ok: true, ids: normalized };
  }

  _normalizeResourceAlertEvaluationRules(rules) {
    if (
      !Array.isArray(rules) ||
      rules.length === 0 ||
      rules.length > RESOURCE_ALERT_EVALUATE_RULE_BATCH_MAX
    ) {
      return { ok: false, rules: [] };
    }

    const normalized = [];
    for (const rule of rules) {
      if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
        return { ok: false, rules: [] };
      }

      const ruleId = typeof rule.ruleId === 'string'
        ? rule.ruleId.trim()
        : String(rule.ruleId || '').trim();
      if (!this._isValidServerId(ruleId)) {
        return { ok: false, rules: [] };
      }

      const serverIds = this._normalizeResourceAlertServerIds(rule.serverIds);
      if (!serverIds.ok) {
        return { ok: false, rules: [] };
      }

      normalized.push({
        ruleId,
        serverIds: serverIds.ids,
        mode: rule.mode,
        windowMinutes: rule.windowMinutes,
        thresholds: rule.thresholds
      });
    }

    return { ok: true, rules: normalized };
  }

  _closeInvalidSubscription(ws) {
    try {
      ws.close(WS_POLICY_VIOLATION, 'invalid subscription');
    } catch (_) {}
  }

  _getSubscribeScope(msg, current) {
    if (!Object.prototype.hasOwnProperty.call(msg, 'scope') || msg.scope === undefined) {
      return current.scope || 'all';
    }
    return typeof msg.scope === 'string' ? msg.scope : null;
  }

  // 根据 scope 和 serverIds 判断是否需要接收某台服务器的更新
  _shouldDeliver(sessionScope, serverId, serverIds) {
    if (!sessionScope) return false;
    if (sessionScope === 'all') {
      if (!serverIds || serverIds.length === 0) return false;
      return serverIds.includes(serverId);
    }
    return sessionScope === serverId;
  }

  _getFrontendWebSockets() {
    return this.state.getWebSockets().filter(ws => {
      const attachment = ws.deserializeAttachment();
      return !attachment || attachment.kind !== AGENT_REPORT_KIND;
    });
  }

  _getFrontendSubscriberCount() {
    return this._getFrontendWebSockets().length;
  }

  _getFrontendAllSubscriberCount() {
    return this._getFrontendWebSockets().filter(ws => {
      const attachment = ws.deserializeAttachment();
      return attachment?.scope === 'all';
    }).length;
  }

  _getAgentReportWebSockets() {
    const sockets = new Set(this.standardAgentWebSockets);
    for (const ws of this.state.getWebSockets()) {
      const attachment = ws.deserializeAttachment();
      if (attachment?.kind === AGENT_REPORT_KIND) {
        sockets.add(ws);
      }
    }
    return Array.from(sockets);
  }

  _isWebSocketUpgrade(request) {
    const upgradeHeader = request.headers.get('Upgrade');
    return !!upgradeHeader && upgradeHeader.toLowerCase() === 'websocket';
  }

  _sendWsJson(ws, payload) {
    try {
      ws.send(JSON.stringify(payload));
    } catch (_) {}
  }

  _acceptStandardAgentWebSocket(server, initialAttachment) {
    // Agent 上报连接使用标准 WebSocket API，避免每条业务消息都成为 hibernation wakeup。
    // 代价是只要 Agent 长连接存在，本 DO 就不能休眠，会持续产生 duration。
    server.accept();

    const session = { attachment: initialAttachment || {} };
    const ws = {
      send: data => server.send(data),
      close: (code, reason) => server.close(code, reason),
      serializeAttachment(value) {
        session.attachment = value || {};
      },
      deserializeAttachment() {
        return session.attachment;
      }
    };

    this.standardAgentWebSocketCount += 1;
    this.standardAgentWebSockets.add(ws);
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      this.standardAgentWebSocketCount = Math.max(0, this.standardAgentWebSocketCount - 1);
      this.standardAgentWebSockets.delete(ws);
    };

    server.addEventListener('message', event => {
      this._handleAgentReportMessage(ws, event.data, ws.deserializeAttachment())
        .catch(error => {
          console.warn('[update-ws] Agent standard WebSocket message failed:', error?.message || error);
          this._closeWsWithError(ws, 'Internal error', 500);
        });
    });
    server.addEventListener('close', cleanup);
    server.addEventListener('error', cleanup);

    return ws;
  }

  _closeWsWithError(ws, message, code = 400, extra = {}, closeCode = WS_POLICY_VIOLATION, closeReason = message) {
    this._sendWsJson(ws, {
      type: 'error',
      ts: Date.now(),
      error: message,
      code,
      ...extra
    });
    try {
      ws.close(closeCode, closeReason);
    } catch (_) {}
  }

  _closeWsForInactiveAgentSchedule(ws) {
    this._closeWsWithError(
      ws,
      'Agent WSS report outside active hours',
      409,
      {
        text: AGENT_WSS_SCHEDULE_INACTIVE,
        connection_mode: 'http'
      },
      WS_TRY_AGAIN_LATER,
      AGENT_WSS_SCHEDULE_INACTIVE
    );
  }

  _closeWsForDisabledAgentSchedule(ws) {
    this._closeWsWithError(
      ws,
      'Agent WSS report disabled',
      409,
      {
        text: AGENT_WSS_SCHEDULE_DISABLED,
        connection_mode: 'http'
      },
      WS_TRY_AGAIN_LATER,
      AGENT_WSS_SCHEDULE_DISABLED
    );
  }

  _createAgentWssUnavailableResponse(scheduleState) {
    if (!scheduleState?.configured) {
      return new Response(JSON.stringify({
        error: 'Agent WSS report disabled',
        code: 409,
        text: AGENT_WSS_SCHEDULE_DISABLED,
        connection_mode: 'http'
      }), {
        status: 409,
        headers: {
          'Cache-Control': 'no-store',
          'Content-Type': 'application/json',
          [AGENT_WSS_MODE_HEADER]: scheduleState.mode,
          [AGENT_WSS_REASON_HEADER]: scheduleState.reason
        }
      });
    }

    return new Response(JSON.stringify({
      error: 'Agent WSS report outside active hours',
      code: 409,
      text: AGENT_WSS_SCHEDULE_INACTIVE,
      connection_mode: 'http'
    }), {
      status: 409,
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json',
        [AGENT_WSS_MODE_HEADER]: scheduleState.mode,
        [AGENT_WSS_REASON_HEADER]: scheduleState.reason
      }
    });
  }

  _decodeWsMessage(message) {
    if (typeof message === 'string') return message;
    if (message instanceof ArrayBuffer) return new TextDecoder().decode(message);
    if (ArrayBuffer.isView(message)) {
      return new TextDecoder().decode(message.buffer.slice(message.byteOffset, message.byteOffset + message.byteLength));
    }
    return String(message || '');
  }

  _normalizeAgentReportData(message) {
    if (!message || typeof message !== 'object' || Array.isArray(message)) return null;
    if (message.type === 'update' && message.payload && typeof message.payload === 'object' && !Array.isArray(message.payload)) {
      const payload = { ...message.payload };
      const inheritedFields = [
        'config_md5',
        'configMd5',
        'agent_config_md5',
        'agentConfigMd5',
        'config_schema',
        'configSchema',
        'agent_config_schema',
        'agentConfigSchema',
        'schema_version'
      ];
      for (const field of inheritedFields) {
        if (payload[field] === undefined && message[field] !== undefined) {
          payload[field] = message[field];
        }
      }
      return {
        ...payload,
        id: message.id ?? payload.id,
        secret: message.secret ?? payload.secret
      };
    }
    return message;
  }

  _getAgentConfigState(data = {}, attachment = {}) {
    const reportedSchema = firstDefined(
      data.config_schema,
      data.configSchema,
      data.agent_config_schema,
      data.agentConfigSchema,
      data.schema_version
    );
    const reportedMd5 = firstDefined(
      data.config_md5,
      data.configMd5,
      data.agent_config_md5,
      data.agentConfigMd5
    );
    const requested = reportedSchema !== undefined || reportedMd5 !== undefined;
    const schema = normalizeConfigSchema(firstDefined(reportedSchema, attachment.configSchema));
    const md5 = normalizeConfigMd5(firstDefined(reportedMd5, attachment.configMd5));
    return { schema, md5, requested };
  }

  _isCorrectionAck(data) {
    return data && (
      Object.prototype.hasOwnProperty.call(data, 'rx_correction') ||
      Object.prototype.hasOwnProperty.call(data, 'tx_correction')
    );
  }

  _normalizeAgentReportIntervalMs(value) {
    const reportInterval = Number(value);
    if (Number.isInteger(reportInterval) && ALLOWED_AGENT_REPORT_INTERVALS.has(reportInterval)) {
      return reportInterval * 1000;
    }
    return null;
  }

  _getReportIntervalMs(serverDetail) {
    const reportIntervalMs = this._normalizeAgentReportIntervalMs(serverDetail?.report_interval);
    if (reportIntervalMs) {
      return reportIntervalMs;
    }
    return AGENT_DEFAULT_HISTORY_WRITE_INTERVAL_MS;
  }

  _getWssReportIntervalMs(serverDetail) {
    return normalizeWssReportInterval(serverDetail?.wss_report_interval) * 1000;
  }

  async _getAgentServerDetail(serverId, forceRefresh = false) {
    const key = String(serverId || '');
    const now = Date.now();
    const cached = this.agentServerDetails.get(key);
    if (!forceRefresh && cached && now - cached.time < AGENT_SERVER_DETAIL_TTL_MS) {
      return cached.data;
    }

    if (forceRefresh) {
      clearServerDetailCache();
    }
    const server = await getServerDetail(this.env.DB, key, true);
    this.agentServerDetails.set(key, { data: server, time: now });
    return server;
  }

  async _resolveAgentContext(ws, attachment, data) {
    const rawServerId = data.id ?? attachment.serverId;
    const serverId = typeof rawServerId === 'string' ? rawServerId.trim() : String(rawServerId || '').trim();
    if (!this._isValidServerId(serverId)) {
      this._closeWsWithError(ws, 'Invalid server ID', 400);
      return null;
    }

    if (attachment.authenticated && attachment.serverId && attachment.serverId !== serverId) {
      this._closeWsWithError(ws, 'Server ID changed', 403);
      return null;
    }

    const hasSecret = Object.prototype.hasOwnProperty.call(data, 'secret');
    if (!attachment.authenticated || hasSecret) {
      if (data.secret !== this.env.API_SECRET) {
        this._closeWsWithError(ws, 'Invalid secret', 401);
        return null;
      }
    }

    // 不永久信任附件：每次上报都走 120s 缓存复核，服务器删除后最多 120s 内自动断开。
    let serverDetail;
    try {
      serverDetail = await this._getAgentServerDetail(serverId);
    } catch (e) {
      // 查询异常不等于服务器被删除：已认证会话用附件续期，绝不因为 D1 抖动踢掉健康连接。
      // 未认证会话无法续期，用 503 + 1013 让 Agent 稍后重试。
      console.warn('[update-ws] Server detail lookup failed:', e?.message || e);
      if (attachment.authenticated && attachment.historyPartitionId) {
        serverDetail = { id: serverId, history_partition_id: attachment.historyPartitionId };
      } else {
        this._closeWsWithError(ws, 'Service unavailable', 503, { text: 'service_unavailable' }, WS_TRY_AGAIN_LATER, 'Service unavailable');
        return null;
      }
    }

    if (!serverDetail) {
      this.agentServerDetails.delete(serverId);
      this.agentHistoryWrites.delete(serverId);
      this.latestReportUpdates.delete(serverId);
      this._closeWsWithError(ws, 'Server not found', 404, { text: 'server_not_found' });
      return null;
    }

    if (!serverDetail.history_partition_id) {
      await ensureServerOptimization(this.env.DB, serverId);
      serverDetail = await this._getAgentServerDetail(serverId, true);
      if (!serverDetail?.history_partition_id) {
        this._closeWsWithError(ws, 'Missing history_partition_id', 400);
        return null;
      }
    }

    const agentVersion = normalizeAgentVersion(
      data.agent_version ??
      data.metrics?.agent_version ??
      attachment.agentVersion
    );
    const agentConfig = this._getAgentConfigState(data, attachment);
    const reportedReportIntervalMs = this._normalizeAgentReportIntervalMs(firstDefined(
      data.report_interval,
      data.reportInterval
    ));
    const attachedReportIntervalMs = Number(attachment.reportIntervalMs);
    const reportIntervalMs = reportedReportIntervalMs ||
      (attachment.authenticated && Number.isFinite(attachedReportIntervalMs) && attachedReportIntervalMs > 0
        ? attachedReportIntervalMs
        : this._getReportIntervalMs(serverDetail));
    const reportedWssReportInterval = firstDefined(
      data.wss_report_interval,
      data.wssReportInterval
    );
    const reportedWssReportIntervalMs = reportedWssReportInterval === undefined
      ? null
      : normalizeWssReportInterval(reportedWssReportInterval) * 1000;
    const attachedWssReportIntervalMs = Number(attachment.wssReportIntervalMs);
    const wssReportIntervalMs = reportedWssReportIntervalMs ||
      (attachment.authenticated && Number.isFinite(attachedWssReportIntervalMs) && attachedWssReportIntervalMs > 0
        ? attachedWssReportIntervalMs
        : this._getWssReportIntervalMs(serverDetail));
    const nextAttachment = {
      ...attachment,
      kind: AGENT_REPORT_KIND,
      authenticated: true,
      serverId,
      historyPartitionId: serverDetail.history_partition_id,
      agentVersion,
      reportIntervalMs,
      wssReportIntervalMs,
      configSchema: agentConfig.schema,
      configMd5: agentConfig.md5
    };
    ws.serializeAttachment(nextAttachment);

    return {
      attachment: nextAttachment,
      serverId,
      historyPartitionId: serverDetail.history_partition_id,
      regionCode: attachment.region || '',
      agentVersion,
      reportIntervalMs,
      wssReportIntervalMs,
      agentConfig
    };
  }

  async _loadAgentConfigDescriptor(serverId, forceRefresh = false, schemaVersion = AGENT_CONFIG_SCHEMA_VERSION) {
    const [serverDetail, settings] = await Promise.all([
      this._getAgentServerDetail(serverId, forceRefresh),
      loadSiteSettings(this.env.DB, { forceRefresh })
    ]);
    if (!serverDetail) return null;
    return describeAgentConfig(serverDetail, settings, schemaVersion);
  }

  _buildAgentConfigFrame(descriptor) {
    const configBody = descriptor.serialized + serializeCorrection(descriptor.correction);
    const hasCorrection = descriptor.correction !== null;
    const configPayload = {
      ...descriptor.config,
      config_md5: descriptor.md5
    };

    if (hasCorrection) {
      configPayload.rx_correction = descriptor.correction.rx_correction;
      configPayload.tx_correction = descriptor.correction.tx_correction;
    }

    return { configBody, configPayload, hasCorrection };
  }

  async _buildAgentConfigAck(context) {
    const schemaVersion = normalizeAgentConfigSchemaVersion(context?.agentConfig?.schema);
    if (!context || !context.agentConfig?.requested || !schemaVersion) {
      return null;
    }

    const clientMd5 = normalizeConfigMd5(context.agentConfig.md5);
    try {
      const descriptor = await this._loadAgentConfigDescriptor(context.serverId, false, schemaVersion);
      if (!descriptor) return null;

      const { configBody, configPayload, hasCorrection } = this._buildAgentConfigFrame(descriptor);
      const md5Changed = clientMd5 !== descriptor.md5;
      const ack = {
        config_schema: schemaVersion,
        config_md5: descriptor.md5,
        has_config: md5Changed || hasCorrection,
        // 自定义 UA 独立下发：不参与 md5；只有本次 ack 携带配置协商字段时才有该字段，
        // agent 收到后自行比对，值相同不写盘。
        ua: descriptor.ua
      };

      if (ack.has_config) {
        // `body` keeps compatibility with currently deployed Go agents; `config_body`
        // is the documented field, and `payload` carries the structured form.
        ack.body = configBody;
        ack.config_body = configBody;
        ack.payload = configPayload;
      }

      return ack;
    } catch (e) {
      console.warn('[update-ws] Failed to build agent configuration:', e?.message || e);
      return null;
    }
  }

  _pushAgentConfigFrame(serverId, descriptors) {
    let delivered = 0;
    let matched = 0;

    const descriptorForSchema = (schema) => {
      const schemaVersion = normalizeAgentConfigSchemaVersion(schema);
      if (!schemaVersion) return null;
      if (descriptors instanceof Map) {
        return descriptors.get(schemaVersion) || null;
      }
      return schemaVersion === AGENT_CONFIG_SCHEMA_VERSION ? descriptors : null;
    };

    for (const ws of this._getAgentReportWebSockets()) {
      const attachment = ws.deserializeAttachment() || {};
      if (
        attachment.kind !== AGENT_REPORT_KIND ||
        !attachment.authenticated ||
        attachment.serverId !== serverId
      ) {
        continue;
      }
      matched += 1;

      const descriptor = descriptorForSchema(attachment.configSchema);
      if (!descriptor) continue;

      const { configBody, configPayload, hasCorrection } = this._buildAgentConfigFrame(descriptor);
      const clientMd5 = normalizeConfigMd5(attachment.configMd5);
      if (clientMd5 === descriptor.md5 && !hasCorrection) {
        continue;
      }

      const nextAttachment = { ...attachment };
      if (Object.prototype.hasOwnProperty.call(descriptor.config, 'wss_report_interval')) {
        nextAttachment.wssReportIntervalMs = descriptor.config.wss_report_interval * 1000;
      } else {
        delete nextAttachment.wssReportIntervalMs;
      }
      if (typeof ws.serializeAttachment === 'function') {
        ws.serializeAttachment(nextAttachment);
      }

      this._sendWsJson(ws, {
        type: 'config',
        ts: Date.now(),
        config_schema: descriptor.config.schema_version,
        config_md5: descriptor.md5,
        body: configBody,
        config_body: configBody,
        payload: configPayload
      });
      delivered += 1;
    }

    return { matched, delivered };
  }

  _closeAgentReportWebSockets() {
    let matched = 0;
    let closed = 0;

    for (const ws of this._getAgentReportWebSockets()) {
      const attachment = ws.deserializeAttachment() || {};
      if (attachment.kind !== AGENT_REPORT_KIND) continue;
      matched += 1;

      try {
        this._closeWsForDisabledAgentSchedule(ws);
        closed += 1;
      } catch (_) {}
    }

    return { matched, closed };
  }

  _closeInactiveAgentReportWebSockets() {
    let matched = 0;
    let closed = 0;

    for (const ws of this._getAgentReportWebSockets()) {
      const attachment = ws.deserializeAttachment() || {};
      if (attachment.kind !== AGENT_REPORT_KIND) continue;
      matched += 1;

      try {
        this._closeWsForInactiveAgentSchedule(ws);
        closed += 1;
      } catch (_) {}
    }

    return { matched, closed };
  }

  _nextUtcHourAlarmTime() {
    const nextHour = new Date();
    nextHour.setUTCMinutes(60, 0, 0);
    return nextHour.getTime();
  }

  async _scheduleAgentWssHourAlarm() {
    if (!this.state?.storage || typeof this.state.storage.setAlarm !== 'function') return;
    try {
      await this.state.storage.setAlarm(this._nextUtcHourAlarmTime());
    } catch (e) {
      console.warn('[update-ws] Failed to schedule WSS hour alarm:', e?.message || e);
    }
  }

  async alarm() {
    const settings = await loadSiteSettings(this.env.DB, { forceRefresh: true });
    const scheduleState = getWssReportScheduleState(settings);
    if (!scheduleState.configured) {
      this._closeAgentReportWebSockets();
      return;
    }
    if (!scheduleState.active) {
      this._closeInactiveAgentReportWebSockets();
      return;
    }
    if (this._getAgentReportWebSockets().length > 0) {
      await this._scheduleAgentWssHourAlarm();
    }
  }

  async _handleAgentConfigChanged(request) {
    let body = null;
    try {
      body = await request.json();
    } catch (_) {
      return new Response(JSON.stringify({ error: 'invalid JSON' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (body?.agentReportModeChanged === true) {
      const settings = await loadSiteSettings(this.env.DB, { forceRefresh: true });
      const scheduleState = getWssReportScheduleState(settings);
      const result = scheduleState.active
        ? { matched: 0, closed: 0 }
        : (scheduleState.configured
            ? this._closeInactiveAgentReportWebSockets()
            : this._closeAgentReportWebSockets());
      return new Response(JSON.stringify({
        ok: true,
        wssReportEnabled: scheduleState.active,
        ...result
      }), {
        headers: {
          'Cache-Control': 'no-store',
          'Content-Type': 'application/json'
        }
      });
    }

    const serverId = String(body?.serverId || '').trim();
    if (!this._isValidServerId(serverId)) {
      return new Response(JSON.stringify({ error: 'invalid serverId' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    clearServerDetailCache();
    this.agentServerDetails.delete(serverId);

    const descriptor = await this._loadAgentConfigDescriptor(serverId, true, AGENT_CONFIG_SCHEMA_VERSION);
    if (!descriptor) {
      return new Response(JSON.stringify({ error: 'server not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const descriptors = new Map([[AGENT_CONFIG_SCHEMA_VERSION, descriptor]]);
    for (let schemaVersion = AGENT_CONFIG_LEGACY_SCHEMA_VERSION; schemaVersion < AGENT_CONFIG_SCHEMA_VERSION; schemaVersion++) {
      const legacyDescriptor = await this._loadAgentConfigDescriptor(serverId, false, schemaVersion);
      if (legacyDescriptor) descriptors.set(schemaVersion, legacyDescriptor);
    }

    const result = this._pushAgentConfigFrame(serverId, descriptors);
    return new Response(JSON.stringify({ ok: true, ...result }), {
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json'
      }
    });
  }

  async _ackTrafficCorrection(serverId, data) {
    const ackRx = normalizeCorrectionValue(data.rx_correction);
    const ackTx = normalizeCorrectionValue(data.tx_correction);
    if (ackRx === null || ackTx === null) {
      return { ok: false, error: 'Invalid correction' };
    }

    await this.env.DB.prepare(`
      UPDATE servers
      SET rx_correction = NULL, tx_correction = NULL
      WHERE id = ?
        AND (rx_correction IS NOT NULL OR tx_correction IS NOT NULL)
        AND ABS(COALESCE(rx_correction, 0) - ?) < 0.000001
        AND ABS(COALESCE(tx_correction, 0) - ?) < 0.000001
    `).bind(serverId, ackRx, ackTx).run();
    clearServerDetailCache();
    this.agentServerDetails.delete(serverId);
    return { ok: true };
  }

  async _ingestRealtimeUpdates(normalizedUpdates, reportTs = Date.now(), options = {}) {
    if (!Array.isArray(normalizedUpdates) || normalizedUpdates.length === 0) return;
    if (this._shouldCacheResourceAlertSamples(reportTs)) {
      await this._ensureResourceAlertSnapshotLoaded();
      await this._cacheResourceAlertSamples(normalizedUpdates, reportTs);
    }
    this._cacheLatestReportUpdates(normalizedUpdates, reportTs);
    if (options.batchFrontend === true) {
      this._broadcastBatch(normalizedUpdates, reportTs, 'single');
      this._queueFrontendBroadcastBatch(normalizedUpdates, reportTs);
    } else {
      this._broadcastBatch(normalizedUpdates, reportTs);
    }
  }

  _queueFrontendBroadcastBatch(updates, reportTs = Date.now()) {
    if (!Array.isArray(updates) || updates.length === 0 || this._getFrontendAllSubscriberCount() === 0) return;

    for (const update of updates) {
      if (!update || !update.serverId || !Array.isArray(update.samples) || update.samples.length === 0) continue;
      const serverId = String(update.serverId);
      const existing = this.pendingFrontendBroadcasts.get(serverId);
      const samples = existing
        ? existing.samples.concat(update.samples)
        : update.samples.slice();

      this.pendingFrontendBroadcasts.delete(serverId);
      this.pendingFrontendBroadcasts.set(serverId, {
        serverId,
        samples: samples
          .sort((a, b) => Number(a?.ts || 0) - Number(b?.ts || 0))
          .slice(-UPDATE_MAX_BATCH_SAMPLES)
      });
    }

    while (this.pendingFrontendBroadcasts.size > LATEST_REPORT_CACHE_MAX_SERVERS) {
      const oldestServerId = this.pendingFrontendBroadcasts.keys().next().value;
      if (oldestServerId === undefined) break;
      this.pendingFrontendBroadcasts.delete(oldestServerId);
    }

    if (this.pendingFrontendBroadcasts.size === 0) return;
    this.pendingFrontendBroadcastTs = Math.max(
      this.pendingFrontendBroadcastTs,
      Number(reportTs) || Date.now()
    );
    if (this.frontendBroadcastTimer !== null) return;

    this.frontendBroadcastTimer = setTimeout(() => {
      this.frontendBroadcastTimer = null;
      this._flushFrontendBroadcastBatch();
    }, AGENT_WSS_FRONTEND_BATCH_WINDOW_MS);
  }

  _flushFrontendBroadcastBatch() {
    if (this.frontendBroadcastTimer !== null) {
      clearTimeout(this.frontendBroadcastTimer);
      this.frontendBroadcastTimer = null;
    }
    if (this.pendingFrontendBroadcasts.size === 0) {
      this.pendingFrontendBroadcastTs = 0;
      return;
    }

    const updates = Array.from(this.pendingFrontendBroadcasts.values());
    const ts = this.pendingFrontendBroadcastTs || Date.now();
    this.pendingFrontendBroadcasts = new Map();
    this.pendingFrontendBroadcastTs = 0;
    this._broadcastBatch(updates, ts, 'all');
  }

  _getAgentRealtimeState(now = Date.now()) {
    const frontendActive = this._getFrontendSubscriberCount() > 0;
    const resourceAlertActive = this._shouldCacheResourceAlertSamples(now);
    return {
      frontendActive,
      resourceAlertActive,
      realtimeActive: frontendActive || resourceAlertActive
    };
  }

  _normalizeRealtimeState(realtimeState) {
    if (realtimeState && typeof realtimeState === 'object') {
      return {
        frontendActive: realtimeState.frontendActive === true,
        resourceAlertActive: realtimeState.resourceAlertActive === true,
        realtimeActive: realtimeState.realtimeActive === true ||
          realtimeState.frontendActive === true ||
          realtimeState.resourceAlertActive === true
      };
    }
    return {
      frontendActive: realtimeState === true,
      resourceAlertActive: false,
      realtimeActive: realtimeState === true
    };
  }

  _getAgentNextWssReportAfterMs(wssReportIntervalMs, reportIntervalMs, realtimeState) {
    const normalizedWssReportIntervalMs = Math.max(
      1000,
      Number(wssReportIntervalMs) || DEFAULT_WSS_REPORT_INTERVAL * 1000
    );
    const state = this._normalizeRealtimeState(realtimeState);
    const normalizedReportIntervalMs = Math.max(
      AGENT_MIN_IDLE_WSS_REPORT_INTERVAL_MS,
      Number(reportIntervalMs) || AGENT_DEFAULT_HISTORY_WRITE_INTERVAL_MS
    );
    return state.frontendActive
      ? normalizedWssReportIntervalMs
      : normalizedReportIntervalMs;
  }

  async _getAgentHintReportIntervalMs(attachment) {
    const attachedReportIntervalMs = Number(
      attachment?.wssReportIntervalMs ?? attachment?.reportIntervalMs
    );
    if (attachment?.serverId) {
      try {
        const serverDetail = await this._getAgentServerDetail(attachment.serverId);
        if (serverDetail) {
          const configuredReportIntervalMs = this._getWssReportIntervalMs(serverDetail);
          if (configuredReportIntervalMs) return configuredReportIntervalMs;
        }
      } catch (e) {
        console.warn('[update-ws] Failed to load agent interval for realtime hint:', e?.message || e);
      }
    }
    if (Number.isFinite(attachedReportIntervalMs) && attachedReportIntervalMs > 0) {
      return attachedReportIntervalMs;
    }
    return DEFAULT_WSS_REPORT_INTERVAL * 1000;
  }

  async _hintAgentRealtimeIntervals(realtimeState = null) {
    const now = Date.now();
    const state = realtimeState || this._getAgentRealtimeState(now);
    if (!state.frontendActive) return 0;
    if (now - this.lastAgentRealtimeHintAt < 1000) return 0;
    this.lastAgentRealtimeHintAt = now;

    let hinted = 0;
    for (const ws of this._getAgentReportWebSockets()) {
      const attachment = ws.deserializeAttachment() || {};
      if (
        attachment.kind !== AGENT_REPORT_KIND ||
        !attachment.authenticated ||
        !attachment.serverId
      ) {
        continue;
      }

      const wssReportIntervalMs = await this._getAgentHintReportIntervalMs(attachment);
      const nextWssReportAfterMs = this._getAgentNextWssReportAfterMs(
        wssReportIntervalMs,
        attachment.reportIntervalMs,
        state
      );
      this._sendWsJson(ws, {
        type: 'ack',
        ts: Date.now(),
        realtimeHint: true,
        nextWssReportAfterMs
      });
      hinted += 1;
    }

    return hinted;
  }

  async _persistAgentHistoryIfDue(ws, attachment, payload) {
    const serverId = String(payload.serverId || '');
    const now = Date.now();
    const state = this.agentHistoryWrites.get(serverId) || {};
    const currentAggregate = payload.historyAggregate ||
      collectHistoryMetricAggregates([{ metrics: payload.metrics }]);

    if (state.flushing) {
      state.pendingHistoryAggregate = mergeHistoryMetricAggregates(
        state.pendingHistoryAggregate,
        currentAggregate
      );
      this.agentHistoryWrites.set(serverId, state);
      return { persisted: false, nextD1WriteAfterMs: 0 };
    }

    state.pendingHistoryAggregate = mergeHistoryMetricAggregates(
      state.pendingHistoryAggregate,
      currentAggregate
    );
    const intervalMs = Math.max(
      1000,
      Number(payload.reportIntervalMs) ||
      Number(attachment.reportIntervalMs) ||
      AGENT_DEFAULT_HISTORY_WRITE_INTERVAL_MS
    );
    const lastWriteTs = Math.max(
      Number(state.lastD1WriteTs) || 0,
      Number(attachment.lastD1WriteTs) || 0
    );
    const nextWriteTs = lastWriteTs + intervalMs;

    if (lastWriteTs > 0 && now < nextWriteTs) {
      state.lastD1WriteTs = lastWriteTs;
      this.agentHistoryWrites.set(serverId, state);
      return { persisted: false, nextD1WriteAfterMs: nextWriteTs - now };
    }

    state.flushing = true;
    const aggregateForWrite = state.pendingHistoryAggregate;
    delete state.pendingHistoryAggregate;
    this.agentHistoryWrites.set(serverId, state);
    try {
      // 探针没探到公网 IP 时用握手连接的来源 IP 按地址族补位。
      // 只在真正落库的这一帧执行，避免每帧上报都做判空/正则。
      const metrics = applyClientIpFallback(
        applyHistoryMetricAggregates(payload.metrics, aggregateForWrite),
        attachment.clientIp
      );
      await saveMetricsHistory(
        this.env.DB,
        serverId,
        payload.historyPartitionId,
        metrics,
        payload.regionCode,
        payload.timestamp,
        payload.agentVersion
      );
      // 月流量阈值告警：写入成功后台非阻塞执行（waitUntil），不阻塞 WebSocket 消息循环
      if (typeof this.state?.waitUntil === 'function') {
        this.state.waitUntil((async () => {
          try {
            const trafficServerDetail = await this._getAgentServerDetail(serverId);
            if (!trafficServerDetail) return;
            await evaluateTrafficAlert(this.env, trafficServerDetail, metrics, {
              patchCache: (id, value) => {
                const entry = this.agentServerDetails.get(id);
                if (entry && entry.data) entry.data.traffic_alert_state = value;
              }
            });
          } catch (e) {
            console.error('[traffic-alert] DO evaluate failed:', e);
          }
        })());
      }
      const persistedAt = Date.now();
      state.lastD1WriteTs = persistedAt;
      const currentAttachment = ws.deserializeAttachment() || attachment;
      ws.serializeAttachment({
        ...currentAttachment,
        lastD1WriteTs: persistedAt
      });
      return {
        persisted: true,
        nextD1WriteAfterMs: intervalMs
      };
    } catch (e) {
      state.pendingHistoryAggregate = mergeHistoryMetricAggregates(
        aggregateForWrite,
        state.pendingHistoryAggregate
      );
      throw e;
    } finally {
      state.flushing = false;
      this.agentHistoryWrites.set(serverId, state);
    }
  }

  async _handleAgentReportMessage(ws, rawMessage, attachment = {}) {
    // 帧尺寸守卫必须在 decode/JSON.parse 之前：超大帧先复制再解析会白烧 DO 的 CPU 配额。
    const rawSize = typeof rawMessage === 'string'
      ? rawMessage.length
      : (rawMessage?.byteLength ?? rawMessage?.buffer?.byteLength ?? 0);
    if (rawSize > UPDATE_MAX_REQUEST_BYTES) {
      // 当前 Agent 单帧约 60KB，此路径只对异常客户端生效。
      this._closeWsWithError(ws, 'Payload too large', 413, { text: 'payload_too_large' }, WS_MESSAGE_TOO_BIG, 'Payload too large');
      return;
    }

    let msg = null;
    try {
      msg = JSON.parse(this._decodeWsMessage(rawMessage) || '{}');
    } catch (_) {
      this._closeWsWithError(ws, 'Invalid JSON', 400);
      return;
    }

    if (msg?.type === 'pong') return;

    const scheduleCheckAfter = Number(attachment.wssScheduleCheckAfter);
    if (Number.isFinite(scheduleCheckAfter) && Date.now() >= scheduleCheckAfter) {
      const settings = await loadSiteSettings(this.env.DB);
      const scheduleState = getWssReportScheduleState(settings);
      if (!scheduleState.configured) {
        this._closeWsForDisabledAgentSchedule(ws);
        return;
      }
      if (!scheduleState.active) {
        this._closeWsForInactiveAgentSchedule(ws);
        return;
      }
      const nextHour = new Date();
      nextHour.setUTCMinutes(60, 0, 0);
      attachment = { ...attachment, wssScheduleCheckAfter: nextHour.getTime() };
      ws.serializeAttachment(attachment);
    }

    const data = this._normalizeAgentReportData(msg);
    if (!data) {
      this._closeWsWithError(ws, 'Invalid report payload', 400);
      return;
    }

    const context = await this._resolveAgentContext(ws, attachment, data);
    if (!context) return;

    if (this._isCorrectionAck(data)) {
      const result = await this._ackTrafficCorrection(context.serverId, data);
      if (!result.ok) {
        this._closeWsWithError(ws, result.error, 400);
        return;
      }
      this._sendWsJson(ws, {
        type: 'ack',
        ts: Date.now(),
        correction: true
      });
      return;
    }

    const samples = normalizeMetricSamples(data);
    if (samples.length === 0) {
      this._closeWsWithError(ws, 'Missing metrics', 400);
      return;
    }

    const latestSample = samples[samples.length - 1];
    const latestMetrics = getReportMetrics(data, latestSample);
    const historyAggregate = collectHistoryMetricAggregates(samples);
    const broadcastSamples = toBroadcastSamples(
      context.serverId,
      samples,
      context.regionCode,
      context.agentVersion,
      latestMetrics
    );
    const reportTs = Date.now();
    const normalizedUpdates = [{
      serverId: context.serverId,
      samples: broadcastSamples
    }];
    const realtimeState = this._getAgentRealtimeState(reportTs);
    if (realtimeState.realtimeActive) {
      await this._ingestRealtimeUpdates(normalizedUpdates, reportTs, { batchFrontend: true });
    } else {
      this._cacheLatestReportUpdates(normalizedUpdates, reportTs);
    }

    const persisted = await this._persistAgentHistoryIfDue(ws, context.attachment, {
      serverId: context.serverId,
      historyPartitionId: context.historyPartitionId,
      metrics: latestMetrics,
      historyAggregate,
      regionCode: context.regionCode,
      timestamp: latestSample.ts,
      agentVersion: context.agentVersion,
      reportIntervalMs: context.reportIntervalMs
    });

    const configAck = await this._buildAgentConfigAck(context);
    const nextWssReportAfterMs = this._getAgentNextWssReportAfterMs(
      context.wssReportIntervalMs,
      context.reportIntervalMs,
      realtimeState
    );
    this._sendWsJson(ws, {
      type: 'ack',
      ts: Date.now(),
      persisted: persisted.persisted,
      nextD1WriteAfterMs: persisted.nextD1WriteAfterMs,
      nextWssReportAfterMs,
      ...(configAck || {})
    });
  }

  async _handleAgentReportWebSocket(request, url) {
    if (!this._isWebSocketUpgrade(request)) {
      return new Response('Expected WebSocket upgrade request', { status: 426 });
    }

    const origin = request.headers.get('Origin');
    const allowedOrigins = parseAllowedOrigins(this.env.CORS_ALLOWED_ORIGINS);
    const realOrigin = request.headers.get('X-Real-Origin') || `${url.protocol}//${url.host}`;
    if (origin && allowedOrigins.length > 0 && !allowedOrigins.includes(origin) && origin !== realOrigin) {
      return new Response('Forbidden', { status: 403 });
    }

    const settings = await loadSiteSettings(this.env.DB, { forceRefresh: true });
    const scheduleState = getWssReportScheduleState(settings);
    if (!scheduleState.active) {
      return this._createAgentWssUnavailableResponse(scheduleState);
    }

    // @ts-ignore - Cloudflare Workers runtime provides WebSocketPair
    const nextHour = new Date();
    nextHour.setUTCMinutes(60, 0, 0);
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const agentSocket = this._acceptStandardAgentWebSocket(server, {
      kind: AGENT_REPORT_KIND,
      authenticated: false,
      serverId: '',
      historyPartitionId: 0,
      region: request.headers.get('cf-ipcountry') || '',
      agentVersion: normalizeAgentVersion(request.headers.get('X-Agent-Version')),
      // 握手请求头里的来源 IP 随连接保存：后续帧上报无法再拿到握手头，
      // 探针公网 IP 为空时用它按地址族补位。
      clientIp: resolveClientIpFromRequest(request),
      reportIntervalMs: AGENT_DEFAULT_HISTORY_WRITE_INTERVAL_MS,
      wssReportIntervalMs: DEFAULT_WSS_REPORT_INTERVAL * 1000,
      wssScheduleCheckAfter: nextHour.getTime(),
      lastD1WriteTs: 0,
      configSchema: normalizeConfigSchema(firstDefined(
        url.searchParams.get('config_schema'),
        url.searchParams.get('agent_config_schema'),
        request.headers.get(AGENT_CONFIG_SCHEMA_HEADER)
      )),
      configMd5: normalizeConfigMd5(firstDefined(
        url.searchParams.get('config_md5'),
        url.searchParams.get('agent_config_md5'),
        request.headers.get(AGENT_CONFIG_MD5_HEADER)
      ))
    });

    this._sendWsJson(agentSocket, {
      type: 'hello',
      ts: Date.now(),
      protocol: 'update'
    });
    await this._scheduleAgentWssHourAlarm();

    const responseHeaders = new Headers();
    if (origin && allowedOrigins.length > 0) {
      responseHeaders.set('Access-Control-Allow-Origin', origin);
      responseHeaders.set('Access-Control-Allow-Credentials', 'true');
    }

    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: responseHeaders
    });
  }

  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (method === 'GET' && (path === '/update' || path.endsWith('/update'))) {
      return this._handleAgentReportWebSocket(request, url);
    }

    if (method === 'POST' && path === '/agent-config-changed') {
      return this._handleAgentConfigChanged(request);
    }

    // ── 1) WebSocket 接入 ──────────────────────────────
    if (path === '/ws' || path.endsWith('/ws')) {
      const upgradeHeader = request.headers.get('Upgrade');
      if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
        return new Response('Expected WebSocket upgrade request', { status: 426 });
      }

      const origin = request.headers.get('Origin');
      const allowedOrigins = parseAllowedOrigins(this.env.CORS_ALLOWED_ORIGINS);

      // Worker 转发时通过 X-Real-Origin 传递真实 origin，替代 DO 内部的 http://internal
      const realOrigin = request.headers.get('X-Real-Origin') || `${url.protocol}//${url.host}`;
      if (origin && allowedOrigins.length > 0 && !allowedOrigins.includes(origin) && origin !== realOrigin) {
        return new Response('Forbidden', { status: 403 });
      }

      const raw = url.searchParams.get('subscribe') || 'all';
      const scope = raw.trim().toLowerCase();
      if (!this._isValidScope(scope)) {
        return new Response('Invalid subscription scope', { status: 400 });
      }

      // @ts-ignore - Cloudflare Workers 运行时提供 WebSocketPair
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);

      // 使用 DO WebSocket Hibernation API 接管连接
      this.state.acceptWebSocket(server);

      // 将订阅 scope 和空 serverIds 附加到 WebSocket（休眠后仍保留）
      server.serializeAttachment({ scope, serverIds: [] });

      // 立即发送 hello 让客户端确认连接成功
      try {
        server.send(JSON.stringify({
          type: 'hello',
          ts: Date.now(),
          subscribed: scope
        }));
      } catch (_) {
      }

      const responseHeaders = new Headers();
      if (origin && allowedOrigins.length > 0) {
        responseHeaders.set('Access-Control-Allow-Origin', origin);
        responseHeaders.set('Access-Control-Allow-Credentials', 'true');
      } else if (allowedOrigins.length === 0) {
        responseHeaders.set('Access-Control-Allow-Origin', '*');
      }

      return new Response(null, {
        status: 101,
        webSocket: client,
        headers: responseHeaders
      });
    }

    // ── 2) 广播入口：/update 成功后由 Worker 内部转发 ──
    //     path: /push/<serverId>   body: { metrics } JSON
    if (method === 'POST' && (path.startsWith('/push/') || path.includes('/push/'))) {
      const parts = path.split('/push/');
      const serverId = decodeURIComponent((parts[1] || '').split('/')[0] || '');
      if (!serverId) {
        return new Response(JSON.stringify({ error: 'missing serverId' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      let payload = null;
      try {
        payload = await request.json();
      } catch (_) {
        return new Response(JSON.stringify({ error: 'invalid JSON' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const reportTs = Date.now();
      const subscribers = this._getFrontendSubscriberCount();
      if (subscribers === 0) {
        return new Response(JSON.stringify({ ok: true, skipped: true, subscribers: 0 }), {
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (this._shouldCacheResourceAlertSamples(reportTs)) {
        await this._ensureResourceAlertSnapshotLoaded();
        await this._cacheResourceAlertSamples([{
          serverId,
          samples: [{ ts: reportTs, data: payload }]
        }], reportTs);
      }
      this._broadcast(serverId, payload);
      return new Response(JSON.stringify({ ok: true, subscribers }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // ── 2b) 批量推送入口 ──────────────────────────────
    //     body: { updates: [{ serverId, payload }, ...] }
    if (method === 'POST' && path === '/batch-push') {
      let body = null;
      try {
        body = await request.json();
      } catch (_) {
        return new Response(JSON.stringify({ error: 'invalid JSON' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const updates = body && body.updates;
      if (!Array.isArray(updates) || updates.length === 0) {
        return new Response(JSON.stringify({ error: 'missing or empty updates array' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const normalizedUpdates = this._normalizeBatchUpdates(updates);
      if (normalizedUpdates.length === 0) {
        return new Response(JSON.stringify({ error: 'missing valid updates' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const maintainState = body?.maintainState === true;
      const latestReportOnly = body?.latestReportOnly === true;
      const subscribers = this._getFrontendSubscriberCount();
      if (!maintainState && !latestReportOnly && subscribers === 0) {
        return new Response(JSON.stringify({ ok: true, skipped: true, count: normalizedUpdates.length, subscribers: 0 }), {
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const reportTs = Date.now();
      if (latestReportOnly && subscribers === 0) {
        this._cacheLatestReportUpdates(normalizedUpdates, reportTs);
        return new Response(JSON.stringify({
          ok: true,
          count: normalizedUpdates.length,
          subscribers,
          latestReportOnly: true
        }), {
          headers: { 'Content-Type': 'application/json' }
        });
      }

      await this._ingestRealtimeUpdates(normalizedUpdates, reportTs);

      return new Response(JSON.stringify({ ok: true, count: normalizedUpdates.length, subscribers }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Worker 内部读取每台服务器最近一次上报的完整样本包。
    if (method === 'POST' && path === '/latest-report-updates') {
      let body = null;
      try {
        body = await request.json();
      } catch (_) {
        return new Response(JSON.stringify({ error: 'invalid JSON' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const normalizedServerIds = this._normalizeServerIds(body?.serverIds);
      if (!normalizedServerIds.ok) {
        return new Response(JSON.stringify({ error: 'invalid serverIds' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const updates = this._getLatestReportUpdates(normalizedServerIds.ids);
      const payload = { updates };

      return new Response(JSON.stringify(payload), {
        headers: {
          'Cache-Control': 'no-store',
          'Content-Type': 'application/json'
        }
      });
    }

    if (method === 'POST' && path === '/evaluate-resource-alerts') {
      let body = null;
      try {
        body = await request.json();
      } catch (_) {
        return new Response(JSON.stringify({ error: 'invalid JSON' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const normalizedRules = this._normalizeResourceAlertEvaluationRules(body?.rules);
      if (!normalizedRules.ok) {
        return new Response(JSON.stringify({ error: 'invalid rules' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      this._activateResourceAlertCache();
      await this._ensureResourceAlertSnapshotLoaded();
      const result = await this._evaluateResourceAlertRules(normalizedRules.rules, {
        resultFormat: body?.resultFormat
      });

      return new Response(JSON.stringify(result), {
        headers: {
          'Cache-Control': 'no-store',
          'Content-Type': 'application/json'
        }
      });
    }

    // ── 3) 健康检查 ────────────────────────────────────
    if (method === 'GET' && (path === '/health' || path.endsWith('/health'))) {
      const subscribers = this._getFrontendSubscriberCount();
      const agentSockets = this.standardAgentWebSocketCount;
      const sockets = this.state.getWebSockets().length + agentSockets;
      return new Response(JSON.stringify({ ok: true, subscribers, sockets, agentSockets }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response('Not found', { status: 404 });
  }

  // 向所有匹配 scope 的 WebSocket 广播推送
  _broadcast(serverId, payload) {
    const ts = Date.now();
    const updates = [{
      serverId,
      samples: [{ ts, data: payload }]
    }];
    this._cacheLatestReportUpdates(updates, ts);
    this._broadcastBatch(updates, ts);
  }

  _pruneLatestReportUpdates(now = Date.now()) {
    for (const [serverId, update] of this.latestReportUpdates) {
      if (!update || now - update.reportTs > LATEST_REPORT_CACHE_TTL_MS) {
        this.latestReportUpdates.delete(serverId);
      }
    }
  }

  _cacheLatestReportUpdates(updates, reportTs = Date.now()) {
    this._pruneLatestReportUpdates(reportTs);

    for (const update of updates) {
      if (!update || !update.serverId || !Array.isArray(update.samples) || update.samples.length === 0) continue;
      const serverId = String(update.serverId);
      // delete + set 让 Map 的插入顺序同时代表最近更新时间，便于限制内存上限。
      this.latestReportUpdates.delete(serverId);
      this.latestReportUpdates.set(serverId, maskPublicIpUpdate({
        serverId,
        reportTs,
        samples: update.samples
      }));
    }

    while (this.latestReportUpdates.size > LATEST_REPORT_CACHE_MAX_SERVERS) {
      const oldestServerId = this.latestReportUpdates.keys().next().value;
      if (oldestServerId === undefined) break;
      this.latestReportUpdates.delete(oldestServerId);
    }
  }

  _getLatestReportUpdates(serverIds) {
    const now = Date.now();
    this._pruneLatestReportUpdates(now);
    const updates = [];
    for (const serverId of serverIds) {
      const update = this.latestReportUpdates.get(serverId);
      if (update) {
        updates.push(maskPublicIpUpdate({
          ...update,
          reportAgeMs: Math.max(0, now - update.reportTs)
        }));
      }
    }
    return updates;
  }

  _activateResourceAlertCache(now = Date.now()) {
    this.resourceAlertCacheActiveUntil = Math.max(
      this.resourceAlertCacheActiveUntil,
      now + RESOURCE_ALERT_CACHE_ACTIVE_GRACE_MS
    );
  }

  _shouldCacheResourceAlertSamples(now = Date.now()) {
    return now <= this.resourceAlertCacheActiveUntil;
  }

  async _ensureResourceAlertSnapshotLoaded() {
    if (this.resourceAlertSnapshotLoaded) return;

    this.resourceAlertSnapshotLoaded = true;
    try {
      const snapshot = await this.state.storage.get(RESOURCE_ALERT_STORAGE_KEY);
      const windows = Array.isArray(snapshot?.windows) ? snapshot.windows : [];
      const now = Date.now();
      const cutoffMinute = getAlertCutoffMinute(now, RESOURCE_ALERT_MAX_BUCKETS);

      for (const item of windows) {
        if (!item || !item.serverId || !Array.isArray(item.samples)) continue;
        const samples = item.samples
          .filter(sample => sample && Number(sample.minuteTs) >= cutoffMinute)
          .sort((a, b) => a.minuteTs - b.minuteTs)
          .slice(-RESOURCE_ALERT_MAX_BUCKETS);
        if (samples.length > 0) {
          this.resourceAlertWindows.set(String(item.serverId), { samples });
        }
      }

      this.resourceAlertLastSnapshotSave = Number(snapshot?.savedAt) || 0;
    } catch (e) {
      console.warn('[resource-alert] load snapshot failed:', e.message || e);
    }
  }

  _pruneResourceAlertWindows(now = Date.now()) {
    const cutoffMinute = getAlertCutoffMinute(now, RESOURCE_ALERT_MAX_BUCKETS);
    let changed = false;
    for (const [serverId, window] of this.resourceAlertWindows) {
      const originalSamples = Array.isArray(window?.samples) ? window.samples : [];
      const samples = originalSamples
        .filter(sample => sample && Number(sample.minuteTs) >= cutoffMinute)
        .sort((a, b) => a.minuteTs - b.minuteTs)
        .slice(-RESOURCE_ALERT_MAX_BUCKETS);

      if (samples.length === 0) {
        this.resourceAlertWindows.delete(serverId);
        changed = true;
      } else {
        const sameSamples = samples.length === originalSamples.length &&
          samples.every((sample, index) => sample === originalSamples[index]);
        if (!sameSamples) changed = true;
        this.resourceAlertWindows.set(serverId, { samples });
      }
    }

    while (this.resourceAlertWindows.size > RESOURCE_ALERT_MAX_SERVERS) {
      const oldestServerId = this.resourceAlertWindows.keys().next().value;
      if (oldestServerId === undefined) break;
      this.resourceAlertWindows.delete(oldestServerId);
      changed = true;
    }

    if (changed) this.resourceAlertSnapshotDirty = true;
    return changed;
  }

  async _cacheResourceAlertSamples(updates, now = Date.now()) {
    this._pruneResourceAlertWindows(now);

    for (const update of updates) {
      if (!update || !update.serverId || !Array.isArray(update.samples)) continue;
      const serverId = String(update.serverId);
      const minuteMap = new Map(
        (this.resourceAlertWindows.get(serverId)?.samples || []).map(sample => [sample.minuteTs, sample])
      );

      for (const sample of update.samples) {
        const normalized = normalizeResourceAlertSample(sample);
        if (!normalized) continue;
        minuteMap.set(normalized.minuteTs, normalized);
      }

      const samples = Array.from(minuteMap.values())
        .filter(sample => sample && Number(sample.minuteTs) >= getAlertCutoffMinute(now, RESOURCE_ALERT_MAX_BUCKETS))
        .sort((a, b) => a.minuteTs - b.minuteTs)
        .slice(-RESOURCE_ALERT_MAX_BUCKETS);

      if (samples.length > 0) {
        this.resourceAlertWindows.delete(serverId);
        this.resourceAlertWindows.set(serverId, { samples });
        this.resourceAlertSnapshotDirty = true;
      }
    }

    await this._persistResourceAlertSnapshotIfNeeded(now);
  }

  async _persistResourceAlertSnapshotIfNeeded(now = Date.now(), force = false) {
    if (!this.resourceAlertSnapshotDirty && !force) return;
    if (!force && now - this.resourceAlertLastSnapshotSave < RESOURCE_ALERT_SNAPSHOT_INTERVAL_MS) return;

    this._pruneResourceAlertWindows(now);
    const windows = [];
    for (const [serverId, window] of this.resourceAlertWindows) {
      if (!window || !Array.isArray(window.samples) || window.samples.length === 0) continue;
      windows.push({
        serverId,
        samples: window.samples
      });
    }

    try {
      await this.state.storage.put(RESOURCE_ALERT_STORAGE_KEY, {
        savedAt: now,
        windows
      });
      this.resourceAlertSnapshotDirty = false;
      this.resourceAlertLastSnapshotSave = now;
    } catch (e) {
      console.warn('[resource-alert] persist snapshot failed:', e.message || e);
    }
  }

  _evaluateResourceAlertRule(rule = {}, now = Date.now(), options = {}) {
    const compact = options.resultFormat === RESOURCE_ALERT_COMPACT_RESULT_FORMAT;
    const windowMinutesNumber = Number(rule.windowMinutes);
    const windowMinutes = Number.isInteger(windowMinutesNumber)
      ? Math.max(5, Math.min(10, windowMinutesNumber))
      : 5;
    const cutoffMinute = getAlertCutoffMinute(now, windowMinutes);
    const mode = normalizeResourceAlertMode(rule.mode);
    const thresholds = normalizeThresholds(rule.thresholds);
    const metricThresholds = [
      ['cpu', thresholds.cpu],
      ['ram', thresholds.ram],
      ['disk', thresholds.disk],
      ['netIn', thresholds.netIn],
      ['netOut', thresholds.netOut],
      ['netTotal', thresholds.netTotal],
      ['tcpConn', thresholds.tcpConn],
      ['udpConn', thresholds.udpConn]
    ].filter(([, threshold]) => threshold > 0);

    const alerts = [];
    const evaluatedServerIds = [];
    const evaluations = [];
    if (metricThresholds.length === 0) {
      return { ruleId: rule.ruleId, now, mode, windowMinutes, alerts, evaluatedServerIds, evaluations };
    }

    for (const serverId of rule.serverIds || []) {
      const samples = (this.resourceAlertWindows.get(serverId)?.samples || [])
        .filter(sample => sample && Number(sample.minuteTs) >= cutoffMinute)
        .sort((a, b) => a.minuteTs - b.minuteTs);
      if (!hasSufficientResourceAlertSamples(samples, windowMinutes)) continue;

      const latestSample = samples[samples.length - 1];
      if (!latestSample || now - latestSample.ts > getResourceAlertLatestTolerance(samples)) continue;

      const metrics = [];
      const evaluationMetrics = [];
      let canEvaluateAllMetrics = true;
      for (const [metric, threshold] of metricThresholds) {
        const metricSamples = samples
          .map(sample => ({ sample, value: getMetricValue(sample, metric) }))
          .filter(item => item.value !== null);
        if (!hasSufficientResourceAlertSamples(metricSamples.map(item => item.sample), windowMinutes)) {
          canEvaluateAllMetrics = false;
          break;
        }
        const summary = summarizeMetric(metricSamples.map(item => item.sample), metric);
        if (!summary) {
          canEvaluateAllMetrics = false;
          break;
        }

        const triggerValue = mode === RESOURCE_ALERT_MODE_AVERAGE ? summary.avg : summary.current;
        const isTriggered = mode === RESOURCE_ALERT_MODE_AVERAGE
          ? triggerValue > threshold
          : metricSamples.every(item => item.value > threshold);

        if (compact && !isTriggered) {
          // compact-v1：规则级定义只返回一次，节点仅返回 triggerValue/current/min/max/avg。
          evaluationMetrics.push([triggerValue, summary.current, summary.min, summary.max, summary.avg]);
        } else {
          const metricEvaluation = {
            metric,
            mode,
            threshold,
            triggerValue,
            triggered: isTriggered,
            ...summary
          };
          evaluationMetrics.push(metricEvaluation);
          if (isTriggered) metrics.push(metricEvaluation);
        }
      }

      if (!canEvaluateAllMetrics) continue;
      if (compact) {
        // 告警节点保留完整 alerts 即可；只有未触发节点才可能需要恢复判断。
        if (metrics.length === 0) evaluations.push({ serverId, metrics: evaluationMetrics });
      } else {
        evaluatedServerIds.push(serverId);
        evaluations.push({
          serverId,
          mode,
          windowMinutes,
          sampleCount: samples.length,
          minSampleRatio: RESOURCE_ALERT_MIN_SAMPLE_RATIO,
          latestTs: latestSample.ts,
          metrics: evaluationMetrics
        });
      }

      if (metrics.length > 0) {
        alerts.push({
          serverId,
          mode,
          windowMinutes,
          sampleCount: samples.length,
          minSampleRatio: RESOURCE_ALERT_MIN_SAMPLE_RATIO,
          latestTs: latestSample.ts,
          metrics
        });
      }
    }

    if (compact && (alerts.length > 0 || evaluations.length > 0)) {
      return {
        ruleId: rule.ruleId,
        format: RESOURCE_ALERT_COMPACT_RESULT_FORMAT,
        metricDefinitions: evaluations.length > 0
          ? metricThresholds.map(([metric, threshold]) => ({ metric, mode, threshold }))
          : [],
        alerts,
        evaluations
      };
    }
    return { ruleId: rule.ruleId, now, mode, windowMinutes, alerts, evaluatedServerIds, evaluations };
  }

  async _evaluateResourceAlertRules(rules = [], options = {}) {
    const now = Date.now();
    this._pruneResourceAlertWindows(now);
    const results = [];

    for (const rule of rules) {
      results.push(this._evaluateResourceAlertRule(rule, now, options));
    }

    await this._persistResourceAlertSnapshotIfNeeded(now);
    return { now, results };
  }

  // WebSocket 收到消息（ping 已被自动响应拦截，不会到达此处）
  _normalizeBatchUpdates(updates) {
    const now = Date.now();
    return updates.map(item => {
      if (!item || !item.serverId) return null;
      const serverId = String(item.serverId);
      const rawSamples = Array.isArray(item.samples)
        ? item.samples
        : (item.payload ? [{ ts: now, payload: item.payload }] : []);

      const samples = rawSamples.map(sample => {
        if (!sample || typeof sample !== 'object') return null;
        const data = sample.data || sample.payload || sample.metrics;
        if (!data || typeof data !== 'object') return null;
        const ts = Number(sample.ts || sample.timestamp || data.last_updated || now) || now;
        return { ts, data };
      }).filter(Boolean);

      if (samples.length === 0) return null;
      samples.sort((a, b) => a.ts - b.ts);
      return { serverId, samples };
    }).filter(Boolean);
  }

  _broadcastBatch(updates, ts = Date.now(), targetScope = null) {
    const websockets = this._getFrontendWebSockets();

    for (const ws of websockets) {
      const attachment = ws.deserializeAttachment();
      if (!attachment) continue;
      if (targetScope === 'all' && attachment.scope !== 'all') continue;
      if (targetScope === 'single' && attachment.scope === 'all') continue;

      const scopedUpdates = updates
        .filter(item => this._shouldDeliver(attachment.scope, item.serverId, attachment.serverIds))
        .map(maskPublicIpUpdate);
      if (scopedUpdates.length === 0) continue;

      const message = JSON.stringify({
        type: 'batchUpdate',
        ts,
        updates: scopedUpdates
      });

      try {
        ws.send(message);
      } catch (_) {
        // WebSocket 已异常关闭，DO 会自动清理
      }
    }
  }

  async webSocketMessage(ws, message) {
    const attachment = ws.deserializeAttachment() || {};
    if (attachment.kind === AGENT_REPORT_KIND) {
      // 与标准 WebSocket 路径保持一致：未捕获异常会直接抛给 DO runtime，可能重置整个对象。
      try {
        await this._handleAgentReportMessage(ws, message, attachment);
      } catch (error) {
        console.warn('[update-ws] Agent hibernation message failed:', error?.message || error);
        this._closeWsWithError(ws, 'Internal error', 500);
      }
      return;
    }
    // 保留处理扩展消息的入口
    try {
      const msg = JSON.parse(message || '{}');
      if (msg && msg.type === 'subscribe') {
        const current = ws.deserializeAttachment() || {};
        const rawScope = this._getSubscribeScope(msg, current);
        if (rawScope === null) {
          this._closeInvalidSubscription(ws);
          return;
        }

        const scope = rawScope.trim().toLowerCase();
        if (!this._isValidScope(scope)) {
          this._closeInvalidSubscription(ws);
          return;
        }

        const normalizedServerIds = this._normalizeServerIds(msg.ids);
        if (!normalizedServerIds.ok) {
          this._closeInvalidSubscription(ws);
          return;
        }

        const serverIds = normalizedServerIds.ids;
        ws.serializeAttachment({ scope, serverIds });
        try {
          ws.send(JSON.stringify({
            type: 'subscribed',
            ts: Date.now(),
            subscribed: scope,
            count: serverIds.length
          }));
        } catch (_) {}
        try {
          await this._hintAgentRealtimeIntervals({
            frontendActive: true,
            resourceAlertActive: this._shouldCacheResourceAlertSamples(),
            realtimeActive: true
          });
        } catch (e) {
          console.warn('[ws] Failed to hint agent realtime interval:', e?.message || e);
        }
        return;
      }
      if (msg && msg.type === 'pong') return;
    } catch (_) {}
  }

  // WebSocket 关闭 — DO 自动清理，无需手动移除
  webSocketClose(ws, code, reason) {}

  // WebSocket 错误 — DO 自动处理
  webSocketError(ws, error) {}
}

export default MetricsBroadcaster;
