import { checkAuth, simpleAuthResponse } from '../middleware/auth.js';
import { formatBytes, getPingColor } from '../utils/format.js';
import { getLatestMetrics, getLatestMetricsForAllServers } from '../database/schema.js';

export async function handleServerAPI(request, env, sys) {
  const isLoggedIn = checkAuth(request, env);
  
  // 如果关闭了公开访问，需要登录
  if (sys.is_public !== 'true' && !isLoggedIn) {
    return simpleAuthResponse();
  }
  
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  
  if (!id) return new Response('Missing ID', { status: 400 });
  let query = 'SELECT * FROM servers WHERE id = ?';
  if (!isLoggedIn) {
    query += " AND (is_hidden != '1' AND is_hidden != 1)";
  }
  
  const server = await env.DB.prepare(query).bind(id).first();
  if (!server) return new Response('Not Found', { status: 404 });
  
  const latestMetrics = await getLatestMetrics(env.DB, id);
  
  if (latestMetrics) {
    server.cpu = latestMetrics.cpu || 0;
    server.ram = latestMetrics.ram || 0;
    server.disk = latestMetrics.disk || 0;
    server.load_avg = latestMetrics.load_avg || '0';
    server.net_in_speed = latestMetrics.net_in_speed || 0;
    server.net_out_speed = latestMetrics.net_out_speed || 0;
    server.net_rx = latestMetrics.net_rx || 0;
    server.net_tx = latestMetrics.net_tx || 0;
    server.processes = latestMetrics.processes || 0;
    server.tcp_conn = latestMetrics.tcp_conn || 0;
    server.udp_conn = latestMetrics.udp_conn || 0;
    server.ping_ct = latestMetrics.ping_ct || 0;
    server.ping_cu = latestMetrics.ping_cu || 0;
    server.ping_cm = latestMetrics.ping_cm || 0;
    server.ping_bd = latestMetrics.ping_bd || 0;
    server.ram_total = latestMetrics.ram_total || 0;
    server.ram_used = latestMetrics.ram_used || 0;
    server.swap_total = latestMetrics.swap_total || 0;
    server.swap_used = latestMetrics.swap_used || 0;
    server.disk_total = latestMetrics.disk_total || 0;
    server.disk_used = latestMetrics.disk_used || 0;
    server.last_updated = latestMetrics.timestamp || 0;
  }
  
  return new Response(JSON.stringify(server), { 
    headers: { 'Content-Type': 'application/json' } 
  });
}

export async function handleServersAPI(request, env, sys) {
  const isLoggedIn = checkAuth(request, env);
  
  // 如果关闭了公开访问，需要登录
  if (sys.is_public !== 'true' && !isLoggedIn) {
    return simpleAuthResponse();
  }
  
  let query = 'SELECT * FROM servers';
  if (!isLoggedIn) {
    query += " WHERE (is_hidden != '1' AND is_hidden != 1)";
  }
  query += ' ORDER BY sort_order ASC';
  
  const { results } = await env.DB.prepare(query).all();
  
  const latestMetricsMap = await getLatestMetricsForAllServers(env.DB);
  
  const now = Date.now();
  let globalOnline = 0;
  let globalSpeedIn = 0, globalSpeedOut = 0, globalNetTx = 0, globalNetRx = 0;
  const countryStats = {};
  
  for (const server of results) {
    const latestMetrics = latestMetricsMap.get(server.id);
    
    let lastUpdated = 0;
    let isOnline = false;
    
    if (latestMetrics) {
      lastUpdated = latestMetrics.timestamp;
      isOnline = (now - lastUpdated) < 300000;
      
      server.cpu = latestMetrics.cpu || 0;
      server.ram = latestMetrics.ram || 0;
      server.disk = latestMetrics.disk || 0;
      server.load_avg = latestMetrics.load_avg || '0';
      server.net_in_speed = latestMetrics.net_in_speed || 0;
      server.net_out_speed = latestMetrics.net_out_speed || 0;
      server.net_rx = latestMetrics.net_rx || 0;
      server.net_tx = latestMetrics.net_tx || 0;
      server.processes = latestMetrics.processes || 0;
      server.tcp_conn = latestMetrics.tcp_conn || 0;
      server.udp_conn = latestMetrics.udp_conn || 0;
      server.ping_ct = latestMetrics.ping_ct || 0;
      server.ping_cu = latestMetrics.ping_cu || 0;
      server.ping_cm = latestMetrics.ping_cm || 0;
      server.ping_bd = latestMetrics.ping_bd || 0;
      server.ram_total = latestMetrics.ram_total || 0;
      server.ram_used = latestMetrics.ram_used || 0;
      server.swap_total = latestMetrics.swap_total || 0;
      server.swap_used = latestMetrics.swap_used || 0;
      server.disk_total = latestMetrics.disk_total || 0;
      server.disk_used = latestMetrics.disk_used || 0;
      server.last_updated = lastUpdated;
    } else {
      lastUpdated = new Date(server.last_updated).getTime();
      isOnline = (now - lastUpdated) < 300000;
    }
    
    if (isOnline) {
      globalOnline++;
      globalSpeedIn += parseFloat(server.net_in_speed) || 0;
      globalSpeedOut += parseFloat(server.net_out_speed) || 0;
    }
    
    globalNetRx += parseFloat(server.net_rx || 0);
    globalNetTx += parseFloat(server.net_tx || 0);
    
    let cCode = (server.country || 'xx').toUpperCase();
    if (cCode === 'TW') cCode = 'CN';
    if (cCode !== 'XX') {
      countryStats[cCode] = (countryStats[cCode] || 0) + 1;
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
    countryStats,
    latestMetricsMap: Object.fromEntries(latestMetricsMap),
    sysConfig: {
      show_price: sys.show_price === 'true',
      show_expire: sys.show_expire === 'true',
      show_bw: sys.show_bw === 'true',
      show_tf: sys.show_tf === 'true',
      site_title: sys.site_title || 'Server Monitor',
      admin_title: sys.admin_title || 'Admin'
    }
  };

  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json' }
  });
}

