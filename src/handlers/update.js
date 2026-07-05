import { saveMetricsHistory } from '../database/schema.js';
import { checkServerExists } from '../utils/cache.js';
import { mergeMetricsIntoServer } from '../utils/metrics.js';
import { createErrorResponse, createUnauthorizedResponse, createNotFoundResponse, createBadRequestResponse } from '../utils/errors.js';

// 将最新一次上报打包成前端可直接消费的 "当前状态" 对象
// 与 /api/server 和 /api/servers 返回的字段保持一致，便于页面直接合并
function buildPayloadForBroadcast(id, metrics, extra = {}) {
  const payload = {};
  mergeMetricsIntoServer(payload, metrics);
  payload.id = id;
  payload.region = extra.region || '';
  payload.last_updated = extra.timestamp || metrics.timestamp || Date.now();
  payload.timestamp = payload.last_updated;
  return payload;
}

// 批量推送：5秒窗口内合并向 DO 推送一次，减少请求次数
const BATCH_WINDOW = 5000;
const MAX_BATCH_SAMPLES = 300;
let batchQueue = new Map();
let flushingPromise = null;

// 用于过滤不需要实时更新的字段
const BROADCAST_DELETE_FIELDS = ['id', 'name', 'region', 'arch', 'os', 'cpu_info', 'cpu_cores', 'gpu_info', 'expire_date', 'server_group', 'traffic_limit', 'net_rx_monthly', 'net_tx_monthly', 'boot_time', 'timestamp', 'ip_v4', 'ip_v6'];

function normalizeTimestamp(value, fallback = Date.now()) {
  const ts = Number(value);
  if (!Number.isFinite(ts) || ts <= 0) return fallback;
  return ts < 10000000000 ? ts * 1000 : ts;
}

function normalizeMetricSamples(data) {
  const now = Date.now();
  const rawSamples = Array.isArray(data.samples)
    ? data.samples
    : (Array.isArray(data.batch) ? data.batch : []);

  const samples = rawSamples.map(item => {
    if (!item || typeof item !== 'object') return null;
    const metrics = item.metrics || item.data || item.payload || item;
    if (!metrics || typeof metrics !== 'object') return null;
    const ts = normalizeTimestamp(item.ts ?? item.timestamp ?? metrics.timestamp, now);
    return { ts, metrics };
  }).filter(Boolean);

  if (samples.length === 0 && data.metrics && typeof data.metrics === 'object') {
    samples.push({
      ts: normalizeTimestamp(data.metrics.timestamp, now),
      metrics: data.metrics
    });
  }

  samples.sort((a, b) => a.ts - b.ts);
  return samples.slice(-MAX_BATCH_SAMPLES);
}

function toBroadcastSamples(id, samples, regionCode) {
  return samples.map(sample => {
    const payload = buildPayloadForBroadcast(id, sample.metrics || {}, {
      region: regionCode,
      timestamp: sample.ts
    });
    const filtered = Object.assign({}, payload);
    BROADCAST_DELETE_FIELDS.forEach(field => delete filtered[field]);
    return { ts: sample.ts, payload: filtered };
  });
}

function queueBroadcastSamples(serverId, samples) {
  if (!serverId || !Array.isArray(samples) || samples.length === 0) return;
  const existing = batchQueue.get(serverId);
  const merged = existing && Array.isArray(existing.samples)
    ? existing.samples.concat(samples)
    : samples;
  batchQueue.set(serverId, { samples: merged.slice(-MAX_BATCH_SAMPLES) });
}

async function _flushBatch(env) {
  flushingPromise = null;

  if (batchQueue.size === 0) return;

  // 原子性地取出当前队列，避免并发写入干扰
  const queue = batchQueue;
  batchQueue = new Map();

  const updates = [];
  for (const [serverId, item] of queue) {
    if (item && Array.isArray(item.samples) && item.samples.length > 0) {
      updates.push({ serverId, samples: item.samples });
    } else if (item) {
      const filtered = Object.assign({}, item);
      BROADCAST_DELETE_FIELDS.forEach(field => delete filtered[field]);
      updates.push({ serverId, payload: filtered });
    }
  }

  if (updates.length === 0) return;

  try {
    const id = env.METRICS_BROADCASTER.idFromName('global');
    const stub = env.METRICS_BROADCASTER.get(id);
    await stub.fetch('http://internal/batch-push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updates })
    });
  } catch (e) {
    console.warn('[broadcast] batch push failed:', e.message || e);
  }
}

function _ensureBatchFlush(env) {
  if (flushingPromise) return flushingPromise;

  flushingPromise = new Promise(resolve => setTimeout(resolve, BATCH_WINDOW))
    .then(() => _flushBatch(env));

  return flushingPromise;
}

export async function handleUpdate(request, env, ctx) {
  try {
    const data = await request.json();
    const { id, secret } = data;

    if (secret !== env.API_SECRET) {
      return createUnauthorizedResponse('Invalid secret');
    }

    let regionCode = request.cf?.country || request.headers?.get('cf-ipcountry') || '';

    const serverExists = await checkServerExists(env.DB, id);

    if (!serverExists) {
      return createNotFoundResponse('Server not found');
    }

    const samples = normalizeMetricSamples(data);
    if (samples.length === 0) {
      return createBadRequestResponse('Missing metrics');
    }

    const latestSample = samples[samples.length - 1];
    await saveMetricsHistory(env.DB, id, latestSample.metrics, regionCode, latestSample.ts, env);

    const broadcastSamples = toBroadcastSamples(id, samples, regionCode);
    // 加入批量队列，由后台定时任务统一推送到 DO
    queueBroadcastSamples(id, broadcastSamples);
    ctx.waitUntil(_ensureBatchFlush(env));

    return new Response('OK', { status: 200 });
  } catch (e) {
    return createErrorResponse(e);
  }
}

// 暴露给 index.js 路由使用的 WebSocket 接入函数
export async function handleWebSocketUpgrade(request, env) {
  if (!env || !env.METRICS_BROADCASTER) {
    return new Response(JSON.stringify({ error: 'WebSocket not enabled', code: 503 }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const url = new URL(request.url);
  const qs = url.search || '';
  try {
    const id = env.METRICS_BROADCASTER.idFromName('global');
    const stub = env.METRICS_BROADCASTER.get(id);
    const realOrigin = new URL(request.url).origin;
    const headers = new Headers(request.headers);
    headers.set('X-Real-Origin', realOrigin);
    return await stub.fetch(new Request(`http://internal/ws${qs}`, {
      method: request.method,
      headers,
      body: request.body,
      redirect: request.redirect
    }));
  } catch (e) {
    console.error('[ws] DO upgrade failed:', e);
    return new Response(JSON.stringify({ error: 'WebSocket error', code: 500 }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
