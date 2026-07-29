import { getAllServers, getLatestMetricsCache, setLatestMetricsCache, getMetricsHistoryCache, setMetricsHistoryCache, getCacheDuration, clearAllCaches } from '../utils/cache.js';
import { saveSiteOptions, debug, getSettingByKey, normalizeLongHistoryPoints, DEFAULT_LONG_HISTORY_POINTS } from '../utils/settings.js';
import { isDisabledProbeMetric, normalizeProbeMetricRow } from '../utils/metrics.js';
import { ensureServerOptimization, buildHistoryId, getServerHistoryInfo, getHistoryIdRange } from './indexOptimization.js';
import { addHistoryColumns, ensureHistoryIndex, isHistoryOptimized } from './updateDatabase.js';
import {
  buildSparseHistoryQuery,
  shouldUseSparseHistorySampling
} from './historySampling.js';

let dbInitialized = false;

const LOSS_AGG_COLUMNS = new Set(['loss_ct', 'loss_cu', 'loss_cm', 'loss_bd']);
const DEFAULT_HISTORY_MAX_POINTS = 160;

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
          region TEXT DEFAULT '',
          tags TEXT DEFAULT '',
          note TEXT DEFAULT '',
          price TEXT DEFAULT '',
          billing_cycle TEXT DEFAULT 'month',
          auto_renewal TEXT DEFAULT '0',
          currency TEXT DEFAULT '¥',
          expire_date TEXT DEFAULT '',
          traffic_limit TEXT DEFAULT '',
          traffic_calc_type TEXT DEFAULT 'total',
          reset_day INTEGER DEFAULT 1,
          collect_interval INTEGER DEFAULT 0,
          report_interval INTEGER DEFAULT 60,
          auto_update TEXT DEFAULT '0',
          custom_ct TEXT DEFAULT '',
          custom_cu TEXT DEFAULT '',
          custom_cm TEXT DEFAULT '',
          custom_bd TEXT DEFAULT '',
          rx_correction REAL DEFAULT NULL,
          tx_correction REAL DEFAULT NULL,
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
          agent_version TEXT DEFAULT '',
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
          gpu_info TEXT DEFAULT '',
          arch TEXT DEFAULT '',
          os TEXT DEFAULT '',
          kernel_version TEXT DEFAULT '',
          region TEXT DEFAULT '',
          ip TEXT DEFAULT '',
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

export async function getMetricsHistory(
  db,
  serverId,
  hours,
  columns,
  server = null,
  longHistoryPoints = DEFAULT_LONG_HISTORY_POINTS
) {
  const now = Date.now();
  const cacheDuration = getCacheDuration(hours);
  const queryHours = Math.min(hours, 168);
  const configuredLongHistoryPoints = queryHours > 1
    ? Number(normalizeLongHistoryPoints(longHistoryPoints))
    : null;
  
  const cached = getMetricsHistoryCache(serverId, hours, columns, configuredLongHistoryPoints);
  if (cached && now - cached.timestamp < cacheDuration) {
    debug(`[History] CACHE HIT: ${serverId}, hours: ${hours}`);
    return cached.data;
  }
  
  const totalMs = queryHours * 60 * 60 * 1000;

  const cutoff = now - queryHours * 60 * 60 * 1000;
  const historyInfo = await getServerHistoryInfo(db, serverId, server);
  const queryStart = Math.max(cutoff, historyInfo.startTimestamp);

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

  const columnList = columns.split(',').map(c => c.trim()).filter(c => c && c !== 'timestamp');
  const sourceColumns = columnList.join(', ');
  const lossColumns = columnList.filter(col => LOSS_AGG_COLUMNS.has(col));
  const lossWindowExpressions = lossColumns.map(col =>
    `MAX(${col}) OVER (PARTITION BY bucket) AS ${col}_bucket_max`
  );
  const selectColumns = columnList.map(col =>
    LOSS_AGG_COLUMNS.has(col) ? `${col}_bucket_max AS ${col}` : col
  );

  const useSparseSampling = shouldUseSparseHistorySampling(
    queryHours,
    currentUsesIdRange,
    oldTableExists,
    oldUsesIdRange
  );
  const sparseQueryEnd = Math.floor(now / 1000) * 1000 + 1000;
  const maxPoints = queryHours > 1
    ? configuredLongHistoryPoints
    : DEFAULT_HISTORY_MAX_POINTS;
  const samplingDurationMs = useSparseSampling
    ? Math.max(0, sparseQueryEnd - queryStart)
    : totalMs;
  const intervalMs = Math.max(10_000, Math.ceil(samplingDurationMs / maxPoints));

  debug(
    '[History]',
    'server:', serverId,
    'hours:', hours,
    'queryHours:', queryHours,
    'maxPoints:', maxPoints,
    'interval:', intervalMs,
    'cutoff:', new Date(cutoff).toISOString(),
    'start:', new Date(queryStart).toISOString()
  );

  let rawResult;

  if (useSparseSampling) {
    // Long-range queries sample one complete row per time bucket via primary-key seeks.
    // Computing an exact maximum for loss columns would require scanning every row in the bucket.
    const queryEnd = sparseQueryEnd;
    const firstRangeEnd = Math.min(
      queryEnd,
      queryStart + intervalMs
    );
    const idPrefix = getHistoryIdRange(historyInfo.partitionId).startId;
    const sparseQuery = buildSparseHistoryQuery({
      columns: sourceColumns,
      queryStart,
      queryEnd,
      firstRangeEnd,
      intervalMs,
      idPrefix,
      oldTableExists,
      tableBoundary: thisSunday.getTime()
    });

    debug('[History] SPARSE ID SAMPLING:', sparseQuery.bindValues.length, 'bind values');
    const sparseResult = await db.prepare(sparseQuery.sql).bind(...sparseQuery.bindValues).all();
    rawResult = {
      ...sparseResult,
      results: sparseResult.results
        .filter(row => row.sample_json)
        .map(row => JSON.parse(row.sample_json))
    };
  } else {
    const sourceQueries = [];
    const bindValues = [];

    sourceQueries.push(buildHistorySourceQuery('metrics_history', currentUsesIdRange, sourceColumns));
    if (currentUsesIdRange) {
      bindValues.push(idRange.startId, idRange.endId);
    } else {
      bindValues.push(serverId, queryStart);
    }

    if (oldTableExists) {
      debug('[History] 跨周查询，合并 metrics_history 和 metrics_history_old');
      sourceQueries.push(buildHistorySourceQuery('metrics_history_old', oldUsesIdRange, sourceColumns));
      if (oldUsesIdRange) {
        bindValues.push(idRange.startId, idRange.endId);
      } else {
        bindValues.push(serverId, queryStart);
      }
    }

    bindValues.push(intervalMs);

    rawResult = await db.prepare(`
      WITH history_rows AS (
        ${sourceQueries.join('\n        UNION ALL\n')}
      ),
      bucketed AS (
        SELECT
          timestamp,
          ${sourceColumns},
          CAST(timestamp / ? AS INTEGER) AS bucket
        FROM history_rows
      ),
      sampled AS (
        SELECT
          timestamp,
          ${sourceColumns},
          ROW_NUMBER() OVER (
            PARTITION BY bucket
            ORDER BY timestamp
          ) AS rn
          ${lossWindowExpressions.length ? `,\n          ${lossWindowExpressions.join(',\n          ')}` : ''}
        FROM bucketed
      )
      SELECT timestamp, ${selectColumns.join(', ')}
      FROM sampled
      WHERE rn = 1
    `).bind(...bindValues).all();
  }

  const result = rawResult.results.map(row => normalizeProbeMetricRow({
    ...row,
    timestamp: Number(row.timestamp)
  }));

  result.sort((a, b) => a.timestamp - b.timestamp);

  setMetricsHistoryCache(serverId, hours, columns, result, configuredLongHistoryPoints);

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

export async function saveMetricsHistory(db, serverId, historyPartitionId, metrics, regionCode = '', timestamp = null, agentVersion = '', ip = '') {
  const historyId = buildHistoryId(historyPartitionId, timestamp);
  const rawTimestamp = Number(timestamp);
  const now = Number.isFinite(rawTimestamp) && rawTimestamp > 0
    ? (rawTimestamp < 10000000000 ? rawTimestamp * 1000 : rawTimestamp)
    : Date.now();

  const DISABLED_PROBE_VALUE = 'false';

  const parsePing = (val) => {
    if (isDisabledProbeMetric(val)) return DISABLED_PROBE_VALUE;
    const num = parseInt(val);
    return (num > 0) ? num : null;
  };

  const parseLoss = (val) => {
    if (isDisabledProbeMetric(val)) return DISABLED_PROBE_VALUE;
    const num = parseInt(val);
    if (Number.isNaN(num)) return null;
    return Math.max(0, Math.min(100, num));
  };

  const insertHistoryRow = async () => {
    await db.prepare(`
    INSERT INTO metrics_history (
      id, server_id, timestamp, agent_version, cpu, load_avg,
      net_in_speed, net_out_speed, net_rx, net_tx,
      processes, tcp_conn, udp_conn,
      ping_ct, ping_cu, ping_cm, ping_bd,
      loss_ct, loss_cu, loss_cm, loss_bd,
      ram_total, ram_used, swap_total, swap_used,
      disk_total, disk_used,
      cpu_cores, cpu_info, gpu_info, arch, os, kernel_version, region, ip, ip_v4, ip_v6, boot_time,
      net_rx_monthly, net_tx_monthly
    ) VALUES (
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?
    )
  `).bind(
    historyId,
    serverId,
    now,
    agentVersion || '',
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
    Array.isArray(metrics.gpu_info) ? JSON.stringify(metrics.gpu_info) : (metrics.gpu_info || ''),
    metrics.arch || '',
    metrics.os || '',
    metrics.kernel_version || '',
    regionCode,
    ip || '',
    metrics.ip_v4 || '0',
    metrics.ip_v6 || '0',
    metrics.boot_time || '',
    parseFloat(metrics.net_rx_monthly) || 0,
    parseFloat(metrics.net_tx_monthly) || 0
    ).run();
  };

  try {
    await insertHistoryRow();
  } catch (e) {
    if (e?.message && /has no column/i.test(e.message)) {
      console.warn('检测到数据库字段缺失，尝试添加缺失字段...');
      await addHistoryColumns(db);
      try {
        await insertHistoryRow();
      } catch (retryError) {
        console.error('保存历史数据失败:', retryError);
      }
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
    return result ? normalizeProbeMetricRow(result) : null;
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
