// CF Server Monitor - iOS Scriptable widget (三网 Ping 版)
// 显示：在线状态 + 内存占用 + 电信 / 联通 / 移动 / BGP 延迟（带迷你趋势柱）
// 用法：粘贴进 Scriptable，改 CONFIG.baseURL；小组件 Parameter 填服务器 id（也支持 id:xxx）

const CONFIG = {
  baseURL: "https://monitor.m1ss.xyz", //必填
  serverId: "" //必填，也可以在 widgetParameter 中指定
};

CONFIG.baseURL = String(CONFIG.baseURL || "").replace(/\/+$/, "");

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

function isOnline(server) {
  const ts = normalizeTimestamp(server.report_timestamp || server.last_updated || server.timestamp);
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
  return `${n.toFixed(1)} ${units[i]}`;
}

// 该项目的 ram_used / ram_total 以 MB 上报，数值很大时才按字节处理
function ramBytes(value) {
  const n = Number(value) || 0;
  if (n <= 0) return 0;
  return n < 1000000 ? n * 1024 * 1024 : n;
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

function pingHex(v) {
  if (!validPingValue(v)) return "#6e7681";
  if (v < PING_WARN) return "#3fb950";
  if (v < PING_BAD) return "#d29922";
  return "#f85149";
}

function pingColor(v) {
  return new Color(pingHex(v));
}

function formatPing(v) {
  if (!validPingValue(v)) return "--";
  return `${Math.round(v)}ms`;
}

function hhmm() {
  const d = new Date();
  const p = (n) => (n < 10 ? "0" : "") + n;
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

async function fetchJSON(url, timeout) {
  const req = new Request(url);
  req.timeoutInterval = timeout || 15;
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
  if (payload && payload.error) throw new Error(`${id}: ${payload.error}`);
  const data = unwrap(payload) || {};
  return data && typeof data === "object" ? data : {};
}

async function fetchListServer(id) {
  try {
    const payload = await fetchJSON(`${CONFIG.baseURL}/api/servers`, 12);
    const root = unwrap(payload) || {};
    const list = Array.isArray(root.servers) ? root.servers : Array.isArray(payload) ? payload : [];
    return list.find((s) => String(s.id) === String(id)) || null;
  } catch (e) {
    return null;
  }
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

  const server = await fetchServer(id);
  const online = isOnline(server);

  const nodes = [];
  NODES.forEach((node) => {
    const parsed = parsePing(server[`ping_${node.key}`]);
    if (!parsed.disabled) nodes.push({ key: node.key, label: node.label, value: parsed.value });
  });

  let history = { ct: [], cu: [], cm: [], bd: [] };
  if (nodes.length) {
    const item = await fetchListServer(id);
    if (item) {
      history = extractHistory(item);
      // /api/server 没取到值时，用列表里的当前值兜底
      nodes.forEach((node) => {
        if (validPingValue(node.value)) return;
        const fallback = parsePing(item[`ping_${node.key}`]);
        if (validPingValue(fallback.value)) node.value = fallback.value;
      });
    }
  }

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
  const dc = new DrawContext();
  dc.size = new Size(width, height);
  dc.opaque = false;
  dc.respectScreenScale = true;

  const n = values.length;
  const gap = n > 20 ? 1 : 2;
  const bw = Math.max(1, (width - gap * (n - 1)) / n);
  let max = 0;
  values.forEach((v) => {
    if (validPingValue(v) && v > max) max = v;
  });
  if (max <= 0) max = 1;

  for (let i = 0; i < n; i++) {
    const v = values[i];
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

  if (opts.detail) {
    addText(row, opts.detail, Font.systemFont(9), COL.dim2, 1);
    row.addSpacer(8);
  }

  const val = addText(row, opts.valid === false ? "--" : `${Math.round(clampPercent(pct))}%`, Font.systemFont(10), COL.dim, 1);
  val.rightAlignText();
}

function addPingRow(parent, node, series, opts) {
  const row = parent.addStack();
  row.centerAlignContent();

  const labelBox = row.addStack();
  labelBox.size = new Size(opts.labelW, 12);
  const label = addText(labelBox, node.label, Font.semiboldSystemFont(opts.labelFont), COL.dim, 1);
  label.minimumScaleFactor = 0.8;

  if (opts.sparkW) {
    row.addSpacer(6);
    const img = sparkImg(series, opts.sparkW, opts.sparkH, pingHex(node.value));
    if (img) {
      const el = row.addImage(img);
      el.imageSize = new Size(opts.sparkW, opts.sparkH);
    }
  }

  row.addSpacer();
  const value = addText(row, formatPing(node.value), Font.systemFont(opts.valueFont), pingColor(node.value), 1);
  value.rightAlignText();
}

function emptyHint(parent, text) {
  addText(parent, text, Font.systemFont(11), COL.dim2, 2);
}

function buildFull(widget, data, large) {
  const { server, nodes, history, online } = data;

  const head = widget.addStack();
  head.centerAlignContent();
  addText(head, "●", Font.systemFont(large ? 12 : 11), online ? COL.green : COL.dim2, 1);
  head.addSpacer(6);
  if (addFlag(head, server, large ? 24 : 22, large ? 18 : 16)) head.addSpacer(6);
  const name = addText(head, serverName(server), Font.boldSystemFont(large ? 18 : 16), COL.fg, 1);
  name.minimumScaleFactor = 0.6;
  head.addSpacer();
  addText(head, online ? hhmm() : "offline", Font.systemFont(large ? 11 : 10), online ? COL.dim2 : COL.red, 1);

  const ramUsed = Number(server.ram_used) || 0;
  const ramTotal = Number(server.ram_total) || 0;
  const ram = percent(ramUsed, ramTotal);
  const cpu = Number(server.cpu);
  const cpuValid = Number.isFinite(cpu);

  widget.addSpacer(large ? 16 : 7);
  addMetricBar(widget, "RAM", ram, {
    labelW: 28,
    barW: large ? 158 : 238,
    barH: large ? 7 : 6,
    valid: ramTotal > 0,
    detail: large && ramTotal > 0 ? `${formatBytes(ramBytes(ramUsed))} / ${formatBytes(ramBytes(ramTotal))}` : ""
  });

  widget.addSpacer(large ? 9 : 5);
  addMetricBar(widget, "CPU", cpu, {
    labelW: 28,
    barW: large ? 158 : 238,
    barH: large ? 7 : 6,
    valid: cpuValid,
    detail: large && server.cpu_cores ? `${server.cpu_cores} 核` : ""
  });

  widget.addSpacer(large ? 18 : 8);

  if (!nodes.length) {
    emptyHint(widget, "后台未配置三网 Ping 节点");
    if (large) widget.addSpacer();
    return;
  }

  const sparkAvailable = nodes.some((n) => {
    const s = history[n.key];
    return Array.isArray(s) && s.filter((v) => validPingValue(v)).length >= 2;
  });

  // 节点越少、行距越松，避免下方留大片空白
  const rowGap = large
    ? nodes.length >= 4 ? 16 : 26
    : nodes.length >= 4 ? 4 : 12;

  nodes.forEach((node, index) => {
    if (index > 0) widget.addSpacer(rowGap);
    addPingRow(widget, node, history[node.key] || [], {
      labelW: 28,
      labelFont: 9,
      valueFont: large ? 13 : 11,
      sparkW: sparkAvailable ? (large ? 216 : 218) : 0,
      sparkH: large ? 26 : 10
    });
  });

  if (large) {
    widget.addSpacer();
    const net = server.net_in_speed || server.net_out_speed
      ? `↓ ${formatBytes(server.net_in_speed)}/s   ↑ ${formatBytes(server.net_out_speed)}/s`
      : `updated ${hhmm()}`;
    const footer = addText(widget, net, Font.systemFont(10), COL.dim2, 1);
    footer.centerAlignText();
  }
}

function buildSmall(widget, data) {
  const { server, nodes, online } = data;

  const head = widget.addStack();
  head.centerAlignContent();
  addText(head, "●", Font.systemFont(10), online ? COL.green : COL.dim2, 1);
  head.addSpacer(5);
  if (addFlag(head, server, 18, 14)) head.addSpacer(5);
  const name = addText(head, serverName(server), Font.boldSystemFont(12), COL.fg, 1);
  name.minimumScaleFactor = 0.6;

  const ramTotal = Number(server.ram_total) || 0;
  const cpu = Number(server.cpu);

  widget.addSpacer(6);
  addMetricBar(widget, "RAM", percent(server.ram_used, ramTotal), {
    labelW: 26,
    barW: 54,
    barH: 5,
    valid: ramTotal > 0
  });
  widget.addSpacer(4);
  addMetricBar(widget, "CPU", cpu, {
    labelW: 26,
    barW: 54,
    barH: 5,
    valid: Number.isFinite(cpu)
  });
  widget.addSpacer(8);

  if (!nodes.length) {
    emptyHint(widget, "未配置三网 Ping");
  } else {
    nodes.forEach((node, index) => {
      if (index > 0) widget.addSpacer(nodes.length >= 4 ? 4 : 6);
      addPingRow(widget, node, [], { labelW: 26, labelFont: 9, valueFont: 12, sparkW: 0, sparkH: 0 });
    });
  }

  widget.addSpacer();
  const time = addText(widget, online ? hhmm() : "offline", Font.systemFont(9), online ? COL.dim2 : COL.red, 1);
  time.centerAlignText();
}

function buildWidget(data) {
  const large = family === "large";
  const small = family === "small";
  const widget = baseWidget();
  widget.setPadding(small ? 12 : 14, small ? 13 : 15, small ? 12 : 14, small ? 13 : 15);

  if (small) buildSmall(widget, data);
  else buildFull(widget, data, large);

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
    if (!CONFIG.baseURL || CONFIG.baseURL.includes("example.com")) {
      widget = errWidget("Set CONFIG.baseURL first.");
    } else {
      const data = await loadData();
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
