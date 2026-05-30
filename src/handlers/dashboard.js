import { checkAuth, authResponse } from '../middleware/auth.js';
import { formatBytes, getPingColor } from '../utils/format.js';
import { getThemeStyles, getFooterHtml } from '../themes/styles.js';
import { handleServerDetail } from './server-detail.js';
import { getLatestMetrics, getLatestMetricsForAllServers } from '../database/schema.js';

export async function handleServerAPI(request, env, sys) {
  if (sys.is_public !== 'true' && !checkAuth(request, env)) {
    return authResponse(sys.site_title);
  }
  
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  
  if (!id) return new Response('Missing ID', { status: 400 });
  
  const isLoggedIn = checkAuth(request, env);
  let query = 'SELECT * FROM servers WHERE id = ?';
  if (!isLoggedIn) {
    query += " AND is_hidden != '1'";
  }
  
  const server = await env.DB.prepare(query).bind(id).first();
  if (!server) return new Response('Not Found', { status: 404 });
  
  const latestMetrics = await getLatestMetrics(env.DB, id);
  
  if (latestMetrics) {
    server.cpu = latestMetrics.cpu || 0;
    server.ram = latestMetrics.ram || 0;
    server.disk = latestMetrics.disk || 0;
    server.load_avg = latestMetrics.load_avg || '0';
    server.net_in_speed = latestMetrics.net_in_speed || 0;
    server.net_out_speed = latestMetrics.net_out_speed || 0;
    server.net_rx = latestMetrics.net_rx || 0;
    server.net_tx = latestMetrics.net_tx || 0;
    server.processes = latestMetrics.processes || 0;
    server.tcp_conn = latestMetrics.tcp_conn || 0;
    server.udp_conn = latestMetrics.udp_conn || 0;
    server.ping_ct = latestMetrics.ping_ct || 0;
    server.ping_cu = latestMetrics.ping_cu || 0;
    server.ping_cm = latestMetrics.ping_cm || 0;
    server.ping_bd = latestMetrics.ping_bd || 0;
    server.ram_total = latestMetrics.ram_total || 0;
    server.ram_used = latestMetrics.ram_used || 0;
    server.swap_total = latestMetrics.swap_total || 0;
    server.swap_used = latestMetrics.swap_used || 0;
    server.disk_total = latestMetrics.disk_total || 0;
    server.disk_used = latestMetrics.disk_used || 0;
    server.last_updated = latestMetrics.timestamp || 0;
  }
  
  return new Response(JSON.stringify(server), { 
    headers: { 'Content-Type': 'application/json' } 
  });
}

export async function handleServersAPI(request, env, sys) {
  if (sys.is_public !== 'true' && !checkAuth(request, env)) {
    return authResponse(sys.site_title);
  }

  const isLoggedIn = checkAuth(request, env);
  
  let query = 'SELECT * FROM servers';
  if (!isLoggedIn) {
    query += " WHERE is_hidden != '1'";
  }
  query += ' ORDER BY sort_order ASC';
  
  const { results } = await env.DB.prepare(query).all();
  
  const latestMetricsMap = await getLatestMetricsForAllServers(env.DB);
  
  const now = Date.now();
  let globalOnline = 0;
  let globalSpeedIn = 0, globalSpeedOut = 0, globalNetTx = 0, globalNetRx = 0;
  const countryStats = {};
  
  for (const server of results) {
    const latestMetrics = latestMetricsMap.get(server.id);
    
    let lastUpdated = 0;
    let isOnline = false;
    
    if (latestMetrics) {
      lastUpdated = latestMetrics.timestamp;
      isOnline = (now - lastUpdated) < 300000;
      
      server.cpu = latestMetrics.cpu || 0;
      server.ram = latestMetrics.ram || 0;
      server.disk = latestMetrics.disk || 0;
      server.load_avg = latestMetrics.load_avg || '0';
      server.net_in_speed = latestMetrics.net_in_speed || 0;
      server.net_out_speed = latestMetrics.net_out_speed || 0;
      server.net_rx = latestMetrics.net_rx || 0;
      server.net_tx = latestMetrics.net_tx || 0;
      server.processes = latestMetrics.processes || 0;
      server.tcp_conn = latestMetrics.tcp_conn || 0;
      server.udp_conn = latestMetrics.udp_conn || 0;
      server.ping_ct = latestMetrics.ping_ct || 0;
      server.ping_cu = latestMetrics.ping_cu || 0;
      server.ping_cm = latestMetrics.ping_cm || 0;
      server.ping_bd = latestMetrics.ping_bd || 0;
      server.ram_total = latestMetrics.ram_total || 0;
      server.ram_used = latestMetrics.ram_used || 0;
      server.swap_total = latestMetrics.swap_total || 0;
      server.swap_used = latestMetrics.swap_used || 0;
      server.disk_total = latestMetrics.disk_total || 0;
      server.disk_used = latestMetrics.disk_used || 0;
      server.last_updated = lastUpdated;
    } else {
      lastUpdated = new Date(server.last_updated).getTime();
      isOnline = (now - lastUpdated) < 300000;
    }
    
    if (isOnline) {
      globalOnline++;
      globalSpeedIn += parseFloat(server.net_in_speed) || 0;
      globalSpeedOut += parseFloat(server.net_out_speed) || 0;
    }
    
    globalNetRx += parseFloat(server.net_rx || 0);
    globalNetTx += parseFloat(server.net_tx || 0);
    
    let cCode = (server.country || 'xx').toUpperCase();
    if (cCode === 'TW') cCode = 'CN';
    if (cCode !== 'XX') {
      countryStats[cCode] = (countryStats[cCode] || 0) + 1;
    }
  }
  
  const globalOffline = results.length - globalOnline;
  
  const data = {
    servers: results,
    stats: {
      total: results.length,
      online: globalOnline,
      offline: globalOffline,
      globalSpeedIn,
      globalSpeedOut,
      globalNetTx,
      globalNetRx
    },
    countryStats
  };
  
  return new Response(JSON.stringify(data), { 
    headers: { 'Content-Type': 'application/json' } 
  });
}

export async function handleDashboard(request, env, sys) {
  if (sys.is_public !== 'true' && !checkAuth(request, env)) {
    return authResponse(sys.site_title);
  }

  const lang = sys.lang === 'en' ? 'en' : 'zh';
const themeStyles = getThemeStyles(sys);
  
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${sys.site_title}</title>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" crossorigin=""/>
  <script id="map-data" type="application/json">{}</script>
  ${sys.custom_head || ''}
  <style>
    @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&display=swap');
    
    :root {
      --bg-primary: #0a0e14;
      --bg-secondary: #12171f;
      --bg-card: #151b24;
      --bg-hover: #1a2230;
      --border-color: #1e2a3a;
      --border-active: #2a3a4f;
      --text-primary: #d3dae3;
      --text-secondary: #8999af;
      --text-muted: #5c6d82;
      --accent-green: #00d4aa;
      --accent-blue: #4da6ff;
      --accent-purple: #b392f0;
      --accent-pink: #f778ba;
      --accent-yellow: #ffb870;
      --accent-red: #f85149;
      --accent-cyan: #39d2c0;
      --terminal-font: 'JetBrains Mono', 'Courier New', monospace;
    }
    
    * { box-sizing: border-box; margin: 0; padding: 0; }
    
    body { 
      font-family: var(--terminal-font);
      background: var(--bg-primary);
      color: var(--text-primary);
      min-height: 100vh;
      line-height: 1.5;
      position: relative;
      font-size: 13px;
    }
    
    body::before {
      content: '';
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: repeating-linear-gradient(
        0deg,
        transparent,
        transparent 2px,
        rgba(0, 0, 0, 0.03) 2px,
        rgba(0, 0, 0, 0.03) 4px
      );
      pointer-events: none;
      z-index: 9999;
    }
    
    .container { max-width: 1500px; margin: 0 auto; padding: 16px; position: relative; }
    
    /* 终端顶部栏 */
    .terminal-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 16px;
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 6px 6px 0 0;
      margin-bottom: 0;
      font-size: 12px;
      color: var(--text-secondary);
    }
    
    .terminal-dots {
      display: flex;
      gap: 8px;
    }
    
    .terminal-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
    }
    
    .terminal-dot.red { background: #ff5f56; }
    .terminal-dot.yellow { background: #ffbd2e; }
    .terminal-dot.green { background: #27c93f; }
    
    .terminal-title {
      color: var(--text-primary);
      font-weight: 600;
      font-size: 12px;
    }
    
    /* 导航区域 */
    .nav-area {
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-top: none;
      padding: 16px;
      margin-bottom: 20px;
    }
    
    .header-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 16px;
      flex-wrap: wrap;
      gap: 12px;
    }
    
    .site-title {
      font-size: 16px;
      font-weight: 700;
      color: var(--accent-green);
      text-shadow: 0 0 10px rgba(0, 212, 170, 0.3);
    }
    
    .controls-group {
      display: flex;
      gap: 12px;
      align-items: center;
      flex-wrap: wrap;
    }
    
    .view-toggle {
      display: flex;
      gap: 2px;
      background: var(--bg-card);
      border: 1px solid var(--border-color);
      border-radius: 4px;
      padding: 3px;
    }
    
    .toggle-btn {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      border: none;
      background: transparent;
      cursor: pointer;
      border-radius: 3px;
      font-size: 11px;
      font-weight: 600;
      color: var(--text-secondary);
      font-family: var(--terminal-font);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      transition: all 0.2s;
    }
    
    .toggle-btn:hover {
      background: var(--bg-hover);
      color: var(--text-primary);
    }
    
    .toggle-btn.active {
      background: var(--accent-green);
      color: #000;
    }
    
    .admin-link {
      padding: 6px 14px;
      background: var(--bg-card);
      border: 1px solid var(--border-color);
      color: var(--accent-cyan);
      text-decoration: none;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      transition: all 0.2s;
    }
    
    .admin-link:hover {
      background: var(--bg-hover);
      border-color: var(--border-active);
    }
    
    /* 过滤器栏 */
    .filter-bar {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-bottom: 16px;
    }
    
    .filter-tag {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 5px 12px;
      background: var(--bg-card);
      border: 1px solid var(--border-color);
      border-radius: 4px;
      font-size: 11px;
      font-weight: 500;
      color: var(--text-secondary);
      cursor: pointer;
      transition: all 0.2s;
      font-family: var(--terminal-font);
    }
    
    .filter-tag:hover {
      border-color: var(--border-active);
      color: var(--text-primary);
    }
    
    .filter-tag.active {
      background: var(--accent-green);
      color: #000;
      border-color: var(--accent-green);
      font-weight: 600;
    }
    
    .filter-tag img {
      border-radius: 1px;
    }
    
    /* 全局统计 */
    .global-stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 1px;
      background: var(--border-color);
      border: 1px solid var(--border-color);
      border-radius: 4px;
      overflow: hidden;
      margin-bottom: 20px;
    }
    
    .stat-item {
      background: var(--bg-card);
      padding: 14px 16px;
      text-align: center;
    }
    
    .stat-label {
      font-size: 10px;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-bottom: 6px;
    }
    
    .stat-main-value {
      font-size: 20px;
      font-weight: 700;
      color: var(--accent-cyan);
      text-shadow: 0 0 8px rgba(57, 210, 192, 0.3);
    }
    
    .stat-sub-info {
      font-size: 11px;
      color: var(--text-secondary);
      margin-top: 4px;
    }
    
    /* 视图面板 */
    .view-panel {
      display: none;
    }
    
    .view-panel.active {
      display: block;
    }
    
    /* 分组标题 */
    .group-section {
      margin-bottom: 24px;
    }
    
    .group-header {
      font-size: 13px;
      font-weight: 600;
      color: var(--accent-green);
      padding: 8px 0;
      margin-bottom: 12px;
      border-bottom: 1px solid var(--border-color);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    
    .prompt-sign {
      color: var(--text-muted);
    }
    
    .group-count {
      color: var(--text-muted);
      font-weight: 400;
      font-size: 11px;
    }
    
    /* 服务器卡片网格 */
    .servers-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
      gap: 12px;
    }
    
    /* 服务器卡片 */
    .server-card {
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 4px;
      padding: 16px;
      text-decoration: none;
      color: inherit;
      transition: all 0.2s;
      display: block;
    }
    
    .server-card:hover {
      border-color: var(--accent-cyan);
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
      transform: translateY(-2px);
    }
    
    .server-card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 12px;
    }
    
    .server-identity {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    
    .status-indicator {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    
    .server-name {
      font-weight: 600;
      font-size: 13px;
      color: var(--text-primary);
    }
    
    .status-label {
      font-size: 10px;
      font-weight: 700;
      padding: 2px 8px;
      border: 1px solid;
      border-radius: 3px;
      letter-spacing: 1px;
    }
    
    .server-meta {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
      font-size: 11px;
      color: var(--text-muted);
    }
    
    .card-meta {
      display: flex;
      gap: 12px;
    }
    
    .card-badges {
      display: flex;
      gap: 4px;
      flex-wrap: wrap;
    }
    
    .badge {
      padding: 2px 6px;
      border-radius: 3px;
      font-size: 9px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    
    .badge-bw { background: var(--accent-blue); color: #000; }
    .badge-tf { background: var(--accent-green); color: #000; }
    .badge-v4 { background: var(--accent-purple); color: #000; }
    .badge-v6 { background: var(--accent-pink); color: #000; }
    
    /* 统计条 */
    .server-stats {
      margin-bottom: 12px;
    }
    
    .stat-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 6px;
    }
    
    .stat-key {
      font-size: 10px;
      color: var(--text-muted);
      width: 35px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    
    .stat-bar-container {
      flex: 1;
      height: 4px;
      background: var(--border-color);
      border-radius: 2px;
      overflow: hidden;
    }
    
    .stat-bar-fill {
      height: 100%;
      border-radius: 2px;
      transition: width 0.3s ease;
    }
    
    .stat-value {
      font-size: 11px;
      color: var(--text-secondary);
      min-width: 40px;
      text-align: right;
      font-weight: 600;
    }
    
    .net-down { color: var(--accent-green); font-size: 10px; }
    .net-up { color: var(--accent-blue); font-size: 10px; }
    
    /* Ping面板 */
    .ping-panel {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 4px;
      padding: 8px;
      background: rgba(0, 0, 0, 0.2);
      border-radius: 4px;
      border: 1px solid var(--border-color);
    }
    
    .ping-item {
      text-align: center;
    }
    
    .ping-label {
      font-size: 9px;
      color: var(--text-muted);
      display: block;
      margin-bottom: 2px;
    }
    
    .ping-value {
      font-size: 10px;
      font-weight: 700;
    }
    
    /* 表格视图 */
    .table-container {
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 4px;
      overflow: hidden;
    }
    
    .terminal-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
    }
    
    .terminal-table th {
      background: var(--bg-card);
      padding: 10px 12px;
      text-align: left;
      color: var(--text-muted);
      font-weight: 600;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      border-bottom: 1px solid var(--border-color);
    }
    
    .terminal-table td {
      padding: 10px 12px;
      border-bottom: 1px solid var(--border-color);
      vertical-align: middle;
    }
    
    .terminal-table tr:hover {
      background: var(--bg-hover);
    }
    
    .table-stat {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    
    .os-label {
      font-size: 11px;
      color: var(--text-secondary);
    }
    
    .update-time {
      color: var(--text-muted);
      font-size: 11px;
    }
    
    /* 地图视图 */
    .map-wrapper {
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 4px;
      padding: 4px;
    }
    
    #map-container {
      width: 100%;
      height: 500px;
      border-radius: 4px;
      background: #1a1a2e;
    }
    
    /* 空状态 */
    .empty-state {
      text-align: center;
      color: var(--text-muted);
      padding: 40px;
      font-size: 13px;
    }
    
    .loading-state {
      text-align: center;
      color: var(--text-muted);
      padding: 40px;
      font-size: 13px;
    }
    
    ::-webkit-scrollbar {
      width: 8px;
      height: 8px;
    }
    
    ::-webkit-scrollbar-track {
      background: var(--bg-primary);
    }
    
    ::-webkit-scrollbar-thumb {
      background: var(--border-color);
      border-radius: 4px;
    }
    
    ::-webkit-scrollbar-thumb:hover {
      background: var(--border-active);
    }
    
    /* 响应式 */
    @media (max-width: 768px) {
      .container { padding: 8px; }
      .servers-grid { grid-template-columns: 1fr; }
      .global-stats { grid-template-columns: 1fr; }
      .ping-panel { grid-template-columns: repeat(2, 1fr); }
    }
    
    ${themeStyles}
  </style>
</head>
<body class="${sys.theme || 'theme1'}">
  <div class="container">
    <!-- 终端顶部模拟 -->
    <div class="terminal-header">
      <div class="terminal-dots">
        <span class="terminal-dot red"></span>
        <span class="terminal-dot yellow"></span>
        <span class="terminal-dot green"></span>
      </div>
      <div class="terminal-title">
        ${sys.site_title}
      </div>
      <div></div>
    </div>
    
    <!-- 导航区域 -->
    <div class="nav-area">
      <div class="header-row">
        <div class="site-title">$ ./${sys.site_title}</div>
        <div class="controls-group">
          <div class="view-toggle">
            <button class="toggle-btn active" id="btn-card" onclick="switchView('card')">
              ▣ CARDS
            </button>
            <button class="toggle-btn" id="btn-table" onclick="switchView('table')">
              ≡ TABLE
            </button>
            <button class="toggle-btn" id="btn-map" onclick="switchView('map')">
              ◉ MAP
            </button>
          </div>
          <a href="/admin" class="admin-link">⚙ ${sys.admin_title}</a>
        </div>
      </div>
      
      <div class="filter-bar" id="ajax-filters">
        <span class="filter-tag active" data-filter="all">[All] 0</span>
      </div>
    </div>

    <div class="global-stats" id="ajax-stats">
      <div class="stat-item">
        <div class="stat-label">Total Servers</div>
        <div class="stat-main-value">-</div>
        <div class="stat-sub-info">
          <span style="color:var(--accent-green);">ON:0</span> | 
          <span style="color:var(--accent-red);">OFF:0</span>
        </div>
      </div>
      <div class="stat-item">
        <div class="stat-label">Total Traffic</div>
        <div class="stat-main-value" style="font-size:16px;">- ↓ | ↑ -</div>
      </div>
      <div class="stat-item">
        <div class="stat-label">Real-time Speed</div>
        <div class="stat-main-value" style="font-size:16px;">
          <span style="color:var(--accent-green);">↓ -/s</span> | 
          <span style="color:var(--accent-blue);">↑ -/s</span>
        </div>
      </div>
    </div>

    <div id="view-card" class="view-panel active">
      <div id="ajax-cards">
        <div class="loading-state">[*] Loading data...</div>
      </div>
    </div>

    <div id="view-table" class="view-panel">
      <div class="table-container">
        <table class="terminal-table">
          <thead>
            <tr>
              <th>STAT</th>
              <th>HOSTNAME</th>
              <th>REGION</th>
              <th>ARCH/OS</th>
              <th>CPU</th>
              <th>RAM</th>
              <th>DISK</th>
              <th>↓ DL</th>
              <th>↑ UL</th>
              <th>↓ RX</th>
              <th>↑ TX</th>
              <th>UPDATE</th>
            </tr>
          </thead>
          <tbody id="ajax-table">
            <tr><td colspan="12" style="text-align:center; color:var(--text-muted);">[*] Loading data...</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 地图视图 -->
    <div id="view-map" class="view-panel">
      <div class="map-wrapper">
        <div id="map-container"></div>
      </div>
    </div>
    
    ${getFooterHtml()}
  </div>

  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" crossorigin=""></script>
  <script id="sys-config" type="application/json">${JSON.stringify({
    show_price: sys.show_price === 'true',
    show_expire: sys.show_expire === 'true',
    show_bw: sys.show_bw === 'true',
    show_tf: sys.show_tf === 'true'
  })}</script>
 <script>
    const DASHBOARD_LANG = '${lang}';

    const DASHBOARD_I18N = {
      zh: {
        'CARDS': '卡片',
        'TABLE': '表格',
        'MAP': '地图',
        '[All]': '[全部]',
        'All': '全部',

        'Total Servers': '服务器总数',
        'Total Traffic': '总流量',
        'Real-time Speed': '实时速度',

        'ONLINE': '在线',
        'OFFLINE': '离线',
        'ON:': '在线:',
        'OFF:': '离线:',

        'STAT': '状态',
        'HOSTNAME': '主机名',
        'REGION': '地区',
        'ARCH/OS': '架构/系统',
        'UPDATE': '更新',

        'Loading data...': '正在加载数据...',
        'No data available': '暂无数据',
        'TIMEOUT': '超时',
        'EXPIRED': '已过期',
        's ago': '秒前',

        'Default': '默认'
      },
      en: {}
    };

    function translateDashboardText(text) {
      const map = DASHBOARD_I18N[DASHBOARD_LANG] || {};
      let result = text;

      Object.entries(map)
        .sort((a, b) => b[0].length - a[0].length)
        .forEach(([from, to]) => {
          result = result.replaceAll(from, to);
        });

      return result;
    }

    function translateDashboardUI() {
      if (DASHBOARD_LANG !== 'zh') return;

      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode(node) {
            if (!node.nodeValue || !node.nodeValue.trim()) {
              return NodeFilter.FILTER_REJECT;
            }

            if (
              node.parentElement &&
              ['SCRIPT', 'STYLE', 'TEXTAREA'].includes(node.parentElement.tagName)
            ) {
              return NodeFilter.FILTER_REJECT;
            }

            return NodeFilter.FILTER_ACCEPT;
          }
        }
      );

      const nodes = [];
      while (walker.nextNode()) {
        nodes.push(walker.currentNode);
      }

      nodes.forEach(node => {
        node.nodeValue = translateDashboardText(node.nodeValue);
      });

      document.querySelectorAll('[title]').forEach(el => {
        el.setAttribute('title', translateDashboardText(el.getAttribute('title') || ''));
      });
    }

    let mapInitialized = false;
    let currentFilter = 'all';
    const sysConfig = JSON.parse(document.getElementById('sys-config').textContent);
    
    function formatBytes(bytes) {
      bytes = parseFloat(bytes) || 0;
      if (bytes === 0) return '0 B';
      const k = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
    
    function getPingColor(ping) {
      ping = parseInt(ping) || 0;
      if (ping === 0) return 'var(--accent-red)';
      if (ping < 100) return 'var(--accent-green)';
      if (ping < 200) return 'var(--accent-yellow)';
      return 'var(--accent-red)';
    }
    
    function renderFilters(countryStats, totalServers) {
      let html = '<span class="filter-tag active" data-filter="all">[All] ' + totalServers + '</span>';
      const sorted = Object.entries(countryStats).sort();
      for (const [code, count] of sorted) {
        const cLower = code.toLowerCase();
        html += '<span class="filter-tag" data-filter="' + cLower + '">';
        html += '<img src="https://flagcdn.com/16x12/' + cLower + '.png" alt="' + code + '"> ' + code + ' [' + count + ']';
        html += '</span>';
      }
      return html;
    }
    
    function renderCards(servers, now) {
      const groups = {};
      const groupOrder = [];
      for (const server of servers) {
        const grpName = server.server_group || 'Default';
        if (!groups[grpName]) {
          groups[grpName] = [];
          groupOrder.push(grpName);
        }
        groups[grpName].push(server);
      }
      
      if (groupOrder.length === 0) {
        return '<div class="empty-state">[!] 暂无服务器，请在 <a href="/admin" style="color: var(--accent-cyan);">后台管理</a> 中添加</div>';
      }
      
      let html = '';
      for (const grpName of groupOrder) {
        const grpServers = groups[grpName];
        html += '<div class="group-section">';
        html += '<div class="group-header" data-group="' + grpName + '">';
        html += '<span class="prompt-sign">#</span> ' + grpName + ' <span class="group-count">[' + grpServers.length + ']</span>';
        html += '</div>';
        html += '<div class="servers-grid">';
        
        for (const server of grpServers) {
          const lastUpdated = new Date(server.last_updated).getTime();
          const isOnline = (now - lastUpdated) < 300000;
          const statusColor = isOnline ? 'var(--accent-green)' : 'var(--accent-red)';
          const statusText = isOnline ? 'ONLINE' : 'OFFLINE';
          const cpu = parseFloat(server.cpu || 0).toFixed(1);
          const ram = parseFloat(server.ram || 0).toFixed(1);
          const disk = parseFloat(server.disk || 0).toFixed(1);
          const netInSpeed = formatBytes(server.net_in_speed);
          const netOutSpeed = formatBytes(server.net_out_speed);
          const totalRx = formatBytes(server.net_rx);
          const totalTx = formatBytes(server.net_tx);
          const cCode = (server.country || 'xx').toLowerCase();
          const flagHtml = cCode !== 'xx' 
            ? '<img src="https://flagcdn.com/24x18/' + cCode + '.png" alt="' + cCode + '" style="vertical-align: middle; margin-right: 5px; border-radius: 2px; filter: brightness(0.9);">' 
            : '🏳️';
          
          let metaHtml = '';
          if (sysConfig.show_price && server.price) {
            metaHtml += '<div class="card-meta">💰 ' + server.price + '</div>';
          }
          if (sysConfig.show_expire && server.expire_date) {
            const expTime = new Date(server.expire_date).getTime();
            if (!isNaN(expTime)) {
              const diff = expTime - now;
              const expireText = diff > 0 
                ? Math.ceil(diff / (1000 * 3600 * 24)) + 'd' 
                : '<span style="color:var(--accent-red);">EXPIRED</span>';
              metaHtml += '<div class="card-meta">📅 ' + expireText + '</div>';
            }
          }
          
          let badgesHtml = '';
          if (sysConfig.show_bw && server.bandwidth) 
            badgesHtml += '<span class="badge badge-bw">' + server.bandwidth + '</span>';
          if (sysConfig.show_tf && server.traffic_limit) 
            badgesHtml += '<span class="badge badge-tf">' + server.traffic_limit + '</span>';
          if (server.ip_v4 === '1') badgesHtml += '<span class="badge badge-v4">IPv4</span>';
          if (server.ip_v6 === '1') badgesHtml += '<span class="badge badge-v6">IPv6</span>';
          
          const pingHtml = '<div class="ping-panel">' +
            '<div class="ping-item"><span class="ping-label">CT</span><span class="ping-value" style="color:' + getPingColor(server.ping_ct) + '">' + (server.ping_ct === '0' ? 'TIMEOUT' : server.ping_ct + 'ms') + '</span></div>' +
            '<div class="ping-item"><span class="ping-label">CU</span><span class="ping-value" style="color:' + getPingColor(server.ping_cu) + '">' + (server.ping_cu === '0' ? 'TIMEOUT' : server.ping_cu + 'ms') + '</span></div>' +
            '<div class="ping-item"><span class="ping-label">CM</span><span class="ping-value" style="color:' + getPingColor(server.ping_cm) + '">' + (server.ping_cm === '0' ? 'TIMEOUT' : server.ping_cm + 'ms') + '</span></div>' +
            '<div class="ping-item"><span class="ping-label">BD</span><span class="ping-value" style="color:' + getPingColor(server.ping_bd) + '">' + (server.ping_bd === '0' ? 'TIMEOUT' : server.ping_bd + 'ms') + '</span></div>' +
          '</div>';
          
          html += '<a href="/?id=' + server.id + '" class="server-card" data-country="' + cCode + '">' +
            '<div class="server-card-header">' +
              '<div class="server-identity">' +
                '<div class="status-indicator" style="background:' + statusColor + '; box-shadow: 0 0 8px ' + statusColor + ';"></div>' +
                flagHtml +
                '<span class="server-name">' + server.name + '</span>' +
              '</div>' +
              '<span class="status-label" style="color:' + statusColor + '; border-color:' + statusColor + ';">' + statusText + '</span>' +
            '</div>' +
            '<div class="server-meta">' + metaHtml + '<div class="card-badges">' + badgesHtml + '</div></div>' +
            '<div class="server-stats">' +
              '<div class="stat-row"><span class="stat-key">CPU</span><div class="stat-bar-container"><div class="stat-bar-fill" style="width:' + cpu + '%; background: var(--accent-cyan);"></div></div><span class="stat-value">' + cpu + '%</span></div>' +
              '<div class="stat-row"><span class="stat-key">RAM</span><div class="stat-bar-container"><div class="stat-bar-fill" style="width:' + ram + '%; background: var(--accent-purple);"></div></div><span class="stat-value">' + ram + '%</span></div>' +
              '<div class="stat-row"><span class="stat-key">DISK</span><div class="stat-bar-container"><div class="stat-bar-fill" style="width:' + disk + '%; background: var(--accent-green);"></div></div><span class="stat-value">' + disk + '%</span></div>' +
              '<div class="stat-row"><span class="stat-key">NET</span><span class="net-down">▼ ' + netInSpeed + '/s</span><span class="net-up">▲ ' + netOutSpeed + '/s</span></div>' +
              '<div class="stat-row"><span class="stat-key">TRF</span><span class="net-down">▼ ' + totalRx + '</span><span class="net-up">▲ ' + totalTx + '</span></div>' +
            '</div>' +
            pingHtml +
          '</a>';
        }
        
        html += '</div></div>';
      }
      return html;
    }
    
    function renderTable(servers, now) {
      if (servers.length === 0) {
        return '<tr><td colspan="12" style="text-align:center; color:var(--text-muted);">[*] No data available</td></tr>';
      }
      
      let html = '';
      for (const server of servers) {
        const lastUpdated = new Date(server.last_updated).getTime();
        const isOnline = (now - lastUpdated) < 300000;
        const statusColor = isOnline ? 'var(--accent-green)' : 'var(--accent-red)';
        const cpu = parseFloat(server.cpu || 0).toFixed(1);
        const ram = parseFloat(server.ram || 0).toFixed(1);
        const disk = parseFloat(server.disk || 0).toFixed(1);
        const netInSpeed = formatBytes(server.net_in_speed);
        const netOutSpeed = formatBytes(server.net_out_speed);
        const totalRx = formatBytes(server.net_rx);
        const totalTx = formatBytes(server.net_tx);
        const cCode = (server.country || 'xx').toLowerCase();
        const flagHtml = cCode !== 'xx' 
          ? '<img src="https://flagcdn.com/24x18/' + cCode + '.png" alt="' + cCode + '" style="vertical-align: middle; border-radius: 2px; filter: brightness(0.9);">' 
          : '🏳️';
        const updateSec = Math.round((now - lastUpdated) / 1000);
        
        html += '<tr onclick="window.location.href=\\\'/?id=' + server.id + '\\\'" style="cursor:pointer;" data-country="' + cCode + '">' +
          '<td style="text-align:center;"><div class="status-indicator" style="background:' + statusColor + '; display:inline-block; margin:0; width:8px; height:8px;"></div></td>' +
          '<td><b>' + server.name + '</b></td>' +
          '<td>' + flagHtml + ' ' + cCode.toUpperCase() + '</td>' +
          '<td><span class="os-label">' + server.arch + ' / ' + (server.cpu_cores || 'N/A') + 'C</span></td>' +
          '<td><div class="table-stat"><div class="stat-bar-container" style="width:60px;"><div class="stat-bar-fill" style="width:' + cpu + '%; background: var(--accent-cyan);"></div></div><span>' + cpu + '%</span></div></td>' +
          '<td><div class="table-stat"><div class="stat-bar-container" style="width:60px;"><div class="stat-bar-fill" style="width:' + ram + '%; background: var(--accent-purple);"></div></div><span>' + ram + '%</span></div></td>' +
          '<td><div class="table-stat"><div class="stat-bar-container" style="width:60px;"><div class="stat-bar-fill" style="width:' + disk + '%; background: var(--accent-green);"></div></div><span>' + disk + '%</span></div></td>' +
          '<td>' + netInSpeed + '/s</td>' +
          '<td>' + netOutSpeed + '/s</td>' +
          '<td>' + totalRx + '</td>' +
          '<td>' + totalTx + '</td>' +
          '<td class="update-time">' + updateSec + 's ago</td>' +
        '</tr>';
      }
      return html;
    }
    
    function renderStats(stats) {
      return '<div class="stat-item">' +
        '<div class="stat-label">Total Servers</div>' +
        '<div class="stat-main-value">' + stats.total + '</div>' +
        '<div class="stat-sub-info">' +
          '<span style="color:var(--accent-green);">ON:' + stats.online + '</span> | ' +
          '<span style="color:var(--accent-red);">OFF:' + stats.offline + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="stat-item">' +
        '<div class="stat-label">Total Traffic</div>' +
        '<div class="stat-main-value" style="font-size:16px;">' + formatBytes(stats.globalNetRx) + ' ↓ | ↑ ' + formatBytes(stats.globalNetTx) + '</div>' +
      '</div>' +
      '<div class="stat-item">' +
        '<div class="stat-label">Real-time Speed</div>' +
        '<div class="stat-main-value" style="font-size:16px;">' +
          '<span style="color:var(--accent-green);">↓ ' + formatBytes(stats.globalSpeedIn) + '/s</span> | ' +
          '<span style="color:var(--accent-blue);">↑ ' + formatBytes(stats.globalSpeedOut) + '/s</span>' +
        '</div>' +
      '</div>';
    }

    function switchView(viewName) {
      document.querySelectorAll('.toggle-btn').forEach(btn => btn.classList.remove('active'));
      document.getElementById('btn-' + viewName).classList.add('active');
      document.querySelectorAll('.view-panel').forEach(panel => panel.classList.remove('active'));
      document.getElementById('view-' + viewName).classList.add('active');
      localStorage.setItem('monitor_preferred_view', viewName);

      if (viewName === 'map' && !mapInitialized) {
        initMap();
        mapInitialized = true;
      } else if (viewName === 'map' && window.myMap) {
        setTimeout(() => window.myMap.invalidateSize(), 100);
      }
    }

    function applyFilter() {
      const cards = document.querySelectorAll('.server-card');
      const rows = document.querySelectorAll('#ajax-table tr');
      
      cards.forEach(card => {
        const country = card.dataset.country;
        card.style.display = (currentFilter === 'all' || country === currentFilter) ? '' : 'none';
      });
      
      rows.forEach(row => {
        const country = row.dataset.country;
        if (country !== undefined) {
          row.style.display = (currentFilter === 'all' || country === currentFilter) ? '' : 'none';
        }
      });
      
      document.querySelectorAll('.group-section').forEach(section => {
        const visibleCards = section.querySelectorAll('.server-card:not([style*="display: none"])');
        section.style.display = visibleCards.length === 0 ? 'none' : '';
      });
    }

    const countryCoords = {
      'US': [37.09, -95.71], 'CN': [35.86, 104.19], 'JP': [36.20, 138.25], 'HK': [22.31, 114.16],
      'SG': [1.35, 103.81], 'KR': [35.90, 127.76], 'DE': [51.16, 10.45], 'GB': [55.37, -3.43],
      'NL': [52.13, 5.29], 'FR': [46.22, 2.21], 'CA': [56.13, -106.34], 'AU': [-25.27, 133.77],
      'IN': [20.59, 78.96], 'BR': [-14.23, -51.92], 'RU': [61.52, 105.31], 'ZA': [-30.55, 22.93],
      'TW': [23.69, 120.96], 'IT': [41.87, 12.56], 'SE': [60.12, 18.64], 'CH': [46.81, 8.22],
      'ES': [40.46, -3.74], 'PL': [51.91, 19.14], 'FI': [61.92, 25.74], 'NO': [60.47, 8.46],
      'DK': [56.26, 9.50], 'IE': [53.14, -7.69], 'AT': [47.51, 14.55], 'TR': [38.96, 35.24],
      'AE': [23.42, 53.84], 'MY': [4.21, 101.97], 'TH': [15.87, 100.99], 'VN': [14.05, 108.27],
      'PH': [12.87, 121.77], 'ID': [-0.78, 113.92]
    };

    const iso2To3 = {
      "US":"USA","CN":"CHN","JP":"JPN","HK":"HKG","SG":"SGP","KR":"KOR","DE":"DEU","GB":"GBR",
      "NL":"NLD","FR":"FRA","CA":"CAN","AU":"AUS","IN":"IND","BR":"BRA","RU":"RUS","ZA":"ZAF",
      "TW":"TWN","IT":"ITA","SE":"SWE","CH":"CHE","ES":"ESP","PL":"POL","FI":"FIN","NO":"NOR",
      "DK":"DNK","IE":"IRL","AT":"AUT","TR":"TUR","AE":"ARE","MY":"MYS","TH":"THA","VN":"VNM",
      "PH":"PHL","ID":"IDN"
    };

    let markersLayer, geoJsonLayer, worldGeoJson = null, currentMapDataStr = "";

    async function initMap() {
      window.myMap = L.map('map-container', {
        zoomControl: false,
        attributionControl: false,
        minZoom: 1
      }).setView([30, 10], 2);

      L.control.zoom({
        position: 'bottomright'
      }).addTo(window.myMap);

      try {
        const res = await fetch('https://cdn.jsdelivr.net/gh/johan/world.geo.json@master/countries.geo.json');
        worldGeoJson = await res.json();
        drawMarkers();
      } catch (e) {
        console.error("[ERROR] Map load failed", e);
      }
    }

    function drawMarkers() {
      if(!window.myMap || !worldGeoJson) return;

      const newDataStr = document.getElementById('map-data').textContent;
      if (currentMapDataStr === newDataStr) return;
      currentMapDataStr = newDataStr;

      if(geoJsonLayer) window.myMap.removeLayer(geoJsonLayer);
      if(markersLayer) markersLayer.clearLayers();
      else markersLayer = L.layerGroup().addTo(window.myMap);

      const data = JSON.parse(newDataStr);
      const isDark = true;

      const activeIso3 = {};
      for (const code in data) {
        if (iso2To3[code]) activeIso3[iso2To3[code]] = true;
      }

      geoJsonLayer = L.geoJSON(worldGeoJson, {
        style: function(feature) {
          const isActive = activeIso3[feature.id];
          return {
            fillColor: isActive ? '#00d4aa' : '#1e2a3a',
            weight: 1,
            opacity: 0.8,
            color: '#0a0e14',
            fillOpacity: isActive ? 0.4 : 0.2
          };
        }
      }).addTo(window.myMap);

      for (const [code, count] of Object.entries(data)) {
        if(countryCoords[code]) {
          const icon = L.divIcon({ 
            className: 'custom-map-marker', 
            html: '<div style="background:#00d4aa; color:#000; border-radius:50%; width:22px; height:22px; display:flex; align-items:center; justify-content:center; font-size:10px; font-weight:bold; border:2px solid #0a0e14; box-shadow:0 0 10px rgba(0,212,170,0.5); font-family:JetBrains Mono,monospace;">' + count + '</div>', 
            iconSize: [22,22] 
          });
          L.marker(countryCoords[code], {icon: icon}).addTo(markersLayer);
        }
      }
    }
    
    function bindFilterEvents() {
      document.querySelectorAll('.filter-tag').forEach(tag => {
        tag.addEventListener('click', function() {
          document.querySelectorAll('.filter-tag').forEach(t => t.classList.remove('active'));
          this.classList.add('active');
          currentFilter = this.dataset.filter;
          applyFilter();
        });
      });
    }

   document.addEventListener('DOMContentLoaded', () => {
   translateDashboardUI();

   const savedView = localStorage.getItem('monitor_preferred_view') || 'card';
   switchView(savedView);
   bindFilterEvents();
   refreshData();
 });

    async function refreshData() {
      try {
        const res = await fetch('/api/servers');
        if (!res.ok) throw new Error('Failed to fetch');
        const data = await res.json();
        const now = Date.now();
        
        document.getElementById('ajax-stats').innerHTML = renderStats(data.stats);
        document.getElementById('ajax-cards').innerHTML = renderCards(data.servers, now);
        document.getElementById('ajax-table').innerHTML = renderTable(data.servers, now);
        document.getElementById('ajax-filters').innerHTML = renderFilters(data.countryStats, data.stats.total);
        document.getElementById('map-data').textContent = JSON.stringify(data.countryStats);
        
      bindFilterEvents();
      applyFilter();
      drawMarkers();
      translateDashboardUI();
      } catch (e) {
        console.log('[INFO] Refresh pending...', e);
      }
    }

    setInterval(refreshData, 60000);
  </script>
  ${sys.custom_script || ''}
</body>
</html>`;

  return new Response(html, { 
    headers: { 'Content-Type': 'text/html;charset=UTF-8' } 
  });
}

export { handleServerDetail };
