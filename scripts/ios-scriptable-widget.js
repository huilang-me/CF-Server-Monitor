// CF Server Monitor - iOS Scriptable widget
// Paste this file into Scriptable, then edit CONFIG.baseURL.
// Server id is required. Set the Scriptable widget parameter to the server id:
//   server-id
//   id:server-id
// Put multiple widget instances in an iOS widget stack, each with a different server id, to swipe between servers.

const CONFIG = {
  baseURL: "https://www.exmaple.com", //必填
  serverId: "", //必填，也可以在widgetParameter中指定
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
  blue: new Color("#58a6ff"),
  cyan: new Color("#39d2c0"),
  track: new Color("#ffffff", 0.12)
};

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
  const v = n.toFixed(1);
  return `${v} ${units[i]}`;
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

function hhmm() {
  const d = new Date();
  const p = (n) => (n < 10 ? "0" : "") + n;
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

async function fetchJSON(path) {
  const req = new Request(CONFIG.baseURL + path);
  req.timeoutInterval = 15;
  if (CONFIG.userAgent) req.headers = { "User-Agent": CONFIG.userAgent };
  return await req.loadJSON();
}

async function fetchServer(id) {
  const data = await fetchJSON(`/api/server?id=${encodeURIComponent(id)}`) || {};
  if (data.error) throw new Error(`${id}: ${data.error}`);
  return data.data && typeof data.data === "object" ? data.data : data;
}

async function loadServers() {
  const id = requiredServerId();
  if (!id) throw new Error("Server id is required. Set the widget parameter.");

  const server = await fetchServer(id);
  server._flagRegionCode = getFlagRegionCode(server.region);
  server._flagImage = await fetchFlagImage(server.region);
  const online = isOnline(server);
  return {
    servers: [server],
    stats: {
      total: 1,
      online: online ? 1 : 0,
      offline: online ? 0 : 1
    },
    serverId: id
  };
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

function addMetricColumn(parent, label, value, width) {
  const col = parent.addStack();
  col.layoutVertically();
  col.spacing = 3;
  const top = col.addStack();
  top.centerAlignContent();
  addText(top, label, Font.semiboldSystemFont(9), COL.dim, 1);
  top.addSpacer();
  addText(top, `${Math.round(clampPercent(value))}%`, Font.systemFont(9), COL.dim2, 1);
  const img = col.addImage(barImg(value, width, 6, usageColor(value)));
  img.imageSize = new Size(width, 6);
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

function addServerRow(widget, server, large) {
  const online = isOnline(server);
  const cpu = Number(server.cpu) || 0;
  const ram = percent(server.ram_used, server.ram_total);
  const disk = percent(server.disk_used, server.disk_total);
  const traffic = trafficPercent(server);

  const head = widget.addStack();
  head.centerAlignContent();
  addText(head, "●", Font.systemFont(9), online ? COL.green : COL.dim2, 1);
  head.addSpacer(5);
  if (addFlag(head, server, 20, 15)) head.addSpacer(5);
  const name = addText(head, serverName(server), Font.semiboldSystemFont(large ? 13 : 12), COL.fg, 1);
  name.minimumScaleFactor = 0.75;
  head.addSpacer();
  const status = online
    ? `↓ ${formatBytes(server.net_in_speed)}/s  ↑ ${formatBytes(server.net_out_speed)}/s`
    : "offline";
  const st = addText(head, status, Font.systemFont(large ? 10 : 9), online ? COL.dim : COL.red, 1);
  st.minimumScaleFactor = 0.7;

  widget.addSpacer(5);
  const metrics = widget.addStack();
  metrics.layoutHorizontally();
  addMetricColumn(metrics, "CPU", cpu, large ? 86 : 76);
  metrics.addSpacer(8);
  addMetricColumn(metrics, "RAM", ram, large ? 86 : 76);
  metrics.addSpacer(8);
  addMetricColumn(metrics, "DISK", disk, large ? 86 : 76);

  if (server.traffic_limit) {
    widget.addSpacer(5);
    addBar(widget, "TRF", traffic, large ? 245 : 216, 6);
  }
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

  widget.addSpacer(10);
  addBar(widget, "CPU", cpu, 76, 7);
  widget.addSpacer(6);
  addBar(widget, "RAM", ram, 76, 7);
  widget.addSpacer(6);
  addBar(widget, "DSK", disk, 76, 7);

  widget.addSpacer();
  const net = widget.addText(online
    ? `↓ ${formatBytes(server.net_in_speed)}/s\n↑ ${formatBytes(server.net_out_speed)}/s`
    : "offline");
  net.font = Font.systemFont(10);
  net.textColor = online ? COL.dim : COL.red;
  net.lineLimit = 2;
}

function addNetLine(parent, label, value, color) {
  const row = parent.addStack();
  row.centerAlignContent();
  addText(row, label, Font.semiboldSystemFont(10), COL.dim, 1);
  row.addSpacer();
  const speed = addText(row, `${formatBytes(value)}/s`, Font.systemFont(11), color, 1);
  speed.minimumScaleFactor = 0.7;
}

function addSingleServer(widget, server, large, small) {
  if (small) {
    addSmallServer(widget, server);
    widget.addSpacer(3);
    addText(widget, `Updated ${hhmm()}`, Font.systemFont(8), COL.dim2, 1).centerAlignText();
    return;
  }

  const online = isOnline(server);
  const cpu = Number(server.cpu) || 0;
  const ram = percent(server.ram_used, server.ram_total);
  const disk = percent(server.disk_used, server.disk_total);
  const traffic = trafficPercent(server);

  const head = widget.addStack();
  head.centerAlignContent();
  addText(head, "●", Font.systemFont(large ? 12 : 11), online ? COL.green : COL.dim2, 1);
  head.addSpacer(6);
  if (addFlag(head, server, large ? 24 : 22, large ? 18 : 16)) head.addSpacer(6);
  const name = addText(head, serverName(server), Font.boldSystemFont(large ? 18 : 16), COL.fg, 1);
  name.minimumScaleFactor = 0.65;
  head.addSpacer();
  addText(head, online ? "online" : "offline", Font.semiboldSystemFont(11), online ? COL.green : COL.red, 1);

  widget.addSpacer(3);
  addText(widget, `Updated ${hhmm()}`, Font.systemFont(9), COL.dim2, 1);
  widget.addSpacer(large ? 16 : 13);
  const metrics = widget.addStack();
  metrics.layoutHorizontally();
  addMetricColumn(metrics, "CPU", cpu, large ? 86 : 76);
  metrics.addSpacer(8);
  addMetricColumn(metrics, "RAM", ram, large ? 86 : 76);
  metrics.addSpacer(8);
  addMetricColumn(metrics, "DISK", disk, large ? 86 : 76);

  if (server.traffic_limit) {
    widget.addSpacer(large ? 13 : 10);
    addBar(widget, "TRF", traffic, large ? 245 : 216, 7);
  }

  widget.addSpacer();
  const net = widget.addStack();
  net.layoutHorizontally();
  const down = net.addStack();
  down.layoutVertically();
  addNetLine(down, "DOWN", server.net_in_speed, online ? COL.cyan : COL.dim2);
  net.addSpacer(large ? 28 : 18);
  const up = net.addStack();
  up.layoutVertically();
  addNetLine(up, "UP", server.net_out_speed, online ? COL.blue : COL.dim2);
}

function buildWidget(data) {
  const servers = data.servers;
  const widget = baseWidget();
  const large = family === "large";
  const small = family === "small";
  widget.setPadding(small ? 12 : 14, small ? 13 : 15, small ? 12 : 14, small ? 13 : 15);

  if (!servers.length) return errWidget("No matching servers");

  addSingleServer(widget, servers[0], large, small);
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
