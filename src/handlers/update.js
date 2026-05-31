import { saveMetricsHistory } from '../database/schema.js';
import { checkOfflineNodes } from '../services/notification.js';

const SERVERS_UPDATE_PERCENTAGE = 5; // 5% 更新服务器信息

const serverExistenceCache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

async function checkServerExists(db, id) {
  const now = Date.now();
  const cached = serverExistenceCache.get(id);

  if (cached && now - cached.timestamp < CACHE_TTL) {
    return cached.exists;
  }

  const result = await db.prepare(
    'SELECT 1 FROM servers WHERE id = ?'
  ).bind(id).first();

  const exists = !!result;
  serverExistenceCache.set(id, { exists, timestamp: now });

  return exists;
}

export async function handleUpdate(request, env, ctx) {
  try {
    const data = await request.json();
    const { id, secret, metrics } = data;

    if (secret !== env.API_SECRET) {
      return new Response('Unauthorized', { status: 401 });
    }

    let countryCode = request.cf?.country || 'XX';
    if (countryCode.toUpperCase() === 'TW') countryCode = 'CN';

    const serverExists = await checkServerExists(env.DB, id);
    
    if (!serverExists) {
      return new Response('Server not found', { status: 404 });
    }

    await saveMetricsHistory(env.DB, id, metrics);

    if (Math.random() * 100 < SERVERS_UPDATE_PERCENTAGE) {
      await env.DB.prepare(`
        UPDATE servers 
        SET cpu = ?, ram = ?, disk = ?, load_avg = ?, uptime = ?, last_updated = ?,
            ram_total = ?, net_rx = ?, net_tx = ?, net_in_speed = ?, net_out_speed = ?,
            os = ?, cpu_info = ?, cpu_cores = ?, arch = ?, boot_time = ?, ram_used = ?, swap_total = ?, 
            swap_used = ?, disk_total = ?, disk_used = ?, processes = ?, tcp_conn = ?, udp_conn = ?, 
            country = ?, ip_v4 = ?, ip_v6 = ?, ping_ct = ?, ping_cu = ?, ping_cm = ?, ping_bd = ?
        WHERE id = ?
      `).bind(
        metrics.cpu, metrics.ram, metrics.disk, metrics.load, metrics.uptime, Date.now(),
        metrics.ram_total || '0', metrics.net_rx || '0', metrics.net_tx || '0',
        metrics.net_in_speed || '0', metrics.net_out_speed || '0',
        metrics.os || '', metrics.cpu_info || '', metrics.cpu_cores || '0', metrics.arch || '', metrics.boot_time || '',
        metrics.ram_used || '0', metrics.swap_total || '0', metrics.swap_used || '0',
        metrics.disk_total || '0', metrics.disk_used || '0', metrics.processes || '0',
        metrics.tcp_conn || '0', metrics.udp_conn || '0', countryCode,
        metrics.ip_v4 || '0', metrics.ip_v6 || '0',
        metrics.ping_ct || '0', metrics.ping_cu || '0', metrics.ping_cm || '0', metrics.ping_bd || '0',
        id
      ).run();
    }

    ctx.waitUntil(checkOfflineNodes(env.DB));

    return new Response('OK', { status: 200 });
  } catch (e) {
    console.error('更新数据失败:', e);
    return new Response(`Error: ${e.message}`, { status: 400 });
  }
}