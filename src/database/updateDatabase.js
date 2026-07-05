import {
  createMetricsHistoryTableSql,
  ensureServerHistoryPartitions,
  HISTORY_COLUMN_NAMES,
  historyTableExists,
  isHistoryIdPrimaryKey,
  isHistoryIdOptimized,
  quoteIdentifier,
  SERVER_HISTORY_PARTITION_COLUMN
} from './historyKey.js';

export async function updateDatabase(db, env = {}) {
  console.log('开始执行数据库更新...');
  const results = [];
  const optimizedHistory = isHistoryIdOptimized(env);
  
  try {
    if (!optimizedHistory) {
      const migrateLoad = await migrateLoadToLoadAvg(db);
      results.push({ name: 'metrics_history load -> load_avg 迁移', ...migrateLoad });

      const migrateOldLoad = await migrateLoadToLoadAvg(db, 'metrics_history_old');
      if (!migrateOldLoad.skipped) {
        results.push({ name: 'metrics_history_old load -> load_avg 迁移', ...migrateOldLoad });
      }
    }
    
    const serversCols = await addServerColumns(db, optimizedHistory);
    results.push({ name: 'servers 表列更新', ...serversCols });

    if (optimizedHistory) {
      const serverPartitions = await ensureServerHistoryPartitions(db);
      results.push({ name: 'servers 历史分区 ID 检查', ...serverPartitions });
      if (!serverPartitions.success) {
        throw new Error(serverPartitions.error || 'servers 历史分区 ID 检查失败');
      }
    }
    
    const cleanupServers = await cleanupServerExtraColumns(db);
    results.push({ name: 'servers 表多余字段清理', ...cleanupServers });
    
    if (!optimizedHistory) {
      const historyCols = await addHistoryColumns(db);
      results.push({ name: 'metrics_history 表列更新', ...historyCols });

      const oldHistoryCols = await addHistoryColumns(db, 'metrics_history_old');
      if (!oldHistoryCols.skipped) {
        results.push({ name: 'metrics_history_old 表列更新', ...oldHistoryCols });
      }
    }

    if (optimizedHistory) {
      const optimizedStorage = await ensureOptimizedHistoryStorage(db);
      results.push({ name: 'metrics_history 优化模式准备', ...optimizedStorage });
      if (!optimizedStorage.success) {
        throw new Error(optimizedStorage.error || 'metrics_history 优化模式准备失败');
      }
    } else {
      const historyIndex = await ensureHistoryIndex(db);
      results.push({ name: 'metrics_history 索引检查', ...historyIndex });
      if (!historyIndex.success) {
        throw new Error(historyIndex.error || 'metrics_history 索引检查失败');
      }
    }

    // 无需清理metrics_history多余字段，消耗过大，不影响使用，每周执行weeklyCleanup的时候会自动清理
    
    const staleCleanup = await cleanupStaleSettings(db);
    results.push({ name: '废弃 settings key 清理', ...staleCleanup });
    
    const dropAggregated = await dropMetricsAggregatedTable(db);
    results.push({ name: '删除弃用的 metrics_aggregated 表', ...dropAggregated });
    
    console.log('✅ 数据库更新完成');
    
    return {
      success: true,
      message: 'databaseUpgradeSuccess',
      results
    };
  } catch (e) {
    console.error('❌ 数据库更新失败:', e);
    return {
      success: false,
      message: 'databaseUpgradeFailed',
      error: e.message,
      results
    };
  }
}

export async function ensureHistoryIndex(db) {
  try {
    if (!await historyTableExists(db)) {
      await db.prepare(createMetricsHistoryTableSql()).run();
    }

    const { results: indexes = [] } = await db.prepare(
      `SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'metrics_history'`
    ).all();
    const hasServerTimeIndex = indexes.some(index => {
      const sql = String(index.sql || '').toLowerCase().replace(/\s+/g, ' ');
      return sql.includes('server_id') && sql.includes('timestamp');
    });

    if (hasServerTimeIndex) {
      return { success: true, created: false, message: '索引已存在' };
    }

    const idxName = 'idx_history_server_time_' + Math.random().toString(36).substring(2);
    await db.prepare(`
      CREATE INDEX IF NOT EXISTS ${quoteIdentifier(idxName)}
      ON metrics_history(server_id, timestamp)
    `).run();

    return { success: true, created: true, message: '已创建索引' };
  } catch (e) {
    console.error('检查/创建 metrics_history 索引失败:', e);
    return { success: false, error: e.message };
  }
}

export async function dropHistorySecondaryIndexes(db, tableName = 'metrics_history') {
  try {
    if (!await historyTableExists(db, tableName)) {
      return { success: true, dropped: 0, skipped: true, message: '表不存在' };
    }

    const { results: indexes = [] } = await db.prepare(
      `SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ?`
    ).bind(tableName).all();
    const secondaryIndexes = indexes.filter(index => index.sql);

    for (const index of secondaryIndexes) {
      await db.prepare(`DROP INDEX IF EXISTS ${quoteIdentifier(index.name)}`).run();
    }

    return {
      success: true,
      dropped: secondaryIndexes.length,
      message: secondaryIndexes.length > 0 ? '已删除非主键索引' : '无需清理'
    };
  } catch (e) {
    console.error(`清理 ${tableName} 非主键索引失败:`, e);
    return { success: false, error: e.message };
  }
}

async function isOptimizedHistoryTableReady(db) {
  if (!await isHistoryIdPrimaryKey(db, 'metrics_history', { force: true })) {
    return false;
  }

  const { results: columns = [] } = await db.prepare(
    `PRAGMA table_info(metrics_history)`
  ).all();
  const existingColumns = new Set(columns.map(column => column.name));
  return HISTORY_COLUMN_NAMES.every(column => existingColumns.has(column));
}

export async function ensureOptimizedHistoryStorage(db) {
  try {
    await ensureServerHistoryPartitions(db);

    let reset = false;
    if (!await isOptimizedHistoryTableReady(db)) {
      await db.prepare(`DROP TABLE IF EXISTS metrics_history`).run();
      await db.prepare(createMetricsHistoryTableSql()).run();
      await isHistoryIdPrimaryKey(db, 'metrics_history', { force: true });
      reset = true;
    }

    const indexes = await dropHistorySecondaryIndexes(db);
    if (!indexes.success) {
      return indexes;
    }

    return {
      success: true,
      reset,
      dropped: indexes.dropped || 0,
      message: reset ? '已重建优化历史表' : '优化历史表已就绪'
    };
  } catch (e) {
    console.error('准备 metrics_history 优化模式失败:', e);
    return { success: false, error: e.message };
  }
}

async function migrateLoadToLoadAvg(db, tableName = 'metrics_history') {
  try {
    if (!await historyTableExists(db, tableName)) {
      return { success: true, migrated: 0, skipped: true, message: '表不存在' };
    }

    const { results: columns } = await db.prepare(`PRAGMA table_info(${quoteIdentifier(tableName)})`).all();
    const existingCols = columns.map(c => c.name);
    
    if (!existingCols.includes('load')) {
      return { success: true, migrated: 0, message: '无需迁移（没有旧的 load 字段）' };
    }
    
    let migrated = 0;
    
    if (!existingCols.includes('load_avg')) {
      await db.prepare(`ALTER TABLE ${quoteIdentifier(tableName)} ADD COLUMN ${quoteIdentifier('load_avg')} TEXT DEFAULT '0'`).run();
    }
    
    const { meta: updateResult } = await db.prepare(
      `UPDATE ${quoteIdentifier(tableName)} SET ${quoteIdentifier('load_avg')} = ${quoteIdentifier('load')} WHERE ${quoteIdentifier('load')} IS NOT NULL AND ${quoteIdentifier('load_avg')} = '0'`
    ).run();
    migrated = updateResult.changes;
    
    await db.prepare(`ALTER TABLE ${quoteIdentifier(tableName)} DROP COLUMN ${quoteIdentifier('load')}`).run();
    console.log(`✅ 已迁移 ${migrated} 条记录的 load -> load_avg`);
    
    return { success: true, migrated, message: `已迁移 ${migrated} 条记录并删除旧字段` };
  } catch (e) {
    console.error('迁移 load -> load_avg 失败:', e);
    return { success: false, error: e.message };
  }
}

export async function addServerColumns(db, optimizedHistory = false) {
  try {
    const { results: columns } = await db.prepare(`PRAGMA table_info(servers)`).all();
    const existingCols = columns.map(c => c.name);
    
    const newCols = {
      is_hidden: "TEXT DEFAULT '0'",
      sort_order: "INTEGER DEFAULT 0",
      reset_day: "INTEGER DEFAULT 1",
      collect_interval: "INTEGER DEFAULT 0",
      report_interval: "INTEGER DEFAULT 60",
      ping_mode: "TEXT DEFAULT 'http'",
      traffic_calc_type: "TEXT DEFAULT 'total'"
    };

    if (optimizedHistory) {
      newCols[SERVER_HISTORY_PARTITION_COLUMN] = "INTEGER DEFAULT 0";
    }
    
    let added = 0;
    for (const [colName, colDef] of Object.entries(newCols)) {
      if (!existingCols.includes(colName)) {
        await db.prepare(`ALTER TABLE servers ADD COLUMN ${colName} ${colDef}`).run();
        added++;
      }
    }
    
    return { success: true, added };
  } catch (e) {
    console.error('添加 servers 表列失败:', e);
    return { success: false, error: e.message };
  }
}

async function cleanupServerExtraColumns(db) {
  try {
    const { results: columns } = await db.prepare(`PRAGMA table_info(servers)`).all();
    const existingCols = columns.map(c => c.name);
    
    const extraCols = ['cpu', 'ram', 'disk', 'load_avg', 'uptime', 'last_updated', 'ram_total', 'net_rx', 'net_tx', 'net_in_speed', 'net_out_speed', 'os', 'cpu_info', 'cpu_cores' , 'arch' ,'boot_time', 'ram_used', 'swap_total', 'swap_used', 'disk_total', 'disk_used', 'processes', 'tcp_conn', 'udp_conn', 'country', 'ip_v4', 'ip_v6', 'ping_ct', 'ping_cu', 'ping_cm', 'ping_bd', 'monthly_rx', 'monthly_tx', 'last_rx', 'last_tx', 'reset_month'];
    const colsToDrop = extraCols.filter(col => existingCols.includes(col));
    
    if (colsToDrop.length === 0) {
      return { success: true, cleaned: 0, message: '无需清理（没有多余字段）' };
    }
    
    for (const col of colsToDrop) {
      await db.prepare(`ALTER TABLE servers DROP COLUMN ${col}`).run();
      console.log(`✅ 已删除 servers 表的 ${col} 字段`);
    }
    
    return { success: true, cleaned: colsToDrop.length, message: `已删除 ${colsToDrop.join(', ')} 字段` };
  } catch (e) {
    console.error('清理 servers 表多余字段失败:', e);
    return { success: false, error: e.message };
  }
}

export async function addHistoryColumns(db, tableName = 'metrics_history') {
  try {
    if (!await historyTableExists(db, tableName)) {
      return { success: true, added: 0, skipped: true, message: '表不存在' };
    }

    const { results: historyColumns } = await db.prepare(`PRAGMA table_info(${quoteIdentifier(tableName)})`).all();
    const existingHistoryCols = historyColumns.map(c => c.name);
    
    const newHistoryCols = {
      cpu_cores: "INTEGER DEFAULT 0",
      cpu_info: "TEXT DEFAULT ''",
      gpu: "REAL DEFAULT NULL",
      gpu_info: "TEXT DEFAULT ''",
      arch: "TEXT DEFAULT ''",
      os: "TEXT DEFAULT ''",
      region: "TEXT DEFAULT ''",
      ip_v4: "TEXT DEFAULT '0'",
      ip_v6: "TEXT DEFAULT '0'",
      boot_time: "TEXT DEFAULT ''",
      net_rx_monthly: "REAL DEFAULT 0",
      net_tx_monthly: "REAL DEFAULT 0",
      loss_ct: "INTEGER DEFAULT NULL",
      loss_cu: "INTEGER DEFAULT NULL",
      loss_cm: "INTEGER DEFAULT NULL",
      loss_bd: "INTEGER DEFAULT NULL"
    };
    
    let added = 0;
    for (const [colName, colDef] of Object.entries(newHistoryCols)) {
      if (!existingHistoryCols.includes(colName)) {
        await db.prepare(`ALTER TABLE ${quoteIdentifier(tableName)} ADD COLUMN ${quoteIdentifier(colName)} ${colDef}`).run();
        added++;
      }
    }
    
    return { success: true, added };
  } catch (e) {
    console.error('添加 metrics_history 表列失败:', e);
    return { success: false, error: e.message };
  }
}

async function dropMetricsAggregatedTable(db) {
  console.log('开始删除弃用的 metrics_aggregated 表...');
  try {
    const { results: tables } = await db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='metrics_aggregated'`
    ).all();
    
    if (tables.length === 0) {
      return { success: true, dropped: 0, message: '无需删除（表不存在）' };
    }
    
    await db.prepare(`DROP TABLE metrics_aggregated`).run();
    console.log('✅ 已删除 metrics_aggregated 表');
    return { success: true, dropped: 1, message: '已删除 metrics_aggregated 表' };
  } catch (e) {
    console.error('删除 metrics_aggregated 表失败:', e);
    return { success: false, error: e.message };
  }
}

export async function cleanupStaleSettings(db) {
  console.log('开始清理废弃的 settings key...');
  try {
    const stalePrefixes = ['last_write_%'];
    const staleExact = [
      'theme',
      'custom_css',
      'auto_reset_traffic',
      'last_aggregated_to_120',
      'last_aggregated_to_240',
      'last_aggregated_to_480',
      'last_aggregated_to_960',
      'last_aggregated_to_1920',
      'site_title',
      'admin_title',
      'custom_head',
      'custom_script',
      'custom_bg',
      'is_public',
      'show_price',
      'show_expire',
      'show_bw',
      'show_tf',
      'show_time',
      'show_long_history',
      'tg_notify',
      'tg_bot_token',
      'tg_chat_id',
      'last_aggregated_to',
      'last_cleanup',
      'expire_reminder'
    ];
    const staleKeysWhere = stalePrefixes.map(() => `key LIKE ?`).concat(staleExact.map(() => `key = ?`)).join(' OR ');
    const staleBindings = [...stalePrefixes, ...staleExact];
    const { meta: cleanupResult } = await db.prepare(
      `DELETE FROM settings WHERE ${staleKeysWhere}`
    ).bind(...staleBindings).run();
    if (cleanupResult.changes > 0) {
      console.log(`已清理 ${cleanupResult.changes} 个废弃的 settings key`);
    }
    return { success: true, cleaned: cleanupResult.changes };
  } catch (e) {
    console.error('清理废弃 settings key 失败:', e);
    return { success: false, error: e.message };
  }
}
