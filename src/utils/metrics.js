import {
  NUMERIC_METRIC_FIELDS,
  PROBE_METRIC_FIELDS
} from './historyFields.js';

export const DISK_IO_METRIC_FIELDS = [
  'read_bps',
  'write_bps',
  'read_iops',
  'write_iops',
  'await_ms',
  'util'
];

export const DISK_IO_FIELD_TO_COLUMN = {
  read_bps: 'disk_read_bps',
  write_bps: 'disk_write_bps',
  read_iops: 'disk_read_iops',
  write_iops: 'disk_write_iops',
  await_ms: 'disk_await_ms',
  util: 'disk_util'
};

function toFiniteMetricNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function hasOwnMetric(source, field) {
  return Object.prototype.hasOwnProperty.call(source, field);
}

function isPlainMetricObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

// 探针公网 IP 探测失败时会回填 "0"（见 install.sh 的 IPV4/IPV6 兜底），
// 与空字符串一样视为"未获取到"，此时才允许用请求头来源 IP 补位。
function isBlankIpField(value) {
  const text = String(value ?? '').trim();
  if (!text) return true;
  const normalized = text.toLowerCase();
  return normalized === '0' || normalized === 'false' || normalized === 'null' || normalized === 'undefined';
}

const MAX_CLIENT_IP_LENGTH = 64;

function sanitizeClientIp(value) {
  const ip = String(value ?? '').trim();
  if (!ip || ip.length > MAX_CLIENT_IP_LENGTH) return '';
  if (!/^[0-9A-Fa-f:.]+$/.test(ip)) return '';
  if (!ip.includes('.') && !ip.includes(':')) return '';
  if (/^0+(\.0+)*$/.test(ip)) return '';
  return ip;
}

function isValidIpv4Address(value) {
  const parts = value.split('.');
  if (parts.length !== 4) return false;
  return parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

// 统一按地址族归类：IPv4-mapped IPv6（::ffff:1.2.3.4）归到 v4，
// 否则 v4 客户端会被误写进 ip_v6。
function normalizeClientIp(value) {
  const ip = sanitizeClientIp(value);
  if (!ip) return null;

  const mapped = ip.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (mapped && isValidIpv4Address(mapped[1])) {
    return { family: 'v4', value: mapped[1] };
  }
  if (ip.includes(':')) {
    return { family: 'v6', value: ip };
  }
  return isValidIpv4Address(ip) ? { family: 'v4', value: ip } : null;
}

// 连接来源 IP：Cloudflare 的 CF-Connecting-IP 最可信，其余代理头按顺序兜底。
export function resolveClientIpFromRequest(request) {
  const headers = request?.headers;
  if (!headers || typeof headers.get !== 'function') return '';

  const forwardedFor = String(headers.get('X-Forwarded-For') || '').split(',')[0];
  const candidates = [
    headers.get('CF-Connecting-IP'),
    headers.get('X-Real-IP'),
    forwardedFor
  ];

  for (const candidate of candidates) {
    const ip = sanitizeClientIp(candidate);
    if (ip) return ip;
  }
  return '';
}

// 仅当上报的 ip_v4 / ip_v6 都为空时，才按来源 IP 的地址族补写对应字段。
export function applyClientIpFallback(metrics, clientIp) {
  if (!isPlainMetricObject(metrics)) return metrics;
  if (!isBlankIpField(metrics.ip_v4) || !isBlankIpField(metrics.ip_v6)) return metrics;

  const normalized = normalizeClientIp(clientIp);
  if (!normalized) return metrics;

  metrics[normalized.family === 'v6' ? 'ip_v6' : 'ip_v4'] = normalized.value;
  return metrics;
}

export function applyRequestIpFallback(metrics, request) {
  if (!isPlainMetricObject(metrics)) return metrics;
  if (!isBlankIpField(metrics.ip_v4) || !isBlankIpField(metrics.ip_v6)) return metrics;

  return applyClientIpFallback(metrics, resolveClientIpFromRequest(request));
}

export function hasDiskMetricsPayload(metrics) {
  const source = isPlainMetricObject(metrics) ? metrics : {};

  if (hasOwnMetric(source, 'disk')) {
    const disk = isPlainMetricObject(source.disk) ? source.disk : {};
    return DISK_IO_METRIC_FIELDS.some(field => {
      const value = hasOwnMetric(disk, field)
        ? toFiniteMetricNumber(disk[field], null)
        : null;
      return value !== null && value !== 0;
    });
  }

  return DISK_IO_METRIC_FIELDS.some(field => {
    const column = DISK_IO_FIELD_TO_COLUMN[field];
    const value = hasOwnMetric(source, column)
      ? toFiniteMetricNumber(source[column], null)
      : null;
    return value !== null && value !== 0;
  });
}

export function normalizeDiskMetrics(metrics) {
  const source = isPlainMetricObject(metrics) ? metrics : {};
  const hasDiskObject = hasOwnMetric(source, 'disk');
  const disk = isPlainMetricObject(source.disk)
    ? source.disk
    : {};

  return Object.fromEntries(DISK_IO_METRIC_FIELDS.map(field => {
    const column = DISK_IO_FIELD_TO_COLUMN[field];
    const value = hasDiskObject
      ? disk[field]
      : source[column];
    return [field, toFiniteMetricNumber(value)];
  }));
}

function createEmptyDiskMetricColumns(value = null) {
  return Object.fromEntries(DISK_IO_METRIC_FIELDS.map(field => [
    DISK_IO_FIELD_TO_COLUMN[field],
    value
  ]));
}

export function flattenDiskMetrics(metrics) {
  if (!hasDiskMetricsPayload(metrics)) {
    return createEmptyDiskMetricColumns(null);
  }

  const disk = normalizeDiskMetrics(metrics);
  return Object.fromEntries(DISK_IO_METRIC_FIELDS.map(field => [
    DISK_IO_FIELD_TO_COLUMN[field],
    disk[field]
  ]));
}

export function attachDiskMetricsObject(metrics) {
  if (!metrics || typeof metrics !== 'object') return metrics;
  const result = { ...metrics };
  delete result.disk;
  if (!hasDiskMetricsPayload(metrics)) {
    return result;
  }
  return {
    ...result,
    disk: normalizeDiskMetrics(metrics)
  };
}

export function isDisabledProbeMetric(value) {
  return value === false || value === 'false';
}

// 将探针上报的指标字段统一转换为数字类型，与 /api/servers 的 servers[] 字段类型保持一致。
// 数据库 D1 对 REAL/INTEGER 列返回 JS number，而探针 POST 的原始字段可能是字符串，
// latestReportUpdates 和 WebSocket 推送直接透传探针数据，需要在此统一类型。
export function coerceNumericMetricFields(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  const result = { ...payload };

  for (const field of NUMERIC_METRIC_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(result, field)) continue;
    const value = result[field];
    if (value === null || value === undefined) continue;
    const num = Number(value);
    result[field] = Number.isFinite(num) ? num : 0;
  }

  for (const field of PROBE_METRIC_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(result, field)) continue;
    const value = result[field];
    if (value === false || value === 'false') {
      result[field] = false;
    } else if (value === null || value === undefined) {
      continue;
    } else {
      const num = Number(value);
      result[field] = Number.isFinite(num) ? num : null;
    }
  }

  if (Object.prototype.hasOwnProperty.call(result, 'disk')) {
    if (!hasDiskMetricsPayload(result)) {
      delete result.disk;
      return result;
    }
    result.disk = normalizeDiskMetrics(result);
  }

  return result;
}

function normalizeProbeMetric(value) {
  return isDisabledProbeMetric(value) ? false : value;
}

export function normalizeProbeMetricRow(metrics) {
  if (!metrics) return metrics;

  const normalized = { ...metrics };
  for (const field of PROBE_METRIC_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(normalized, field)) {
      normalized[field] = normalizeProbeMetric(normalized[field]);
    }
  }
  return normalized;
}

export function mergeMetricsIntoServer(server, metrics) {
  if (!metrics) return;

  server.cpu = metrics.cpu || 0;
  server.load_avg = metrics.load ?? metrics.load_avg ?? '0 0 0';
  server.net_in_speed = metrics.net_in_speed || 0;
  server.net_out_speed = metrics.net_out_speed || 0;
  server.net_rx = metrics.net_rx || 0;
  server.net_tx = metrics.net_tx || 0;
  server.net_rx_monthly = metrics.net_rx_monthly || 0;
  server.net_tx_monthly = metrics.net_tx_monthly || 0;
  server.processes = metrics.processes || 0;
  server.tcp_conn = metrics.tcp_conn || 0;
  server.udp_conn = metrics.udp_conn || 0;
  server.ping_ct = normalizeProbeMetric(metrics.ping_ct);
  server.ping_cu = normalizeProbeMetric(metrics.ping_cu);
  server.ping_cm = normalizeProbeMetric(metrics.ping_cm);
  server.ping_bd = normalizeProbeMetric(metrics.ping_bd);
  server.loss_ct = normalizeProbeMetric(metrics.loss_ct);
  server.loss_cu = normalizeProbeMetric(metrics.loss_cu);
  server.loss_cm = normalizeProbeMetric(metrics.loss_cm);
  server.loss_bd = normalizeProbeMetric(metrics.loss_bd);
  server.ping_node_1 = normalizeProbeMetric(metrics.ping_node_1);
  server.ping_node_2 = normalizeProbeMetric(metrics.ping_node_2);
  server.ping_node_3 = normalizeProbeMetric(metrics.ping_node_3);
  server.ping_node_4 = normalizeProbeMetric(metrics.ping_node_4);
  server.loss_node_1 = normalizeProbeMetric(metrics.loss_node_1);
  server.loss_node_2 = normalizeProbeMetric(metrics.loss_node_2);
  server.loss_node_3 = normalizeProbeMetric(metrics.loss_node_3);
  server.loss_node_4 = normalizeProbeMetric(metrics.loss_node_4);
  server.ram_total = metrics.ram_total || 0;
  server.ram_used = metrics.ram_used || 0;
  server.swap_total = metrics.swap_total || 0;
  server.swap_used = metrics.swap_used || 0;
  server.disk_total = metrics.disk_total || 0;
  server.disk_used = metrics.disk_used || 0;
  if (hasDiskMetricsPayload(metrics)) {
    server.disk = normalizeDiskMetrics(metrics);
  } else {
    delete server.disk;
  }
  server.cpu_cores = metrics.cpu_cores || 0;
  server.cpu_info = metrics.cpu_info || '';
  server.gpu_info = metrics.gpu_info || '';
  server.arch = metrics.arch || '';
  server.os = metrics.os || '';
  server.kernel_version = metrics.kernel_version || '';
  server.agent_version = metrics.agent_version || '';
  server.region = server.region || metrics.region || '';
  server.ip_v4 = metrics.ip_v4 || '0';
  server.ip_v6 = metrics.ip_v6 || '0';
  server.boot_time = metrics.boot_time || '';
  server.last_updated = metrics.timestamp || 0;
}
