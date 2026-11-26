export const PROBE_METRIC_FIELDS = Object.freeze([
  'ping_ct', 'ping_cu', 'ping_cm', 'ping_bd', 'ping_node_1', 'ping_node_2', 'ping_node_3', 'ping_node_4',
  'loss_ct', 'loss_cu', 'loss_cm', 'loss_bd', 'loss_node_1', 'loss_node_2', 'loss_node_3', 'loss_node_4'
]);

export const NUMERIC_METRIC_FIELDS = Object.freeze([
  'cpu', 'net_in_speed', 'net_out_speed', 'net_rx', 'net_tx',
  'net_rx_monthly', 'net_tx_monthly', 'processes', 'tcp_conn', 'udp_conn',
  'ram_total', 'ram_used', 'swap_total', 'swap_used',
  'disk_total', 'disk_used', 'cpu_cores',
  'disk_read_bps', 'disk_write_bps', 'disk_read_iops',
  'disk_write_iops', 'disk_await_ms', 'disk_util',
  'egress_latitude', 'egress_longitude'
]);

export const HISTORY_ALL_QUERY_COLUMNS = Object.freeze([
  'cpu',
  'gpu_info',
  'ram_total',
  'ram_used',
  'disk_total',
  'disk_used',
  'disk_read_bps',
  'disk_write_bps',
  'disk_read_iops',
  'disk_write_iops',
  'disk_await_ms',
  'disk_util',
  'processes',
  'net_in_speed',
  'net_out_speed',
  'tcp_conn',
  'udp_conn',
  'ping_ct',
  'ping_cu',
  'ping_cm',
  'ping_bd',
  'ping_node_1', 'ping_node_2', 'ping_node_3', 'ping_node_4',
  'loss_ct',
  'loss_cu',
  'loss_cm',
  'loss_bd',
  'loss_node_1', 'loss_node_2', 'loss_node_3', 'loss_node_4',
  'swap_total',
  'swap_used',
  'load_avg',
  'region',
  'kernel_version',
  'egress_city',
  'egress_region',
  'egress_region_code',
  'egress_country',
  'egress_latitude',
  'egress_longitude'
]);

const HISTORY_AGGREGATION_MAX_FIELDS = Object.freeze([
  'net_in_speed', 'net_out_speed',
  'disk_read_bps', 'disk_write_bps', 'disk_read_iops',
  'disk_write_iops', 'disk_await_ms', 'disk_util',
  'processes', 'tcp_conn', 'udp_conn'
]);

const HISTORY_AGGREGATION_AVG_FIELDS = Object.freeze([
  'cpu', 'ram_used', 'swap_used',
  'ping_ct', 'ping_cu', 'ping_cm', 'ping_bd',
  'loss_ct', 'loss_cu', 'loss_cm', 'loss_bd'
]);

export const HISTORY_METRIC_AGGREGATION_POLICY = Object.freeze({
  ...Object.fromEntries(HISTORY_AGGREGATION_MAX_FIELDS.map(field => [field, 'max'])),
  ...Object.fromEntries(HISTORY_AGGREGATION_AVG_FIELDS.map(field => [field, 'avg']))
});

export const BROADCAST_DELETE_FIELDS = Object.freeze([
  'id',
  'name',
  'region',
  'arch',
  'os',
  'kernel_version',
  'cpu_info',
  'cpu_cores',
  'expire_date',
  'server_group',
  'traffic_limit',
  'net_rx_monthly',
  'net_tx_monthly',
  'boot_time',
  'timestamp',
  'ip_v4',
  'ip_v6'
]);

export const HISTORY_TABLE_COLUMNS = Object.freeze([
  ['id', 'INTEGER PRIMARY KEY'],
  ['server_id', 'TEXT NOT NULL'],
  ['timestamp', 'INTEGER DEFAULT 0'],
  ['agent_version', "TEXT DEFAULT ''"],
  ['cpu', 'REAL DEFAULT 0'],
  ['load_avg', "TEXT DEFAULT '0'"],
  ['net_in_speed', 'REAL DEFAULT 0'],
  ['net_out_speed', 'REAL DEFAULT 0'],
  ['net_rx', 'REAL DEFAULT 0'],
  ['net_tx', 'REAL DEFAULT 0'],
  ['processes', 'INTEGER DEFAULT 0'],
  ['tcp_conn', 'INTEGER DEFAULT 0'],
  ['udp_conn', 'INTEGER DEFAULT 0'],
  ['ping_ct', 'INTEGER DEFAULT 0'],
  ['ping_cu', 'INTEGER DEFAULT 0'],
  ['ping_cm', 'INTEGER DEFAULT 0'],
  ['ping_bd', 'INTEGER DEFAULT 0'],
  ['ping_node_1', 'INTEGER DEFAULT 0'],
  ['ping_node_2', 'INTEGER DEFAULT 0'],
  ['ping_node_3', 'INTEGER DEFAULT 0'],
  ['ping_node_4', 'INTEGER DEFAULT 0'],
  ['loss_ct', 'INTEGER DEFAULT NULL'],
  ['loss_cu', 'INTEGER DEFAULT NULL'],
  ['loss_cm', 'INTEGER DEFAULT NULL'],
  ['loss_bd', 'INTEGER DEFAULT NULL'],
  ['loss_node_1', 'INTEGER DEFAULT NULL'],
  ['loss_node_2', 'INTEGER DEFAULT NULL'],
  ['loss_node_3', 'INTEGER DEFAULT NULL'],
  ['loss_node_4', 'INTEGER DEFAULT NULL'],
  ['ram_total', 'REAL DEFAULT 0'],
  ['ram_used', 'REAL DEFAULT 0'],
  ['swap_total', 'REAL DEFAULT 0'],
  ['swap_used', 'REAL DEFAULT 0'],
  ['disk_total', 'REAL DEFAULT 0'],
  ['disk_used', 'REAL DEFAULT 0'],
  ['disk_read_bps', 'REAL'],
  ['disk_write_bps', 'REAL'],
  ['disk_read_iops', 'REAL'],
  ['disk_write_iops', 'REAL'],
  ['disk_await_ms', 'REAL'],
  ['disk_util', 'REAL'],
  ['cpu_cores', 'INTEGER DEFAULT 0'],
  ['cpu_info', "TEXT DEFAULT ''"],
  ['gpu_info', "TEXT DEFAULT ''"],
  ['arch', "TEXT DEFAULT ''"],
  ['os', "TEXT DEFAULT ''"],
  ['kernel_version', "TEXT DEFAULT ''"],
  ['region', "TEXT DEFAULT ''"],
  ['ip_v4', "TEXT DEFAULT '0'"],
  ['ip_v6', "TEXT DEFAULT '0'"],
  ['boot_time', "TEXT DEFAULT ''"],
  ['net_rx_monthly', 'REAL DEFAULT 0'],
  ['net_tx_monthly', 'REAL DEFAULT 0'],
  ['egress_city', "TEXT DEFAULT ''"],
  ['egress_region', "TEXT DEFAULT ''"],
  ['egress_region_code', "TEXT DEFAULT ''"],
  ['egress_country', "TEXT DEFAULT ''"],
  ['egress_latitude', 'REAL DEFAULT NULL'],
  ['egress_longitude', 'REAL DEFAULT NULL']
]);

export const HISTORY_INSERT_COLUMNS = Object.freeze(
  HISTORY_TABLE_COLUMNS.map(([name]) => name)
);

export const HISTORY_UPGRADE_COLUMNS = Object.freeze(Object.fromEntries(
  HISTORY_TABLE_COLUMNS
    .filter(([name]) => !['id', 'server_id', 'timestamp', 'cpu', 'load_avg', 'net_in_speed', 'net_out_speed', 'net_rx', 'net_tx', 'processes', 'tcp_conn', 'udp_conn', 'ping_ct', 'ping_cu', 'ping_cm', 'ping_bd', 'ram_total', 'ram_used', 'swap_total', 'swap_used', 'disk_total', 'disk_used'].includes(name))
    .map(([name, definition]) => [name, definition])
));

export function createHistoryTableSql(tableName = 'metrics_history') {
  const columnDefinitions = HISTORY_TABLE_COLUMNS
    .map(([name, definition]) => `          ${name} ${definition}`)
    .join(',\n');

  return `
        CREATE TABLE IF NOT EXISTS ${tableName} (
${columnDefinitions}
        )
      `;
}
