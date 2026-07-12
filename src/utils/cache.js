/**
 * 缓存管理模块。
 *
 * servers/settings 不再使用 Worker isolate 本地缓存，统一读取 ConfigCache DO。
 * 最新指标和历史查询结果仍保留短期本地缓存，它们不属于低频配置数据。
 */

import { readServers, refreshConfigCache } from '../services/configStore.js';

const LATEST_ALL_TTL = 30 * 1000;
let latestAllCache = null;
let latestAllCacheTime = 0;

const metricsHistoryCache = new Map();

export function getCacheDuration(hours) {
  if (hours >= 120) return 10 * 60 * 1000;
  if (hours >= 60) return 5 * 60 * 1000;
  if (hours >= 30) return 3 * 60 * 1000;
  return 1 * 60 * 1000;
}

function filterServersByHidden(servers, includeHidden) {
  if (!servers || servers.length === 0) return [];
  if (includeHidden) return servers.map(server => ({ ...server }));
  return servers
    .filter(server => server.is_hidden !== 1 && server.is_hidden !== '1')
    .map(server => ({ ...server }));
}

export async function getAllServers(env, includeHidden = true) {
  const servers = await readServers(env);
  return filterServersByHidden(servers, includeHidden);
}

export async function clearServersListCache(env) {
  if (env?.DB) await refreshConfigCache(env, 'servers');
}

export function clearServerDetailCache() {
  // 兼容旧调用；服务器详情已经与列表统一存放在 ConfigCache DO。
}

export async function getServerDetail(env, id, includeHidden = false) {
  const servers = await readServers(env);
  const server = servers.find(item => item.id === id);
  if (!server) return null;
  if (!includeHidden && (server.is_hidden === 1 || server.is_hidden === '1')) {
    return null;
  }
  return { ...server };
}

export async function checkServerExists(env, id) {
  return !!(await getServerDetail(env, id, true));
}

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
  return metricsHistoryCache.get(getCacheKey(serverId, hours, columns));
}

export function setMetricsHistoryCache(serverId, hours, columns, data) {
  metricsHistoryCache.set(getCacheKey(serverId, hours, columns), {
    data,
    timestamp: Date.now()
  });
}

export function clearMetricsHistoryCache(serverId) {
  for (const key of metricsHistoryCache.keys()) {
    if (key.startsWith(`${serverId}:`)) metricsHistoryCache.delete(key);
  }
}

export async function clearAllCaches(env) {
  clearLatestMetricsCache();
  metricsHistoryCache.clear();
  if (env?.DB) await refreshConfigCache(env, 'all');
}
