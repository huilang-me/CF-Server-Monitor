// CF Server Monitor - iOS Scriptable widget (三网 Ping 版)
// 显示：在线状态 + 内存占用 + 电信 / 联通 / 移动 / BGP 延迟（带迷你趋势柱）
// 用法：粘贴进 Scriptable，改 CONFIG.baseURL；小组件 Parameter 填服务器 id（也支持 id:xxx）

const CONFIG = {
  baseURL: "https://example.com", //必填
  serverId: "", //必填，也可以在 widgetParameter 中指定
  userAgent: "" //可选，填后台「安全设置 - 自定义 UA」；启用 Cloudflare 安全规则后必填
};

CONFIG.baseURL = String(CONFIG.baseURL || "").replace(/\/+$/, "");
CONFIG.userAgent = String(CONFIG.userAgent || "").trim();

const family = config.widgetFamily || "medium";
const widgetParameter = String(args.widgetParameter || "").trim();

const COL = {
  bg1: new Color("#0d1117"),
  bg2: new Color("#161b22"),
  fg: new Color("#e6edf3"),
  dim: new Color("#8b949e"),
  dim2: new Color("#6e7681"),
  green: new Color("#3fb950"),
  amber: new Color("#d29922"),
  red: new Color("#f85149"),
  track: new Color("#ffffff", 0.12)
};

// 延迟配色阈值（ms）
const PING_WARN = 60;
const PING_BAD = 120;

const NODES = [
  { key: "ct", label: "电信" },
  { key: "cu", label: "联通" },
  { key: "cm", label: "移动" },
  { key: "bd", label: "BGP" }
];

function normalizeServerId(value) {
  const raw = String(value || "").trim();
  const matched = raw.match(/^(?:id|server):(.+)$/i);
  if (matched) return matched[1].trim();
  return raw;
}

function requiredServerId() {
  return normalizeServerId(widgetParameter) || normalizeServerId(CONFIG.serverId);
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
    req.timeoutInterval = 3;
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

function isOnline(server) {
  const ts = normalizeTimestamp(server.last_updated);
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

// 解析三网延迟：false = 后台禁用该节点，null/空 = 本轮没取到
function parsePing(raw) {
  if (raw === false) return { disabled: true, value: null };
  if (raw === null || raw === undefined) return { disabled: false, value: null };
  const text = String(raw).trim().toLowerCase();
  if (text === "false") return { disabled: true, value: null };
  if (!text || text === "null" || text === "undefined") return { disabled: false, value: null };
  const n = parseFloat(text);
  if (!Number.isFinite(n) || n <= 0) return { disabled: false, value: null };
  return { disabled: false, value: n };
}

function validPingValue(v) {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}

// 三态：ok 有值 / timeout 有历史但当前取不到 / nodata 从未上报过
// 区分「超时」和「没数据」，避免服务器刚添加、agent 未上报时四行全红
function pingState(value, series) {
  if (validPingValue(value)) return "ok";
  return lastValidPing(series) !== null ? "timeout" : "nodata";
}

function pingHex(v) {
  if (!validPingValue(v)) return "#f85149";
  if (v < PING_WARN) return "#3fb950";
  if (v < PING_BAD) return "#d29922";
  return "#f85149";
}

function pingColor(state, v) {
  if (state === "nodata") return COL.dim2;
  return new Color(pingHex(v));
}

function formatPing(v, short, state) {
  if (state === "nodata") return "--";
  if (!validPingValue(v)) return short ? "T/O" : "time out";
  return `${Math.round(v)}ms`;
}

// 历史序列里最后一个有效值，用于决定趋势柱颜色（当前超时不让历史柱跟着变红）
function lastValidPing(series) {
  if (!Array.isArray(series)) return null;
  for (let i = series.length - 1; i >= 0; i--) {
    if (validPingValue(series[i])) return series[i];
  }
  return null;
}

function hhmm() {
  const d = new Date();
  const p = (n) => (n < 10 ? "0" : "") + n;
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

async function fetchJSON(url, timeout) {
  const req = new Request(url);
  req.timeoutInterval = timeout || 15;
  if (CONFIG.userAgent) req.headers = { "User-Agent": CONFIG.userAgent };
  return await req.loadJSON();
}

function unwrap(payload) {
  if (payload && payload.data && typeof payload.data === "object" && !Array.isArray(payload.data)) {
    return payload.data;
  }
  return payload;
}

async function fetchServer(id) {
  const payload = await fetchJSON(`${CONFIG.baseURL}/api/server?id=${encodeURIComponent(id)}`);
  if (payload && payload.error) throw new Error(payload.error);
  const data = unwrap(payload) || {};
  return data && typeof data === "object" ? data : {};
}

async function fetchListServer(id) {
  try {
    const payload = await fetchJSON(`${CONFIG.baseURL}/api/servers`, 12);
    const root = unwrap(payload) || {};
    const list = Array.isArray(root.servers) ? root.servers : Array.isArray(payload) ? payload : [];
    return {
      item: list.find((s) => String(s.id) === String(id)) || null,
      sysConfig: root && typeof root.sysConfig === "object" ? root.sysConfig : null
    };
  } catch (e) {
    return null;
  }
}

const NODE_NAME_KEYS = {
  ct: "custom_ct_name",
  cu: "custom_cu_name",
  cm: "custom_cm_name",
  bd: "custom_bd_name"
};

// 节点名跟随后台配置（sysConfig.custom_*_name），没配就保留默认中文名
function applyNodeNames(nodes, sysConfig) {
  if (!sysConfig) return;
  nodes.forEach((node) => {
    const key = NODE_NAME_KEYS[node.key];
    const name = key ? String(sysConfig[key] || "").trim() : "";
    if (name) node.label = name;
  });
}

// 趋势点：[{ ts, ct, cu, cm, bd }] → { ct: [...], cu: [...] }
function extractHistory(item) {
  const history = { ct: [], cu: [], cm: [], bd: [] };
  const points = item && Array.isArray(item.ping) ? item.ping : [];
  points.forEach((p) => {
    if (!p || typeof p !== "object") return;
    NODES.forEach((node) => {
      const v = Number(p[node.key]);
      history[node.key].push(Number.isFinite(v) && v > 0 ? v : null);
    });
  });
  return history;
}

async function loadData() {
  const id = requiredServerId();
  if (!id) throw new Error("Server id is required. Set the widget parameter.");

  // 两个接口互不依赖，并发发出，避免串行超时叠加（15s + 12s）撑爆小组件预算
  const [server, listResult] = await Promise.all([fetchServer(id), fetchListServer(id)]);
  const online = isOnline(server);

  const nodes = [];
  NODES.forEach((node) => {
    const raw = server[`ping_${node.key}`];
    const parsed = parsePing(raw);
    if (!parsed.disabled) nodes.push({ key: node.key, label: node.label, value: parsed.value, missing: raw === undefined });
  });

  let history = { ct: [], cu: [], cm: [], bd: [] };
  if (nodes.length && listResult) {
    applyNodeNames(nodes, listResult.sysConfig);
    if (listResult.item) {
      history = extractHistory(listResult.item);
      // 仅当单点接口完全没返回该字段时，才用列表里的当前值兜底；
      // 0 / null 是明确的超时，不能被旧值覆盖
      nodes.forEach((node) => {
        if (!node.missing || validPingValue(node.value)) return;
        const fallback = parsePing(listResult.item[`ping_${node.key}`]);
        if (validPingValue(fallback.value)) node.value = fallback.value;
      });
    }
  }

  // 旗帜要等 region 才知道地址，只能排在后面；超时压短，拿不到就不显示
  server._flagRegionCode = getFlagRegionCode(server.region);
  server._flagImage = await fetchFlagImage(server.region);

  return { server, nodes, history, online };
}

function baseWidget() {
  const w = new ListWidget();
  const bg = new LinearGradient();
  bg.colors = [COL.bg1, COL.bg2];
  bg.locations = [0, 1];
  w.backgroundGradient = bg;
  if (CONFIG.baseURL) w.url = CONFIG.baseURL;
  w.refreshAfterDate = new Date(Date.now() + 60 * 1000);
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

// 迷你趋势柱：按本行最大值归一化，缺点用短灰柱表示
function sparkImg(values, width, height, hex) {
  if (!Array.isArray(values) || values.length < 2) return null;
  // 后端 latency_window.points 可配，点数过多会把柱子挤成一条实心块，
  // 按可用宽度截断，只保留最近的点
  const maxPoints = Math.max(2, Math.floor(width / 4));
  const points = values.length > maxPoints ? values.slice(-maxPoints) : values;

  const dc = new DrawContext();
  dc.size = new Size(width, height);
  dc.opaque = false;
  dc.respectScreenScale = true;

  const n = points.length;
  const gap = n > 20 ? 1 : 2;
  const bw = Math.max(1, (width - gap * (n - 1)) / n);
  let max = 0;
  points.forEach((v) => {
    if (validPingValue(v) && v > max) max = v;
  });
  if (max <= 0) max = 1;

  for (let i = 0; i < n; i++) {
    const v = points[i];
    const x = i * (bw + gap);
    const ok = validPingValue(v);
    const h = ok ? Math.max(2, height * (v / max)) : Math.max(1.5, height * 0.16);
    const radius = Math.min(1.5, bw / 2);
    const path = new Path();
    path.addRoundedRect(new Rect(x, height - h, bw, h), radius, radius);
    dc.addPath(path);
    dc.setFillColor(ok ? new Color(hex, 0.45 + 0.5 * (v / max)) : new Color("#6e7681", 0.4));
    dc.fillPath();
  }

  return dc.getImage();
}

function addText(parent, text, font, color, lineLimit) {
  const t = parent.addText(String(text));
  t.font = font;
  t.textColor = color;
  if (lineLimit) t.lineLimit = lineLimit;
  return t;
}

function serverName(server) {
  return server.name || server.id || "Server";
}

// 按实际文字估算标签栏宽度（中文按全角算），让自定义节点名不被截断
function estimateLabelWidth(nodes, fontSize) {
  let max = 0;
  nodes.forEach((node) => {
    let w = 0;
    for (const ch of String(node.label || "")) {
      w += /[\u4e00-\u9fa5]/.test(ch) ? fontSize : fontSize * 0.58;
    }
    max = Math.max(max, w);
  });
  return Math.max(22, Math.min(56, Math.ceil(max) + 2));
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

// Scriptable 拿不到 widget 实际宽度，只能按屏幕估算。
// Device.screenSize() 在不同系统上可能返回点、也可能返回像素，先归一化成点再算，
// 否则会把屏宽算成三分之一，柱条只画到一半。
function screenShortSidePt() {
  try {
    const screen = Device.screenSize();
    const shortSide = Math.min(screen.width, screen.height);
    if (!Number.isFinite(shortSide) || shortSide <= 0) return 393;
    return shortSide > 460 ? shortSide / (Device.screenScale() || 2) : shortSide;
  } catch (e) {
    return 393;
  }
}

function widgetContentWidth() {
  const pt = screenShortSidePt();
  // 各机型 widget 宽度不同（SE / Pro / Pro Max / iPad），一律略低估，
  // 多余空间交给弹性 spacer，避免在小屏机上把右侧数值裁掉
  return {
    wide: Math.max(250, Math.min(360, Math.round(pt * 0.86))) - 30,
    small: Math.max(118, Math.round(pt * 0.4)) - 26
  };
}

function addMetricBar(parent, label, pct, opts) {
  const row = parent.addStack();
  row.centerAlignContent();

  const labelBox = row.addStack();
  labelBox.size = new Size(opts.labelW, 12);
  addText(labelBox, label, Font.semiboldSystemFont(9), COL.dim, 1);

  row.addSpacer(6);
  const img = row.addImage(barImg(pct, opts.barW, opts.barH, usageColor(pct)));
  img.imageSize = new Size(opts.barW, opts.barH);
  row.addSpacer();

  const val = addText(row, opts.valid === false ? "--" : `${Math.round(clampPercent(pct))}%`, Font.systemFont(10), COL.dim, 1);
  val.rightAlignText();
  val.minimumScaleFactor = 0.7;
}

function addPingRow(parent, node, series, opts) {
  const state = pingState(node.value, series);
  const row = parent.addStack();
  row.centerAlignContent();

  const labelBox = row.addStack();
  labelBox.size = new Size(opts.labelW, 12);
  const label = addText(labelBox, node.label, Font.semiboldSystemFont(opts.labelFont), COL.dim, 1);
  label.minimumScaleFactor = 0.7;

  if (opts.sparkW) {
    const points = opts.maxPoints ? series.slice(-opts.maxPoints) : series;
    const img = sparkImg(points, opts.sparkW, opts.sparkH, pingHex(lastValidPing(points)));
    if (img) {
      row.addSpacer(6);
      const el = row.addImage(img);
      el.imageSize = new Size(opts.sparkW, opts.sparkH);
    }
  }

  row.addSpacer();
  const value = addText(row, formatPing(node.value, opts.short, state), Font.systemFont(opts.valueFont), pingColor(state, node.value), 1);
  value.rightAlignText();
  value.minimumScaleFactor = 0.7;
}

function emptyHint(parent, text) {
  addText(parent, text, Font.systemFont(11), COL.dim2, 2);
}

function buildFull(widget, data) {
  const { server, nodes, history, online } = data;

  const head = widget.addStack();
  head.centerAlignContent();
  addText(head, "●", Font.systemFont(11), online ? COL.green : COL.dim2, 1);
  head.addSpacer(6);
  if (addFlag(head, server, 22, 16)) head.addSpacer(6);
  const name = addText(head, serverName(server), Font.boldSystemFont(16), COL.fg, 1);
  name.minimumScaleFactor = 0.6;
  head.addSpacer();
  addText(head, online ? hhmm() : "offline", Font.systemFont(10), online ? COL.dim2 : COL.red, 1);

  const ramTotal = Number(server.ram_total) || 0;
  const ram = percent(server.ram_used, ramTotal);
  const cpu = Number(server.cpu);

  const cw = widgetContentWidth().wide;
  const labelW = nodes.length ? estimateLabelWidth(nodes, 9) : 28;
  const barW = Math.max(90, cw - labelW - 6 - 30);
  const sparkW = Math.max(90, cw - labelW - 6 - 56);

  widget.addSpacer(7);
  addMetricBar(widget, "RAM", ram, {
    labelW: labelW,
    barW: barW,
    barH: 6,
    valid: ramTotal > 0
  });

  widget.addSpacer(5);
  addMetricBar(widget, "CPU", cpu, {
    labelW: labelW,
    barW: barW,
    barH: 6,
    valid: Number.isFinite(cpu)
  });

  widget.addSpacer(8);

  if (!nodes.length) {
    emptyHint(widget, "后台未配置三网 Ping 节点");
    return;
  }

  const sparkAvailable = nodes.some((n) => {
    const s = history[n.key];
    return Array.isArray(s) && s.filter((v) => validPingValue(v)).length >= 2;
  });

  const rowGap = nodes.length >= 4 ? 4 : 12;

  nodes.forEach((node, index) => {
    if (index > 0) widget.addSpacer(rowGap);
    addPingRow(widget, node, history[node.key] || [], {
      labelW: labelW,
      labelFont: 9,
      valueFont: 10,
      sparkW: sparkAvailable ? sparkW : 0,
      sparkH: 10
    });
  });
}

function buildSmall(widget, data) {
  const { server, nodes, history, online } = data;
  const dense = nodes.length >= 4;

  const head = widget.addStack();
  head.centerAlignContent();
  addText(head, "●", Font.systemFont(10), online ? COL.green : COL.dim2, 1);
  head.addSpacer(5);
  if (addFlag(head, server, 18, 14)) head.addSpacer(5);
  const name = addText(head, serverName(server), Font.boldSystemFont(12), COL.fg, 1);
  name.minimumScaleFactor = 0.6;

  const ramTotal = Number(server.ram_total) || 0;
  const cpu = Number(server.cpu);
  const cwSmall = widgetContentWidth().small;
  const labelW = nodes.length ? Math.min(42, estimateLabelWidth(nodes, 9)) : 22;
  const barW = Math.max(36, cwSmall - labelW - 6 - 28);
  const sparkW = Math.max(36, cwSmall - labelW - 6 - 36);

  widget.addSpacer(6);
  addMetricBar(widget, "RAM", percent(server.ram_used, ramTotal), {
    labelW: labelW,
    barW: barW,
    barH: 5,
    valid: ramTotal > 0
  });
  widget.addSpacer(4);
  addMetricBar(widget, "CPU", cpu, {
    labelW: labelW,
    barW: barW,
    barH: 5,
    valid: Number.isFinite(cpu)
  });
  widget.addSpacer(dense ? 5 : 7);

  if (!nodes.length) {
    emptyHint(widget, "未配置三网 Ping");
  } else {
    const sparkAvailable = nodes.some((n) => {
      const s = history[n.key];
      return Array.isArray(s) && s.filter((v) => validPingValue(v)).length >= 2;
    });
    nodes.forEach((node, index) => {
      if (index > 0) widget.addSpacer(dense ? 4 : 5);
      addPingRow(widget, node, history[node.key] || [], {
        labelW: labelW,
        labelFont: 9,
        valueFont: 10,
        sparkW: sparkAvailable ? sparkW : 0,
        sparkH: 11,
        maxPoints: 10,
        short: true
      });
    });
  }

  if (!dense) {
    widget.addSpacer();
    const time = addText(widget, online ? hhmm() : "offline", Font.systemFont(9), online ? COL.dim2 : COL.red, 1);
    time.centerAlignText();
  }
}

function buildWidget(data) {
  const small = family === "small";
  const widget = baseWidget();
  widget.setPadding(small ? 12 : 14, small ? 13 : 15, small ? 12 : 14, small ? 13 : 15);

  if (small) buildSmall(widget, data);
  else buildFull(widget, data);

  return widget;
}

function hintWidget(message) {
  const widget = baseWidget();
  widget.setPadding(14, 15, 14, 15);
  widget.addSpacer();
  addText(widget, message, Font.systemFont(12), COL.red, 3).centerAlignText();
  widget.addSpacer();
  return widget;
}

async function main() {
  let widget;
  try {
    if (!CONFIG.baseURL || CONFIG.baseURL.includes("example.com") || CONFIG.baseURL.includes("exmaple.com")) {
      widget = hintWidget("Set CONFIG.baseURL");
    } else if (!requiredServerId()) {
      widget = hintWidget("Set server id");
    } else {
      widget = buildWidget(await loadData());
    }
  } catch (e) {
    widget = hintWidget("Request failed: " + (e.message || e));
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
