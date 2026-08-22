import { checkAuth, simpleAuthResponse } from '../middleware/auth.js';
import { getDashboardLatencyHistory, getLatestMetrics, getLatestMetricsForAllServers } from '../database/schema.js';
import { getAllServers, getServerDetail } from '../utils/cache.js';
import { mergeMetricsIntoServer, coerceNumericMetricFields } from '../utils/metrics.js';
import { normalizeLongHistoryPoints } from '../utils/settings.js';
import { createSuccessResponse, createBadRequestResponse, createNotFoundResponse } from '../utils/errors.js';
import {
  cacheLatestReportUpdate,
  getLatestReportSampleTimestamp,
  getWorkerLatestReportUpdates
} from '../utils/latestReportCache.js';
import { markFrontendRealtimeActive } from '../utils/realtimeBroadcastGate.js';

const LATEST_REPORT_ID_CHUNK_SIZE = 500;

function createEmptyLatencyWindow() {
  return { ping: [], loss: [] };
}

function toPublicIpReachability(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized && normalized !== '0' && normalized !== 'false' ? '1' : '0';
}

function normalizePublicIpFields(item, ensureFields = true) {
  if (ensureFields || Object.prototype.hasOwnProperty.call(item, 'ip_v4')) {
    item.ip_v4 = toPublicIpReachability(item.ip_v4);
  }
  if (ensureFields || Object.prototype.hasOwnProperty.call(item, 'ip_v6')) {
    item.ip_v6 = toPublicIpReachability(item.ip_v6);
  }
  for (const field of ['data', 'payload', 'metrics']) {
    if (item[field] && typeof item[field] === 'object' && !Array.isArray(item[field])) {
      item[field] = normalizePublicIpFields({ ...item[field] }, false);
    }
  }
  return item;
}

function withoutPrivateServerFields(server) {
  const item = { ...server };
  delete item.bandwidth;
  delete item.note;
  delete item.auto_update;
  return normalizePublicIpFields(item);
}

function normalizeLatestReportSample(sample) {
  if (!sample || typeof sample !== 'object') return null;
  const data = sample?.data || sample?.payload || sample?.metrics;
  if (!data || typeof data !== 'object') return null;

  const publicData = coerceNumericMetricFields(normalizePublicIpFields({ ...data }, false));
  const ts = sample.ts ?? sample.timestamp;
  return ts === undefined ? { data: publicData } : { ts, data: publicData };
}

function normalizeLatestReportUpdate(update) {
  if (!update || !Array.isArray(update.samples)) return null;

  const samples = update.samples
    .map(normalizeLatestReportSample)
    .filter(Boolean);
  if (samples.length === 0) return null;

  return {
    ...update,
    samples
  };
}

function attachLatencyHistoryToServers(servers, latencyHistory) {
  for (const server of servers || []) {
    const window = latencyHistory?.get(String(server.id)) || createEmptyLatencyWindow();
    server.ping = window.ping;
    server.loss = window.loss;
  }
}

async function getDurableRealtimeState(env, serverIds) {
  const empty = { latestReportUpdates: [] };
  if (!env.METRICS_BROADCASTER || !Array.isArray(serverIds) || serverIds.length === 0) return empty;

  try {
    const id = env.METRICS_BROADCASTER.idFromName('global');
    const stub = env.METRICS_BROADCASTER.get(id);
    const updates = [];

    for (let offset = 0; offset < serverIds.length; offset += LATEST_REPORT_ID_CHUNK_SIZE) {
      const chunk = serverIds.slice(offset, offset + LATEST_REPORT_ID_CHUNK_SIZE);
      const response = await stub.fetch('http://internal/latest-report-updates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverIds: chunk })
      });
      if (!response.ok) continue;
      const data = await response.json();
      if (Array.isArray(data?.updates)) updates.push(...data.updates);
    }

    return { latestReportUpdates: updates };
  } catch (e) {
    console.warn('[Dashboard] Failed to read realtime state:', e?.message || e);
    return empty;
  }
}

function mergeLatestReportUpdates(serverIds, durableUpdates, workerUpdates) {
  const merged = new Map();

  for (const update of durableUpdates) {
    if (!update?.serverId || !Array.isArray(update.samples)) continue;
    merged.set(String(update.serverId), update);
  }

  // Worker 缓存后合并：样本更新时取更新的一包；同一包优先使用更准确的 Worker 接收时间。
  for (const update of workerUpdates) {
    if (!update?.serverId || !Array.isArray(update.samples)) continue;
    const serverId = String(update.serverId);
    const existing = merged.get(serverId);
    if (!existing || getLatestReportSampleTimestamp(update) >= getLatestReportSampleTimestamp(existing)) {
      merged.set(serverId, update);
    }
  }

  const now = Date.now();
  return serverIds.map(serverId => merged.get(String(serverId)))
    .filter(Boolean)
    .map(update => normalizeLatestReportUpdate({
      ...update,
      reportAgeMs: Math.max(0, now - Number(update.reportTs || now))
    }))
    .filter(Boolean);
}

async function getRealtimeStateForServers(env, serverIds) {
  const normalizedServerIds = Array.from(new Set(
    (Array.isArray(serverIds) ? serverIds : [])
      .map(serverId => String(serverId || '').trim())
      .filter(Boolean)
  ));
  if (normalizedServerIds.length === 0) {
    return { latestReportUpdates: [] };
  }

  const durableState = await getDurableRealtimeState(env, normalizedServerIds);
  const durableLatestReportUpdates = durableState.latestReportUpdates;

  // DO 命中后反向预热当前 Worker isolate，降低随后 DO 休眠造成的空缓存概率。
  for (const update of durableLatestReportUpdates) {
    cacheLatestReportUpdate(update.serverId, update.samples, update.reportTs);
  }

  return {
    latestReportUpdates: mergeLatestReportUpdates(
      normalizedServerIds,
      durableLatestReportUpdates,
      getWorkerLatestReportUpdates(normalizedServerIds)
    )
  };
}

export async function handleServerAPI(request, env, sys) {
  const isLoggedIn = await checkAuth(request, env, sys);
  
  if (sys.is_public !== 'true' && !isLoggedIn) {
    return simpleAuthResponse();
  }
  markFrontendRealtimeActive();
  
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  
  if (!id) return createBadRequestResponse('Missing ID');
  
  const server = await getServerDetail(env.DB, id, isLoggedIn);
  if (!server) return createNotFoundResponse('Server not found');
  
  const [latestMetrics, realtimeState] = await Promise.all([
    getLatestMetrics(env.DB, id, server),
    getRealtimeStateForServers(env, [id])
  ]);
  mergeMetricsIntoServer(server, latestMetrics);
  server.latestReportUpdates = realtimeState.latestReportUpdates;
  server.sysConfig = {
    long_history_points: Number(normalizeLongHistoryPoints(sys.long_history_points))
  };
  
  return createSuccessResponse(withoutPrivateServerFields(server));
}

export async function handleServersAPI(request, env, sys) {
  const isLoggedIn = await checkAuth(request, env, sys);
  
  if (sys.is_public !== 'true' && !isLoggedIn) {
    return simpleAuthResponse();
  }
  markFrontendRealtimeActive();
  
  const results = (await getAllServers(env.DB, isLoggedIn)).map(withoutPrivateServerFields);
  const shouldIncludeLatencyHistory = sys.show_three_net_details === 'true';
  
  const serverIds = results.map(server => server.id).filter(Boolean);
  const [latestMetricsMap, realtimeState, latencyHistory] = await Promise.all([
    getLatestMetricsForAllServers(env.DB),
    getRealtimeStateForServers(env, serverIds),
    shouldIncludeLatencyHistory
      ? getDashboardLatencyHistory(env.DB, results)
      : Promise.resolve(new Map())
  ]);
  attachLatencyHistoryToServers(results, latencyHistory);
  
  const now = Date.now();
  let globalOnline = 0;
  let globalSpeedIn = 0, globalSpeedOut = 0, globalNetTx = 0, globalNetRx = 0;
  const regionStats = {};
  
  for (const server of results) {
    const latestMetrics = latestMetricsMap.get(server.id);
    
    let isOnline = false;
    
    if (latestMetrics) {
      isOnline = (now - latestMetrics.timestamp) < 300000;
      mergeMetricsIntoServer(server, latestMetrics);
    }
    normalizePublicIpFields(server);
    
    if (isOnline) {
      globalOnline++;
      globalSpeedIn += parseFloat(server.net_in_speed) || 0;
      globalSpeedOut += parseFloat(server.net_out_speed) || 0;
    }
    
    globalNetRx += parseFloat(server.net_rx || 0);
    globalNetTx += parseFloat(server.net_tx || 0);
    
    let cCode = (server.region || '').toUpperCase();
    if (cCode !== '') {
      regionStats[cCode] = (regionStats[cCode] || 0) + 1;
    }
  }
  
  const globalOffline = results.length - globalOnline;

  const data = {
    servers: results,
    latestReportUpdates: realtimeState.latestReportUpdates,
    stats: {
      total: results.length,
      online: globalOnline,
      offline: globalOffline,
      globalSpeedIn,
      globalSpeedOut,
      globalNetTx,
      globalNetRx
    },
    regionStats,
    sysConfig: {
      show_price: sys.show_price === 'true',
      show_expire: sys.show_expire === 'true',
      show_tf: sys.show_tf === 'true',
      show_three_net_details: sys.show_three_net_details === 'true',
      display_mode: sys.display_mode || 'bar'
    }
  };

  return createSuccessResponse(data);
}
