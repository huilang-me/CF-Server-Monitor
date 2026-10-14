import { getAllServers, getLatestMetricsCache, setLatestMetricsCache, getMetricsHistoryCache, setMetricsHistoryCache, getCacheDuration, clearAllCaches } from '../utils/cache.js';
import { saveSiteOptions, debug, normalizeLongHistoryPoints, DEFAULT_LONG_HISTORY_POINTS } from '../utils/settings.js';
import { attachDiskMetricsObject, flattenDiskMetrics, isDisabledProbeMetric, normalizeProbeMetricRow } from '../utils/metrics.js';
import { ensureServerOptimization, buildHistoryId, getServerHistoryInfo, getHistoryIdRange } from './indexOptimization.js';
import { addHistoryColumns } from './updateDatabase.js';
import {
  buildSparseHistoryQuery,
  shouldUseSparseHistorySampling
} from './historySampling.js';
import {
  createHistoryTableSql,
  HISTORY_INSERT_COLUMNS
} from '../utils/historyFields.js';
import {
  DASHBOARD_LATENCY_WINDOW_CACHE_MAX_SERVERS,
  DASHBOARD_LATENCY_WINDOW_CACHE_TTL_MS,
  DASHBOARD_LATENCY_WINDOW_HOURS,
  DASHBOARD_LATENCY_WINDOW_POINTS,
  DASHBOARD_LATENCY_WINDOW_QUERY_CONCURRENCY
} from '../utils/config.js';

let dbInitialized = false;

const LOSS_AGG_COLUMNS = new Set(['loss_ct', 'loss_cu', 'loss_cm', 'loss_bd', 'loss_node_1', 'loss_node_2', 'loss_node_3', 'loss_node_4']);
const DEFAULT_HISTORY_MAX_POINTS = 160;
const LATENCY_NODE_FIELDS = ['ct', 'cu', 'cm', 'bd', 'node_1', 'node_2', 'node_3', 'node_4'];
const DASHBOARD_LATENCY_COLUMNS = LATENCY_NODE_FIELDS
  .flatMap(field => [`ping_${field}`, `loss_${field}`]);
const dashboardLatencyHistoryCache = new Map();

function pruneDashboardLatencyHistoryCache(now = Date.now()) {
  for (const [serverId, entry] of dashboardLatencyHistoryCache) {
    if (!entry || now - entry.cachedAt > DASHBOARD_LATENCY_WINDOW_CACHE_TTL_MS) {
      dashboardLatencyHistoryCache.delete(serverId);
    }
  }

  while (dashboardLatencyHistoryCache.size > DASHBOARD_LATENCY_WINDOW_CACHE_MAX_SERVERS) {
    const oldestServerId = dashboardLatencyHistoryCache.keys().next().value;
    if (oldestServerId === undefined) break;
    dashboardLatencyHistoryCache.delete(oldestServerId);
  }
}

export function clearDashboardLatencyHistoryCache() {
  dashboardLatencyHistoryCache.clear();
}

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
          traffic_alert_percent INTEGER DEFAULT NULL,
          traffic_alert_state TEXT,
          "interface" TEXT DEFAULT '',
          reset_day INTEGER DEFAULT 1,
          collect_interval INTEGER DEFAULT 0,
          report_interval INTEGER DEFAULT 60,
          wss_report_interval INTEGER DEFAULT 2,
          connection_mode TEXT DEFAULT 'auto',
          ping_mode TEXT DEFAULT 'tcp',
          auto_update TEXT DEFAULT '0',
          custom_ct TEXT DEFAULT '',
          custom_cu TEXT DEFAULT '',
          custom_cm TEXT DEFAULT '',
          custom_bd TEXT DEFAULT '',
          node_1 TEXT DEFAULT '',
          node_2 TEXT DEFAULT '',
          node_3 TEXT DEFAULT '',
          node_4 TEXT DEFAULT '',
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

    // 确保 metrics_history 表存在（主键 id 已编码分区与时间，无需二级索引）
    await db.prepare(createHistoryTableSql('metrics_history')).run();

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

    await clearAllCaches(db);
    clearDashboardLatencyHistoryCache();
    
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

function buildHistorySourceQuery(tableName, columns) {
  return `
    SELECT timestamp, ${columns} FROM ${tableName}
    WHERE id >= ?
      AND id <= ?
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

  if (!historyInfo.partitionId) {
    throw new Error('Invalid history partition id');
  }
  const idRange = getHistoryIdRange(historyInfo.partitionId, queryStart);

  const columnList = columns.split(',').map(c => c.trim()).filter(c => c && c !== 'timestamp');
  const sourceColumns = columnList.join(', ');
  const lossColumns = columnList.filter(col => LOSS_AGG_COLUMNS.has(col));
  const lossWindowExpressions = lossColumns.map(col =>
    `MAX(${col}) OVER (PARTITION BY bucket) AS ${col}_bucket_max`
  );
  const selectColumns = columnList.map(col =>
    LOSS_AGG_COLUMNS.has(col) ? `${col}_bucket_max AS ${col}` : col
  );

  const useSparseSampling = shouldUseSparseHistorySampling(queryHours);
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

    sourceQueries.push(buildHistorySourceQuery('metrics_history', sourceColumns));
    bindValues.push(idRange.startId, idRange.endId);

    if (oldTableExists) {
      debug('[History] 跨周查询，合并 metrics_history 和 metrics_history_old');
      sourceQueries.push(buildHistorySourceQuery('metrics_history_old', sourceColumns));
      bindValues.push(idRange.startId, idRange.endId);
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

  const result = rawResult.results.map(row => attachDiskMetricsObject(normalizeProbeMetricRow({
    ...row,
    timestamp: Number(row.timestamp)
  })));

  result.sort((a, b) => a.timestamp - b.timestamp);

  setMetricsHistoryCache(serverId, hours, columns, result, configuredLongHistoryPoints);

  debug(`[History] FINAL: ${result.length}, interval: ${intervalMs}ms`);

  return result;
}

function normalizeLatencyHistoryValue(value, metricType) {
  if (isDisabledProbeMetric(value)) return false;
  if (value === null || value === undefined || value === '') return null;

  const number = Number(value);
  if (!Number.isFinite(number)) return null;

  if (metricType === 'loss') {
    return Math.max(0, Math.min(100, Math.round(number)));
  }
  return number > 0 ? Math.round(number) : null;
}

function buildLatencyHistoryPoint(row, metricType, { includeEmpty = false } = {}) {
  const timestamp = Number(row?.timestamp);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;

  const point = { ts: timestamp };
  for (const field of LATENCY_NODE_FIELDS) {
    const column = `${metricType}_${field}`;
    if (!Object.prototype.hasOwnProperty.call(row, column)) continue;
    const value = normalizeLatencyHistoryValue(row[column], metricType);
    if (value !== null) point[field] = value;
    else if (includeEmpty) point[field] = null;
  }

  return includeEmpty || Object.keys(point).length > 1 ? point : null;
}

function normalizeDashboardLatencyRows(rows, options = {}) {
  const ping = [];
  const loss = [];

  for (const row of rows || []) {
    const pingPoint = buildLatencyHistoryPoint(row, 'ping', options);
    if (pingPoint) ping.push(pingPoint);

    const lossPoint = buildLatencyHistoryPoint(row, 'loss', options);
    if (lossPoint) loss.push(lossPoint);
  }

  ping.sort((a, b) => a.ts - b.ts);
  loss.sort((a, b) => a.ts - b.ts);
  return { ping, loss };
}

function parseDashboardLatencySample(row) {
  if (!row?.sample_json) return null;
  try {
    return JSON.parse(row.sample_json);
  } catch (_) {
    return null;
  }
}

function normalizeDashboardLatencyWindow(sampleRows, { queryStart, intervalMs, points }) {
  const rows = Array.from({ length: points }, (_, index) => {
    const bucketTimestamp = queryStart + index * intervalMs;
    const sample = parseDashboardLatencySample(sampleRows?.[index]);
    if (!sample || typeof sample !== 'object') {
      return { timestamp: bucketTimestamp };
    }

    return {
      ...sample,
      sample_timestamp: Number(sample.timestamp),
      timestamp: bucketTimestamp
    };
  });

  return normalizeDashboardLatencyRows(rows, { includeEmpty: true });
}

export async function getDashboardLatencyHistory(db, servers, options = {}) {
  const serverList = Array.isArray(servers) ? servers : [];
  const serverIds = serverList.map(server => String(server?.id || '').trim()).filter(Boolean);
  if (serverIds.length === 0) return new Map();

  const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
  const useCache = options.cache !== false;
  const result = new Map();
  const serversToFetch = [];

  if (useCache) {
    pruneDashboardLatencyHistoryCache(now);
  }

  for (const server of serverList) {
    const serverId = String(server?.id || '').trim();
    if (!serverId) continue;

    const cached = dashboardLatencyHistoryCache.get(serverId);
    if (useCache && cached && now - cached.cachedAt < DASHBOARD_LATENCY_WINDOW_CACHE_TTL_MS) {
      result.set(serverId, cached.window);
      continue;
    }
    serversToFetch.push(server);
  }

  if (serversToFetch.length === 0) return result;

  const points = Number.isInteger(options.points) && options.points > 0
    ? options.points
    : DASHBOARD_LATENCY_WINDOW_POINTS;
  const queryEnd = Math.floor(now / 1000) * 1000 + 1000;
  const cutoff = now - DASHBOARD_LATENCY_WINDOW_HOURS * 60 * 60 * 1000;
  const columns = DASHBOARD_LATENCY_COLUMNS.join(', ');

  const nowDate = new Date(now);
  const day = nowDate.getUTCDay();
  const thisSunday = new Date(Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth(), nowDate.getUTCDate() - day));
  const oldTableExists = cutoff < thisSunday.getTime() && !!await db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='metrics_history_old'`
  ).first();

  const fetchServerLatency = async server => {
    const serverId = String(server?.id || '').trim();
    if (!serverId) return;

    try {
      const historyInfo = await getServerHistoryInfo(db, serverId, server);
      if (!historyInfo.partitionId) {
        result.set(serverId, { ping: [], loss: [] });
        return;
      }

      const queryStart = cutoff;
      if (queryStart >= queryEnd) {
        result.set(serverId, { ping: [], loss: [] });
        return;
      }

      const intervalMs = Math.max(10_000, Math.ceil((queryEnd - queryStart) / points));
      const idPrefix = getHistoryIdRange(historyInfo.partitionId).startId;
      const querySparseHistory = async queryColumns => {
        const sparseQuery = buildSparseHistoryQuery({
          columns: queryColumns,
          queryStart,
          queryEnd,
          firstRangeEnd: Math.min(queryEnd, queryStart + intervalMs),
          intervalMs,
          idPrefix,
          oldTableExists,
          tableBoundary: thisSunday.getTime(),
          sampleOrder: 'DESC'
        });
        return db.prepare(sparseQuery.sql).bind(...sparseQuery.bindValues).all();
      };

      const rawResult = await querySparseHistory(columns);
      const window = normalizeDashboardLatencyWindow(rawResult.results, { queryStart, intervalMs, points });
      result.set(serverId, window);
      if (useCache) {
        dashboardLatencyHistoryCache.set(serverId, { cachedAt: now, window });
      }
    } catch (e) {
      debug('[DashboardLatency] query failed:', serverId, e?.message || e);
      const empty = { ping: [], loss: [] };
      result.set(serverId, empty);
      if (useCache) {
        dashboardLatencyHistoryCache.set(serverId, { cachedAt: now, window: empty });
      }
    }
  };

  for (let offset = 0; offset < serversToFetch.length; offset += DASHBOARD_LATENCY_WINDOW_QUERY_CONCURRENCY) {
    await Promise.all(
      serversToFetch
        .slice(offset, offset + DASHBOARD_LATENCY_WINDOW_QUERY_CONCURRENCY)
        .map(fetchServerLatency)
    );
  }

  return result;
}


export async function weeklyCleanup(db) {
  try {
    debug('[Cleanup] 开始执行表轮换操作...');
    
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

export async function saveMetricsHistory(db, serverId, historyPartitionId, metrics, regionCode = '', timestamp = null, agentVersion = '') {
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
    const diskMetrics = flattenDiskMetrics(metrics);

    await db.prepare(`
    INSERT INTO metrics_history (
      ${HISTORY_INSERT_COLUMNS.join(', ')}
    ) VALUES (
      ${HISTORY_INSERT_COLUMNS.map(() => '?').join(', ')}
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
    parsePing(metrics.ping_node_1),
    parsePing(metrics.ping_node_2),
    parsePing(metrics.ping_node_3),
    parsePing(metrics.ping_node_4),
    parseLoss(metrics.loss_ct),
    parseLoss(metrics.loss_cu),
    parseLoss(metrics.loss_cm),
    parseLoss(metrics.loss_bd),
    parseLoss(metrics.loss_node_1),
    parseLoss(metrics.loss_node_2),
    parseLoss(metrics.loss_node_3),
    parseLoss(metrics.loss_node_4),
    parseFloat(metrics.ram_total) || 0,
    parseFloat(metrics.ram_used) || 0,
    parseFloat(metrics.swap_total) || 0,
    parseFloat(metrics.swap_used) || 0,
    parseFloat(metrics.disk_total) || 0,
    parseFloat(metrics.disk_used) || 0,
    diskMetrics.disk_read_bps,
    diskMetrics.disk_write_bps,
    diskMetrics.disk_read_iops,
    diskMetrics.disk_write_iops,
    diskMetrics.disk_await_ms,
    diskMetrics.disk_util,
    parseInt(metrics.cpu_cores) || 0,
    metrics.cpu_info || '',
    Array.isArray(metrics.gpu_info) ? JSON.stringify(metrics.gpu_info) : (metrics.gpu_info || ''),
    metrics.arch || '',
    metrics.os || '',
    metrics.kernel_version || '',
    regionCode,
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

    const rangeStart = historyInfo.startTimestamp > 0 ? historyInfo.startTimestamp : null;
    const { startId, endId } = getHistoryIdRange(historyInfo.partitionId, rangeStart);
    debug(`Server ${serverId} history_id_range: ${startId} - ${endId}`);
  
    const result = await db.prepare(`
      SELECT * FROM metrics_history
      WHERE id >= ?
        AND id <= ?
      ORDER BY id DESC
      LIMIT 1
    `).bind(startId, endId).first();
    return result ? normalizeProbeMetricRow(result) : null;
  } catch (e) {
    console.error('获取最新指标数据失败:', e);
    return null;
  }
}

// 每批合并的服务器数量：通过 db.batch() 一次发送多条语句，减少 D1 往返次数
const LATEST_QUERY_CHUNK_SIZE = 30;

/**
 * 获取所有服务器的最新完整指标行（供仪表盘/管理端合并展示）。
 * 命中"完整指标"缓存时直接返回；未命中时每台服务器在主键 rowid 范围内取最新一行，
 * 每批最多 LATEST_QUERY_CHUNK_SIZE 台，通过 db.batch() 合并成一次 D1 往返，
 * 避免逐台 N 次查询与 N 次往返。单台 history 范围异常只跳过该台，与 getLatestMetrics 行为一致。
 */
export async function getLatestMetricsForAllServers(db) {
  const now = Date.now();
  const cacheInfo = getLatestMetricsCache();
  if (cacheInfo.cache && now - cacheInfo.time < cacheInfo.ttl) {
    return cacheInfo.cache;
  }

  const result = new Map();
  try {
    const servers = await getAllServers(db);
    if (servers.length === 0) {
      setLatestMetricsCache(result);
      return result;
    }

    // 先逐台计算 history rowid 范围：单台异常只跳过该台（与 getLatestMetrics 逐台失败一致）
    const items = [];
    for (const server of servers) {
      try {
        // 传入 server 对象时 getServerHistoryInfo 不会触发额外查询
        const historyInfo = await getServerHistoryInfo(db, server.id, server);
        if (!historyInfo.partitionId) continue;
        const rangeStart = historyInfo.startTimestamp > 0 ? historyInfo.startTimestamp : null;
        const { startId, endId } = getHistoryIdRange(historyInfo.partitionId, rangeStart);
        items.push({ server, startId, endId });
      } catch (err) {
        debug(`Server ${server.id} history 范围计算失败，跳过: ${err.message}`);
      }
    }

    for (let offset = 0; offset < items.length; offset += LATEST_QUERY_CHUNK_SIZE) {
      const chunk = items.slice(offset, offset + LATEST_QUERY_CHUNK_SIZE);
      let batchResults;
      try {
        batchResults = await db.batch(chunk.map(item =>
          db.prepare(
            'SELECT * FROM metrics_history WHERE id >= ? AND id <= ? ORDER BY id DESC LIMIT 1'
          ).bind(item.startId, item.endId)
        ));
      } catch (batchError) {
        // 整批失败时回退逐台查询，保持"单台异常不影响其它台"的既有语义
        debug(`批量获取最新指标失败，回退逐台查询: ${batchError.message}`);
        for (const item of chunk) {
          const metrics = await getLatestMetrics(db, item.server.id, item.server);
          if (metrics) result.set(item.server.id, metrics);
        }
        continue;
      }
      for (let index = 0; index < chunk.length; index++) {
        const rows = batchResults[index] && batchResults[index].results;
        if (rows && rows.length > 0) {
          result.set(chunk[index].server.id, normalizeProbeMetricRow(rows[0]));
        }
      }
    }

    setLatestMetricsCache(result);
    return result;
  } catch (e) {
    console.error('获取所有服务器最新指标数据失败:', e);
    const fallback = getLatestMetricsCache();
    return fallback.cache || new Map();
  }
}

// 从"完整指标"缓存中抽取每台服务器的最新上报时间戳（完整行是轻量结果的超集）
function extractTimestampsFromMetricsCache(cache) {
  const map = new Map();
  if (!cache) return map;
  for (const [id, metrics] of cache) {
    if (metrics) map.set(id, metrics.timestamp);
  }
  return map;
}

/**
 * 获取所有服务器的最新上报时间戳（只查 timestamp 一列）。
 * 供离线检测等只需时间戳的场景使用，避免拉取整行 52 列带来的序列化 CPU 开销。
 * 命中"完整指标"缓存时直接复用；未命中才轻量查询，且不写回共享缓存，避免用残缺行污染它。
 * 每台服务器用 rowid 范围在主键索引上定位最新一行，每批最多 LATEST_QUERY_CHUNK_SIZE 台，
 * 通过 db.batch() 合并成一次 D1 往返（注意：D1 的 compound SELECT 项数上限极低，不能用 UNION ALL）。
 *
 * @returns {Promise<Map|null>} 成功返回 Map<serverId, timestamp>（可能为空 Map）；
 *   查询失败且无可回退缓存时返回 null，调用方应跳过本次检测，避免误判为全部离线。
 */
export async function getLatestTimestampsForAllServers(db) {
  const now = Date.now();
  const cacheInfo = getLatestMetricsCache();
  if (cacheInfo.cache && now - cacheInfo.time < cacheInfo.ttl) {
    return extractTimestampsFromMetricsCache(cacheInfo.cache);
  }

  const collected = new Map();
  try {
    const servers = await getAllServers(db);
    if (servers.length === 0) return collected;

    const items = [];
    for (const server of servers) {
      try {
        // 传入 server 对象时 getServerHistoryInfo 不会触发额外查询
        const historyInfo = await getServerHistoryInfo(db, server.id, server);
        if (!historyInfo.partitionId) continue; // 无效分区，跳过（与 getLatestMetrics 行为一致）
        const rangeStart = historyInfo.startTimestamp > 0 ? historyInfo.startTimestamp : null;
        const { startId, endId } = getHistoryIdRange(historyInfo.partitionId, rangeStart);
        items.push({ serverId: server.id, startId, endId });
      } catch (err) {
        // 单台服务器 history 范围异常不影响其它服务器（与 getLatestMetrics 逐台失败一致）
        debug(`Server ${server.id} history 范围计算失败，跳过: ${err.message}`);
      }
    }

    for (let offset = 0; offset < items.length; offset += LATEST_QUERY_CHUNK_SIZE) {
      const chunk = items.slice(offset, offset + LATEST_QUERY_CHUNK_SIZE);
      const batchResults = await db.batch(chunk.map(item =>
        db.prepare(
          'SELECT timestamp FROM metrics_history WHERE id >= ? AND id <= ? ORDER BY id DESC LIMIT 1'
        ).bind(item.startId, item.endId)
      ));
      for (let index = 0; index < chunk.length; index++) {
        const rows = batchResults[index] && batchResults[index].results;
        if (rows && rows.length > 0) {
          collected.set(chunk[index].serverId, rows[0].timestamp);
        }
      }
    }
    return collected;
  } catch (e) {
    console.error('获取所有服务器最新时间戳失败:', e);
    // 查询失败时回退到（可能已过期的）完整缓存；无缓存则返回 null 让调用方跳过本次检测，
    // 避免把查询失败误判为全部服务器离线而误发告警
    return cacheInfo.cache ? extractTimestampsFromMetricsCache(cacheInfo.cache) : null;
  }
}
