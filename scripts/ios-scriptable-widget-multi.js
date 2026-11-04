// CF Server Monitor - iOS Scriptable widget (multi-server)
// 基于 ios-scriptable-widget.js 改的：一个脚本里放多台服务器，单台时显示更多细节。
// Based on ios-scriptable-widget.js: several servers in one script, more details for a single server.
// Paste this file into Scriptable, then edit CONFIG.baseURL.
//
// 显示哪些服务器（小组件的 Parameter 优先，其次 CONFIG.servers）/ Which servers to show (widget parameter first, then CONFIG.servers):
//   留空 / all                  面板上所有公开的服务器，按面板排序 / all public servers, in panel order
//   server-a                    只显示一台（服务器 id 或面板里的名字都行）→ 详细视图 / one server (id or name) → detail view
//   server-a,server-b,server-c  显示多台（逗号或空格分隔）→ 列表视图 / several servers → list view
//   id:xxxx                     兼容原脚本的写法 / same syntax as the original script

const CONFIG = {
  baseURL: "https://www.example.com", //必填
  servers: [], //可选，填 id 或名字，例如 ["server-a", "server-b"]；留空 = 全部
  maxRows: { small: 3, medium: 3, large: 3 }, //列表视图每种尺寸最多显示几台，多的显示"还有 N 台"
  refreshMinutes: 5 //iOS 会自己限流，实际刷新间隔通常更长
};

CONFIG.baseURL = String(CONFIG.baseURL || "").replace(/\/+$/, "");

const family = config.widgetFamily || "medium";
const widgetParameter = String(args.widgetParameter || "").trim();
let SYS = {}; // /api/servers 的 sysConfig：三网名字、延迟窗口点数
const COL = {
  bg1: new Color("#0d1117"),
  bg2: new Color("#161b22"),
  fg: new Color("#e6edf3"),
  dim: new Color("#8b949e"),
  dim2: new Color("#6e7681"),
  green: new Color("#3fb950"),
  amber: new Color("#d29922"),
  red: new Color("#f85149"),
  blue: new Color("#58a6ff"),
  cyan: new Color("#39d2c0"),
  track: new Color("#ffffff", 0.12),
  card: new Color("#ffffff", 0.055),
  ct: new Color("#58a6ff"),
  cu: new Color("#f0883e"),
  cm: new Color("#3fb950")
};

function normalizeServerId(value) {
  const raw = String(value || "").trim();
  const matched = raw.match(/^(?:id|server):(.+)$/i);
  if (matched) return matched[1].trim();
  return raw;
}

// 返回要显示的服务器列表（id 或名字），空数组 = 全部
function wantedServers() {
  const source = widgetParameter || (CONFIG.servers || []).join(",");
  if (/^all$/i.test(source.trim())) return [];
  return source.split(/[,，\s]+/).map(normalizeServerId).filter(Boolean);
}

function getFlagRegionCode(region) {
  const code = String(region || "").trim().toUpperCase();
  if (!code || code === "XX") return "";
  if (code === "TW" || code === "HK" || code === "MO") return "cn";
  return code.toLowerCase();
}

async function fetchFlagImage(region) {
  const code = getFlagRegionCode(region);
  if (!code) return null;
  try {
    const req = new Request(`https://flagcdn.com/24x18/${code}.png`);
    req.timeoutInterval = 5;
    return await req.loadImage();
  } catch (e) {
    return null;
  }
}

function normalizeTimestamp(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n < 10000000000 ? n * 1000 : n;
}

function lastSeen(server) {
  return normalizeTimestamp(server.report_timestamp || server.last_updated || server.timestamp);
}

function isOnline(server) {
  const ts = lastSeen(server);
  return ts > 0 && Date.now() - ts < 300000;
}

function percent(used, total) {
  const u = Number(used) || 0;
  const t = Number(total) || 0;
  return t > 0 ? (u / t) * 100 : 0;
}

function clampPercent(value) {
  return Math.max(0, Math.min(100, Number(value) || 0));
}

function usageColor(p) {
  return p < 60 ? COL.green : p < 85 ? COL.amber : COL.red;
}

function formatBytes(bytes) {
  let n = Math.abs(Number(bytes) || 0);
  if (n === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  const v = n.toFixed(1);
  return `${v} ${units[i]}`;
}

// 面板里内存和磁盘的单位是 MB
function formatMB(mb) {
  return formatBytes((Number(mb) || 0) * 1024 * 1024);
}

// 列表里空间小，用紧凑写法：1.2G、345K
function shortBytes(bytes) {
  const text = formatBytes(bytes).replace(/^(\d{3,})\.\d/, "$1");
  return text.replace(/\.0 /, " ").replace(/ ([KMGT])?B$/, (m, u) => u || "B");
}

function formatDuration(ms) {
  const min = Math.floor((Number(ms) || 0) / 60000);
  if (min <= 0) return "";
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  if (d > 0) return `${d}天${h}时`;
  if (h > 0) return `${h}时${min % 60}分`;
  return `${min}分`;
}

function uptimeText(server) {
  const boot = normalizeTimestamp(server.boot_time);
  return boot > 0 ? formatDuration(Date.now() - boot) : "";
}

function daysLeft(server) {
  const m = String(server.expire_date || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const end = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Math.ceil((end.getTime() - Date.now()) / 86400000);
}

function expiryColor(days) {
  return days <= 7 ? COL.red : days <= 30 ? COL.amber : COL.dim;
}

function pingParts(server) {
  const parts = [];
  for (const [key, label] of [["ct", "电"], ["cu", "联"], ["cm", "移"], ["bd", "百"]]) {
    const ping = Number(server[`ping_${key}`]);
    if (server[`ping_${key}`] === false || !Number.isFinite(ping) || ping <= 0) continue;
    const loss = Number(server[`loss_${key}`]) || 0;
    parts.push(`${label}${Math.round(ping)}${loss > 0 ? `(${Math.round(loss)}%)` : ""}`);
  }
  return parts;
}

function trafficUsedBytes(server) {
  const rx = Number(server.net_rx_monthly) || 0;
  const tx = Number(server.net_tx_monthly) || 0;
  const type = server.traffic_calc_type || "total";
  if (type === "dl") return rx;
  if (type === "ul") return tx;
  if (type === "max") return Math.max(rx, tx);
  return rx + tx;
}

function trafficLimitBytes(value) {
  const raw = String(value || "").trim().toUpperCase();
  if (!raw) return 0;
  const n = parseFloat(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (raw.includes("TB")) return n * 1024 * 1024 * 1024 * 1024;
  if (raw.includes("GB")) return n * 1024 * 1024 * 1024;
  if (raw.includes("MB")) return n * 1024 * 1024;
  return n * 1024 * 1024 * 1024;
}

function trafficPercent(server) {
  const limit = trafficLimitBytes(server.traffic_limit);
  if (limit <= 0) return 0;
  return percent(trafficUsedBytes(server), limit);
}

function hhmm(date) {
  const d = date ? new Date(date) : new Date();
  const p = (n) => (n < 10 ? "0" : "") + n;
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

async function fetchJSON(path) {
  const req = new Request(CONFIG.baseURL + path);
  req.timeoutInterval = 15;
  return await req.loadJSON();
}

async function fetchServer(id) {
  const data = await fetchJSON(`/api/server?id=${encodeURIComponent(id)}`) || {};
  if (data.error) throw new Error(`${id}: ${data.error}`);
  return data.data && typeof data.data === "object" ? data.data : data;
}

// 一次请求 /api/servers 拿到所有公开服务器；指定了但列表里没有的（比如隐藏的），再按 id 单独请求
async function fetchServers(wanted) {
  const list = await fetchJSON("/api/servers") || {};
  if (list.error) throw new Error(list.error);
  const all = (list.servers || []).slice().sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0));
  const sysConfig = list.sysConfig || {};
  if (!wanted.length) return { servers: all, sysConfig };

  const servers = await Promise.all(wanted.map(async (key) => {
    const lower = key.toLowerCase();
    const found = all.find((s) => String(s.id).toLowerCase() === lower || String(s.name || "").toLowerCase() === lower);
    if (found) return found;
    try {
      return await fetchServer(key);
    } catch (e) {
      return { id: key, name: key, _missing: true };
    }
  }));
  return { servers, sysConfig };
}

// 上次成功的数据存在本机缓存里，网络出错时先显示旧数据
function cachePath(wanted) {
  const fm = FileManager.local();
  const key = (wanted.join("_") || "all").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80) || "custom";
  return { fm, path: fm.joinPath(fm.cacheDirectory(), `cfsm-widget-${key}.json`) };
}

function saveCache(wanted, result) {
  try {
    const { fm, path } = cachePath(wanted);
    fm.writeString(path, JSON.stringify({ savedAt: Date.now(), ...result }));
  } catch (e) {}
}

function loadCache(wanted) {
  try {
    const { fm, path } = cachePath(wanted);
    if (!fm.fileExists(path)) return null;
    return JSON.parse(fm.readString(path));
  } catch (e) {
    return null;
  }
}

async function loadServers() {
  const wanted = wantedServers();
  let result;
  let staleAt = 0;
  try {
    result = await fetchServers(wanted);
    saveCache(wanted, result);
  } catch (e) {
    const cached = loadCache(wanted);
    if (!cached || !cached.servers) throw e;
    result = cached;
    staleAt = cached.savedAt;
  }
  const servers = result.servers;
  SYS = result.sysConfig || {};

  await Promise.all(servers.map(async (server) => {
    server._flagRegionCode = getFlagRegionCode(server.region);
    server._flagImage = await fetchFlagImage(server.region);
  }));
  const online = servers.filter(isOnline).length;
  return {
    servers,
    stats: { total: servers.length, online, offline: servers.length - online },
    single: wanted.length === 1,
    staleAt
  };
}

function baseWidget() {
  const w = new ListWidget();
  const bg = new LinearGradient();
  bg.colors = [COL.bg1, COL.bg2];
  bg.locations = [0, 1];
  w.backgroundGradient = bg;
  if (CONFIG.baseURL) w.url = CONFIG.baseURL;
  w.refreshAfterDate = new Date(Date.now() + (Number(CONFIG.refreshMinutes) || 5) * 60 * 1000);
  return w;
}

function barImg(value, width, height, color) {
  const p = clampPercent(value);
  const dc = new DrawContext();
  dc.size = new Size(width, height);
  dc.opaque = false;
  dc.respectScreenScale = true;

  const bg = new Path();
  bg.addRoundedRect(new Rect(0, 0, width, height), height / 2, height / 2);
  dc.addPath(bg);
  dc.setFillColor(COL.track);
  dc.fillPath();

  const fw = Math.max(height, (width * p) / 100);
  const fg = new Path();
  fg.addRoundedRect(new Rect(0, 0, fw, height), height / 2, height / 2);
  dc.addPath(fg);
  dc.setFillColor(color);
  dc.fillPath();

  return dc.getImage();
}

function addText(parent, text, font, color, lineLimit) {
  const t = parent.addText(String(text));
  t.font = font;
  t.textColor = color;
  if (lineLimit) t.lineLimit = lineLimit;
  return t;
}

function addBar(parent, label, value, width, height) {
  const row = parent.addStack();
  row.centerAlignContent();
  const labelBox = row.addStack();
  labelBox.size = new Size(34, 12);
  addText(labelBox, label, Font.semiboldSystemFont(9), COL.dim, 1);
  row.addSpacer(5);
  const img = row.addImage(barImg(value, width, height, usageColor(value)));
  img.imageSize = new Size(width, height);
  row.addSpacer(5);
  const val = addText(row, `${Math.round(clampPercent(value))}%`, Font.systemFont(9), COL.dim, 1);
  val.minimumScaleFactor = 0.7;
}

// 详细视图用：标签 + 进度条 + 右侧说明（例如 1.7 GB / 3.8 GB）
function addDetailBar(parent, label, value, detail, width, big) {
  const row = parent.addStack();
  row.centerAlignContent();
  const labelBox = row.addStack();
  labelBox.size = new Size(big ? 38 : 34, big ? 14 : 12);
  addText(labelBox, label, Font.semiboldSystemFont(big ? 11 : 9), COL.dim, 1);
  row.addSpacer(4);
  const h = big ? 9 : 7;
  const img = row.addImage(barImg(value, width, h, usageColor(value)));
  img.imageSize = new Size(width, h);
  row.addSpacer(6);
  const pct = addText(row, `${Math.round(clampPercent(value))}%`, Font.semiboldSystemFont(big ? 12 : 10), COL.fg, 1);
  pct.minimumScaleFactor = 0.7;
  row.addSpacer();
  const d = addText(row, detail, Font.systemFont(big ? 10 : 9), COL.dim, 1);
  d.minimumScaleFactor = 0.6;
}

function addMetricColumn(parent, label, value, width) {
  const col = parent.addStack();
  col.layoutVertically();
  col.spacing = 3;
  const top = col.addStack();
  top.size = new Size(width, 0);
  top.centerAlignContent();
  addText(top, label, Font.semiboldSystemFont(9), COL.dim, 1);
  top.addSpacer();
  addText(top, `${Math.round(clampPercent(value))}%`, Font.systemFont(9), COL.dim2, 1);
  const img = col.addImage(barImg(value, width, 6, usageColor(value)));
  img.imageSize = new Size(width, 6);
}

// 键值对一行：左右各一组
function addKV(parent, pairs, big) {
  const row = parent.addStack();
  row.centerAlignContent();
  pairs.forEach(([key, value, color], i) => {
    if (i > 0) row.addSpacer();
    const cell = row.addStack();
    cell.centerAlignContent();
    addText(cell, key, Font.semiboldSystemFont(big ? 10 : 9), COL.dim2, 1);
    cell.addSpacer(4);
    const v = addText(cell, value || "-", Font.systemFont(big ? 12 : 10), color || COL.fg, 1);
    v.minimumScaleFactor = 0.6;
  });
}

function serverName(server) {
  return server.name || server.id || "Server";
}

function addFlag(parent, server, width, height) {
  if (server._flagImage) {
    const img = parent.addImage(server._flagImage);
    img.imageSize = new Size(width, height);
    img.cornerRadius = 2;
    return true;
  }

  if (server._flagRegionCode) {
    const region = addText(parent, String(server.region || "").toUpperCase(), Font.semiboldSystemFont(9), COL.dim, 1);
    region.minimumScaleFactor = 0.7;
    return true;
  }

  return false;
}

function offlineText(server) {
  if (server._missing) return "找不到";
  const ts = lastSeen(server);
  const ago = ts > 0 ? formatDuration(Date.now() - ts) : "";
  return ago ? `离线 ${ago}` : "离线";
}

function speedText(server) {
  return `↓${shortBytes(server.net_in_speed)}/s ↑${shortBytes(server.net_out_speed)}/s`;
}

function addServerRow(widget, server) {
  const online = isOnline(server);
  const cpu = Number(server.cpu) || 0;
  const ram = percent(server.ram_used, server.ram_total);
  const disk = percent(server.disk_used, server.disk_total);

  const head = widget.addStack();
  head.centerAlignContent();
  addText(head, "●", Font.systemFont(9), online ? COL.green : COL.dim2, 1);
  head.addSpacer(5);
  if (addFlag(head, server, 18, 13)) head.addSpacer(5);
  const name = addText(head, serverName(server), Font.semiboldSystemFont(12), online ? COL.fg : COL.dim, 1);
  name.minimumScaleFactor = 0.75;
  head.addSpacer();
  const st = addText(head, online ? speedText(server) : offlineText(server), Font.systemFont(9), online ? COL.dim : COL.red, 1);
  st.minimumScaleFactor = 0.7;

  if (server._missing) return;

  widget.addSpacer(4);
  const metrics = widget.addStack();
  metrics.layoutHorizontally();
  addMetricColumn(metrics, "CPU", cpu, 80);
  metrics.addSpacer();
  addMetricColumn(metrics, "RAM", ram, 80);
  metrics.addSpacer();
  addMetricColumn(metrics, "DISK", disk, 80);
}

// ---------- 三网延迟 / 丢包柱状图 ----------

// 小组件实际宽度：iOS 大、中尺寸约为屏幕宽度的 0.86（6.1 寸约 338，6.9 寸约 378）
function widgetWidth() {
  const size = Device.screenSize();
  return Math.round(Math.min(size.width, size.height) * 0.86);
}

function carriers(server) {
  const list = [["ct", "电信"], ["cu", "联通"], ["cm", "移动"], ["bd", "BGP"]];
  return list
    .map(([key, name]) => ({ key, name: String(SYS[`custom_${key}_name`] || name), color: COL[key] || COL.cyan }))
    .filter(({ key }) => server[`ping_${key}`] !== false || (server.ping || []).some((p) => typeof p[key] === "number"));
}

// 按时间排好的 [{ ping, loss }]；ping 为 null 表示这一轮超时
function latencySeries(server, key) {
  const loss = new Map((server.loss || []).map((p) => [p.ts, p[key]]));
  const series = (server.ping || [])
    .filter((p) => p[key] !== false && p[key] !== undefined)
    .sort((a, b) => a.ts - b.ts)
    .map((p) => ({ ping: p[key], loss: Number(loss.get(p.ts)) || 0 }));
  if (!series.length && typeof server[`ping_${key}`] === "number") {
    series.push({ ping: server[`ping_${key}`], loss: Number(server[`loss_${key}`]) || 0 });
  }
  return series;
}

function latencyColor(ms) {
  return ms < 100 ? COL.green : ms < 200 ? COL.amber : COL.red;
}

// 一台服务器所有线路共用一个纵轴，方便横向比较。纵轴从最低延迟的 40% 开始，
// 否则延迟都差不多时每根柱子一样高，看不出波动
function latencyScale(server, list) {
  let min = Infinity;
  let max = 0;
  for (const c of list) {
    for (const p of latencySeries(server, c.key)) {
      if (typeof p.ping !== "number") continue;
      min = Math.min(min, p.ping);
      max = Math.max(max, p.ping);
    }
  }
  if (!max) return { lo: 0, hi: 100 };
  return { lo: Math.floor(min * 0.4), hi: Math.max(max * 1.08, min * 0.4 + 20) };
}

// 每根柱子是一次采样（最新的在右）：高度 = 延迟，颜色 = 线路；顶部红色 = 丢包比例；整根暗红 = 超时
function latencyChart(series, width, height, scale, color) {
  const slots = Math.max(8, Number((SYS.latency_window || {}).points) || 20);
  const dc = new DrawContext();
  dc.size = new Size(width, height);
  dc.opaque = false;
  dc.respectScreenScale = true;
  const step = width / slots;
  const barW = Math.max(1.5, step - 1.2);
  const data = series.slice(-slots);
  const offset = slots - data.length;
  for (let i = 0; i < slots; i++) {
    const x = i * step;
    const sample = data[i - offset];
    dc.setFillColor(COL.track);
    dc.fillRect(new Rect(x, height - 1.5, barW, 1.5));
    if (!sample) continue;
    if (typeof sample.ping !== "number") {
      dc.setFillColor(new Color("#f85149", 0.45));
      dc.fillRect(new Rect(x, 0, barW, height));
      continue;
    }
    const ratio = (sample.ping - scale.lo) / (scale.hi - scale.lo);
    const h = Math.max(2, Math.min(1, Math.max(0, ratio)) * height);
    dc.setFillColor(color);
    dc.fillRect(new Rect(x, height - h, barW, h));
    if (sample.loss > 0) {
      dc.setFillColor(COL.red);
      dc.fillRect(new Rect(x, 0, barW, Math.max(2, (Math.min(100, sample.loss) / 100) * height)));
    }
  }
  return dc.getImage();
}

// 固定宽度的单行文字。不用 minimumScaleFactor：空间紧时 iOS 会把字各缩各的，字号就不统一了
function addFixedText(parent, text, width, font, color, right) {
  const box = parent.addStack();
  box.size = new Size(width, 0);
  if (right) box.addSpacer();
  const t = addText(box, text, font, color, 1);
  if (!right) box.addSpacer();
  return t;
}

// 卡片里统一用两种字号：名字 13，其余全部 10
const CARD_FONT = {
  name: Font.semiboldSystemFont(13),
  label: Font.semiboldSystemFont(10),
  text: Font.systemFont(10)
};

// 每条线路一行：名字 | 当前延迟 | 柱状图 | 当前丢包
function addLatencyRows(parent, server, width, rowH, gap) {
  const list = carriers(server);
  if (!list.length) {
    addText(parent, "未配置三网延迟", CARD_FONT.text, COL.dim2, 1);
    return;
  }
  const scale = latencyScale(server, list);
  const nameW = 26;
  const valW = 40;
  const lossW = 30;
  const chartW = Math.max(40, width - nameW - valW - lossW - 12);
  list.forEach((c, i) => {
    if (i > 0) parent.addSpacer(gap);
    const series = latencySeries(server, c.key);
    const last = series[series.length - 1] || {};
    const row = parent.addStack();
    row.centerAlignContent();
    row.size = new Size(width, rowH);
    addFixedText(row, c.name, nameW, CARD_FONT.label, c.color);
    row.addSpacer(4);
    const ping = typeof last.ping === "number" ? `${Math.round(last.ping)}ms` : series.length ? "超时" : "-";
    addFixedText(row, ping, valW, CARD_FONT.text, typeof last.ping === "number" ? latencyColor(last.ping) : COL.red, true);
    row.addSpacer(4);
    const img = row.addImage(latencyChart(series, chartW, rowH, scale, c.color));
    img.imageSize = new Size(chartW, rowH);
    row.addSpacer(4);
    const loss = Math.round(Number(last.loss) || 0);
    addFixedText(row, `${loss}%`, lossW, CARD_FONT.text, loss > 0 ? COL.red : COL.dim2, true);
  });
}

// 资源一行：标签 | 进度条 | 百分比
function addMiniBar(parent, label, value, width, rowH) {
  const row = parent.addStack();
  row.centerAlignContent();
  row.size = new Size(width, rowH);
  addFixedText(row, label, 32, CARD_FONT.label, COL.dim);
  const barW = width - 32 - 34;
  const img = row.addImage(barImg(value, barW, 5, usageColor(value)));
  img.imageSize = new Size(barW, 5);
  addFixedText(row, `${Math.round(clampPercent(value))}%`, 34, CARD_FONT.text, COL.fg, true);
}

// 卡片底部：本月流量 · 额度 · 运行天数，右边到期。尽量短，保证一行放得下
function cardFooter(server) {
  const parts = [`本月 ↓${shortBytes(server.net_rx_monthly)} ↑${shortBytes(server.net_tx_monthly)}`];
  if (server.traffic_limit) parts.push(`额度 ${Math.round(trafficPercent(server))}%`);
  const boot = normalizeTimestamp(server.boot_time);
  if (boot > 0) {
    const days = Math.floor((Date.now() - boot) / 86400000);
    parts.push(days > 0 ? `运行 ${days} 天` : `运行 ${uptimeText(server)}`);
  }
  return parts.join(" · ");
}

// 大尺寸列表里的一台：圆角卡片，所有行高固定，避免内容超高时 iOS 压缩文字
//   名字 / 网速
//   CPU RAM DISK 进度条 | 三网延迟+丢包柱状图
//   本月流量 · 额度 · 运行天数 / 到期
function addServerCard(widget, server, innerW, roomy) {
  const online = isOnline(server);
  const pad = roomy ? 9 : 8;
  const rowH = roomy ? 13 : 12;
  const gap = roomy ? 4 : 3;
  const card = widget.addStack();
  card.layoutVertically();
  card.backgroundColor = COL.card;
  card.cornerRadius = 12;
  card.setPadding(pad, 10, pad, 10);
  card.size = new Size(innerW + 20, 0);

  const head = card.addStack();
  head.centerAlignContent();
  head.size = new Size(innerW, 16);
  addText(head, "●", Font.systemFont(8), online ? COL.green : COL.dim2, 1);
  head.addSpacer(5);
  if (addFlag(head, server, 18, 13)) head.addSpacer(6);
  addText(head, serverName(server), CARD_FONT.name, online ? COL.fg : COL.dim, 1);
  head.addSpacer();
  addText(head, online ? speedText(server) : offlineText(server), CARD_FONT.text, online ? COL.dim : COL.red, 1);
  if (server._missing) return;

  card.addSpacer(6);
  const body = card.addStack();
  body.layoutHorizontally();
  const leftW = roomy ? 112 : 102;
  const rightW = innerW - leftW - 10;
  const left = body.addStack();
  left.layoutVertically();
  addMiniBar(left, "CPU", Number(server.cpu) || 0, leftW, rowH);
  left.addSpacer(gap);
  addMiniBar(left, "RAM", percent(server.ram_used, server.ram_total), leftW, rowH);
  left.addSpacer(gap);
  addMiniBar(left, "DISK", percent(server.disk_used, server.disk_total), leftW, rowH);
  body.addSpacer(10);
  const right = body.addStack();
  right.layoutVertically();
  addLatencyRows(right, server, rightW, rowH, gap);

  card.addSpacer(6);
  const foot = card.addStack();
  foot.centerAlignContent();
  foot.size = new Size(innerW, 13);
  addText(foot, cardFooter(server), CARD_FONT.text, COL.dim2, 1);
  foot.addSpacer();
  const days = daysLeft(server);
  if (days !== null) addText(foot, days >= 0 ? `剩 ${days} 天` : "已到期", CARD_FONT.text, expiryColor(days), 1);
}

// 小尺寸列表：每台两行文字
function addSmallRow(widget, server) {
  const online = isOnline(server);
  const head = widget.addStack();
  head.centerAlignContent();
  addText(head, "●", Font.systemFont(9), online ? COL.green : COL.dim2, 1);
  head.addSpacer(4);
  const name = addText(head, serverName(server), Font.semiboldSystemFont(11), online ? COL.fg : COL.dim, 1);
  name.minimumScaleFactor = 0.7;
  head.addSpacer();
  if (online) {
    const cpu = Number(server.cpu) || 0;
    addText(head, `${Math.round(cpu)}%`, Font.semiboldSystemFont(10), usageColor(cpu), 1);
  }

  const ram = Math.round(percent(server.ram_used, server.ram_total));
  const disk = Math.round(percent(server.disk_used, server.disk_total));
  const sub = addText(widget, online ? `R${ram}% D${disk}% ↑${shortBytes(server.net_out_speed)}/s` : offlineText(server), Font.systemFont(9), online ? COL.dim : COL.red, 1);
  sub.minimumScaleFactor = 0.7;
}

function addSmallServer(widget, server) {
  const online = isOnline(server);
  const cpu = Number(server.cpu) || 0;
  const ram = percent(server.ram_used, server.ram_total);
  const disk = percent(server.disk_used, server.disk_total);

  const head = widget.addStack();
  head.centerAlignContent();
  addText(head, "●", Font.systemFont(10), online ? COL.green : COL.dim2, 1);
  head.addSpacer(5);
  if (addFlag(head, server, 20, 15)) head.addSpacer(5);
  const name = addText(head, serverName(server), Font.boldSystemFont(13), COL.fg, 1);
  name.minimumScaleFactor = 0.7;

  widget.addSpacer(8);
  addBar(widget, "CPU", cpu, 70, 7);
  widget.addSpacer(5);
  addBar(widget, "RAM", ram, 70, 7);
  widget.addSpacer(5);
  addBar(widget, "DSK", disk, 70, 7);
  if (server.traffic_limit) {
    widget.addSpacer(5);
    addBar(widget, "TRF", trafficPercent(server), 70, 7);
  }

  widget.addSpacer();
  const net = widget.addText(online ? speedText(server) : offlineText(server));
  net.font = Font.systemFont(10);
  net.textColor = online ? COL.dim : COL.red;
  net.lineLimit = 1;
  net.minimumScaleFactor = 0.7;
  const up = uptimeText(server);
  if (online && up) addText(widget, `运行 ${up}`, Font.systemFont(9), COL.dim2, 1);
}

function addNetLine(parent, label, value, color) {
  const row = parent.addStack();
  row.centerAlignContent();
  addText(row, label, Font.semiboldSystemFont(10), COL.dim, 1);
  row.addSpacer();
  const speed = addText(row, `${formatBytes(value)}/s`, Font.systemFont(11), color, 1);
  speed.minimumScaleFactor = 0.7;
}

function addSingleHeader(widget, server, large, footer) {
  const online = isOnline(server);
  const head = widget.addStack();
  head.centerAlignContent();
  addText(head, "●", Font.systemFont(large ? 12 : 11), online ? COL.green : COL.dim2, 1);
  head.addSpacer(6);
  if (addFlag(head, server, large ? 24 : 22, large ? 18 : 16)) head.addSpacer(6);
  const name = addText(head, serverName(server), Font.boldSystemFont(large ? 18 : 16), COL.fg, 1);
  name.minimumScaleFactor = 0.65;
  head.addSpacer();
  addText(head, online ? "online" : offlineText(server), Font.semiboldSystemFont(11), online ? COL.green : COL.red, 1);

  widget.addSpacer(3);
  const parts = [footer];
  const up = uptimeText(server);
  if (up) parts.push(`运行 ${up}`);
  if (server.load_avg) parts.push(`负载 ${String(server.load_avg).split(/\s+/)[0]}`);
  const days = daysLeft(server);
  const sub = widget.addStack();
  sub.centerAlignContent();
  addText(sub, parts.join(" · "), Font.systemFont(9), COL.dim2, 1).minimumScaleFactor = 0.7;
  if (days !== null) {
    sub.addSpacer();
    addText(sub, days >= 0 ? `剩 ${days} 天` : "已到期", Font.systemFont(9), expiryColor(days), 1);
  }
}

function addMediumServer(widget, server, footer) {
  const online = isOnline(server);
  addSingleHeader(widget, server, false, footer);

  widget.addSpacer(10);
  const metrics = widget.addStack();
  metrics.layoutHorizontally();
  addMetricColumn(metrics, "CPU", Number(server.cpu) || 0, 80);
  metrics.addSpacer();
  addMetricColumn(metrics, "RAM", percent(server.ram_used, server.ram_total), 80);
  metrics.addSpacer();
  addMetricColumn(metrics, "DISK", percent(server.disk_used, server.disk_total), 80);

  widget.addSpacer(8);
  if (server.traffic_limit) {
    addBar(widget, "TRF", trafficPercent(server), 222, 6);
  } else {
    addText(widget, `本月 ↓${formatBytes(server.net_rx_monthly)}  ↑${formatBytes(server.net_tx_monthly)}`, Font.systemFont(9), COL.dim, 1);
  }

  widget.addSpacer();
  const net = widget.addStack();
  net.centerAlignContent();
  addText(net, `↓ ${formatBytes(server.net_in_speed)}/s`, Font.systemFont(11), online ? COL.cyan : COL.dim2, 1);
  net.addSpacer(10);
  addText(net, `↑ ${formatBytes(server.net_out_speed)}/s`, Font.systemFont(11), online ? COL.blue : COL.dim2, 1);
  net.addSpacer();
  const ping = pingParts(server);
  if (ping.length) addText(net, ping.join(" "), Font.systemFont(9), COL.dim, 1).minimumScaleFactor = 0.6;
}

function addLargeServer(widget, server, footer) {
  const online = isOnline(server);
  addSingleHeader(widget, server, true, footer);
  const sys = [server.os, server.cpu_cores ? `${server.cpu_cores} 核` : "", server.arch].filter(Boolean).join(" · ");
  if (sys) {
    widget.addSpacer(2);
    addText(widget, sys, Font.systemFont(9), COL.dim2, 1).minimumScaleFactor = 0.7;
  }

  widget.addSpacer(8);
  widget.addSpacer();
  const barW = 140;
  const gap = 9;
  addDetailBar(widget, "CPU", Number(server.cpu) || 0, server.load_avg ? `负载 ${server.load_avg}` : "", barW, true);
  widget.addSpacer(gap);
  addDetailBar(widget, "RAM", percent(server.ram_used, server.ram_total), `${formatMB(server.ram_used)} / ${formatMB(server.ram_total)}`, barW, true);
  if (Number(server.swap_total) > 0) {
    widget.addSpacer(gap);
    addDetailBar(widget, "SWAP", percent(server.swap_used, server.swap_total), `${formatMB(server.swap_used)} / ${formatMB(server.swap_total)}`, barW, true);
  }
  widget.addSpacer(gap);
  addDetailBar(widget, "DISK", percent(server.disk_used, server.disk_total), `${formatMB(server.disk_used)} / ${formatMB(server.disk_total)}`, barW, true);
  if (server.traffic_limit) {
    widget.addSpacer(gap);
    addDetailBar(widget, "TRF", trafficPercent(server), `${formatBytes(trafficUsedBytes(server))} / ${formatBytes(trafficLimitBytes(server.traffic_limit))}`, barW, true);
  }

  widget.addSpacer(10);
  widget.addSpacer();
  const kvGap = 7;
  addKV(widget, [
    ["下载", `${formatBytes(server.net_in_speed)}/s`, online ? COL.cyan : COL.dim2],
    ["上传", `${formatBytes(server.net_out_speed)}/s`, online ? COL.blue : COL.dim2]
  ], true);
  widget.addSpacer(kvGap);
  addKV(widget, [
    ["本月↓", formatBytes(server.net_rx_monthly)],
    ["本月↑", formatBytes(server.net_tx_monthly)]
  ], true);
  const io = server.disk && typeof server.disk === "object" ? server.disk : null;
  if (io) {
    widget.addSpacer(kvGap);
    addKV(widget, [
      ["磁盘读", `${formatBytes(io.read_bps)}/s`],
      ["磁盘写", `${formatBytes(io.write_bps)}/s`]
    ], true);
  }
  widget.addSpacer(kvGap);
  addKV(widget, [
    ["TCP", String(server.tcp_conn ?? "-")],
    ["UDP", String(server.udp_conn ?? "-")],
    ["进程", String(server.processes ?? "-")]
  ], true);
  widget.addSpacer(10);
  widget.addSpacer();
  addLatencyRows(widget, server, widgetWidth() - 30, 16, 6);
  widget.addSpacer();
}

function addSingleServer(widget, server, footer) {
  if (family === "small") {
    addSmallServer(widget, server);
    widget.addSpacer(3);
    addText(widget, footer, Font.systemFont(8), COL.dim2, 1).centerAlignText();
  } else if (family === "large") {
    addLargeServer(widget, server, footer);
  } else {
    addMediumServer(widget, server, footer);
  }
}

function addServerList(widget, data, footer) {
  const servers = data.servers;
  const max = Math.max(1, Number((CONFIG.maxRows || {})[family]) || 3);
  const shown = servers.slice(0, max);
  const more = servers.length - shown.length;

  // 大尺寸有空间，顶部加一行总览
  if (family === "large") {
    const head = widget.addStack();
    head.centerAlignContent();
    head.size = new Size(widgetWidth() - 24, 18);
    addText(head, "Servers", Font.boldSystemFont(15), COL.fg, 1);
    head.addSpacer(8);
    addText(head, `${data.stats.online}/${data.stats.total} 在线`, CARD_FONT.label, data.stats.offline ? COL.amber : COL.green, 1);
    head.addSpacer();
    addText(head, footer, CARD_FONT.text, COL.dim2, 1);
    widget.addSpacer(6);
  }

  const innerW = widgetWidth() - 24 - 20;
  const roomy = widgetWidth() >= 355;
  const spread = shown.length >= 3;
  shown.forEach((server, i) => {
    if (i > 0) {
      // 3 台时卡片之间用弹性间距，把剩下的高度平均分开
      if (family === "large") {
        widget.addSpacer(roomy ? 6 : 4);
        if (spread) widget.addSpacer();
      } else {
        widget.addSpacer(family === "small" ? 5 : 7);
      }
    }
    if (family === "small") addSmallRow(widget, server);
    else if (family === "large") addServerCard(widget, server, innerW, roomy);
    else addServerRow(widget, server);
  });

  if (family !== "large" || !spread) widget.addSpacer();
  if (family !== "large" || more > 0) {
    if (family === "large") widget.addSpacer(5);
    const foot = widget.addStack();
    if (more > 0) addText(foot, `还有 ${more} 台`, Font.systemFont(8), COL.dim, 1);
    foot.addSpacer();
    if (family !== "large") addText(foot, footer, Font.systemFont(8), COL.dim2, 1);
  }
}

function buildWidget(data) {
  const widget = baseWidget();
  const small = family === "small";
  const listPad = data.servers.length > 1 && family !== "small" ? (family === "large" ? 12 : 11) : null;
  const sidePad = family === "large" && data.servers.length > 1 ? 12 : small ? 13 : 15;
  widget.setPadding(listPad || (small ? 12 : 14), sidePad, listPad || (small ? 12 : 14), sidePad);

  if (!data.servers.length) return errWidget("No matching servers");

  const footer = data.staleAt ? `⚠ 缓存 ${hhmm(data.staleAt)}` : `更新 ${hhmm()}`;
  if (data.servers.length === 1) addSingleServer(widget, data.servers[0], footer);
  else addServerList(widget, data, footer);
  return widget;
}

function errWidget(message) {
  const widget = baseWidget();
  widget.setPadding(14, 15, 14, 15);
  addText(widget, "CF Server Monitor", Font.boldSystemFont(14), COL.red, 1);
  widget.addSpacer(8);
  addText(widget, message, Font.systemFont(11), COL.fg, 3);
  return widget;
}

async function main() {
  let widget;
  try {
    if (!CONFIG.baseURL || /ex(a|m)+ple\.com/.test(CONFIG.baseURL)) {
      widget = errWidget("Set CONFIG.baseURL first.");
    } else {
      const data = await loadServers();
      widget = buildWidget(data);
    }
  } catch (e) {
    widget = errWidget("Request failed: " + (e.message || e));
  }

  if (config.runsInWidget) {
    Script.setWidget(widget);
  } else if (family === "small") {
    await widget.presentSmall();
  } else if (family === "large") {
    await widget.presentLarge();
  } else {
    await widget.presentMedium();
  }
  Script.complete();
}

await main();
