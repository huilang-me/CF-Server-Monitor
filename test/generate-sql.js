#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 生成带有波动的指标数据
function generateMetrics(baseTimestamp, serverIdx, hourOffset) {
  const baseHour = (new Date(baseTimestamp).getHours() + hourOffset / 60) % 24;
  
  const timeFactor = 1 - 0.3 * Math.cos((baseHour - 9) * Math.PI / 12);
  
  const baselines = [
    { cpu: 35, ram: 45, ping: 80, load: 1.2 },
    { cpu: 25, ram: 35, ping: 35, load: 0.8 }
  ];
  
  const baseline = baselines[serverIdx];
  const cpuNoise = (Math.random() - 0.5) * 20;
  const ramNoise = (Math.random() - 0.5) * 10;
  const pingNoise = (Math.random() - 0.5) * 15;
  
  return {
    cpu: Math.max(5, Math.min(95, baseline.cpu * timeFactor + cpuNoise)),
    ram: Math.max(10, Math.min(90, baseline.ram * timeFactor + ramNoise)),
    disk: 45 + (Math.random() - 0.5) * 5,
    load_avg: (baseline.load + (Math.random() - 0.5) * 0.8).toFixed(2),
    net_in_speed: Math.random() * 80 + 20,
    net_out_speed: Math.random() * 40 + 10,
    net_rx: Math.random() * 10000 + 5000,
    net_tx: Math.random() * 5000 + 2500,
    processes: 100 + Math.floor(Math.random() * 50),
    tcp_conn: 50 + Math.floor(Math.random() * 100),
    udp_conn: 10 + Math.floor(Math.random() * 30),
    ping_ct: Math.round(Math.max(10, baseline.ping * 1.2 + pingNoise)),
    ping_cu: Math.round(Math.max(10, baseline.ping + pingNoise)),
    ping_cm: Math.round(Math.max(10, baseline.ping * 1.1 + pingNoise)),
    ping_bd: Math.round(Math.max(10, baseline.ping * 1.5 + pingNoise)),
    ram_total: serverIdx === 0 ? 32768 : 16384,
    ram_used: (serverIdx === 0 ? 32768 : 16384) * ((baseline.ram * timeFactor + ramNoise) / 100),
    swap_total: 8192,
    swap_used: Math.random() * 512,
    disk_total: serverIdx === 0 ? 200 : 100,
    disk_used: 90
  };
}

const now = Date.now();
const hoursBack = 72;

const servers = [
  {
    id: '550e8400-e29b-41d4-a716-446655440001',
    name: 'US-East-Fast',
    country: 'US',
    os: 'Ubuntu 22.04 LTS',
    cpu_info: 'Intel Xeon E5-2680 v4',
    cpu_cores: '4',
    arch: 'x86_64',
    ram_total: '32768',
    disk_total: '200',
    ip_v4: '1',
    ip_v6: '1',
    server_group: 'Production',
    price: '$15/mo',
    bandwidth: '1Gbps',
    traffic_limit: '2TB',
    report_interval: 60,
    boot_time: now - 86400000 * 30
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440002',
    name: 'JP-Tokyo-Stable',
    country: 'JP',
    os: 'Debian 12',
    cpu_info: 'AMD EPYC 7742',
    cpu_cores: '2',
    arch: 'x86_64',
    ram_total: '16384',
    disk_total: '100',
    ip_v4: '1',
    ip_v6: '0',
    server_group: 'Production',
    price: '$10/mo',
    bandwidth: '500Mbps',
    traffic_limit: '1TB',
    report_interval: 120,
    boot_time: now - 86400000 * 15
  }
];

let sql = `-- CF Server Monitor 模拟数据
-- 生成时间: ${new Date().toISOString()}

-- 清空现有数据（注意顺序：先删子表，再删主表）
DELETE FROM metrics_history;
DELETE FROM metrics_aggregated;
DELETE FROM servers;
DELETE FROM settings;

-- 插入系统配置
`;

const settings = {
  site_title: 'Server Monitor Pro',
  admin_title: 'Admin Panel',
  api_secret: 'local-dev-secret-change-this-in-production',
  is_public: 'false',
  theme: 'theme1',
  show_price: 'true',
  show_expire: 'true',
  show_bw: 'true',
  show_tf: 'true',
  custom_head: '',
  custom_script: '',
  last_cleanup: now.toString(),
  last_aggregated_to: (now - 60 * 60 * 1000).toString()
};

for (const [key, value] of Object.entries(settings)) {
  sql += `INSERT INTO settings (key, value) VALUES ('${key}', '${value}');\n`;
}

sql += `\n-- 插入服务器数据\n`;

const serverLatestMetrics = {};

for (const server of servers) {
  sql += `INSERT INTO servers (
    id, name, country, os, cpu_info, cpu_cores, arch, ram_total, disk_total, 
    ip_v4, ip_v6, server_group, price, bandwidth, traffic_limit, boot_time
  ) VALUES (
    '${server.id}', '${server.name}', '${server.country}', 
    '${server.os}', '${server.cpu_info}', '${server.cpu_cores}', '${server.arch}', 
    '${server.ram_total}', '${server.disk_total}', '${server.ip_v4}', 
    '${server.ip_v6}', '${server.server_group}', '${server.price}', 
    '${server.bandwidth}', '${server.traffic_limit}', ${server.boot_time}
  );\n`;
}

sql += `\n-- 生成历史指标数据\n`;

for (let s = 0; s < servers.length; s++) {
  const server = servers[s];
  const startTime = now - hoursBack * 60 * 60 * 1000;
  let latestTs = 0;
  let latestMetrics = null;
  
  for (let ts = startTime; ts <= now; ts += server.report_interval * 1000) {
    const hourOffset = (now - ts) / (60 * 60 * 1000);
    const metrics = generateMetrics(now, s, hourOffset);
    
    sql += `INSERT INTO metrics_history (
      server_id, timestamp, cpu, ram, disk, load_avg,
      net_in_speed, net_out_speed, net_rx, net_tx,
      processes, tcp_conn, udp_conn,
      ping_ct, ping_cu, ping_cm, ping_bd,
      ram_total, ram_used, swap_total, swap_used,
      disk_total, disk_used
    ) VALUES (
      '${server.id}', ${ts}, 
      ${metrics.cpu}, ${metrics.ram}, ${metrics.disk}, '${metrics.load_avg}',
      ${metrics.net_in_speed}, ${metrics.net_out_speed},
      ${metrics.net_rx}, ${metrics.net_tx},
      ${metrics.processes}, ${metrics.tcp_conn}, ${metrics.udp_conn},
      ${metrics.ping_ct}, ${metrics.ping_cu}, ${metrics.ping_cm}, ${metrics.ping_bd},
      ${metrics.ram_total}, ${metrics.ram_used},
      ${metrics.swap_total}, ${metrics.swap_used},
      ${metrics.disk_total}, ${metrics.disk_used}
    );\n`;
    
    if (ts > latestTs) {
      latestTs = ts;
      latestMetrics = metrics;
    }
  }
  
  serverLatestMetrics[server.id] = { ts: latestTs, metrics: latestMetrics };
}

sql += `\n-- 更新服务器最新状态\n`;

for (const [serverId, data] of Object.entries(serverLatestMetrics)) {
  const { ts, metrics } = data;
  const uptime = Math.floor((now - servers.find(s => s.id === serverId).boot_time) / 1000);
  
  sql += `UPDATE servers 
    SET cpu = '${metrics.cpu.toFixed(1)}', 
        ram = '${metrics.ram.toFixed(1)}', 
        disk = '${metrics.disk.toFixed(1)}', 
        load_avg = '${metrics.load_avg}', 
        net_in_speed = '${metrics.net_in_speed.toFixed(0)}', 
        net_out_speed = '${metrics.net_out_speed.toFixed(0)}',
        net_rx = '${metrics.net_rx.toFixed(0)}', 
        net_tx = '${metrics.net_tx.toFixed(0)}',
        processes = '${metrics.processes}', 
        tcp_conn = '${metrics.tcp_conn}', 
        udp_conn = '${metrics.udp_conn}',
        ping_ct = '${metrics.ping_ct.toFixed(0)}', 
        ping_cu = '${metrics.ping_cu.toFixed(0)}', 
        ping_cm = '${metrics.ping_cm.toFixed(0)}', 
        ping_bd = '${metrics.ping_bd.toFixed(0)}',
        ram_used = '${metrics.ram_used.toFixed(0)}', 
        swap_used = '${metrics.swap_used.toFixed(0)}', 
        disk_used = '${metrics.disk_used}',
        last_updated = ${ts}, 
        uptime = '${uptime}'
    WHERE id = '${serverId}';\n`;
}

const outputPath = path.join(__dirname, 'mock-data.sql');
fs.writeFileSync(outputPath, sql);

console.log('✅ SQL 文件生成成功:', outputPath);
console.log('\n📝 使用说明:');
console.log('  1. 确保你有 wrangler.toml 配置好 D1 数据库');
console.log('  2. 创建本地 D1 数据库: wrangler d1 create server-monitor-db --local');
console.log('  3. 初始化数据库结构（如果还没）: 访问一次 http://localhost:8787');
console.log('  4. 或者直接执行 SQL: wrangler d1 execute server-monitor-db --local --file=test/mock-data.sql');
console.log('  5. 然后运行: npm run dev');
