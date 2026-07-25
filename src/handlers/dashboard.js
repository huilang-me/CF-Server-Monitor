import { checkAuth, simpleAuthResponse } from '../middleware/auth.js';
import { getLatestMetrics, getLatestMetricsForAllServers } from '../database/schema.js';
import { getAllServers, getServerDetail } from '../utils/cache.js';
import { mergeMetricsIntoServer } from '../utils/metrics.js';
import { createSuccessResponse, createBadRequestResponse, createNotFoundResponse } from '../utils/errors.js';
import {
  cacheLatestReportUpdate,
  getLatestReportSampleTimestamp,
  getWorkerLatestReportUpdates
} from '../utils/latestReportCache.js';

const LATEST_REPORT_ID_CHUNK_SIZE = 500;

function withoutPrivateServerFields(server) {
  const item = { ...server };
  delete item.bandwidth;
  delete item.note;
  delete item.auto_update;
  return item;
}

async function getDurableLatestReportUpdates(env, serverIds) {
  if (!env.METRICS_BROADCASTER || !Array.isArray(serverIds) || serverIds.length === 0) return [];

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

    return updates;
  } catch (e) {
    console.warn('[Dashboard] Failed to read latest report updates:', e?.message || e);
    return [];
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
  return serverIds.map(serverId => merged.get(String(serverId))).filter(Boolean).map(update => ({
    ...update,
    reportAgeMs: Math.max(0, now - Number(update.reportTs || now))
  }));
}

export async function handleServerAPI(request, env, sys) {
  const isLoggedIn = await checkAuth(request, env, sys);
  
  if (sys.is_public !== 'true' && !isLoggedIn) {
    return simpleAuthResponse();
  }
  
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  
  if (!id) return createBadRequestResponse('Missing ID');
  
  const server = await getServerDetail(env.DB, id, isLoggedIn);
  if (!server) return createNotFoundResponse('Server not found');
  
  const latestMetrics = await getLatestMetrics(env.DB, id, server);
  mergeMetricsIntoServer(server, latestMetrics);
  server.sysConfig = {
    show_long_history: sys.show_long_history === 'true'
  };
  
  return createSuccessResponse(withoutPrivateServerFields(server));
}

export async function handleServersAPI(request, env, sys) {
  const isLoggedIn = await checkAuth(request, env, sys);
  
  if (sys.is_public !== 'true' && !isLoggedIn) {
    return simpleAuthResponse();
  }
  
  const results = (await getAllServers(env.DB, isLoggedIn)).map(withoutPrivateServerFields);
  
  const serverIds = results.map(server => server.id).filter(Boolean);
  const [latestMetricsMap, durableLatestReportUpdates] = await Promise.all([
    getLatestMetricsForAllServers(env.DB),
    getDurableLatestReportUpdates(env, serverIds)
  ]);

  // DO 命中后反向预热当前 Worker isolate，降低随后 DO 休眠造成的空缓存概率。
  for (const update of durableLatestReportUpdates) {
    cacheLatestReportUpdate(update.serverId, update.samples, update.reportTs);
  }
  const latestReportUpdates = mergeLatestReportUpdates(
    serverIds,
    durableLatestReportUpdates,
    getWorkerLatestReportUpdates(serverIds)
  );
  
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
    latestReportUpdates,
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
      show_time: sys.show_time === 'true',
      display_mode: sys.display_mode || 'bar'
    }
  };

  return createSuccessResponse(data);
}
