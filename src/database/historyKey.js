export const HISTORY_ID_SEPARATOR = '0';
export const HISTORY_TIME_DIGITS = 14;
export const HISTORY_MIN_TIME_KEY = '19700101000000';
export const HISTORY_MAX_TIME_KEY = '9'.repeat(HISTORY_TIME_DIGITS);

export const HISTORY_COLUMNS = [
  { name: 'id', definition: 'TEXT PRIMARY KEY NOT NULL', defaultSql: null },
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
      ) WITHOUT ROWID
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

export function buildHistoryId(serverId, timestamp) {
  return `${String(serverId)}${HISTORY_ID_SEPARATOR}${formatHistoryTimeKey(timestamp)}`;
}

export function getHistoryIdRange(serverId, startTimestamp = null, endTimestamp = null) {
  const prefix = `${String(serverId)}${HISTORY_ID_SEPARATOR}`;
  return {
    startId: prefix + (startTimestamp === null || startTimestamp === undefined
      ? HISTORY_MIN_TIME_KEY
      : formatHistoryTimeKey(startTimestamp)),
    endId: prefix + (endTimestamp === null || endTimestamp === undefined
      ? HISTORY_MAX_TIME_KEY
      : formatHistoryTimeKey(endTimestamp))
  };
}

export function buildHistoryIdSqlExpression(serverIdColumn = 'server_id', timestampColumn = 'timestamp') {
  const serverId = quoteIdentifier(serverIdColumn);
  const timestamp = quoteIdentifier(timestampColumn);
  return `
    CAST(${serverId} AS TEXT) || '${HISTORY_ID_SEPARATOR}' || COALESCE(
      strftime(
        '%Y%m%d%H%M%S',
        CASE
          WHEN CAST(${timestamp} AS INTEGER) < 10000000000
            THEN CAST(${timestamp} AS INTEGER)
          ELSE CAST(${timestamp} AS INTEGER) / 1000
        END,
        'unixepoch'
      ),
      '19700101000000'
    )
  `;
}

export function selectHistoryColumnExpression(columnName, existingColumns) {
  if (existingColumns.includes(columnName)) return quoteIdentifier(columnName);
  const column = HISTORY_COLUMNS.find(item => item.name === columnName);
  return column?.defaultSql ?? 'NULL';
}

export async function historyTableExists(db, tableName = 'metrics_history') {
  const table = await db.prepare(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`
  ).bind(tableName).first();
  return !!table;
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
  const withoutRowid = /WITHOUT\s+ROWID/i.test(table.sql || '');
  const optimized = !!idColumn
    && Number(idColumn.pk) > 0
    && String(idColumn.type || '').toUpperCase().includes('TEXT')
    && withoutRowid;

  setHistoryIdPrimaryKeyCache(tableName, optimized);
  return optimized;
}
