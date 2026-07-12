import { saveSiteOptions, debug, getSettingByKey } from '../utils/settings.js';
import { getAllServers } from '../utils/cache.js';
import { refreshConfigCache, updateServerFields } from '../services/configStore.js';

export const HISTORY_PARTITION_MULTIPLIER = 10000000000000;
export const HISTORY_AUTO_OPTIMIZED_MIN_ID = HISTORY_PARTITION_MULTIPLIER;
export const HISTORY_MAX_PARTITION_ID = 900;
export const HISTORY_MAX_TIME_KEY = 991231235959;

// 确保servers历史记录分区优化
export async function ensureServerOptimization(env) {
  const db = env.DB;
  const optimized = await getSettingByKey(env, 'servers_optimized', true);
  const { results: columns = [] } = await db.prepare(`PRAGMA table_info(servers)`).all();
  const existingColumns = new Set(columns.map(column => column.name));
  let addedColumns = 0;

  if (!existingColumns.has('history_partition_id')) {
    await db.prepare(`ALTER TABLE servers ADD COLUMN history_partition_id INTEGER DEFAULT 0`).run();
    addedColumns++;
    debug('history_partition_id 字段已添加');
  }

  if (!existingColumns.has('timestamp')) {
    await db.prepare(`ALTER TABLE servers ADD COLUMN timestamp INTEGER DEFAULT 0`).run();
    addedColumns++;
    debug('timestamp 字段已添加');
  }

  if (addedColumns > 0) {
    await refreshConfigCache(env, 'servers');
  }

  if (optimized && addedColumns === 0) {
    debug('服务器历史记录分区已优化');
    return { success: true, assigned: 0 };
  }

  const servers = (await getAllServers(env, true))
    .map(server => ({
      id: server.id,
      history_partition_id: server.history_partition_id
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  
  if (servers.length === 0) {
    debug('没有服务器需要优化');
    await saveSiteOptions(env, { servers_optimized: 'true' });
    return { success: true, assigned: 0 };
  }

  if (servers.length > HISTORY_MAX_PARTITION_ID) {
    throw new Error(`No available history partition id; max is ${HISTORY_MAX_PARTITION_ID}`);
  }

  let updated = 0;

  for (let i = 0; i < servers.length; i++) {
    const server = servers[i];
    const partitionId = i + 1;
    if (Number(server.history_partition_id) === partitionId) {
      continue;
    }

    try {
      await updateServerFields(env, server.id, { history_partition_id: partitionId });
      updated++;
    } catch (e) {
      debug(`Failed to update server ${server.id} history_partition_id: ${e.message}`);
    }
  }

  // 清空服务器列表的缓存
  await refreshConfigCache(env, 'servers');

  debug(`服务器历史记录分区优化完成，更新了 ${updated} 条记录`);
  
  // 标记为已优化
  await saveSiteOptions(env, { servers_optimized: 'true' });

  return { success: true, assigned: updated };
}

// 获取下一个可用的历史记录分区ID
export async function getNextServerHistoryPartitionId(env) {
  const servers = await getAllServers(env, true);
  const usedIds = new Set(
    servers
      .map(s => Number(s.history_partition_id))
      .filter(id => Number.isInteger(id) && id > 0 && id <= HISTORY_MAX_PARTITION_ID)
  );
  
  for (let id = 1; id <= HISTORY_MAX_PARTITION_ID; id++) {
    if (!usedIds.has(id)) return id;
  }
  debug(`No available history partition id`);
  throw new Error(`No available history partition id`);
}

function padHistoryTimePart(value) {
  return String(value).padStart(2, '0');
}

// 格式化历史记录时间戳
export function normalizeHistoryTimestamp(value, fallback = Date.now()) {
  const ts = Number(value);
  if (!Number.isFinite(ts) || ts <= 0) return fallback;
  return ts < 10000000000 ? ts * 1000 : ts;
}

export function formatHistoryTimeKey(timestamp) {
  const normalized = normalizeHistoryTimestamp(timestamp);

  const date = new Date(normalized);
  const year = date.getUTCFullYear();
  if (year < 2000 || year > 2099) {
    debug(`Invalid year ${year} for history time key`);
    throw new Error(`Invalid year ${year} for history time key`);
  };

  return Number([
    padHistoryTimePart(year % 100),
    padHistoryTimePart(date.getUTCMonth() + 1),
    padHistoryTimePart(date.getUTCDate()),
    padHistoryTimePart(date.getUTCHours()),
    padHistoryTimePart(date.getUTCMinutes()),
    padHistoryTimePart(date.getUTCSeconds())
  ].join(''));
}

export function normalizeHistoryPartitionId(value) {
  const partitionId = Number(value);
  if (!Number.isInteger(partitionId) || partitionId <= 0 || partitionId > HISTORY_MAX_PARTITION_ID) {
    return null;
  }
  return partitionId;
}

export function buildHistoryId(partitionId, timestamp) {
  const normalizedPartitionId = normalizeHistoryPartitionId(partitionId);
  if (!normalizedPartitionId) {
    throw new Error('Invalid history partition id');
  }
  return normalizedPartitionId * HISTORY_PARTITION_MULTIPLIER + formatHistoryTimeKey(timestamp);
}

export async function getServerHistoryInfo(env, serverId, server = null) {
  const target = server && server.id === serverId
    ? server
    : (await getAllServers(env, true)).find(s => s.id === serverId);

  if (!target) {
    debug(`Server ${serverId} not found`);
    throw new Error(`Server ${serverId} not found`);
  }

  return {
    partitionId: normalizeHistoryPartitionId(target.history_partition_id),
    startTimestamp: normalizeHistoryTimestamp(target.timestamp, 0)
  };
}

export function getHistoryIdRange(partitionId, startTimestamp = null, endTimestamp = null) {
  const normalizedPartitionId = normalizeHistoryPartitionId(partitionId);
  if (!normalizedPartitionId) {
    throw new Error('Invalid history partition id');
  }

  const prefix = normalizedPartitionId * HISTORY_PARTITION_MULTIPLIER;
  return {
    startId: prefix + (startTimestamp === null || startTimestamp === undefined
      ? 0
      : formatHistoryTimeKey(startTimestamp)),
    endId: prefix + (endTimestamp === null || endTimestamp === undefined
      ? HISTORY_MAX_TIME_KEY
      : formatHistoryTimeKey(endTimestamp))
  };
}
