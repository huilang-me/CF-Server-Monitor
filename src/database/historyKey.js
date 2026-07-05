export const HISTORY_ID_SEPARATOR = '0';
export const HISTORY_TIME_DIGITS = 14;
export const HISTORY_MIN_TIME_KEY = '19700101000000';
export const HISTORY_MAX_TIME_KEY = '9'.repeat(HISTORY_TIME_DIGITS);
export const HISTORY_MAX_PARTITION_ID = 9223;
export const SERVER_HISTORY_PARTITION_COLUMN = 'history_partition_id';

export const HISTORY_COLUMNS = [
  { name: 'id', definition: 'INTEGER PRIMARY KEY NOT NULL', defaultSql: null },
  { name: 'server_id', definition: 'TEXT NOT NULL', defaultSql: "''" },
  { name: 'timestamp', definition: 'INTEGER DEFAULT 0', defaultSql: '0' },
  { name: 'cpu', definition: 'REAL DEFAULT 0', defaultSql: '0' },
  { name: 'load_avg', definition: "TEXT DEFAULT '0'", defaultSql: "'0'" },
  { name: 'net_in_speed', definition: 'REAL DEFAULT 0', defaultSql: '0' },
  { name: 'net_out_speed', definition: 'REAL DEFAULT 0', defaultSql: '0' },
  { name: 'net_rx', definition: 'REAL DEFAULT 0', defaultSql: '0' },
  { name: 'net_tx', definition: 'REAL DEFAULT 0', defaultSql: '0' },
  { name: 'processes', definition: 'INTEGER DEFAULT 0', defaultSql: '0' },
  { name: 'tcp_conn', definition: 'INTEGER DEFAULT 0', defaultSql: '0' },
  { name: 'udp_conn', definition: 'INTEGER DEFAULT 0', defaultSql: '0' },
  { name: 'ping_ct', definition: 'INTEGER DEFAULT 0', defaultSql: '0' },
  { name: 'ping_cu', definition: 'INTEGER DEFAULT 0', defaultSql: '0' },
  { name: 'ping_cm', definition: 'INTEGER DEFAULT 0', defaultSql: '0' },
  { name: 'ping_bd', definition: 'INTEGER DEFAULT 0', defaultSql: '0' },
  { name: 'loss_ct', definition: 'INTEGER DEFAULT NULL', defaultSql: 'NULL' },
  { name: 'loss_cu', definition: 'INTEGER DEFAULT NULL', defaultSql: 'NULL' },
  { name: 'loss_cm', definition: 'INTEGER DEFAULT NULL', defaultSql: 'NULL' },
  { name: 'loss_bd', definition: 'INTEGER DEFAULT NULL', defaultSql: 'NULL' },
  { name: 'ram_total', definition: 'REAL DEFAULT 0', defaultSql: '0' },
  { name: 'ram_used', definition: 'REAL DEFAULT 0', defaultSql: '0' },
  { name: 'swap_total', definition: 'REAL DEFAULT 0', defaultSql: '0' },
  { name: 'swap_used', definition: 'REAL DEFAULT 0', defaultSql: '0' },
  { name: 'disk_total', definition: 'REAL DEFAULT 0', defaultSql: '0' },
  { name: 'disk_used', definition: 'REAL DEFAULT 0', defaultSql: '0' },
  { name: 'cpu_cores', definition: 'INTEGER DEFAULT 0', defaultSql: '0' },
  { name: 'cpu_info', definition: "TEXT DEFAULT ''", defaultSql: "''" },
  { name: 'gpu', definition: 'REAL DEFAULT NULL', defaultSql: 'NULL' },
  { name: 'gpu_info', definition: "TEXT DEFAULT ''", defaultSql: "''" },
  { name: 'arch', definition: "TEXT DEFAULT ''", defaultSql: "''" },
  { name: 'os', definition: "TEXT DEFAULT ''", defaultSql: "''" },
  { name: 'region', definition: "TEXT DEFAULT ''", defaultSql: "''" },
  { name: 'ip_v4', definition: "TEXT DEFAULT '0'", defaultSql: "'0'" },
  { name: 'ip_v6', definition: "TEXT DEFAULT '0'", defaultSql: "'0'" },
  { name: 'boot_time', definition: "TEXT DEFAULT ''", defaultSql: "''" },
  { name: 'net_rx_monthly', definition: 'REAL DEFAULT 0', defaultSql: '0' },
  { name: 'net_tx_monthly', definition: 'REAL DEFAULT 0', defaultSql: '0' }
];

export const HISTORY_COLUMN_NAMES = HISTORY_COLUMNS.map(column => column.name);
export const HISTORY_INSERT_COLUMNS = HISTORY_COLUMN_NAMES.filter(name => name !== 'id');

const historyIdPrimaryKeyCache = new Map();
const serverHistoryPartitionCache = new Map();

export function quoteIdentifier(identifier) {
  return `"${String(identifier).replace(/"/g, '""')}"`;
}

export function createMetricsHistoryTableSql(tableName = 'metrics_history') {
  const columnsSql = HISTORY_COLUMNS
    .map(column => `${quoteIdentifier(column.name)} ${column.definition}`)
    .join(',\n        ');

  return `
      CREATE TABLE IF NOT EXISTS ${quoteIdentifier(tableName)} (
        ${columnsSql}
      )
    `;
}

export function normalizeHistoryTimestamp(value, fallback = Date.now()) {
  const ts = Number(value);
  if (!Number.isFinite(ts) || ts <= 0) return fallback;
  return ts < 10000000000 ? ts * 1000 : ts;
}

function pad(value, length = 2) {
  return String(value).padStart(length, '0');
}

export function formatHistoryTimeKey(timestamp) {
  const normalized = normalizeHistoryTimestamp(timestamp, 0);
  const date = new Date(normalized);
  if (!Number.isFinite(date.getTime())) return HISTORY_MIN_TIME_KEY;

  return [
    pad(date.getUTCFullYear(), 4),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds())
  ].join('');
}

export function buildHistoryId(partitionId, timestamp) {
  const normalizedPartitionId = normalizeHistoryPartitionId(partitionId);
  if (!normalizedPartitionId) {
    throw new Error('Invalid history partition id');
  }
  return `${normalizedPartitionId}${HISTORY_ID_SEPARATOR}${formatHistoryTimeKey(timestamp)}`;
}

export function getHistoryIdRange(partitionId, startTimestamp = null, endTimestamp = null) {
  const normalizedPartitionId = normalizeHistoryPartitionId(partitionId);
  if (!normalizedPartitionId) {
    throw new Error('Invalid history partition id');
  }

  const prefix = `${normalizedPartitionId}${HISTORY_ID_SEPARATOR}`;
  return {
    startId: prefix + (startTimestamp === null || startTimestamp === undefined
      ? HISTORY_MIN_TIME_KEY
      : formatHistoryTimeKey(startTimestamp)),
    endId: prefix + (endTimestamp === null || endTimestamp === undefined
      ? HISTORY_MAX_TIME_KEY
      : formatHistoryTimeKey(endTimestamp))
  };
}

export function buildHistoryIdSqlExpression(partitionExpression, timestampExpression) {
  return `
    CAST(
      CAST(${partitionExpression} AS TEXT) || '${HISTORY_ID_SEPARATOR}' || COALESCE(
        strftime(
          '%Y%m%d%H%M%S',
          CASE
            WHEN CAST(${timestampExpression} AS INTEGER) < 10000000000
              THEN CAST(${timestampExpression} AS INTEGER)
            ELSE CAST(${timestampExpression} AS INTEGER) / 1000
          END,
          'unixepoch'
        ),
        '19700101000000'
      ) AS INTEGER
    )
  `;
}

export function selectHistoryColumnExpression(columnName, existingColumns, tableAlias = null) {
  const prefix = tableAlias ? `${quoteIdentifier(tableAlias)}.` : '';
  if (existingColumns.includes(columnName)) return `${prefix}${quoteIdentifier(columnName)}`;
  if (columnName === 'load_avg' && existingColumns.includes('load')) {
    return `${prefix}${quoteIdentifier('load')}`;
  }
  const column = HISTORY_COLUMNS.find(item => item.name === columnName);
  return column?.defaultSql ?? 'NULL';
}

export async function historyTableExists(db, tableName = 'metrics_history') {
  const table = await db.prepare(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`
  ).bind(tableName).first();
  return !!table;
}

export function normalizeHistoryPartitionId(value) {
  const partitionId = Number(value);
  if (!Number.isInteger(partitionId) || partitionId <= 0 || partitionId > HISTORY_MAX_PARTITION_ID) {
    return null;
  }
  return partitionId;
}

function nextAvailableHistoryPartitionId(usedIds) {
  for (let id = 1; id <= HISTORY_MAX_PARTITION_ID; id++) {
    if (!usedIds.has(id)) return id;
  }
  throw new Error(`No available history partition id; max is ${HISTORY_MAX_PARTITION_ID}`);
}

async function serverTableExists(db) {
  const table = await db.prepare(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'servers'`
  ).first();
  return !!table;
}

export async function ensureServerHistoryPartitionColumn(db) {
  if (!await serverTableExists(db)) {
    return { success: true, added: false, skipped: true, message: 'servers 表不存在' };
  }

  const { results: columns = [] } = await db.prepare(`PRAGMA table_info(servers)`).all();
  const exists = columns.some(column => column.name === SERVER_HISTORY_PARTITION_COLUMN);
  if (exists) {
    return { success: true, added: false, message: 'history_partition_id 已存在' };
  }

  await db.prepare(
    `ALTER TABLE servers ADD COLUMN ${quoteIdentifier(SERVER_HISTORY_PARTITION_COLUMN)} INTEGER DEFAULT 0`
  ).run();
  return { success: true, added: true, message: '已添加 history_partition_id' };
}

export async function ensureServerHistoryPartitions(db) {
  await ensureServerHistoryPartitionColumn(db);

  if (!await serverTableExists(db)) {
    return { success: true, assigned: 0, skipped: true, message: 'servers 表不存在' };
  }

  const { results: columns = [] } = await db.prepare(`PRAGMA table_info(servers)`).all();
  const hasSortOrder = columns.some(column => column.name === 'sort_order');
  const sortOrderSelect = hasSortOrder ? ', sort_order' : '';
  const sortOrderSql = hasSortOrder ? 'sort_order ASC, ' : '';
  const { results: servers = [] } = await db.prepare(`
    SELECT id, ${quoteIdentifier(SERVER_HISTORY_PARTITION_COLUMN)} AS history_partition_id${sortOrderSelect}
    FROM servers
    ORDER BY ${sortOrderSql}id ASC
  `).all();
  const usedIds = new Set();
  const updates = [];

  for (const server of servers) {
    let partitionId = normalizeHistoryPartitionId(server.history_partition_id);
    if (partitionId && !usedIds.has(partitionId)) {
      usedIds.add(partitionId);
      serverHistoryPartitionCache.set(server.id, partitionId);
      continue;
    }

    partitionId = nextAvailableHistoryPartitionId(usedIds);
    usedIds.add(partitionId);
    updates.push({ serverId: server.id, partitionId });
    serverHistoryPartitionCache.set(server.id, partitionId);
  }

  for (const update of updates) {
    await db.prepare(
      `UPDATE servers SET ${quoteIdentifier(SERVER_HISTORY_PARTITION_COLUMN)} = ? WHERE id = ?`
    ).bind(update.partitionId, update.serverId).run();
  }

  return { success: true, assigned: updates.length };
}

export async function getNextServerHistoryPartitionId(db) {
  await ensureServerHistoryPartitionColumn(db);

  const { results: rows = [] } = await db.prepare(`
    SELECT ${quoteIdentifier(SERVER_HISTORY_PARTITION_COLUMN)} AS history_partition_id
    FROM servers
  `).all();
  const usedIds = new Set(
    rows
      .map(row => normalizeHistoryPartitionId(row.history_partition_id))
      .filter(Boolean)
  );

  return nextAvailableHistoryPartitionId(usedIds);
}

export async function getServerHistoryPartitionId(db, serverId) {
  if (serverHistoryPartitionCache.has(serverId)) {
    return serverHistoryPartitionCache.get(serverId);
  }

  await ensureServerHistoryPartitionColumn(db);

  let row = await db.prepare(`
    SELECT ${quoteIdentifier(SERVER_HISTORY_PARTITION_COLUMN)} AS history_partition_id
    FROM servers
    WHERE id = ?
  `).bind(serverId).first();
  let partitionId = normalizeHistoryPartitionId(row?.history_partition_id);
  if (partitionId) {
    serverHistoryPartitionCache.set(serverId, partitionId);
    return partitionId;
  }

  await ensureServerHistoryPartitions(db);

  row = await db.prepare(`
    SELECT ${quoteIdentifier(SERVER_HISTORY_PARTITION_COLUMN)} AS history_partition_id
    FROM servers
    WHERE id = ?
  `).bind(serverId).first();
  partitionId = normalizeHistoryPartitionId(row?.history_partition_id);
  if (!partitionId) {
    throw new Error(`Missing history partition id for server ${serverId}`);
  }

  serverHistoryPartitionCache.set(serverId, partitionId);
  return partitionId;
}

export function setHistoryIdPrimaryKeyCache(tableName = 'metrics_history', value) {
  historyIdPrimaryKeyCache.set(tableName, !!value);
}

export function clearHistoryIdPrimaryKeyCache(tableName = null) {
  if (tableName) {
    historyIdPrimaryKeyCache.delete(tableName);
  } else {
    historyIdPrimaryKeyCache.clear();
  }
}

export async function isHistoryIdPrimaryKey(db, tableName = 'metrics_history', { force = false } = {}) {
  if (!force && historyIdPrimaryKeyCache.has(tableName)) {
    return historyIdPrimaryKeyCache.get(tableName);
  }

  const table = await db.prepare(
    `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`
  ).bind(tableName).first();

  if (!table) {
    setHistoryIdPrimaryKeyCache(tableName, false);
    return false;
  }

  const { results = [] } = await db.prepare(
    `PRAGMA table_info(${quoteIdentifier(tableName)})`
  ).all();
  const idColumn = results.find(column => column.name === 'id');
  const optimized = !!idColumn
    && Number(idColumn.pk) > 0
    && String(idColumn.type || '').toUpperCase().includes('INTEGER')
    && Number(idColumn.notnull) > 0;

  setHistoryIdPrimaryKeyCache(tableName, optimized);
  return optimized;
}
