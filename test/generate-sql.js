#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function generateMetrics(baseTimestamp, serverIdx, hourOffset) {
  const baseHour = (new Date(baseTimestamp).getHours() + hourOffset / 60) % 24;
  
  const timeFactor = 1 - 0.3 * Math.cos((baseHour - 9) * Math.PI / 12);
  
  const baselines = [
    { cpu: 35, ram: 45, ping: 80, load_avg: 1.2, gpu: 42 },
    { cpu: 25, ram: 35, ping: 35, load_avg: 0.8, gpu: 28 }
  ];
  
  const baseline = baselines[serverIdx];
  const cpuNoise = (Math.random() - 0.5) * 20;
  const ramNoise = (Math.random() - 0.5) * 10;
  const pingNoise = (Math.random() - 0.5) * 15;
  const gpuNoise = (Math.random() - 0.5) * 25;
  
  const cpu = Math.max(5, Math.min(95, baseline.cpu * timeFactor + cpuNoise));
  const ram = Math.max(10, Math.min(90, baseline.ram * timeFactor + ramNoise));
  const gpu = Math.max(0, Math.min(100, baseline.gpu * timeFactor + gpuNoise));
  const ramTotal = serverIdx === 0 ? 32768 : 16384;
  const ramUsed = ramTotal * (ram / 100);
  
  return {
    cpu: cpu.toFixed(2),
    ram_total: ramTotal.toString(),
    ram_used: Math.floor(ramUsed).toString(),
    swap_total: '8192',
    swap_used: Math.floor(Math.random() * 512).toString(),
    disk_total: (serverIdx === 0 ? 200 : 100).toString(),
    disk_used: '90',
    load_avg: `${(baseline.load_avg + (Math.random() - 0.5) * 0.8).toFixed(2)} ${(baseline.load_avg + (Math.random() - 0.5) * 0.6).toFixed(2)} ${(baseline.load_avg + (Math.random() - 0.5) * 0.4).toFixed(2)}`,
    net_rx: Math.floor(Math.random() * 10000 + 5000).toString(),
    net_tx: Math.floor(Math.random() * 5000 + 2500).toString(),
    net_rx_monthly: Math.floor(Math.random() * 1000000000 + 500000000).toString(),
    net_tx_monthly: Math.floor(Math.random() * 500000000 + 250000000).toString(),
    net_in_speed: Math.floor(Math.random() * 10000000 + 20).toString(),
    net_out_speed: Math.floor(Math.random() * 10).toString(),
    processes: (100 + Math.floor(Math.random() * 50)).toString(),
    tcp_conn: (Math.floor(Math.random() * 100)).toString(),
    udp_conn: (Math.floor(Math.random() * 3)).toString(),
    ping_ct: Math.round(Math.max(10, baseline.ping * 1.2 + pingNoise)).toString(),
    ping_cu: Math.round(Math.max(10, baseline.ping + pingNoise)).toString(),
    ping_cm: Math.round(Math.max(10, baseline.ping * 1.1 + pingNoise)).toString(),
    ping_bd: Math.round(Math.max(10, baseline.ping * 1.5 + pingNoise)).toString(),
    loss_ct: Math.floor(Math.random() * (serverIdx === 0 ? 8 : 3)).toString(),
    loss_cu: Math.floor(Math.random() * (serverIdx === 0 ? 12 : 4)).toString(),
    loss_cm: Math.floor(Math.random() * (serverIdx === 0 ? 10 : 5)).toString(),
    loss_bd: Math.floor(Math.random() * (serverIdx === 0 ? 15 : 6)).toString(),
    ip_v4: '1',
    ip_v6: serverIdx === 0 ? '1' : '0',
    cpu_cores: serverIdx === 0 ? '4' : '2',
    cpu_info: serverIdx === 0 ? 'Intel Xeon E5-2680 v4' : 'AMD EPYC 7742',
    gpu: gpu.toFixed(2),
    gpu_info: serverIdx === 0 ? 'NVIDIA Tesla T4' : 'AMD Radeon Pro V620',
    arch: 'x86_64',
    os: serverIdx === 0 ? 'Ubuntu 22.04 LTS' : 'Debian 12',
    boot_time: (Date.now() - (serverIdx === 0 ? 86400000 * 600 : 86400000 * 15)).toString(),
    region: serverIdx === 0 ? 'US' : 'JP',
  };
}

const now = Date.now();

const servers = [
  {
    id: '550e8400-e29b-41d4-a716-446655440001',
    name: 'US-East-Fast',
    server_group: 'Production',
    price: '$15/mo',
    expire_date: '2026-12-31',
    bandwidth: '1Gbps',
    traffic_limit: '2TB',
    is_hidden: '0',
    sort_order: 0
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440002',
    name: 'JP-Tokyo-Stable',
    server_group: 'Production',
    price: '$10/mo',
    expire_date: '2026-06-30',
    bandwidth: '500Mbps',
    traffic_limit: '1TB',
    is_hidden: '1',
    sort_order: 1
  }
];

let sql = `-- CF Server Monitor 模拟数据
-- 生成时间: ${new Date().toISOString()}

-- 清空现有数据（注意顺序：先删子表，再删主表）
DROP TABLE IF EXISTS metrics_history;
DROP TABLE IF EXISTS metrics_history_old;
DROP TABLE IF EXISTS servers;
DROP TABLE IF EXISTS settings;

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY, 
  value TEXT
);

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
);

-- 这里模拟不插入history_partition_id和timestamp

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
);
-- 模拟外键

-- 插入系统配置
`;

const appearanceOptions = {
  site_title: 'Test',
  custom_bg: 'https://cdn.nodeimage.com/i/fux0OSoFzVZQsn9uZmSDbIpKzZw2r8GW.webp',
  custom_head: '<meta content="test">',
  custom_script: 'console.log("Hello, World!");'
};

const siteOptions = {
  username: 'admin',
  is_public: 'true',
  show_price: 'true',
  show_expire: 'true',
  show_bw: 'true',
  show_tf: 'true',
  show_time: 'true',
  show_long_history: 'true',
  tg_notify: 'false',
  tg_bot_token: '',
  tg_chat_id: '',
  turnstile_site_key: '0x4AAAAAADnx_ErgRBFcm5Il'
};

sql += `INSERT INTO settings (key, value) VALUES ('appearance_options', '${JSON.stringify(appearanceOptions)}');\n`;
sql += `INSERT INTO settings (key, value) VALUES ('site_options', '${JSON.stringify(siteOptions)}');\n`;

sql += `\n-- 插入服务器数据\n`;

const serverLatestMetrics = {};

for (const server of servers) {
  sql += `INSERT INTO servers (
    id, name, server_group, price, expire_date, bandwidth, traffic_limit, is_hidden, sort_order
  ) VALUES (
    '${server.id}', '${server.name}', '${server.server_group}', '${server.price}', 
    '${server.expire_date}', '${server.bandwidth}', '${server.traffic_limit}', 
    '${server.is_hidden}', ${server.sort_order}
  );\n`;
}

sql += `\n-- 生成历史指标数据\n`;

const serverConfigs = [
  { hoursBack: 24, intervals: [
      { minutes: 10, interval: 60 },      // 前10分钟: 每分钟
      { minutes: Infinity, interval: 60 } // 之后: 每10分钟
    ]},
  { hoursBack: 24 * 7, intervals: [
      { minutes: 10, interval: 60 },      // 前10分钟: 每分钟
      { minutes: 60, interval: 60 }, // 1小时后: 每20分钟
      { minutes: 120, interval: 200 }, // 2小时后: 每20分钟
      { minutes: Infinity, interval: 400 } // 之后: 每40分钟
    ]}
];

function getInterval(config, minutesBack) {
  for (const item of config.intervals) {
    if (minutesBack <= item.minutes) {
      return item.interval;
    }
  }
  return config.intervals[config.intervals.length - 1].interval;
}

for (let s = 0; s < servers.length; s++) {
  const server = servers[s];
  const config = serverConfigs[s];

  const startTime = now - config.hoursBack * 60 * 60 * 1000;

  let latestTs = 0;
  let latestMetrics = null;

  const rows = [];

  let ts = now;

  while (ts >= startTime) {

    const minutesBack = (now - ts) / 60000;

    const intervalSeconds = getInterval(
      config,
      minutesBack
    );

    const hourOffset =
      (now - ts) / (60 * 60 * 1000);

    const metrics =
      generateMetrics(now, s, hourOffset);

    rows.push(`
INSERT INTO metrics_history (
  server_id, timestamp, cpu, load_avg,
  net_in_speed, net_out_speed, net_rx, net_tx,
  processes, tcp_conn, udp_conn,
  ping_ct, ping_cu, ping_cm, ping_bd,
  loss_ct, loss_cu, loss_cm, loss_bd,
  ram_total, ram_used, swap_total, swap_used,
  disk_total, disk_used,
  cpu_cores, cpu_info, gpu, gpu_info, arch, os,
  ip_v4, ip_v6, boot_time,
  net_rx_monthly, net_tx_monthly,
  region
) VALUES (
  '${server.id}',
  ${ts},
  ${parseFloat(metrics.cpu)},
  '${metrics.load_avg}',
  ${parseFloat(metrics.net_in_speed)},
  ${parseFloat(metrics.net_out_speed)},
  ${parseFloat(metrics.net_rx)},
  ${parseFloat(metrics.net_tx)},
  ${parseInt(metrics.processes)},
  ${parseInt(metrics.tcp_conn)},
  ${parseInt(metrics.udp_conn)},
  ${parseInt(metrics.ping_ct)},
  ${parseInt(metrics.ping_cu)},
  ${parseInt(metrics.ping_cm)},
  ${parseInt(metrics.ping_bd)},
  ${parseInt(metrics.loss_ct)},
  ${parseInt(metrics.loss_cu)},
  ${parseInt(metrics.loss_cm)},
  ${parseInt(metrics.loss_bd)},
  ${parseFloat(metrics.ram_total)},
  ${parseFloat(metrics.ram_used)},
  ${parseFloat(metrics.swap_total)},
  ${parseFloat(metrics.swap_used)},
  ${parseFloat(metrics.disk_total)},
  ${parseFloat(metrics.disk_used)},
  ${parseInt(metrics.cpu_cores)},
  '${metrics.cpu_info}',
  ${parseFloat(metrics.gpu)},
  '${metrics.gpu_info}',
  '${metrics.arch}',
  '${metrics.os}',
  '${metrics.ip_v4}',
  '${metrics.ip_v6}',
  '${metrics.boot_time}',
  ${parseFloat(metrics.net_rx_monthly)},
  ${parseFloat(metrics.net_tx_monthly)},
  '${metrics.region}'
);
`);

    if (ts > latestTs) {
      latestTs = ts;
      latestMetrics = metrics;
    }

    ts -= intervalSeconds * 1000;
  }

  rows.reverse();

  sql += rows.join('\n');

  serverLatestMetrics[server.id] = {
    ts: latestTs,
    metrics: latestMetrics
  };
}

const outputPath = path.join(__dirname, 'mock-data.sql');
fs.writeFileSync(outputPath, sql);

console.log('✅ SQL 文件生成成功:', outputPath);
console.log('\n📝 使用说明:');
console.log('  1. 确保你有 wrangler.toml 配置好 D1 数据库');
console.log('  2. 创建本地 D1 数据库: wrangler d1 create server-monitor-db');
console.log('  3. 初始化数据库结构（如果还没）: 访问一次 http://localhost:8787');
console.log('  4. 或者直接执行 SQL: wrangler d1 execute server-monitor-db --file=test/mock-data.sql');
console.log('  5. 然后运行: npm run dev');