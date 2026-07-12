/**
 * 缓存管理模块
 * 集中管理所有内存缓存，包括：
 * - 服务器列表缓存
 * - 服务器详情（复用服务器列表缓存）
 * - 最新指标缓存
 * - 历史指标缓存
 * - 站点设置缓存
 */

import { clearAppearanceSettingsCache, clearSiteSettingsCache, debug } from './settings.js';

const SERVERS_LIST_TTL = 120 * 1000;
let serversListCache = null;

const LATEST_ALL_TTL = 30 * 1000;
let latestAllCache = null;
let latestAllCacheTime = 0;

const metricsHistoryCache = new Map();

const serverDetailCache = new Map();

export function getCacheDuration(hours) {
  if (hours >= 120) {
    return 10 * 60 * 1000;
  } else if (hours >= 60) {
    return 5 * 60 * 1000;
  } else if (hours >= 30) {
    return 3 * 60 * 1000;
  } else {
    return 1 * 60 * 1000;
  }
}

function filterServersByHidden(servers, includeHidden) {
  if (!servers || servers.length === 0) return [];
  if (includeHidden) {
    return [...servers];
  }
  return servers.filter(s => s.is_hidden !== 1 && s.is_hidden !== '1');
}

export async function getAllServers(db, includeHidden = true) {
  const now = Date.now();
  
  if (serversListCache && now - serversListCache.time < SERVERS_LIST_TTL) {
    debug('服务器列表缓存命中');
    return filterServersByHidden(serversListCache.data, includeHidden);
  }

  try {
    const { results } = await db.prepare('SELECT * FROM servers ORDER BY sort_order ASC').all();
    serversListCache = { data: results, time: now };
    debug('服务器列表缓存更新');
    return filterServersByHidden(results, includeHidden);
  } catch (e) {
    debug('获取服务器列表失败:', e);
    return filterServersByHidden(serversListCache?.data, includeHidden);
  }
}

export function clearServersListCache() {
  serversListCache = null;
  serverDetailCache.clear();
}

export function clearServerDetailCache() {
  serverDetailCache.clear();
}

export async function getServerDetail(db, id, includeHidden = false) {
  const now = Date.now();
  const cached = serverDetailCache.get(id);
  
  if (cached) {
    if (now - cached.time < SERVERS_LIST_TTL) {
      debug('服务器详情缓存命中');
      const server = cached.data;
      
      if (!server) {
        return null;
      }
      
      if (!includeHidden && (server.is_hidden === 1 || server.is_hidden === '1')) {
        return null;
      }
      
      return { ...server };
    }
    
    serverDetailCache.delete(id);
  }
  
  const server = await db.prepare('SELECT * FROM servers WHERE id = ?').bind(id).first();

  serverDetailCache.set(id, { data: server, time: now });
  debug('服务器详情缓存更新');
  
  if (!server) {
    return null;
  }
  
  if (!includeHidden && (server.is_hidden === 1 || server.is_hidden === '1')) {
    return null;
  }
  
  return { ...server };
}

export async function checkServerExists(db, id) {
  const server = await getServerDetail(db, id, true);
  return !!server;
}

/**
 * 获取最新指标缓存信息
 * @returns {object} 包含 cache、time、ttl 字段的对象
 */
export function getLatestMetricsCache() {
  return { cache: latestAllCache, time: latestAllCacheTime, ttl: LATEST_ALL_TTL };
}

export function setLatestMetricsCache(data) {
  latestAllCache = data;
  latestAllCacheTime = Date.now();
}

export function clearLatestMetricsCache() {
  latestAllCache = null;
  latestAllCacheTime = 0;
}

function getCacheKey(serverId, hours, columns) {
  const sortedColumns = columns.split(',').sort().join(',');
  return `${serverId}:${hours}:${sortedColumns}`;
}

export function getMetricsHistoryCache(serverId, hours, columns) {
  const key = getCacheKey(serverId, hours, columns);
  return metricsHistoryCache.get(key);
}

export function setMetricsHistoryCache(serverId, hours, columns, data) {
  const key = getCacheKey(serverId, hours, columns);
  metricsHistoryCache.set(key, { data, timestamp: Date.now() });
}

export function clearMetricsHistoryCache(serverId) {
  for (const key of metricsHistoryCache.keys()) {
    if (key.startsWith(`${serverId}:`)) {
      metricsHistoryCache.delete(key);
    }
  }
}

export function clearAllCaches() {
  clearServersListCache();
  clearLatestMetricsCache();
  metricsHistoryCache.clear();
  clearSiteSettingsCache();
  clearAppearanceSettingsCache();
}
