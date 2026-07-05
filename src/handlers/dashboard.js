import { checkAuth, simpleAuthResponse } from '../middleware/auth.js';
import { getLatestMetrics, getLatestMetricsForAllServers } from '../database/schema.js';
import { getAllServers, getServerDetail } from '../utils/cache.js';
import { mergeMetricsIntoServer } from '../utils/metrics.js';
import { DEFAULT_SITE_TITLE } from '../utils/settings.js';
import { createSuccessResponse, createBadRequestResponse, createNotFoundResponse } from '../utils/errors.js';

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
  
  const latestMetrics = await getLatestMetrics(env.DB, id, env);
  mergeMetricsIntoServer(server, latestMetrics);
  server.sysConfig = {
    show_long_history: sys.show_long_history === 'true'
  };
  
  return createSuccessResponse(server);
}

export async function handleServersAPI(request, env, sys) {
  const isLoggedIn = await checkAuth(request, env, sys);
  
  if (sys.is_public !== 'true' && !isLoggedIn) {
    return simpleAuthResponse();
  }
  
  const results = await getAllServers(env.DB, isLoggedIn);
  
  const latestMetricsMap = await getLatestMetricsForAllServers(env.DB, env);
  
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
      show_bw: sys.show_bw === 'true',
      show_tf: sys.show_tf === 'true',
      show_time: sys.show_time === 'true',
      site_title: sys.site_title || DEFAULT_SITE_TITLE
    }
  };

  return createSuccessResponse(data);
}

