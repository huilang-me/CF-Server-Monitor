import { 
  getAllServers,
  getLatestMetricsCache, 
  setLatestMetricsCache,
  getMetricsHistoryCache,
  setMetricsHistoryCache,
  getCacheDuration
} from '../utils/cache.js';
import { saveSiteOptions, debug } from '../utils/settings.js';
import { addHistoryColumns, ensureHistoryIndex, ensureOptimizedHistoryStorage } from './updateDatabase.js';
import {
  buildHistoryId,
  createMetricsHistoryTableSql,
  ensureServerHistoryPartitions,
  getHistoryIdRange,
  getServerHistoryPartitionId,
  historyTableExists,
  isHistoryIdOptimized,
  normalizeHistoryTimestamp,
  quoteIdentifier
} from './historyKey.js';

let dbInitialized = false;

function buildHistorySource(tableName, useHistoryId, serverId, partitionId, cutoff, columns) {
  if (useHistoryId) {
    const { startId, endId } = getHistoryIdRange(partitionId, cutoff);
    return {
      sql: `
          SELECT timestamp, ${columns} FROM ${quoteIdentifier(tableName)}
          WHERE id >= ?
            AND id <= ?
            AND server_id = ?
            AND timestamp >= ?
        `,
      bindings: [startId, endId, serverId, cutoff]
    };
  }

  return {
    sql: `
          SELECT timestamp, ${columns} FROM ${quoteIdentifier(tableName)}
          WHERE server_id = ?
            AND typeof(timestamp) = 'integer'
            AND timestamp >= ?
        `,
    bindings: [serverId, cutoff]
  };
}

async function ensureHistoryStorage(db, optimizedHistory) {
  if (optimizedHistory) {
    const result = await ensureOptimizedHistoryStorage(db);
    if (!result.success) {
      throw new Error(result.error || 'metrics_history 优化模式准备失败');
    }
    return;
  }

  const result = await ensureHistoryIndex(db);
  if (!result.success) {
    throw new Error(result.error || 'metrics_history 索引检查失败');
  }
}

export async function initDatabase(db, env = {}) {
  if (dbInitialized) return;
  
  try {
    const optimizedHistory = isHistoryIdOptimized(env);
    const serverHistoryPartitionColumnSql = optimizedHistory ? `,
        history_partition_id INTEGER DEFAULT 0` : '';

    await db.prepare(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY, 
        value TEXT
      )
    `).run();

    await db.prepare(`
      CREATE TABLE IF NOT EXISTS servers (
        id TEXT PRIMARY KEY,
        name TEXT,
        server_group TEXT DEFAULT 'Default',
        price TEXT DEFAULT '',
        expire_date TEXT DEFAULT '',
        bandwidth TEXT DEFAULT '',
        traffic_limit TEXT DEFAULT '',
        traffic_calc_type TEXT DEFAULT 'total',
        reset_day INTEGER DEFAULT 1,
        collect_interval INTEGER DEFAULT 0,
        report_interval INTEGER DEFAULT 60,
        ping_mode TEXT DEFAULT 'http',
        is_hidden TEXT DEFAULT '0',
        sort_order INTEGER DEFAULT 0${serverHistoryPartitionColumnSql}
      )
    `).run();

    await db.prepare(createMetricsHistoryTableSql()).run();
    await ensureHistoryStorage(db, optimizedHistory);

    debug('✅ 数据库初始化完成');
    dbInitialized = true;
  } catch (e) {
    console.error('❌ 数据库初始化失败:', e);
  }
}

export async function rebuildDatabase(db, env = {}) {
  debug('开始执行数据库重建...');
  
  try {
    await db.prepare(`DROP TABLE IF EXISTS metrics_history`).run();
    debug('✅ 已删除 metrics_history 表');

    await db.prepare(`DROP TABLE IF EXISTS metrics_history_old`).run();
    debug('✅ 已删除 metrics_history_old 表');
    
    await db.prepare(`DROP TABLE IF EXISTS servers`).run();
    debug('✅ 已删除 servers 表');
    
    await db.prepare(`DROP TABLE IF EXISTS settings`).run();
    debug('✅ 已删除 settings 表');
    
    dbInitialized = false;
    
    await initDatabase(db, env);
    
    debug('✅ 数据库重建完成');
    
    return {
      success: true,
      message: 'databaseRebuiltSuccess'
    };
  } catch (e) {
    console.error('❌ 数据库重建失败:', e);
    return {
      success: false,
      message: 'databaseRebuiltFailed',
      error: e.message
    };
  }
}

export async function getMetricsHistory(db, serverId, hours, columns, env = {}) {
  const now = Date.now();
  const cacheDuration = getCacheDuration(hours);
  const optimizedHistory = isHistoryIdOptimized(env);
  
  const cached = getMetricsHistoryCache(serverId, hours, columns);
  if (cached && now - cached.timestamp < cacheDuration) {
    debug(`[History] CACHE HIT: ${serverId}, hours: ${hours}`);
    return cached.data;
  }
  
  let queryHours = hours;
  let intervalMs;
  
  if (hours > 168) {
    queryHours = 168;
    intervalMs = 80 * 60 * 1000;
  } else if (hours >= 96) {
    intervalMs = 60 * 60 * 1000;
  } else if (hours >= 48) {
    intervalMs = 40 * 60 * 1000;
  } else if (hours >= 24) {
    intervalMs = 15 * 60 * 1000;
  } else if (hours >= 12) {
    intervalMs = 10 * 60 * 1000;
  } else if (hours >= 6) {
    intervalMs = 5 * 60 * 1000;
  } else if (hours > 1) {
    intervalMs = 1 * 60 * 1000;
  } else {
    intervalMs = 10 * 1000;
  }

  const cutoff = now - queryHours * 60 * 60 * 1000;

  debug(
    '[History]',
    'server:', serverId,
    'hours:', hours,
    'queryHours:', queryHours,
    'interval:', intervalMs,
    'cutoff:', new Date(cutoff).toISOString()
  );

  // 判断是否需要查询 metrics_history_old 表
  // 如果 cutoff 早于本周日 00:00 UTC（表轮换时间），说明需要查旧表
  const nowDate = new Date(now);
  const day = nowDate.getUTCDay();
  const thisSunday = new Date(Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth(), nowDate.getUTCDate() - day));
  const needOldTable = cutoff < thisSunday.getTime();
  
  const partitionId = optimizedHistory ? await getServerHistoryPartitionId(db, serverId) : null;
  const sources = [
    buildHistorySource('metrics_history', optimizedHistory, serverId, partitionId, cutoff, columns)
  ];

  if (!optimizedHistory && needOldTable && await historyTableExists(db, 'metrics_history_old')) {
    sources.push(buildHistorySource('metrics_history_old', false, serverId, null, cutoff, columns));
    debug('[History] 跨周查询，合并 metrics_history 和 metrics_history_old');
  }

  const unionSql = sources.map(source => source.sql).join('\n          UNION ALL\n');
  const bindings = [intervalMs, ...sources.flatMap(source => source.bindings)];
  const rawResult = await db.prepare(`
    WITH sampled AS (
      SELECT
        timestamp,
        ${columns},
        ROW_NUMBER() OVER (
          PARTITION BY CAST(timestamp / ? AS INTEGER)
          ORDER BY timestamp
        ) AS rn
      FROM (
${unionSql}
      )
    )
    SELECT timestamp, ${columns}
    FROM sampled
    WHERE rn = 1
  `).bind(...bindings).all();

  const result = rawResult.results.map(row => ({
    ...row,
    timestamp: Number(row.timestamp)
  }));

  result.sort((a, b) => a.timestamp - b.timestamp);
  
  setMetricsHistoryCache(serverId, hours, columns, result);

  debug(`[History] FINAL: ${result.length}`);

  return result;
}

export async function dropMetricsHistoryOld(db) {
  try {
    await db.prepare(`DROP TABLE IF EXISTS metrics_history_old`).run();
    debug('[Cleanup] 已删除 metrics_history_old 表');
    return { success: true };
  } catch (e) {
    console.error('[Cleanup] 删除 metrics_history_old 表失败:', e);
    return { success: false, error: e.message };
  }
}

export async function weeklyCleanup(db, env = {}) {
  try {
    debug('[Cleanup] 开始执行表轮换操作...');
    
    await saveSiteOptions(db, { cleanup_skip_count: '1' });
    debug('cleanup_skip_count set to 1');
    
    // 1. 删除旧的 metrics_history_old 表（如果存在）
    await db.prepare(`DROP TABLE IF EXISTS metrics_history_old`).run();
    debug('[Cleanup] 已删除旧的 metrics_history_old 表');
    
    // 2. 将 metrics_history 重命名为 metrics_history_old
    const currentTable = await db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='metrics_history'`
    ).first();
    
    if (currentTable) {
      await db.prepare(`ALTER TABLE metrics_history RENAME TO metrics_history_old`).run();
      debug('[Cleanup] 已将 metrics_history 重命名为 metrics_history_old');
    }
    
    // 3. 重新初始化数据库以创建新的 metrics_history 表
    dbInitialized = false;
    await initDatabase(db, env);

    debug('[Cleanup] 已创建新的 metrics_history 表');
    
    return {
      success: true,
      message: '表轮换成功'
    };
  } catch (e) {
    console.error('[Cleanup] 表轮换失败:', e);
    return { success: false, error: e.message };
  }
}

export async function saveMetricsHistory(db, serverId, metrics, regionCode = '', timestamp = null, env = {}, partitionRepairAttempted = false) {
  const useHistoryId = isHistoryIdOptimized(env);

  try {
    const now = normalizeHistoryTimestamp(timestamp);
    
    const parsePing = (val) => {
      if (val === '' || val === null || val === undefined) return null;
      const num = parseInt(val);
      return (num > 0) ? num : null;
    };

    const parseLoss = (val) => {
      if (val === '' || val === null || val === undefined) return null;
      const num = parseInt(val);
      if (Number.isNaN(num)) return null;
      return Math.max(0, Math.min(100, num));
    };
    
    const partitionId = useHistoryId ? await getServerHistoryPartitionId(db, serverId) : null;

    const insertColumns = [
      'server_id', 'timestamp', 'cpu', 'load_avg',
      'net_in_speed', 'net_out_speed', 'net_rx', 'net_tx',
      'processes', 'tcp_conn', 'udp_conn',
      'ping_ct', 'ping_cu', 'ping_cm', 'ping_bd',
      'loss_ct', 'loss_cu', 'loss_cm', 'loss_bd',
      'ram_total', 'ram_used', 'swap_total', 'swap_used',
      'disk_total', 'disk_used',
      'cpu_cores', 'cpu_info', 'gpu', 'gpu_info', 'arch', 'os', 'region', 'ip_v4', 'ip_v6', 'boot_time',
      'net_rx_monthly', 'net_tx_monthly'
    ];
    const insertValues = [
      serverId,
      now,
      parseFloat(metrics.cpu) || 0,
      metrics.load || metrics.load_avg || '0 0 0',
      parseFloat(metrics.net_in_speed) || 0,
      parseFloat(metrics.net_out_speed) || 0,
      parseFloat(metrics.net_rx) || 0,
      parseFloat(metrics.net_tx) || 0,
      parseInt(metrics.processes) || 0,
      parseInt(metrics.tcp_conn) || 0,
      parseInt(metrics.udp_conn) || 0,
      parsePing(metrics.ping_ct),
      parsePing(metrics.ping_cu),
      parsePing(metrics.ping_cm),
      parsePing(metrics.ping_bd),
      parseLoss(metrics.loss_ct),
      parseLoss(metrics.loss_cu),
      parseLoss(metrics.loss_cm),
      parseLoss(metrics.loss_bd),
      parseFloat(metrics.ram_total) || 0,
      parseFloat(metrics.ram_used) || 0,
      parseFloat(metrics.swap_total) || 0,
      parseFloat(metrics.swap_used) || 0,
      parseFloat(metrics.disk_total) || 0,
      parseFloat(metrics.disk_used) || 0,
      parseInt(metrics.cpu_cores) || 0,
      metrics.cpu_info || '',
      metrics.gpu === '' || metrics.gpu === null || metrics.gpu === undefined ? null : (parseFloat(metrics.gpu) || 0),
      metrics.gpu_info || '',
      metrics.arch || '',
      metrics.os || '',
      regionCode,
      metrics.ip_v4 || '0',
      metrics.ip_v6 || '0',
      metrics.boot_time || '',
      parseFloat(metrics.net_rx_monthly) || 0,
      parseFloat(metrics.net_tx_monthly) || 0
    ];
    const columns = useHistoryId ? ['id', ...insertColumns] : insertColumns;
    const values = useHistoryId ? [buildHistoryId(partitionId, now), ...insertValues] : insertValues;
    const placeholders = columns.map(() => '?').join(', ');
    const conflictSql = useHistoryId
      ? ` ON CONFLICT(id) DO UPDATE SET ${insertColumns.map(column => `${column} = excluded.${column}`).join(', ')} WHERE metrics_history.server_id = excluded.server_id`
      : '';

    const result = await db.prepare(`
      INSERT INTO metrics_history (
        ${columns.join(', ')}
      ) VALUES (
        ${placeholders}
      )${conflictSql}
    `).bind(...values).run();

    if (useHistoryId && result?.meta?.changes === 0 && !partitionRepairAttempted) {
      await ensureServerHistoryPartitions(db);
      return saveMetricsHistory(db, serverId, metrics, regionCode, timestamp, env, true);
    }
  } catch (e) {
    if (useHistoryId && e.message && /datatype mismatch|NOT NULL constraint failed: metrics_history\.id/i.test(e.message) && !partitionRepairAttempted) {
      await ensureOptimizedHistoryStorage(db);
      return saveMetricsHistory(db, serverId, metrics, regionCode, timestamp, env, true);
    }

    // 检测是否是 "has no column" 错误，如果是则添加缺失字段
    if (e.message && /has no column/i.test(e.message)) {
      if (useHistoryId && !partitionRepairAttempted) {
        await ensureOptimizedHistoryStorage(db);
        return saveMetricsHistory(db, serverId, metrics, regionCode, timestamp, env, true);
      }

      console.warn('检测到数据库字段缺失，尝试添加缺失字段...');
      await addHistoryColumns(db);
      return;
    }
    console.error('保存历史数据失败:', e);
  }
}

export async function getLatestMetrics(db, serverId, env = {}) {
  try {
    const useHistoryId = isHistoryIdOptimized(env);
    let result;

    if (useHistoryId) {
      const partitionId = await getServerHistoryPartitionId(db, serverId);
      const { startId, endId } = getHistoryIdRange(partitionId);
      result = await db.prepare(`
        SELECT * FROM metrics_history
        WHERE id >= ?
          AND id <= ?
          AND server_id = ?
        ORDER BY id DESC
        LIMIT 1
      `).bind(startId, endId, serverId).first();
    } else {
      result = await db.prepare(`
        SELECT * FROM metrics_history
        WHERE server_id = ?
        ORDER BY timestamp DESC
        LIMIT 1
      `).bind(serverId).first();
    }
    
    return result || null;
  } catch (e) {
    console.error('获取最新指标数据失败:', e);
    return null;
  }
}

export async function getLatestMetricsForAllServers(db, env = {}) {
  const now = Date.now();
  const cacheInfo = getLatestMetricsCache();
  if (cacheInfo.cache && now - cacheInfo.time < cacheInfo.ttl) {
    return cacheInfo.cache;
  }

  const useHistoryId = isHistoryIdOptimized(env);
  if (!useHistoryId) {
    await ensureHistoryIndex(db);
  }

  try {
    const servers = await getAllServers(db);

    const entries = await Promise.all(
      servers.map(s =>
        getLatestMetricsWithMode(db, s.id, useHistoryId).then(metrics => [s.id, metrics])
      )
    );

    const result = new Map(entries.filter(([, m]) => m !== null));
    setLatestMetricsCache(result);
    return result;
  } catch (e) {
    console.error('获取所有服务器最新指标数据失败:', e);
    const cacheInfo = getLatestMetricsCache();
    return cacheInfo.cache || new Map();
  }
}

async function getLatestMetricsWithMode(db, serverId, useHistoryId) {
  if (useHistoryId) {
    const partitionId = await getServerHistoryPartitionId(db, serverId);
    const { startId, endId } = getHistoryIdRange(partitionId);
    return await db.prepare(`
      SELECT * FROM metrics_history
      WHERE id >= ?
        AND id <= ?
        AND server_id = ?
      ORDER BY id DESC
      LIMIT 1
    `).bind(startId, endId, serverId).first();
  }

  return await db.prepare(`
    SELECT * FROM metrics_history
    WHERE server_id = ?
    ORDER BY timestamp DESC
    LIMIT 1
  `).bind(serverId).first();
}

export async function deleteMetricsHistoryForServer(db, serverId, tableName = 'metrics_history', env = {}) {
  if (!await historyTableExists(db, tableName)) {
    return { success: true, changes: 0 };
  }

  const useHistoryId = tableName === 'metrics_history' && isHistoryIdOptimized(env);
  let result;

  if (useHistoryId) {
    const partitionId = await getServerHistoryPartitionId(db, serverId);
    const { startId, endId } = getHistoryIdRange(partitionId);
    result = await db.prepare(`
      DELETE FROM ${quoteIdentifier(tableName)}
      WHERE id >= ?
        AND id <= ?
        AND server_id = ?
    `).bind(startId, endId, serverId).run();
  } else {
    result = await db.prepare(`
      DELETE FROM ${quoteIdentifier(tableName)}
      WHERE server_id = ?
    `).bind(serverId).run();
  }

  return {
    success: true,
    changes: result?.meta?.changes || 0
  };
}
