import { debug, getSettingByKey } from '../utils/settings.js';


export async function updateDatabase(db) {
  debug('开始执行数据库更新...');
  const results = [];
  
  try {
    const historyIndex = await ensureHistoryIndex(db);
    results.push({ name: 'metrics_history 索引检查', ...historyIndex });
    
    const serversCols = await addServerColumns(db);
    results.push({ name: 'servers 表列更新', ...serversCols });
    
    const cleanupServers = await cleanupServerExtraColumns(db);
    results.push({ name: 'servers 表多余字段清理', ...cleanupServers });
    
    const historyCols = await addHistoryColumns(db);
    results.push({ name: 'metrics_history 表列更新', ...historyCols });

    // 无需清理metrics_history多余字段，消耗过大，不影响使用，每周执行weeklyCleanup的时候会自动清理
    
    const staleCleanup = await cleanupStaleSettings(db);
    results.push({ name: '废弃 settings key 清理', ...staleCleanup });
    
    const dropAggregated = await dropMetricsAggregatedTable(db);
    results.push({ name: '删除弃用的 metrics_aggregated 表', ...dropAggregated });
    
    debug('✅ 数据库更新完成');
    
    return {
      success: true,
      message: 'databaseUpgradeSuccess',
      results
    };
  } catch (e) {
    debug('❌ 数据库更新失败:', e);
    return {
      success: false,
      message: 'databaseUpgradeFailed',
      error: e.message,
      results
    };
  }
}

export async function isHistoryOptimized(db) {
  const history_id_optimized = await getSettingByKey(db, 'history_id_optimized', true);
  if(history_id_optimized) return true;
  const minId = await db.prepare(`
    SELECT id AS min_id
    FROM metrics_history
    ORDER BY id ASC
    LIMIT 1
  `).first();
  if(!minId) return true;  // 空表，视为已优化
  return minId.min_id > 10000000000000;
}

// 确保 旧版metrics_history 表有索引
export async function ensureHistoryIndex(db) {
  const history_id_optimized = await getSettingByKey(db, 'history_id_optimized', true);
  if(history_id_optimized) {
    debug('metrics_history 表已优化，无需创建索引');
    return { success: true, created: false, message: 'metrics_history 表已优化，无需创建索引'};
  }
  
  try {
    const index = await db.prepare(
      `SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='metrics_history'`
    ).first();

    if (index) {
      debug('索引已存在无需创建');
      return { success: true, created: false, message: '索引已存在' };
    }

    // 获取最小id
     const minId = await db.prepare(`
      SELECT id AS min_id
      FROM metrics_history
      ORDER BY id ASC
      LIMIT 1
    `).first();

    if (!minId || minId.min_id > 10000000000000) {
      debug('metrics_history 表为空或已优化，无需创建索引');
      return {
        success: true,
        created: false,
        message: 'metrics_history 表为空或已优化，无需创建索引'
      };
    }

    const idxName = 'idx_history_server_time_' + Math.random().toString(36).substring(2);
    await db.prepare(`DROP INDEX IF EXISTS ${idxName}`).run();
    await db.prepare(`
      CREATE INDEX IF NOT EXISTS ${idxName} 
      ON metrics_history(server_id, timestamp)
    `).run();
    debug(`✅ 已创建索引 ${idxName}`);

    return { success: true, created: true, message: '已创建索引' };
  } catch (e) {
    debug('检查/创建 metrics_history 索引失败:', e);
    return { success: false, error: e.message };
  }
}

export async function addServerColumns(db) {
  try {
    const { results: columns } = await db.prepare(`PRAGMA table_info(servers)`).all();
    const existingCols = columns.map(c => c.name);
    
    const newCols = {
      is_hidden: "TEXT DEFAULT '0'",
      offline_notify_disabled: "TEXT DEFAULT '0'",
      sort_order: "INTEGER DEFAULT 0",
      reset_day: "INTEGER DEFAULT 1",
      collect_interval: "INTEGER DEFAULT 0",
      report_interval: "INTEGER DEFAULT 60",
      ping_mode: "TEXT DEFAULT 'http'",
      traffic_calc_type: "TEXT DEFAULT 'total'",
      history_partition_id: "INTEGER DEFAULT 0",
      timestamp: "INTEGER DEFAULT 0"
    };
    
    let added = 0;
    for (const [colName, colDef] of Object.entries(newCols)) {
      if (!existingCols.includes(colName)) {
        await db.prepare(`ALTER TABLE servers ADD COLUMN ${colName} ${colDef}`).run();
        added++;
      }
    }
    
    return { success: true, added };
  } catch (e) {
    debug('添加 servers 表列失败:', e);
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
      debug(`✅ 已删除 servers 表的 ${col} 字段`);
    }
    
    return { success: true, cleaned: colsToDrop.length, message: `已删除 ${colsToDrop.join(', ')} 字段` };
  } catch (e) {
    debug('清理 servers 表多余字段失败:', e);
    return { success: false, error: e.message };
  }
}

export async function addHistoryColumns(db) {
  try {
    const { results: historyColumns } = await db.prepare(`PRAGMA table_info(metrics_history)`).all();
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
        await db.prepare(`ALTER TABLE metrics_history ADD COLUMN ${colName} ${colDef}`).run();
        added++;
      }
    }
    
    return { success: true, added };
  } catch (e) {
    debug('添加 metrics_history 表列失败:', e);
    return { success: false, error: e.message };
  }
}

async function dropMetricsAggregatedTable(db) {
  debug('开始删除弃用的 metrics_aggregated 表...');
  try {
    const { results: tables } = await db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='metrics_aggregated'`
    ).all();
    
    if (tables.length === 0) {
      return { success: true, dropped: 0, message: '无需删除（表不存在）' };
    }
    
    await db.prepare(`DROP TABLE metrics_aggregated`).run();
    debug('✅ 已删除 metrics_aggregated 表');
    return { success: true, dropped: 1, message: '已删除 metrics_aggregated 表' };
  } catch (e) {
    debug('删除 metrics_aggregated 表失败:', e);
    return { success: false, error: e.message };
  }
}

export async function cleanupStaleSettings(db) {
  debug('开始清理废弃的 settings key...');
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
      debug(`已清理 ${cleanupResult.changes} 个废弃的 settings key`);
    }
    return { success: true, cleaned: cleanupResult.changes };
  } catch (e) {
    debug('清理废弃 settings key 失败:', e);
    return { success: false, error: e.message };
  }
}
