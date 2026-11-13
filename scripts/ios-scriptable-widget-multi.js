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
//   page:2（或 p2、2、第2页）     智能叠放用：只显示第几页；不填页码 = 第 1 页 / Smart Stack: show page N (default page 1)
// 服务器总是自动分页，台数平均分（3 台 = 2+1，5 台 = 2+2+1），加了机器不用改设置；页码超出时提示"这一页没有机器"
// Servers are always paged and balanced (3 → 2+1, 5 → 2+2+1); an out-of-range page shows a hint
//   小、中尺寸：每页 1 台 / small, medium: 1 per page
//   大尺寸：每页 2 台（两张中尺寸样式的卡片）；只剩 1 台时是单台详细视图 / large: 2 per page as two medium-style cards, 1 → detail view
// 小组件尺寸按机型查表（WIDGET_SIZES），iPhone Air 是实机量的 / widget sizes come from a per-device table

const CONFIG = {
  baseURL: "https://www.example.com", //必填
  servers: [], //可选，填 id 或名字，例如 ["server-a", "server-b"]；留空 = 全部
  refreshMinutes: 5, //iOS 会自己限流，实际刷新间隔通常更长
  userAgent: "", //可选，填后台「安全设置 - 自定义 UA」；启用 Cloudflare 安全规则后必填
  appPassword: "" //可选，填后台「安全设置 - App 访问口令」；私有站点或需要看隐藏服务器时必填
};

CONFIG.baseURL = String(CONFIG.baseURL || "").replace(/\/+$/, "");
CONFIG.userAgent = String(CONFIG.userAgent || "").trim();
CONFIG.appPassword = String(CONFIG.appPassword || "").trim();

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

// Parameter 是页码（page:2、page：2、p2、2、第2页）时返回页码，否则返回 0
function pageParam() {
  const matched = widgetParameter.match(/^(?:page|p|第)?\s*[:：]?\s*(\d+)\s*页?$/i);
  return matched ? Math.max(1, Number(matched[1])) : 0;
}

// 返回要显示的服务器列表（id 或名字），空数组 = 全部；Parameter 是页码时，范围用 CONFIG.servers
function wantedServers() {
  const list = Array.isArray(CONFIG.servers) ? CONFIG.servers : [CONFIG.servers || ""];
  const source = String((pageParam() ? "" : widgetParameter) || list.join(",")).trim();
  if (/^all$/i.test(source)) return [];
  return [...new Set(source.split(/[,，\s]+/).map(normalizeServerId).filter(Boolean))];
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


// 空间小，用紧凑写法：1.2G、345K
function shortBytes(bytes) {
  const text = formatBytes(bytes).replace(/^(\d{3,})\.\d/, "$1");
  return text.replace(/\.0 /, " ").replace(/ ([KMGT])?B$/, (m, u) => u || "B");
}

// 面板里内存和磁盘的单位是 MB
function shortMB(mb) {
  return shortBytes((Number(mb) || 0) * 1024 * 1024);
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

// 站点关了流量额度开关就不画 TRF（SYS 还没拿到时按开启处理）
function showTraffic() {
  return SYS.show_tf !== false;
}

function hhmm(date) {
  const d = date ? new Date(date) : new Date();
  const p = (n) => (n < 10 ? "0" : "") + n;
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

// 缓存时间：不是今天的带上月/日，跨天时才看得出数据有多旧
function cacheTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  return sameDay ? hhmm(ts) : `${d.getMonth() + 1}/${d.getDate()} ${hhmm(ts)}`;
}

async function fetchJSON(path) {
  const req = new Request(CONFIG.baseURL + path);
  req.timeoutInterval = 15;
  const headers = {};
  if (CONFIG.userAgent) headers["User-Agent"] = CONFIG.userAgent;
  if (CONFIG.appPassword) headers["X-App-Password"] = CONFIG.appPassword;
  if (Object.keys(headers).length > 0) req.headers = headers;
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
// 缓存名带上站点指纹，换 baseURL 后不会读到上一个站点的旧数据
function siteTag() {
  let h = 0;
  const s = CONFIG.baseURL || "";
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

function cachePath(wanted) {
  const fm = FileManager.local();
  const key = (wanted.join("_") || "all").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80) || "custom";
  return { fm, path: fm.joinPath(fm.cacheDirectory(), `cfsm-widget-${siteTag()}-${key}.json`) };
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
  const all = result.servers || [];
  SYS = result.sysConfig || {};

  // 分页：页数 = ceil(总数 / 每页上限)，再把台数平均分到各页；没填页码就是第 1 页
  const page = pageParam() || 1;
  // 每页台数跟排版绑定：大尺寸 2 台，小、中尺寸 1 台
  const pageSize = family === "large" ? 2 : 1;
  const count = Math.max(1, Math.ceil(all.length / pageSize));
  // 前 (总数 % 页数) 页各多放一台，例如 5 台 = 2+2+1
  const base = Math.floor(all.length / count);
  const extra = all.length % count;
  const start = (page - 1) * base + Math.min(page - 1, extra);
  const servers = page > count ? [] : all.slice(start, start + base + (page <= extra ? 1 : 0));
  const pageInfo = { index: page, count };

  // 只给这一页的几台拉国旗，同一个地区只请求一次
  const codes = [...new Set(servers.map((s) => getFlagRegionCode(s.region)).filter(Boolean))];
  const flagMap = new Map();
  await Promise.all(codes.map(async (code) => flagMap.set(code, await fetchFlagImage(code))));
  servers.forEach((server) => {
    server._flagRegionCode = getFlagRegionCode(server.region);
    server._flagImage = flagMap.get(server._flagRegionCode) || null;
  });

  // 在线统计按全部服务器算，分页时也能看出别的页有没有掉线的
  const online = all.filter(isOnline).length;
  return {
    servers,
    stats: { total: all.length, online, offline: all.length - online },
    pageInfo,
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

function addText(parent, text, font, color, lineLimit) {
  const t = parent.addText(String(text));
  t.font = font;
  t.textColor = color;
  if (lineLimit) t.lineLimit = lineLimit;
  return t;
}

// ---------- 尺寸 ----------

// iOS 小组件尺寸（pt）：[屏宽, 屏高, 小/中尺寸的高, 中/大尺寸的宽, 大尺寸的高]
// 来自 Apple 设计规范；iPhone Air（420×912）规范里没有，是 2026-11 从实机截图量的
const WIDGET_SIZES = [
  [440, 956, 170, 364, 382],
  [430, 932, 170, 364, 382],
  [428, 926, 170, 364, 382],
  [420, 912, 172, 366, 381],
  [414, 896, 169, 360, 379],
  [414, 736, 159, 348, 357],
  [402, 874, 162, 345, 364],
  [393, 852, 158, 338, 354],
  [390, 844, 158, 338, 354],
  [375, 812, 155, 329, 345],
  [375, 667, 148, 321, 324],
  [360, 780, 155, 329, 345],
  [320, 568, 141, 292, 311]
];

// 当前尺寸的小组件宽高；表里没有的机型取屏宽最接近的一档，再按屏宽比例缩放
function widgetSize() {
  const s = Device.screenSize();
  const sw = Math.min(s.width, s.height);
  const sh = Math.max(s.width, s.height);
  let row = WIDGET_SIZES.find((r) => Math.abs(r[0] - sw) <= 1 && Math.abs(r[1] - sh) <= 1);
  let k = 1;
  if (!row) {
    row = WIDGET_SIZES.reduce((a, b) => (Math.abs(b[0] - sw) < Math.abs(a[0] - sw) ? b : a));
    k = sw / row[0];
  }
  const [, , smallH, wideW, largeH] = row.map((v) => Math.floor(v * k));
  if (family === "small") return { w: smallH, h: smallH };
  if (family === "large") return { w: wideW, h: largeH };
  return { w: wideW, h: smallH };
}

// ---------- 基础部件 ----------

const FONT = {
  name: Font.semiboldSystemFont(13),
  label: Font.semiboldSystemFont(10),
  text: Font.systemFont(10),
  small: Font.systemFont(9)
};

// 固定宽度的单行文字，放不下时先缩小字号，别截成"…"
function addFixedText(parent, text, width, font, color, right) {
  const box = parent.addStack();
  box.size = new Size(width, 0);
  if (right) box.addSpacer();
  const t = addText(box, text, font, color, 1);
  t.minimumScaleFactor = 0.7;
  if (!right) box.addSpacer();
  return t;
}

// 固定大小的竖排容器
function fixedColumn(parent, width, height) {
  const col = parent.addStack();
  col.layoutVertically();
  col.size = new Size(width, height);
  return col;
}

// 一行：左边文字撑开，右边文字靠右
function addSplitRow(parent, width, height, left, right) {
  const row = parent.addStack();
  row.centerAlignContent();
  row.size = new Size(width, height);
  if (left) addText(row, left.text, left.font || FONT.small, left.color || COL.dim2, 1).minimumScaleFactor = 0.7;
  row.addSpacer();
  if (right) addText(row, right.text, right.font || FONT.small, right.color || COL.dim2, 1).minimumScaleFactor = 0.7;
  return row;
}

// 圆环：灰色轨道 + 按百分比的彩色弧线，中间写百分比。
// Scriptable 没有画弧的 API，用很多短线段拼出来，两头各补一个圆点当圆角
function ringImg(value, size, lineW) {
  const p = clampPercent(value);
  const dc = new DrawContext();
  dc.size = new Size(size, size);
  dc.opaque = false;
  dc.respectScreenScale = true;
  const c = size / 2;
  const r = c - lineW / 2 - 0.5;
  const arc = (from, to) => {
    const path = new Path();
    const steps = Math.max(2, Math.ceil(Math.abs(to - from) / 0.05));
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const a = from + ((to - from) * i) / steps;
      pts.push(new Point(c + r * Math.cos(a), c + r * Math.sin(a)));
    }
    path.addLines(pts);
    return path;
  };
  const start = -Math.PI / 2;
  dc.setLineWidth(lineW);
  dc.addPath(arc(start, start + Math.PI * 2));
  dc.setStrokeColor(COL.track);
  dc.strokePath();

  const color = usageColor(p);
  const end = start + Math.PI * 2 * Math.max(0.015, p / 100);
  dc.addPath(arc(start, end));
  dc.setStrokeColor(color);
  dc.strokePath();
  dc.setFillColor(color);
  for (const a of [start, end]) {
    dc.fillEllipse(new Rect(c + r * Math.cos(a) - lineW / 2, c + r * Math.sin(a) - lineW / 2, lineW, lineW));
  }

  const fontSize = size >= 50 ? 14 : 11;
  dc.setFont(Font.semiboldSystemFont(fontSize));
  dc.setTextColor(COL.fg);
  dc.setTextAlignedCenter();
  dc.drawTextInRect(`${Math.round(p)}%`, new Rect(0, c - fontSize * 0.62, size, fontSize * 1.3));
  return dc.getImage();
}

// 圆环 + 下面的标签（可选再加一行说明，例如 0.6 / 1.9 GB）
function addRing(parent, label, value, size, colW, sub) {
  const col = parent.addStack();
  col.layoutVertically();
  col.size = new Size(colW, 0);
  // 每一行都给定宽度，两边弹性间距才会把内容居中
  const centered = () => {
    const row = col.addStack();
    row.size = new Size(colW, 0);
    row.addSpacer();
    return row;
  };
  const top = centered();
  const img = top.addImage(ringImg(value, size, size >= 50 ? 6 : 4.5));
  img.imageSize = new Size(size, size);
  top.addSpacer();
  col.addSpacer(3);
  const lab = centered();
  addText(lab, label, FONT.label, COL.dim, 1);
  lab.addSpacer();
  if (sub) {
    col.addSpacer(1);
    const s = centered();
    addText(s, sub, FONT.small, COL.dim2, 1).minimumScaleFactor = 0.6;
    s.addSpacer();
  }
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

function expiryText(server) {
  const days = daysLeft(server);
  if (days === null) return null;
  return { text: days >= 0 ? `剩 ${days} 天` : "已到期", color: expiryColor(days) };
}

function loadText(server) {
  return server.load_avg ? String(server.load_avg).split(/\s+/)[0] : "";
}

// 名字行：● 国旗 名字 …… 右边（到期天数 / online / 离线）
function addHeader(parent, server, width, big, right) {
  const online = isOnline(server);
  const head = parent.addStack();
  head.centerAlignContent();
  head.size = new Size(width, big ? 22 : 17);
  addText(head, "●", Font.systemFont(big ? 11 : 9), online ? COL.green : COL.dim2, 1);
  head.addSpacer(big ? 6 : 5);
  if (addFlag(head, server, big ? 22 : 18, big ? 16 : 13)) head.addSpacer(big ? 7 : 6);
  const name = addText(head, serverName(server), big ? Font.boldSystemFont(17) : FONT.name, online ? COL.fg : COL.dim, 1);
  name.minimumScaleFactor = 0.65;
  head.addSpacer();
  if (!online) {
    addText(head, offlineText(server), FONT.label, COL.red, 1);
  } else if (right) {
    addText(head, right.text, right.font || FONT.text, right.color || COL.dim, 1);
  }
}

// 网速：↓下载 ↑上传，居中
function addSpeed(parent, server, width, font) {
  const online = isOnline(server);
  const row = parent.addStack();
  row.centerAlignContent();
  row.size = new Size(width, 13);
  row.addSpacer();
  addText(row, `↓${shortBytes(server.net_in_speed)}/s`, font, online ? COL.cyan : COL.dim2, 1).minimumScaleFactor = 0.7;
  row.addSpacer(6);
  addText(row, `↑${shortBytes(server.net_out_speed)}/s`, font, online ? COL.blue : COL.dim2, 1).minimumScaleFactor = 0.7;
  row.addSpacer();
}

// ---------- 三网延迟 / 丢包柱状图 ----------

function carriers(server) {
  const list = [["ct", "电信"], ["cu", "联通"], ["cm", "移动"], ["bd", "BGP"]];
  return list
    .map(([key, name]) => ({ key, name: String(SYS[`custom_${key}_name`] || name), color: COL[key] || COL.cyan }))
    .filter(({ key }) => server[`ping_${key}`] !== false || (server.ping || []).some((p) => typeof p[key] === "number"));
}

// 按时间排好的 [{ ping, loss }]
// 后端会把窗口里每个时间桶都填满（includeEmpty）：没采样时 ping 是 null，
// 有采样但全超时时 ping 也是 null 而 loss 有值。所以只有 loss 也有值才算超时，
// 两者都是 null 只是"这一轮没数据"（探针重启 / 服务器新加 / 窗口中间断档）。
function latencySeries(server, key) {
  const lossMap = new Map((server.loss || []).map((p) => [p.ts, p[key]]));
  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const series = (server.ping || [])
    .filter((p) => p[key] !== false && p[key] !== undefined)
    .sort((a, b) => a.ts - b.ts)
    .map((p) => ({ ping: num(p[key]), loss: num(lossMap.get(p.ts)) }));
  if (!series.length && server[`ping_${key}`] !== false) {
    const ping = num(server[`ping_${key}`]);
    const loss = num(server[`loss_${key}`]);
    if (ping !== null || loss !== null) series.push({ ping, loss });
  }
  return series;
}

function isTimeout(sample) {
  return !!sample && typeof sample.ping !== "number" && typeof sample.loss === "number";
}

function latencyColor(ms) {
  return ms < 100 ? COL.green : ms < 200 ? COL.amber : COL.red;
}

// 最近一次有数据的采样：窗口最后一格可能还没上报，别因此把延迟显示成 "-"
function lastSample(series) {
  return series.slice().reverse().find((s) => typeof s.ping === "number" || typeof s.loss === "number");
}

function pingText(sample) {
  if (sample && typeof sample.ping === "number") {
    return sample.ping >= 1000 ? `${(sample.ping / 1000).toFixed(1)}s` : `${Math.round(sample.ping)}ms`;
  }
  return isTimeout(sample) ? "超时" : "-";
}

function pingColor(sample) {
  if (sample && typeof sample.ping === "number") return latencyColor(sample.ping);
  return isTimeout(sample) ? COL.red : COL.dim2;
}

// 一台服务器所有线路共用一个纵轴，方便横向比较。纵轴从最低延迟的 40% 开始，
// 否则延迟都差不多时每根柱子一样高，看不出波动；顶端取 90 分位，偶尔一次尖峰顶满，不会把其他柱子压扁
function latencyScale(server, list) {
  const values = [];
  for (const c of list) {
    for (const p of latencySeries(server, c.key)) if (typeof p.ping === "number") values.push(p.ping);
  }
  if (!values.length) return { lo: 0, hi: 100 };
  values.sort((a, b) => a - b);
  const lo = Math.floor(values[0] * 0.4);
  const p90 = values[Math.floor((values.length - 1) * 0.9)];
  return { lo, hi: Math.max(p90 * 1.15, lo + 20) };
}

// 每根柱子是一次采样（最新的在右）：高度 = 延迟，颜色 = 线路；顶部红色 = 丢包比例；
// 整根暗红 = 超时；只留底部一条轨道 = 这一轮没数据
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
      if (!isTimeout(sample)) continue;
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

// 每条线路一行：名字 | 当前延迟 | 柱状图 | 当前丢包
function addLatencyRows(parent, server, width, rowH, gap) {
  // 站点关了三网延迟开关就不画，跟网页端保持一致
  if (SYS.show_three_net_details === false) return;
  const list = carriers(server);
  if (!list.length) {
    addText(parent, "未配置三网延迟", FONT.text, COL.dim2, 1);
    return;
  }
  const scale = latencyScale(server, list);
  const nameW = 26;
  const valW = 40;
  const lossW = 28;
  const chartW = Math.max(24, width - nameW - valW - lossW - 12);
  list.forEach((c, i) => {
    if (i > 0) parent.addSpacer(gap);
    const series = latencySeries(server, c.key);
    const last = lastSample(series);
    const row = parent.addStack();
    row.centerAlignContent();
    row.size = new Size(width, rowH);
    addFixedText(row, c.name, nameW, FONT.label, c.color);
    row.addSpacer(4);
    addFixedText(row, pingText(last), valW, FONT.text, pingColor(last), true);
    row.addSpacer(4);
    const img = row.addImage(latencyChart(series, chartW, rowH, scale, c.color));
    img.imageSize = new Size(chartW, rowH);
    row.addSpacer(4);
    const loss = last && typeof last.loss === "number" ? Math.round(last.loss) : null;
    addFixedText(row, loss === null ? "-" : `${loss}%`, lossW, FONT.text, loss > 0 ? COL.red : COL.dim2, true);
  });
}

// 小尺寸用：三网当前延迟一行数字，"电 88  联 60  移 102"
function addLatencyNumbers(parent, server, width) {
  if (SYS.show_three_net_details === false) return;
  const list = carriers(server).slice(0, 3);
  if (!list.length) return;
  const row = parent.addStack();
  row.centerAlignContent();
  row.size = new Size(width, 13);
  list.forEach((c, i) => {
    if (i > 0) row.addSpacer();
    const last = lastSample(latencySeries(server, c.key));
    addText(row, c.name.slice(0, 1), FONT.label, c.color, 1);
    row.addSpacer(2);
    addText(row, pingText(last).replace(/ms$/, ""), FONT.text, pingColor(last), 1).minimumScaleFactor = 0.7;
  });
}

// ---------- 四种排版 ----------

// 中尺寸 / 大尺寸 2 台时的一张卡片：
//   ● 国旗 名字 …… 剩 N 天
//   CPU RAM DISK 三个圆环 + 网速 | 三网延迟柱状图
//   运行 · 负载 · 本月流量 …… 右下角（更新时间 / 页码，可选）
function addMediumBody(parent, server, w, h, corner) {
  addHeader(parent, server, w, false, expiryText(server));
  if (server._missing) return;

  const headH = 17;
  const footH = 12;
  const gap = 6;
  const bodyH = h - headH - footH - gap * 2;
  parent.addSpacer(gap);
  const body = parent.addStack();
  body.layoutHorizontally();
  body.size = new Size(w, bodyH);

  const leftW = 128;
  const left = fixedColumn(body, leftW, bodyH);
  left.addSpacer();
  const rings = left.addStack();
  rings.size = new Size(leftW, 0);
  const ringSize = bodyH >= 100 ? 38 : 34;
  addRing(rings, "CPU", Number(server.cpu) || 0, ringSize, leftW / 3);
  addRing(rings, "RAM", percent(server.ram_used, server.ram_total), ringSize, leftW / 3);
  addRing(rings, "DISK", percent(server.disk_used, server.disk_total), ringSize, leftW / 3);
  left.addSpacer(7);
  addSpeed(left, server, leftW, FONT.text);
  left.addSpacer();

  body.addSpacer(12);
  const rightW = w - leftW - 12;
  const right = fixedColumn(body, rightW, bodyH);
  const rowGap = 7;
  const rowH = Math.max(12, Math.min(19, Math.floor((bodyH - rowGap * 2) / 3) - 2));
  right.addSpacer();
  addLatencyRows(right, server, rightW, rowH, rowGap);
  right.addSpacer();

  parent.addSpacer(gap);
  const parts = [];
  const up = uptimeText(server);
  if (up) parts.push(`运行 ${up}`);
  if (loadText(server)) parts.push(`负载 ${loadText(server)}`);
  parts.push(`本月 ↓${shortBytes(server.net_rx_monthly)} ↑${shortBytes(server.net_tx_monthly)}`);
  if (showTraffic() && server.traffic_limit) parts.push(`额度 ${Math.round(trafficPercent(server))}%`);
  addSplitRow(parent, w, footH, { text: parts.join(" · ") }, corner ? { text: corner } : null);
}

// 小尺寸：名字 / 三个圆环 / 网速 / 三网延迟数字 / 到期 + 更新时间
function addSmallBody(parent, server, w, h, corner) {
  addHeader(parent, server, w, false, null);
  if (server._missing) return;
  parent.addSpacer(8);
  const rings = parent.addStack();
  rings.size = new Size(w, 0);
  addRing(rings, "CPU", Number(server.cpu) || 0, 40, w / 3);
  addRing(rings, "RAM", percent(server.ram_used, server.ram_total), 40, w / 3);
  addRing(rings, "DISK", percent(server.disk_used, server.disk_total), 40, w / 3);
  parent.addSpacer();
  addSpeed(parent, server, w, FONT.text);
  parent.addSpacer(4);
  addLatencyNumbers(parent, server, w);
  parent.addSpacer(4);
  const exp = expiryText(server);
  addSplitRow(parent, w, 11, exp ? { text: exp.text, color: exp.color } : null, { text: corner });
}

// 大尺寸 1 台：名字 / 系统信息 / 四个大圆环 / 信息框 / 三网延迟柱状图 / 更新时间
function addLargeBody(parent, server, w, h, corner) {
  addHeader(parent, server, w, true, { text: "online", font: FONT.label, color: COL.green });
  if (server._missing) return;

  parent.addSpacer(3);
  const sys = [server.os, server.cpu_cores ? `${server.cpu_cores} 核` : "", server.arch].filter(Boolean);
  if (uptimeText(server)) sys.push(`运行 ${uptimeText(server)}`);
  const exp = expiryText(server);
  addSplitRow(parent, w, 12, { text: sys.join(" · ") }, exp ? { text: exp.text, color: exp.color } : null);

  parent.addSpacer();
  const rings = [
    ["CPU", Number(server.cpu) || 0, loadText(server) ? `负载 ${loadText(server)}` : `${server.cpu_cores || "-"} 核`],
    ["RAM", percent(server.ram_used, server.ram_total), `${shortMB(server.ram_used)} / ${shortMB(server.ram_total)}`],
    ["DISK", percent(server.disk_used, server.disk_total), `${shortMB(server.disk_used)} / ${shortMB(server.disk_total)}`]
  ];
  if (showTraffic() && server.traffic_limit) {
    rings.push(["流量", trafficPercent(server), `${shortBytes(trafficUsedBytes(server))} / ${shortBytes(trafficLimitBytes(server.traffic_limit))}`]);
  } else if (Number(server.swap_total) > 0) {
    rings.push(["SWAP", percent(server.swap_used, server.swap_total), `${shortMB(server.swap_used)} / ${shortMB(server.swap_total)}`]);
  }
  const ringRow = parent.addStack();
  ringRow.size = new Size(w, 0);
  rings.forEach(([label, value, sub]) => addRing(ringRow, label, value, 56, w / rings.length, sub));

  parent.addSpacer();
  const online = isOnline(server);
  const io = server.disk && typeof server.disk === "object" ? server.disk : null;
  const box = parent.addStack();
  box.layoutVertically();
  box.backgroundColor = COL.card;
  box.cornerRadius = 10;
  box.setPadding(8, 12, 8, 12);
  box.size = new Size(w, 0);
  const cellW = (w - 24 - 14) / 2;
  const cells = [
    [["下载", `${shortBytes(server.net_in_speed)}/s`, online ? COL.cyan : COL.dim2], ["上传", `${shortBytes(server.net_out_speed)}/s`, online ? COL.blue : COL.dim2]],
    [["本月 ↓", shortBytes(server.net_rx_monthly)], ["本月 ↑", shortBytes(server.net_tx_monthly)]],
    [["磁盘读写", io ? `${shortBytes(io.read_bps)} / ${shortBytes(io.write_bps)}/s` : "-"], ["TCP · 进程", `${server.tcp_conn ?? "-"} · ${server.processes ?? "-"}`]]
  ];
  cells.forEach((pair, i) => {
    if (i > 0) box.addSpacer(5);
    const row = box.addStack();
    row.centerAlignContent();
    pair.forEach(([key, value, color], j) => {
      if (j > 0) row.addSpacer(14);
      const cell = row.addStack();
      cell.centerAlignContent();
      cell.size = new Size(cellW, 13);
      addText(cell, key, FONT.text, COL.dim2, 1);
      cell.addSpacer();
      addText(cell, value, FONT.text, color || COL.fg, 1).minimumScaleFactor = 0.7;
    });
  });

  parent.addSpacer();
  addLatencyRows(parent, server, w, 18, 7);
  parent.addSpacer(6);
  addSplitRow(parent, w, 11, null, { text: corner });
}

// 大尺寸 2 台：顶部一行总览，下面两张中尺寸样式的卡片
function addTwoCards(parent, data, w, h, corner) {
  const pg = data.pageInfo;
  const left = `${data.stats.online}/${data.stats.total} 在线${pg.count > 1 ? ` · ${pg.index}/${pg.count} 页` : ""}`;
  addSplitRow(parent, w, 12, { text: left, font: FONT.label, color: data.stats.offline ? COL.amber : COL.green }, { text: corner });
  const topGap = 6;
  const cardGap = 6;
  const cardH = Math.floor((h - 12 - topGap - cardGap) / 2);
  data.servers.forEach((server, i) => {
    parent.addSpacer(i === 0 ? topGap : cardGap);
    const card = parent.addStack();
    card.layoutVertically();
    card.backgroundColor = COL.card;
    card.cornerRadius = 14;
    card.setPadding(10, 12, 10, 12);
    card.size = new Size(w, cardH);
    addMediumBody(card, server, w - 24, cardH - 20, null);
  });
}

// 小组件内边距（pt）
const PAD = { small: [13, 12], medium: [12, 14], large1: [14, 14], large2: [10, 10] };

function buildWidget(data) {
  const widget = baseWidget();
  const pg = data.pageInfo;
  if (!data.servers.length) {
    return errWidget(pg.index > pg.count ? `第 ${pg.index} 页没有机器（现在共 ${pg.count} 页），可以把这个小组件删掉` : "No matching servers");
  }

  const two = family === "large" && data.servers.length >= 2;
  const [py, px] = PAD[family === "large" ? (two ? "large2" : "large1") : family];
  widget.setPadding(py, px, py, px);
  const size = widgetSize();
  const w = size.w - px * 2;
  const h = size.h - py * 2;
  const root = widget.addStack();
  root.layoutVertically();
  root.size = new Size(w, h);

  const time = data.staleAt ? `⚠ 缓存 ${cacheTime(data.staleAt)}` : hhmm();
  const corner = (!two && pg.count > 1 ? `${pg.index}/${pg.count} 页 · ` : "") + (data.staleAt || family === "small" ? time : `更新 ${time}`);
  const server = data.servers[0];
  if (two) addTwoCards(root, data, w, h, corner);
  else if (family === "small") addSmallBody(root, server, w, h, corner);
  else if (family === "large") addLargeBody(root, server, w, h, corner);
  else addMediumBody(root, server, w, h, corner);
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
