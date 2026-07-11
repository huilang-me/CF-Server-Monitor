import { getAllServers, getLatestMetricsCache, setLatestMetricsCache, getMetricsHistoryCache, setMetricsHistoryCache, getCacheDuration, clearAllCaches } from '../utils/cache.js';
import { saveSiteOptions, debug, getSettingByKey } from '../utils/settings.js';
import { ensureServerOptimization, buildHistoryId, getServerHistoryInfo, getHistoryIdRange } from './indexOptimization.js';
import { addHistoryColumns, ensureHistoryIndex, isHistoryOptimized } from './updateDatabase.js';

let dbInitialized = false;

export async function initDatabase(db) {
  if (dbInitialized) return;

  debug('初始化数据库');
  
  try {
    const SettingTableExists = await db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='settings'
    `).first();
    if (!SettingTableExists) {
      await db.prepare(`
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY, 
          value TEXT
        )
      `).run();
      await saveSiteOptions(db, { servers_optimized: 'true' });
      await saveSiteOptions(db, { history_id_optimized: 'true' });
    }

    // 判断servers表是否存在
    const ServerTableExists = await db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='servers'
    `).first();
    if (!ServerTableExists) {
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
          offline_notify_disabled TEXT DEFAULT '0',
          is_hidden TEXT DEFAULT '0',
          sort_order INTEGER DEFAULT 0,
          history_partition_id INTEGER DEFAULT 0,
          timestamp INTEGER DEFAULT 0
        )
      `).run();
    } else {
      debug('检查servers表优化状态');
      await ensureServerOptimization(db);
    }

    // 判断metrics_history表是否存在
    const historyTableExists = await db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='metrics_history'
    `).first();
    if (!historyTableExists) {
      await db.prepare(`
        CREATE TABLE IF NOT EXISTS metrics_history (
          id INTEGER PRIMARY KEY,
          server_id TEXT NOT NULL,
          timestamp INTEGER DEFAULT 0,
          cpu REAL DEFAULT 0,
          load_avg TEXT DEFAULT '0',
          net_in_speed REAL DEFAULT 0,
          net_out_speed REAL DEFAULT 0,
          net_rx REAL DEFAULT 0,
          net_tx REAL DEFAULT 0,
          processes INTEGER DEFAULT 0,
          tcp_conn INTEGER DEFAULT 0,
          udp_conn INTEGER DEFAULT 0,
          ping_ct INTEGER DEFAULT 0,
          ping_cu INTEGER DEFAULT 0,
          ping_cm INTEGER DEFAULT 0,
          ping_bd INTEGER DEFAULT 0,
          loss_ct INTEGER DEFAULT NULL,
          loss_cu INTEGER DEFAULT NULL,
          loss_cm INTEGER DEFAULT NULL,
          loss_bd INTEGER DEFAULT NULL,
          ram_total REAL DEFAULT 0,
          ram_used REAL DEFAULT 0,
          swap_total REAL DEFAULT 0,
          swap_used REAL DEFAULT 0,
          disk_total REAL DEFAULT 0,
          disk_used REAL DEFAULT 0,
          cpu_cores INTEGER DEFAULT 0,
          cpu_info TEXT DEFAULT '',
          gpu REAL DEFAULT NULL,
          gpu_info TEXT DEFAULT '',
          arch TEXT DEFAULT '',
          os TEXT DEFAULT '',
          region TEXT DEFAULT '',
          ip_v4 TEXT DEFAULT '0',
          ip_v6 TEXT DEFAULT '0',
          boot_time TEXT DEFAULT '',
          net_rx_monthly REAL DEFAULT 0,
          net_tx_monthly REAL DEFAULT 0
        )
      `).run();
    }else{
      await ensureHistoryIndex(db);
    }

    debug('✅ 数据库初始化完成');
    dbInitialized = true;
  } catch (e) {
    console.error('❌ 数据库初始化失败:', e);
  }
}

export async function clearHistory(db) {
  debug('开始清空历史数据...');
  
  try {
    await db.prepare(`DROP TABLE IF EXISTS metrics_history`).run();
    debug('✅ 已删除 metrics_history 表');

    await db.prepare(`DROP TABLE IF EXISTS metrics_history_old`).run();
    debug('✅ 已删除 metrics_history_old 表');
    
    dbInitialized = false;
    
    await initDatabase(db);

    await saveSiteOptions(db, { history_id_optimized: 'true' });

    await clearAllCaches(db);
    
    debug('✅ 数据库重建完成');
    
    return {
      success: true,
      message: 'databaseRebuiltSuccess'
    };
  } catch (e) {
    console.error('❌ 数据库清理失败:', e);
    return {
      success: false,
      message: 'databaseRebuiltFailed',
      error: e.message
    };
  }
}

async function hasHistoryServerTimeIndex(db, tableName) {
  const index = await db.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'index'
      AND tbl_name = ?
      AND sql IS NOT NULL
      AND LOWER(sql) LIKE '%server_id%'
      AND LOWER(sql) LIKE '%timestamp%'
    LIMIT 1
  `).bind(tableName).first();

  return !!index;
}

function buildHistorySourceQuery(tableName, useIdRange, columns) {
  if (useIdRange) {
    return `
      SELECT timestamp, ${columns} FROM ${tableName}
      WHERE id >= ?
        AND id <= ?
    `;
  }

  return `
    SELECT timestamp, ${columns} FROM ${tableName}
    WHERE server_id = ?
      AND typeof(timestamp) = 'integer'
      AND timestamp >= ?
  `;
}

export async function getMetricsHistory(db, serverId, hours, columns, server = null) {
  const now = Date.now();
  const cacheDuration = getCacheDuration(hours);
  
  const cached = getMetricsHistoryCache(serverId, hours, columns);
  if (cached && now - cached.timestamp < cacheDuration) {
    debug(`[History] CACHE HIT: ${serverId}, hours: ${hours}`);
    return cached.data;
  }
  
  // 最多返回80个数据点,前端需要配合这个计算断点阈值
  const queryHours = Math.min(hours, 168);
  const MAX_POINTS = 80;
  const totalMs = queryHours * 60 * 60 * 1000;
  const intervalMs = Math.max(10_000, Math.ceil(totalMs / MAX_POINTS));

  const cutoff = now - queryHours * 60 * 60 * 1000;
  const historyInfo = await getServerHistoryInfo(db, serverId, server);
  const queryStart = Math.max(cutoff, historyInfo.startTimestamp);

  debug(
    '[History]',
    'server:', serverId,
    'hours:', hours,
    'queryHours:', queryHours,
    'interval:', intervalMs,
    'cutoff:', new Date(cutoff).toISOString(),
    'start:', new Date(queryStart).toISOString()
  );

  // 判断是否需要查询 metrics_history_old 表
  // 如果实际查询起点早于本周日 00:00 UTC（表轮换时间），说明需要查旧表
  const nowDate = new Date(now);
  const day = nowDate.getUTCDay();
  const thisSunday = new Date(Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth(), nowDate.getUTCDate() - day));
  const needOldTable = queryStart < thisSunday.getTime();
  
  const oldTableExists = needOldTable && !!await db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='metrics_history_old'`
  ).first();

  const history_id_optimized = await getSettingByKey(db, 'history_id_optimized', true);
  const currentHasServerTimeIndex = history_id_optimized
    ? false
    : await hasHistoryServerTimeIndex(db, 'metrics_history');
  const currentUsesIdRange = history_id_optimized || !currentHasServerTimeIndex;
  const oldUsesIdRange = oldTableExists
    ? history_id_optimized || !await hasHistoryServerTimeIndex(db, 'metrics_history_old')
    : false;
  const needsIdRange = currentUsesIdRange || oldUsesIdRange;

  let idRange = null;
  if (needsIdRange) {
    if (!historyInfo.partitionId) {
      throw new Error('Invalid history partition id');
    }

    idRange = getHistoryIdRange(historyInfo.partitionId, queryStart);
  }

  const sourceQueries = [];
  const bindValues = [intervalMs];

  sourceQueries.push(buildHistorySourceQuery('metrics_history', currentUsesIdRange, columns));
  if (currentUsesIdRange) {
    bindValues.push(idRange.startId, idRange.endId);
  } else {
    bindValues.push(serverId, queryStart);
  }

  if (oldTableExists) {
    debug('[History] 跨周查询，合并 metrics_history 和 metrics_history_old');
    sourceQueries.push(buildHistorySourceQuery('metrics_history_old', oldUsesIdRange, columns));
    if (oldUsesIdRange) {
      bindValues.push(idRange.startId, idRange.endId);
    } else {
      bindValues.push(serverId, queryStart);
    }
  }

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
        ${sourceQueries.join('\n        UNION ALL\n')}
      )
    )
    SELECT timestamp, ${columns}
    FROM sampled
    WHERE rn = 1
  `).bind(...bindValues).all();

  const result = rawResult.results.map(row => ({
    ...row,
    timestamp: Number(row.timestamp)
  }));

  result.sort((a, b) => a.timestamp - b.timestamp);

  setMetricsHistoryCache(serverId, hours, columns, result);

  debug(`[History] FINAL: ${result.length}, interval: ${intervalMs}ms`);

  return result;
}


export async function weeklyCleanup(db) {
  try {
    debug('[Cleanup] 开始执行表轮换操作...');
    
    // 判断metrics_history有无索引
    const index = await db.prepare(
      `SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='metrics_history'`
    ).first();
    if(!index){
      await saveSiteOptions(db, { history_id_optimized: 'true' });
      debug('✅ 切换到优化模式');
    }else{
      debug('✅ 继续兼容模式');
    }
    
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
    await initDatabase(db);

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

export async function saveMetricsHistory(db, serverId, historyPartitionId, metrics, regionCode = '', timestamp = null) {
  try {
    const historyId = buildHistoryId(historyPartitionId, timestamp);
    const rawTimestamp = Number(timestamp);
    const now = Number.isFinite(rawTimestamp) && rawTimestamp > 0
      ? (rawTimestamp < 10000000000 ? rawTimestamp * 1000 : rawTimestamp)
      : Date.now();
    
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
    
    await db.prepare(`
      INSERT INTO metrics_history (
        id, server_id, timestamp, cpu, load_avg,
        net_in_speed, net_out_speed, net_rx, net_tx,
        processes, tcp_conn, udp_conn,
        ping_ct, ping_cu, ping_cm, ping_bd,
        loss_ct, loss_cu, loss_cm, loss_bd,
        ram_total, ram_used, swap_total, swap_used,
        disk_total, disk_used,
        cpu_cores, cpu_info, gpu, gpu_info, arch, os, region, ip_v4, ip_v6, boot_time,
        net_rx_monthly, net_tx_monthly
      ) VALUES (
        ?,?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?
      )
    `).bind(
      historyId,
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
    ).run();
  } catch (e) {
    // 检测是否是 "has no column" 错误，如果是则添加缺失字段
    if (e.message && /has no column/i.test(e.message)) {
      console.warn('检测到数据库字段缺失，尝试添加缺失字段...');
      await addHistoryColumns(db);
      return;
    }
    console.error('保存历史数据失败:', e);
  }
}

export async function getLatestMetrics(db, serverId, server = null) {
  try {
    const historyInfo = await getServerHistoryInfo(db, serverId, server);
    if (!historyInfo.partitionId) {
      throw new Error('Invalid history partition id');
    }

    const useIdFilter = await isHistoryOptimized(db);

    const rangeStart = historyInfo.startTimestamp > 0 ? historyInfo.startTimestamp : null;
    const { startId, endId } = getHistoryIdRange(historyInfo.partitionId, rangeStart);
    debug(`Server ${serverId} history_id_range: ${startId} - ${endId}`);
  
    const result = useIdFilter ? await db.prepare(`
      SELECT * FROM metrics_history
      WHERE id >= ?
        AND id <= ?
      ORDER BY id DESC
      LIMIT 1
    `).bind(startId, endId).first()
    :await db.prepare(`
      SELECT * FROM metrics_history
      WHERE server_id = ?
      ORDER BY timestamp DESC
      LIMIT 1
    `).bind(serverId).first();
    return result || null;
  } catch (e) {
    console.error('获取最新指标数据失败:', e);
    return null;
  }
}

export async function getLatestMetricsForAllServers(db) {
  const now = Date.now();
  const cacheInfo = getLatestMetricsCache();
  if (cacheInfo.cache && now - cacheInfo.time < cacheInfo.ttl) {
    return cacheInfo.cache;
  }

  // 确保 metrics_history 表有 idx_history_server_time 索引
  await ensureHistoryIndex(db);

  try {
    const servers = await getAllServers(db);

    const entries = await Promise.all(
      servers.map(s =>
        getLatestMetrics(db, s.id, s).then(metrics => [s.id, metrics])
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
