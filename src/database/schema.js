let dbInitialized = false;
const DELETE_RAW_DATA = false; // 是否删除原始数据
const RETENTION_DAYS = 1; // 数据保留天数（原始数据和聚合数据都保留此天数）

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
        cpu TEXT DEFAULT '0',
        ram TEXT DEFAULT '0',
        disk TEXT DEFAULT '0',
        load_avg TEXT DEFAULT '0',
        uptime TEXT DEFAULT '0',
        last_updated INTEGER DEFAULT 0,
        ram_total TEXT DEFAULT '0',
        net_rx TEXT DEFAULT '0',
        net_tx TEXT DEFAULT '0',
        net_in_speed TEXT DEFAULT '0',
        net_out_speed TEXT DEFAULT '0',
        os TEXT DEFAULT '',
        cpu_info TEXT DEFAULT '',
        cpu_cores TEXT DEFAULT '0',
        arch TEXT DEFAULT '',
        boot_time TEXT DEFAULT '',
        ram_used TEXT DEFAULT '0',
        swap_total TEXT DEFAULT '0',
        swap_used TEXT DEFAULT '0',
        disk_total TEXT DEFAULT '0',
        disk_used TEXT DEFAULT '0',
        processes TEXT DEFAULT '0',
        tcp_conn TEXT DEFAULT '0',
        udp_conn TEXT DEFAULT '0',
        country TEXT DEFAULT 'XX',
        ip_v4 TEXT DEFAULT '0',
        ip_v6 TEXT DEFAULT '0',
        server_group TEXT DEFAULT 'Default',
        price TEXT DEFAULT '',
        expire_date TEXT DEFAULT '',
        bandwidth TEXT DEFAULT '',
        traffic_limit TEXT DEFAULT '',
        ping_ct TEXT DEFAULT '0',
        ping_cu TEXT DEFAULT '0',
        ping_cm TEXT DEFAULT '0',
        ping_bd TEXT DEFAULT '0',
        is_hidden TEXT DEFAULT '0',
        sort_order INTEGER DEFAULT 0
      )
    `).run();

    await db.prepare(`
      CREATE TABLE IF NOT EXISTS metrics_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        server_id TEXT NOT NULL,
        timestamp INTEGER DEFAULT 0,
        cpu REAL DEFAULT 0,
        ram REAL DEFAULT 0,
        disk REAL DEFAULT 0,
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
        ram_total REAL DEFAULT 0,
        ram_used REAL DEFAULT 0,
        swap_total REAL DEFAULT 0,
        swap_used REAL DEFAULT 0,
        disk_total REAL DEFAULT 0,
        disk_used REAL DEFAULT 0,
        FOREIGN KEY (server_id) REFERENCES servers(id)
      )
    `).run();

    await db.prepare(`
      CREATE TABLE IF NOT EXISTS metrics_aggregated (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        server_id TEXT NOT NULL,
        bucket INTEGER NOT NULL,
        bucket_size INTEGER NOT NULL,
        cpu_avg REAL DEFAULT 0,
        cpu_max REAL DEFAULT 0,
        ram_avg REAL DEFAULT 0,
        ram_max REAL DEFAULT 0,
        disk_avg REAL DEFAULT 0,
        disk_max REAL DEFAULT 0,
        load_avg_avg REAL DEFAULT 0,
        net_in_speed_avg REAL DEFAULT 0,
        net_out_speed_avg REAL DEFAULT 0,
        net_rx_avg REAL DEFAULT 0,
        net_tx_avg REAL DEFAULT 0,
        processes_avg REAL DEFAULT 0,
        tcp_conn_avg REAL DEFAULT 0,
        udp_conn_avg REAL DEFAULT 0,
        ping_ct_avg REAL DEFAULT 0,
        ping_cu_avg REAL DEFAULT 0,
        ping_cm_avg REAL DEFAULT 0,
        ping_bd_avg REAL DEFAULT 0,
        ram_total_avg REAL DEFAULT 0,
        ram_used_avg REAL DEFAULT 0,
        swap_total_avg REAL DEFAULT 0,
        swap_used_avg REAL DEFAULT 0,
        disk_total_avg REAL DEFAULT 0,
        disk_used_avg REAL DEFAULT 0,
        FOREIGN KEY (server_id) REFERENCES servers(id),
        UNIQUE(server_id, bucket, bucket_size)
      )
    `).run();

    const dropResult = await db.prepare(`DROP INDEX IF EXISTS idx_history_server_time_covering`).run();
    if (dropResult.meta.changes > 0) {
      console.log('✅ 已删除旧的覆盖索引，减少索引体积和写入放大');
    }

    await db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_history_server_time 
      ON metrics_history(server_id, timestamp)
    `).run();

    await db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_aggregated_server_bucket 
      ON metrics_aggregated(server_id, bucket_size, bucket)
    `).run();

    const { results: columns } = await db.prepare(`PRAGMA table_info(servers)`).all();
    const existingCols = columns.map(c => c.name);
    
    const newCols = {
      ping_ct: "TEXT DEFAULT '0'",
      ping_cu: "TEXT DEFAULT '0'",
      ping_cm: "TEXT DEFAULT '0'",
      ping_bd: "TEXT DEFAULT '0'",
      cpu_cores: "TEXT DEFAULT '0'",
      is_hidden: "TEXT DEFAULT '0'",
      sort_order: "INTEGER DEFAULT 0"
    };

    for (const [colName, colDef] of Object.entries(newCols)) {
      if (!existingCols.includes(colName)) {
        await db.prepare(`ALTER TABLE servers ADD COLUMN ${colName} ${colDef}`).run();
      }
    }

    console.log('✅ 数据库初始化完成');
    dbInitialized = true;
  } catch (e) {
    console.error('❌ 数据库初始化失败:', e);
  }
}

const AGGREGATE_PHASES = [
  {
    name: '30分钟-1小时(2分钟桶)',
    minHours: 0.5,
    maxHours: 1,
    bucketSeconds: 120,
    sourceBucketSeconds: null
  },
  {
    name: '1-3小时(4分钟桶)',
    minHours: 1,
    maxHours: 3,
    bucketSeconds: 240,
    sourceBucketSeconds: 120  // ✅ 从2分钟桶聚合
  },
  {
    name: '3-6小时(8分钟桶)',
    minHours: 3,
    maxHours: 6,
    bucketSeconds: 480,
    sourceBucketSeconds: 240  // ✅ 从4分钟桶聚合
  },
  {
    name: '6-24小时(16分钟桶)',
    minHours: 6,
    maxHours: 24,
    bucketSeconds: 960,
    sourceBucketSeconds: 480  // ✅ 从8分钟桶聚合
  }
];

const COLUMN_MAP = {
  'cpu': 'cpu_avg',
  'ram': 'ram_avg',
  'disk': 'disk_avg',
  'load_avg': 'load_avg_avg',
  'net_in_speed': 'net_in_speed_avg',
  'net_out_speed': 'net_out_speed_avg',
  'net_rx': 'net_rx_avg',
  'net_tx': 'net_tx_avg',
  'processes': 'processes_avg',
  'tcp_conn': 'tcp_conn_avg',
  'udp_conn': 'udp_conn_avg',
  'ping_ct': 'ping_ct_avg',
  'ping_cu': 'ping_cu_avg',
  'ping_cm': 'ping_cm_avg',
  'ping_bd': 'ping_bd_avg',
  'ram_total': 'ram_total_avg',
  'ram_used': 'ram_used_avg',
  'swap_total': 'swap_total_avg',
  'swap_used': 'swap_used_avg',
  'disk_total': 'disk_total_avg',
  'disk_used': 'disk_used_avg'
};

async function aggregateFromRaw(db, startTime, endTime, bucketSeconds, phaseName) {
  const bucketMs = bucketSeconds * 1000;
  
  const rawCountResult = await db.prepare(`
    SELECT COUNT(*) as count FROM metrics_history
    WHERE typeof(timestamp) = 'integer'
      AND timestamp >= ?
      AND timestamp < ?
  `).bind(startTime, endTime).first();
  
  const rawCount = rawCountResult?.count || 0;
  
  if (rawCount === 0) {
    console.log(`[Aggregate] ${phaseName}: 无原始数据，跳过`);
    return { aggregated: 0, deleted: 0, rawCount: 0 };
  }
  
  const aggregateResult = await db.prepare(`
    INSERT OR IGNORE INTO metrics_aggregated (
      server_id, bucket, bucket_size,
      cpu_avg, cpu_max,
      ram_avg, ram_max,
      disk_avg, disk_max,
      load_avg_avg,
      net_in_speed_avg, net_out_speed_avg,
      net_rx_avg, net_tx_avg,
      processes_avg, tcp_conn_avg, udp_conn_avg,
      ping_ct_avg, ping_cu_avg, ping_cm_avg, ping_bd_avg,
      ram_total_avg, ram_used_avg,
      swap_total_avg, swap_used_avg,
      disk_total_avg, disk_used_avg
    )
    SELECT 
      server_id,
      CAST((timestamp + ? / 2) / ? AS INTEGER) * ? AS bucket,
      ? AS bucket_size,
      ROUND(AVG(cpu), 2), MAX(cpu),
      ROUND(AVG(ram), 2), MAX(ram),
      ROUND(AVG(disk), 2), MAX(disk),
      ROUND(AVG(CAST(load_avg AS REAL)), 2),
      ROUND(AVG(net_in_speed), 2), ROUND(AVG(net_out_speed), 2),
      ROUND(AVG(net_rx), 2), ROUND(AVG(net_tx), 2),
      ROUND(AVG(processes), 2), ROUND(AVG(tcp_conn), 2), ROUND(AVG(udp_conn), 2),
      ROUND(AVG(ping_ct), 2), ROUND(AVG(ping_cu), 2), ROUND(AVG(ping_cm), 2), ROUND(AVG(ping_bd), 2),
      ROUND(AVG(ram_total), 2), ROUND(AVG(ram_used), 2),
      ROUND(AVG(swap_total), 2), ROUND(AVG(swap_used), 2),
      ROUND(AVG(disk_total), 2), ROUND(AVG(disk_used), 2)
    FROM metrics_history
    WHERE typeof(timestamp) = 'integer'
      AND timestamp >= ?
      AND timestamp < ?
    GROUP BY server_id, CAST((timestamp + ? / 2) / ? AS INTEGER)
  `).bind(
    bucketMs, bucketMs, bucketMs, bucketSeconds,
    startTime, endTime, bucketMs, bucketMs
  ).run();
  
  const aggregated = aggregateResult.meta.changes || 0;
  
  const existingAggResult = await db.prepare(`
    SELECT server_id, bucket FROM metrics_aggregated
    WHERE bucket_size = ?
      AND bucket >= ?
      AND bucket < ?
  `).bind(bucketSeconds, startTime, endTime).all();
  
  const existingKeys = new Set(
    existingAggResult.results.map(r => `${r.server_id}_${r.bucket}`)
  );
  
  const toDeleteResult = await db.prepare(`
    SELECT id, server_id, timestamp FROM metrics_history
    WHERE typeof(timestamp) = 'integer'
      AND timestamp >= ?
      AND timestamp < ?
  `).bind(startTime, endTime).all();
  
  const idsToDelete = [];
  for (const row of toDeleteResult.results) {
    const bucket = Math.floor((row.timestamp + bucketMs / 2) / bucketMs) * bucketMs;
    const key = `${row.server_id}_${bucket}`;
    if (existingKeys.has(key)) {
      idsToDelete.push(row.id);
    }
  }
  
  let deleted = 0;
  if (DELETE_RAW_DATA && idsToDelete.length > 0) {
    const batchSize = 500;
    for (let i = 0; i < idsToDelete.length; i += batchSize) {
      const batch = idsToDelete.slice(i, i + batchSize);
      const placeholders = batch.map(() => '?').join(',');
      const deleteResult = await db.prepare(`
        DELETE FROM metrics_history WHERE id IN (${placeholders})
      `).bind(...batch).run();
      deleted += deleteResult.meta.changes || 0;
    }
  }
  
  const deleteStatus = DELETE_RAW_DATA ? `删除原始 ${deleted} 条` : `[测试模式] 跳过删除 (将删除 ${idsToDelete.length} 条)`;
  console.log(`[Aggregate] ${phaseName}: 原始数据 ${rawCount} 条, 新增聚合 ${aggregated} 组, ${deleteStatus}`);
  
  return { aggregated, deleted, rawCount };
}

async function aggregateFromAggregated(db, startTime, endTime, targetBucketSeconds, sourceBucketSeconds, phaseName) {
  const sourceBucketMs = sourceBucketSeconds * 1000;
  const targetBucketMs = targetBucketSeconds * 1000;
  
  const sourceCountResult = await db.prepare(`
    SELECT COUNT(*) as count FROM metrics_aggregated
    WHERE bucket_size = ?
      AND bucket >= ?
      AND bucket < ?
  `).bind(sourceBucketSeconds, startTime, endTime).first();
  
  const sourceCount = sourceCountResult?.count || 0;
  
  if (sourceCount === 0) {
    console.log(`[Aggregate] ${phaseName}: 无源聚合数据 (桶${sourceBucketSeconds}秒)，跳过`);
    return { aggregated: 0, deleted: 0, rawCount: 0 };
  }
  
  const aggregateResult = await db.prepare(`
    INSERT OR IGNORE INTO metrics_aggregated (
      server_id, bucket, bucket_size,
      cpu_avg, cpu_max,
      ram_avg, ram_max,
      disk_avg, disk_max,
      load_avg_avg,
      net_in_speed_avg, net_out_speed_avg,
      net_rx_avg, net_tx_avg,
      processes_avg, tcp_conn_avg, udp_conn_avg,
      ping_ct_avg, ping_cu_avg, ping_cm_avg, ping_bd_avg,
      ram_total_avg, ram_used_avg,
      swap_total_avg, swap_used_avg,
      disk_total_avg, disk_used_avg
    )
    SELECT 
      server_id,
      CAST((bucket + ? / 2) / ? AS INTEGER) * ? AS bucket,
      ? AS bucket_size,
      ROUND(AVG(cpu_avg), 2), MAX(cpu_max),
      ROUND(AVG(ram_avg), 2), MAX(ram_max),
      ROUND(AVG(disk_avg), 2), MAX(disk_max),
      ROUND(AVG(load_avg_avg), 2),
      ROUND(AVG(net_in_speed_avg), 2), ROUND(AVG(net_out_speed_avg), 2),
      ROUND(AVG(net_rx_avg), 2), ROUND(AVG(net_tx_avg), 2),
      ROUND(AVG(processes_avg), 2), ROUND(AVG(tcp_conn_avg), 2), ROUND(AVG(udp_conn_avg), 2),
      ROUND(AVG(ping_ct_avg), 2), ROUND(AVG(ping_cu_avg), 2), ROUND(AVG(ping_cm_avg), 2), ROUND(AVG(ping_bd_avg), 2),
      ROUND(AVG(ram_total_avg), 2), ROUND(AVG(ram_used_avg), 2),
      ROUND(AVG(swap_total_avg), 2), ROUND(AVG(swap_used_avg), 2),
      ROUND(AVG(disk_total_avg), 2), ROUND(AVG(disk_used_avg), 2)
    FROM metrics_aggregated
    WHERE bucket_size = ?
      AND bucket >= ?
      AND bucket < ?
    GROUP BY server_id, CAST((bucket + ? / 2) / ? AS INTEGER)
  `).bind(
    targetBucketMs, targetBucketMs, targetBucketMs, targetBucketSeconds,
    sourceBucketSeconds, startTime, endTime, targetBucketMs, targetBucketMs
  ).run();
  
  const aggregated = aggregateResult.meta.changes || 0;
  
  const existingTargetResult = await db.prepare(`
    SELECT server_id, bucket FROM metrics_aggregated
    WHERE bucket_size = ?
      AND bucket >= ?
      AND bucket < ?
  `).bind(targetBucketSeconds, startTime, endTime).all();
  
  const existingTargetKeys = new Set(
    existingTargetResult.results.map(r => `${r.server_id}_${r.bucket}`)
  );
  
  const sourceToDeleteResult = await db.prepare(`
    SELECT id, server_id, bucket FROM metrics_aggregated
    WHERE bucket_size = ?
      AND bucket >= ?
      AND bucket < ?
  `).bind(sourceBucketSeconds, startTime, endTime).all();
  
  const idsToDelete = [];
  for (const row of sourceToDeleteResult.results) {
    const targetBucket = Math.floor((row.bucket + targetBucketMs / 2) / targetBucketMs) * targetBucketMs;
    const key = `${row.server_id}_${targetBucket}`;
    if (existingTargetKeys.has(key)) {
      idsToDelete.push(row.id);
    }
  }
  
  let deleted = 0;
  if (DELETE_RAW_DATA && idsToDelete.length > 0) {
    const batchSize = 500;
    for (let i = 0; i < idsToDelete.length; i += batchSize) {
      const batch = idsToDelete.slice(i, i + batchSize);
      const placeholders = batch.map(() => '?').join(',');
      const deleteResult = await db.prepare(`
        DELETE FROM metrics_aggregated WHERE id IN (${placeholders})
      `).bind(...batch).run();
      deleted += deleteResult.meta.changes || 0;
    }
  }
  
  const deleteStatus = DELETE_RAW_DATA ? `删除源聚合 ${deleted} 条` : `[测试模式] 跳过删除 (将删除 ${idsToDelete.length} 条)`;
  console.log(`[Aggregate] ${phaseName}: 源聚合数据 ${sourceCount} 条, 新增聚合 ${aggregated} 组, ${deleteStatus}`);
  
  return { aggregated, deleted, rawCount: sourceCount };
}

function mapColumnsToAggregated(columns) {
  return columns.split(',').map(col => {
    const trimmed = col.trim();
    const aggCol = COLUMN_MAP[trimmed];
    return aggCol ? `${aggCol} AS ${trimmed}` : trimmed;
  }).join(', ');
}

async function getLastAggregatedTo(db) {
  const result = await db.prepare(`SELECT value FROM settings WHERE key = 'last_aggregated_to'`).first();
  if (result && result.value) {
    return parseInt(result.value);
  }
  return null;
}

export async function getMetricsHistory(db, serverId, hours, columns) {
  const now = Date.now();
  const cutoff = now - hours * 60 * 60 * 1000;

  const aggColumns = mapColumnsToAggregated(columns);

  const lastAggregatedTo = await getLastAggregatedTo(db);

  const rawCutoff = lastAggregatedTo || (now - 30 * 60 * 1000);

  const map = new Map();

  console.log(
    '[History]',
    'server:', serverId,
    'hours:', hours,
    'cutoff:', new Date(cutoff).toISOString(),
    'rawCutoff:', new Date(rawCutoff).toISOString()
  );

  const rawStart = Math.max(cutoff, rawCutoff);

  const rawResult = await db.prepare(`
    SELECT timestamp, ${columns}
    FROM metrics_history
    WHERE server_id = ?
      AND typeof(timestamp) = 'integer'
      AND timestamp >= ?
  `).bind(serverId, rawStart).all();

  for (const row of rawResult.results) {
    const ts = Number(row.timestamp);
    map.set(ts, {
      ...row,
      timestamp: ts
    });
  }

  console.log(`[History] RAW: ${rawResult.results.length}`);

  for (const phase of AGGREGATE_PHASES) {
    const phaseStart = now - phase.maxHours * 3600 * 1000;
    const phaseEnd = now - phase.minHours * 3600 * 1000;

    const queryStart = Math.max(cutoff, phaseStart);
    const queryEnd = Math.min(phaseEnd, rawCutoff);

    if (queryStart >= queryEnd) continue;

    const aggResult = await db.prepare(`
      SELECT 
        bucket AS timestamp,
        ${aggColumns}
      FROM metrics_aggregated
      WHERE server_id = ?
        AND bucket_size = ?
        AND bucket >= ?
        AND bucket < ?
    `).bind(
      serverId,
      phase.bucketSeconds,
      queryStart,
      queryEnd
    ).all();

    for (const row of aggResult.results) {
      const ts = Number(row.timestamp);

      if (!map.has(ts)) {
        map.set(ts, {
          ...row,
          timestamp: ts
        });
      }
    }

    console.log(`[History] ${phase.name}: ${aggResult.results.length}`);
  }

  const result = Array.from(map.values());
  result.sort((a, b) => a.timestamp - b.timestamp);

  console.log(`[History] FINAL: ${result.length}`);

  return result;
}

export async function getAggregatedHistory(db, serverId, hours, columns) {
  const now = Date.now();
  const oneHourMs = 60 * 60 * 1000;

  const aggColumns = mapColumnsToAggregated(columns);

  const queryStart = now - hours * oneHourMs;
  const queryEnd = now - oneHourMs;

  const map = new Map();

  console.log(
    '[Aggregated]',
    'server:', serverId,
    'hours:', hours,
    'range:', new Date(queryStart).toISOString(),
    '-',
    new Date(queryEnd).toISOString()
  );

  for (const phase of AGGREGATE_PHASES) {
    const phaseStart = now - phase.maxHours * 3600 * 1000;
    const phaseEnd = now - phase.minHours * 3600 * 1000;

    const phaseQueryStart = Math.max(queryStart, phaseStart);
    const phaseQueryEnd = Math.min(queryEnd, phaseEnd);

    if (phaseQueryStart >= phaseQueryEnd) continue;

    const aggResult = await db.prepare(`
      SELECT 
        bucket AS timestamp,
        ${aggColumns}
      FROM metrics_aggregated
      WHERE server_id = ?
        AND bucket_size = ?
        AND bucket >= ?
        AND bucket < ?
    `).bind(
      serverId,
      phase.bucketSeconds,
      phaseQueryStart,
      phaseQueryEnd
    ).all();

    for (const row of aggResult.results) {
      const ts = Number(row.timestamp);
      map.set(ts, {
        ...row,
        timestamp: ts
      });
    }

    console.log(`[Aggregated] ${phase.name}: ${aggResult.results.length}`);
  }

  const result = Array.from(map.values());
  result.sort((a, b) => a.timestamp - b.timestamp);

  console.log(`[Aggregated] FINAL: ${result.length}`);

  return result;
}

export async function cleanupOldData(db, force = false) {
  try {
    const lastClean = await db.prepare(`SELECT value FROM settings WHERE key = 'last_cleanup'`).first();
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;
    const delDate = RETENTION_DAYS * 24 * 60 * 60 * 1000; // 删除N天前的原始数据
    
    const shouldRun = force || !lastClean || (now - parseInt(lastClean.value)) > oneHour;
    
    if (!shouldRun) {
      console.log('[Cleanup] 距离上次清理不足1小时，跳过（可使用 force=true 强制执行）');
      return { skipped: true, reason: 'rate_limit' };
    }
    
    const stats = {
      oldFormat: 0,
      expired: 0,
      aggregated: 0,
      deleted: 0,
      aggCleaned: 0,
      phases: []
    };
    
    const strDeleteResult = await db.prepare(
      `DELETE FROM metrics_history WHERE typeof(timestamp) = 'text'`
    ).run();
    stats.oldFormat = strDeleteResult.meta.changes || 0;
    
    for (const phase of AGGREGATE_PHASES) {
      const phaseStart = now - (phase.maxHours * 60 * 60 * 1000);
      const phaseEnd = now - (phase.minHours * 60 * 60 * 1000);
      
      let phaseResult;
      if (phase.sourceBucketSeconds === null) {
        phaseResult = await aggregateFromRaw(
          db, phaseStart, phaseEnd, phase.bucketSeconds, phase.name
        );
      } else {
        phaseResult = await aggregateFromAggregated(
          db, phaseStart, phaseEnd, phase.bucketSeconds, phase.sourceBucketSeconds, phase.name
        );
      }
      
      stats.aggregated += phaseResult.aggregated;
      stats.deleted += phaseResult.deleted;
      stats.phases.push({
        phase: phase.name,
        ...phaseResult
      });
    }
    
    const cutoff = now - delDate;
    const intDeleteResult = await db.prepare(
      `DELETE FROM metrics_history WHERE typeof(timestamp) = 'integer' AND timestamp < ?`
    ).bind(cutoff).run();
    stats.expired = intDeleteResult.meta.changes || 0;
    stats.deleted += stats.expired;
    
    const aggCutoff = now - delDate;
    const aggCleanResult = await db.prepare(
      `DELETE FROM metrics_aggregated WHERE bucket < ?`
    ).bind(aggCutoff).run();
    stats.aggCleaned = aggCleanResult.meta.changes || 0;
    
    const oneHourMs = 60 * 60 * 1000;
    const lastAggregatedTo = now - oneHourMs;
    
    const totalDeleted = stats.oldFormat + stats.deleted + stats.aggCleaned;
    
    if (totalDeleted > 0 || stats.aggregated > 0) {
      await db.prepare(`
        INSERT OR REPLACE INTO settings (key, value) VALUES ('last_cleanup', ?)
      `).bind(now.toString()).run();
      
      await db.prepare(`
        INSERT OR REPLACE INTO settings (key, value) VALUES ('last_aggregated_to', ?)
      `).bind(lastAggregatedTo.toString()).run();
      
      console.log(`[Cleanup] 聚合 ${stats.aggregated} 组, 清理 ${totalDeleted} 条（旧格式:${stats.oldFormat}, 过期原始:${stats.expired}, 过期聚合:${stats.aggCleaned}）, 聚合完成时间点:${new Date(lastAggregatedTo).toISOString()}`);
    }
    
    return {
      success: true,
      aggregated: stats.aggregated,
      deleted: totalDeleted,
      oldFormat: stats.oldFormat,
      expired: stats.expired,
      aggCleaned: stats.aggCleaned,
      phases: stats.phases,
      forced: force
    };
  } catch (e) {
    console.error('[Cleanup] 清理数据失败:', e);
    return { success: false, error: e.message };
  }
}

export async function saveMetricsHistory(db, serverId, metrics) {
  try {
    const now = Date.now();
    await db.prepare(`
      INSERT INTO metrics_history (
        server_id, timestamp, cpu, ram, disk, load_avg,
        net_in_speed, net_out_speed, net_rx, net_tx,
        processes, tcp_conn, udp_conn,
        ping_ct, ping_cu, ping_cm, ping_bd,
        ram_total, ram_used, swap_total, swap_used,
        disk_total, disk_used
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?
      )
    `).bind(
      serverId,
      now,
      parseFloat(metrics.cpu) || 0,
      parseFloat(metrics.ram) || 0,
      parseFloat(metrics.disk) || 0,
      metrics.load || '0',
      parseFloat(metrics.net_in_speed) || 0,
      parseFloat(metrics.net_out_speed) || 0,
      parseFloat(metrics.net_rx) || 0,
      parseFloat(metrics.net_tx) || 0,
      parseInt(metrics.processes) || 0,
      parseInt(metrics.tcp_conn) || 0,
      parseInt(metrics.udp_conn) || 0,
      parseInt(metrics.ping_ct) || 0,
      parseInt(metrics.ping_cu) || 0,
      parseInt(metrics.ping_cm) || 0,
      parseInt(metrics.ping_bd) || 0,
      parseFloat(metrics.ram_total) || 0,
      parseFloat(metrics.ram_used) || 0,
      parseFloat(metrics.swap_total) || 0,
      parseFloat(metrics.swap_used) || 0,
      parseFloat(metrics.disk_total) || 0,
      parseFloat(metrics.disk_used) || 0
    ).run();
  } catch (e) {
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
  try {
    const { results } = await db.prepare(`
      SELECT mh.*
      FROM metrics_history mh
      INNER JOIN (
        SELECT server_id, MAX(timestamp) as max_ts
        FROM metrics_history
        GROUP BY server_id
      ) latest ON mh.server_id = latest.server_id AND mh.timestamp = latest.max_ts
    `).all();
    
    const map = new Map();
    for (const row of results) {
      map.set(row.server_id, row);
    }
    
    return map;
  } catch (e) {
    console.error('获取所有服务器最新指标数据失败:', e);
    return new Map();
  }
}
