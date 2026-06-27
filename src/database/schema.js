import { 
  getAllServers,
  getLatestMetricsCache, 
  setLatestMetricsCache,
  getMetricsHistoryCache,
  setMetricsHistoryCache,
  getCacheDuration
} from '../utils/cache.js';
import { saveSiteOptions, debug } from '../utils/settings.js';
import { addHistoryColumns } from './updateDatabase.js';

let dbInitialized = false;

export async function initDatabase(db) {
  if (dbInitialized) return;
  
  try {
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
        sort_order INTEGER DEFAULT 0
      )
    `).run();

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
        net_tx_monthly REAL DEFAULT 0,
        FOREIGN KEY (server_id) REFERENCES servers(id)
      )
    `).run();

    await db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_history_server_time 
      ON metrics_history(server_id, timestamp)
    `).run();

    debug('✅ 数据库初始化完成');
    dbInitialized = true;
  } catch (e) {
    console.error('❌ 数据库初始化失败:', e);
  }
}

export async function rebuildDatabase(db) {
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
    
    await initDatabase(db);
    
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

export async function getMetricsHistory(db, serverId, hours, columns) {
  const now = Date.now();
  const cacheDuration = getCacheDuration(hours);
  
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
  // 获取当前月份的第一天 00:00:00 的时间戳
  const nowDate = new Date(now);
  const currentMonthStart = new Date(nowDate.getFullYear(), nowDate.getMonth(), 1).getTime();
  
  // 如果 cutoff 在当前月份之前，说明需要查询旧表
  const needOldTable = cutoff < currentMonthStart;
  // const needOldTable = true;
  
  // 检查 metrics_history_old 表是否存在
  let oldTableExists = false;
  if (needOldTable) {
    const oldTable = await db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='metrics_history_old'`
    ).first();
    oldTableExists = !!oldTable;
  }

  let rawResult;
  
  if (needOldTable && oldTableExists) {
    // 跨月查询，使用 UNION ALL
    debug('[History] 跨月查询，合并 metrics_history 和 metrics_history_old');
    
    rawResult = await db.prepare(`
      WITH sampled AS (
        SELECT 
          timestamp, 
          ${columns},
          ROW_NUMBER() OVER (
            PARTITION BY CAST(timestamp / ? AS INTEGER)
            ORDER BY timestamp
          ) AS rn
        FROM (
          SELECT timestamp, ${columns} FROM metrics_history
          WHERE server_id = ?
            AND typeof(timestamp) = 'integer'
            AND timestamp >= ?
          
          UNION ALL
          
          SELECT timestamp, ${columns} FROM metrics_history_old
          WHERE server_id = ?
            AND typeof(timestamp) = 'integer'
            AND timestamp >= ?
        )
      )
      SELECT timestamp, ${columns}
      FROM sampled
      WHERE rn = 1
    `).bind(intervalMs, serverId, cutoff, serverId, cutoff).all();
  } else {
    // 单表查询
    rawResult = await db.prepare(`
      WITH sampled AS (
        SELECT 
          timestamp, 
          ${columns},
          ROW_NUMBER() OVER (
            PARTITION BY CAST(timestamp / ? AS INTEGER)
            ORDER BY timestamp
          ) AS rn
        FROM metrics_history
        WHERE server_id = ?
          AND typeof(timestamp) = 'integer'
          AND timestamp >= ?
      )
      SELECT timestamp, ${columns}
      FROM sampled
      WHERE rn = 1
    `).bind(intervalMs, serverId, cutoff).all();
  }

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

export async function monthlyCleanup(db) {
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

export async function saveMetricsHistory(db, serverId, metrics, regionCode = '', timestamp = null) {
  try {
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
        server_id, timestamp, cpu, load_avg,
        net_in_speed, net_out_speed, net_rx, net_tx,
        processes, tcp_conn, udp_conn,
        ping_ct, ping_cu, ping_cm, ping_bd,
        loss_ct, loss_cu, loss_cm, loss_bd,
        ram_total, ram_used, swap_total, swap_used,
        disk_total, disk_used,
        cpu_cores, cpu_info, gpu, gpu_info, arch, os, region, ip_v4, ip_v6, boot_time,
        net_rx_monthly, net_tx_monthly
      ) VALUES (
        ?, ?, ?, ?,
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

export async function getLatestMetrics(db, serverId) {
  try {
    const result = await db.prepare(`
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

  try {
    const servers = await getAllServers(db);

    const entries = await Promise.all(
      servers.map(s =>
        getLatestMetrics(db, s.id).then(metrics => [s.id, metrics])
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
