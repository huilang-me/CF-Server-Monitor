import { getLatestMetricsForAllServers } from '../database/schema.js';
import { clearServersListCache, getAllServers } from '../utils/cache.js';
import { getExpireReminderDays, getResourceAlertConfig, getResourceAlertRuleThresholds, getTgNotifyMinutes, loadSiteSettings, debug } from '../utils/settings.js';
import { detectBillingCycle, normalizeBillingCycle, renewExpireDateIfNeeded } from '../utils/serverBilling.js';

const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;
const RESOURCE_ALERT_EVALUATE_RULE_BATCH_SIZE = 20;
const RESOURCE_ALERT_EVALUATE_SERVER_BATCH_SIZE = 500;
const RESOURCE_ALERT_STATE_ACTIVE = 'active';
const RESOURCE_ALERT_STATE_RECOVERED = 'recovered';
const RESOURCE_ALERT_STATE_KEY = 'resource_alert_state';

function formatLastReportTime(timestamp) {
  if (!timestamp) return '无上报记录';

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '无效时间';

  return date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
}

function formatMegabitsPerSecond(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return '0 Mbps';
  const mbps = number * 8 / 1000 / 1000;
  return `${mbps >= 10 ? mbps.toFixed(1) : mbps.toFixed(2)} Mbps`;
}

function formatPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '0%';
  return `${number.toFixed(number >= 10 ? 1 : 2)}%`;
}

function formatResourceMetric(metric) {
  const metricLabels = {
    cpu: 'CPU',
    ram: 'RAM',
    disk: 'DISK',
    netIn: '下行网速',
    netOut: '上行网速',
    netTotal: '总网速'
  };
  const label = metricLabels[metric.metric] || metric.metric;
  const valueLabel = metric.mode === 'average' ? '平均' : '当前';
  const value = metric.triggerValue ?? metric.current;
  if (metric.metric === 'cpu' || metric.metric === 'ram' || metric.metric === 'disk') {
    return `${label} ${valueLabel} ${formatPercent(value)} > ${formatPercent(metric.threshold)}`;
  }
  return `${label} ${valueLabel} ${formatMegabitsPerSecond(value)} > ${formatMegabitsPerSecond(metric.threshold)}`;
}

function getResourceMetricLabel(metric) {
  const metricLabels = {
    cpu: 'CPU',
    ram: 'RAM',
    disk: 'DISK',
    netIn: '下行网速',
    netOut: '上行网速',
    netTotal: '总网速'
  };
  return metricLabels[metric?.metric] || metric?.metric || '';
}

function formatResourceMetricValue(metric, value) {
  if (metric?.metric === 'cpu' || metric?.metric === 'ram' || metric?.metric === 'disk') {
    return formatPercent(value);
  }
  return formatMegabitsPerSecond(value);
}

function formatRecoveredResourceMetric(metric) {
  if (!metric || typeof metric !== 'object') return '';
  const label = getResourceMetricLabel(metric);
  const value = metric.current;
  const valueText = formatResourceMetricValue(metric, value);
  const thresholdText = formatResourceMetricValue(metric, metric.threshold);

  return `${label} 当前 ${valueText} < ${thresholdText}`;
}

function parseResourceAlertState(row) {
  if (!row || !row.value) return { signature: '', servers: {} };
  try {
    const parsed = JSON.parse(row.value);
    if (parsed && typeof parsed === 'object' && parsed.servers && typeof parsed.servers === 'object') {
      return {
        signature: String(parsed.signature || ''),
        servers: parsed.servers
      };
    }
  } catch (_) {}
  return { signature: '', servers: {} };
}

function hasResourceAlertStateEntries(alertState) {
  return alertState && typeof alertState === 'object' && Object.keys(alertState).length > 0;
}

function getD1Changes(result) {
  const changes = Number(result?.meta?.changes ?? result?.changes ?? 0);
  return Number.isFinite(changes) && changes > 0 ? changes : 0;
}

export async function clearResourceAlertState(db) {
  if (!db) return false;
  const result = await db.prepare(
    `DELETE FROM settings WHERE key = ?`
  ).bind(RESOURCE_ALERT_STATE_KEY).run();
  return getD1Changes(result) > 0;
}

async function saveResourceAlertState(db, configSignature, alertState, hadStoredState) {
  if (hasResourceAlertStateEntries(alertState)) {
    await db.prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    ).bind(RESOURCE_ALERT_STATE_KEY, JSON.stringify({ signature: configSignature, servers: alertState })).run();
    return;
  }

  if (hadStoredState) {
    await clearResourceAlertState(db);
  }
}

function getResourceAlertStateStatus(state) {
  if (!state || typeof state !== 'object') return RESOURCE_ALERT_STATE_ACTIVE;
  return state.status === RESOURCE_ALERT_STATE_RECOVERED
    ? RESOURCE_ALERT_STATE_RECOVERED
    : RESOURCE_ALERT_STATE_ACTIVE;
}

function getResourceAlertStateTimestamp(state, key) {
  if (!state || typeof state !== 'object') return 0;
  const timestamp = Number(state[key] || 0);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : 0;
}

function getStoredResourceAlertMetrics(alert) {
  return (alert?.metrics || []).map(m => ({
    metric: m.metric,
    mode: m.mode,
    threshold: m.threshold,
    triggerValue: m.triggerValue ?? m.current
  }));
}

function canRecoverResourceAlert(evaluation) {
  const metrics = Array.isArray(evaluation?.metrics) ? evaluation.metrics : [];
  return metrics.length > 0 && metrics.every(metric => {
    const current = Number(metric?.current);
    const threshold = Number(metric?.threshold);
    return Number.isFinite(current) && Number.isFinite(threshold) && current < threshold;
  });
}

function getResourceAlertRuleIntervalMs(rule) {
  const minutes = Number(rule?.intervalMinutes);
  const normalizedMinutes = Number.isFinite(minutes) && minutes > 0 ? minutes : 5;
  return Math.max(5, normalizedMinutes) * 60 * 1000;
}

function formatCurrentTime() {
  return new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
}

function getResourceAlertRuleStateKey(rule, serverId) {
  return `${rule.id}:${serverId}`;
}

function getResourceAlertRuleName(rule) {
  return String(rule?.name || '资源负载告警').trim() || '资源负载告警';
}

function getResourceAlertRuleServerIds(rule, servers) {
  const allServerIds = servers.map(server => String(server.id)).filter(Boolean);
  if (!Array.isArray(rule.servers) || rule.servers.length === 0) {
    return allServerIds;
  }

  const allowed = new Set(allServerIds);
  const seen = new Set();
  const ids = [];
  for (const serverId of rule.servers) {
    const id = String(serverId || '').trim();
    if (!id || !allowed.has(id) || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

async function evaluateResourceAlertRules(stub, ruleRequests) {
  const resultMap = new Map();
  const requests = [];

  for (const item of Array.isArray(ruleRequests) ? ruleRequests : []) {
    const serverIds = Array.isArray(item?.serverIds) ? item.serverIds : [];
    for (let offset = 0; offset < serverIds.length; offset += RESOURCE_ALERT_EVALUATE_SERVER_BATCH_SIZE) {
      requests.push({
        rule: item.rule,
        serverIds: serverIds.slice(offset, offset + RESOURCE_ALERT_EVALUATE_SERVER_BATCH_SIZE)
      });
    }
  }

  for (let offset = 0; offset < requests.length; offset += RESOURCE_ALERT_EVALUATE_RULE_BATCH_SIZE) {
    const batch = requests.slice(offset, offset + RESOURCE_ALERT_EVALUATE_RULE_BATCH_SIZE);
    if (batch.length === 0) continue;

    try {
      const response = await stub.fetch('http://internal/evaluate-resource-alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rules: batch.map(({ rule, serverIds }) => ({
            ruleId: rule.id,
            serverIds,
            mode: rule.mode,
            windowMinutes: Number(rule.intervalMinutes),
            thresholds: getResourceAlertRuleThresholds(rule)
          }))
        })
      });

      if (!response.ok) {
        console.warn('[ResourceAlert] DO evaluate failed:', response.status);
        continue;
      }

      const result = await response.json();
      for (const item of Array.isArray(result?.results) ? result.results : []) {
        const ruleId = String(item?.ruleId || '').trim();
        if (!ruleId) continue;
        const existing = resultMap.get(ruleId) || {
          alerts: [],
          evaluatedServerIds: [],
          evaluations: []
        };
        existing.alerts.push(...(Array.isArray(item.alerts) ? item.alerts : []));
        existing.evaluatedServerIds.push(...(
          Array.isArray(item.evaluatedServerIds)
            ? item.evaluatedServerIds.map(id => String(id)).filter(Boolean)
            : []
        ));
        existing.evaluations.push(...(
          Array.isArray(item.evaluations)
            ? item.evaluations.filter(evaluation => evaluation && evaluation.serverId)
            : []
        ));
        resultMap.set(ruleId, existing);
      }
    } catch (e) {
      console.warn('[ResourceAlert] DO evaluate failed:', e?.message || e);
    }
  }

  return resultMap;
}

async function fetchWithRetry(url, options, retries = MAX_RETRIES) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, options);
      if (response.ok) return response;
      
      if (i < retries - 1) {
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
      }
    } catch (e) {
      if (i < retries - 1) {
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
      } else {
        throw e;
      }
    }
  }
  throw new Error('Max retries exceeded');
}


export function hasNotifyChannel(settings) {
  if (!settings) return false;
  if (settings.tg_bot_token && String(settings.tg_bot_token).trim().length > 0) return true;
  if (settings.notify_type === 'custom_http' && settings.notify_http_url && String(settings.notify_http_url).trim().length > 0) return true;
  return false;
}

export async function sendNotification(settings, msg) {
  if(!settings.tg_bot_token && !hasNotifyChannel(settings)) return;

  // 自定义 HTTP Webhook（如 WXPush 微信模板消息中继：POST {title, content} + Authorization 头）
  if (settings.notify_type === 'custom_http' && settings.notify_http_url) {
    try {
      const httpTitle = "💌 Cloudflare Server Monitor";
      const body = JSON.stringify({ title: httpTitle, content: String(msg || '') });
      const headers = { 'Content-Type': 'application/json' };
      if (settings.notify_http_auth) headers['Authorization'] = String(settings.notify_http_auth);
      await fetchWithRetry(settings.notify_http_url, {
        method: (settings.notify_http_method || 'POST').toUpperCase(),
        headers,
        body
      });
      return null;
    } catch (e) {
      return '自定义HTTP通知发送失败: ' + (e && e.message ? e.message : e);
    }
  }

  if(!settings.tg_bot_token) return;
  const title = "💌 Cloudflare Server Monitor";
  if(settings.tg_bot_token.indexOf("onebot:") == 0) {
    // OneBot 协议 (QQ 等)，私聊格式: onebot:http://127.0.0.1:3000/send_private_msg?access_token=xxx
    // 群聊格式: onebot:http://127.0.0.1:3000/send_group_msg?access_token=xxx
    let onebotUrl = settings.tg_bot_token.replace("onebot:", "");
    const targetId = settings.tg_chat_id || '';
    const isGroup = onebotUrl.indexOf("send_group_msg") != -1;
    if (!targetId) {
      return "OneBot 通知失败: 缺少 tg_chat_id（私人: QQ号，群: group:群号）";
    }
    try {
      const endpoint = onebotUrl.trim();
      const body = {
        [isGroup ? 'group_id' : 'user_id']: targetId,
        message: [
          {
            type: 'text',
            data: {
              text: `${title}\n${String(msg || '').replace(/\*/g, '')}\n`
            }
          }
        ]
      };
      await fetchWithRetry(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
    } catch (e) {
      return "OneBot 通知发送失败: " + e.message;
    }
  }else if(settings.tg_bot_token.includes("open.feishu.cn")) {
    // 飞书机器人 Webhook
    try {
      await fetchWithRetry(settings.tg_bot_token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({
          msg_type: "interactive",
          card: {
            schema: "2.0",
            header: { template: "blue", title: { content: title, tag: "plain_text" } },
            body: { elements: [{ tag: "markdown", content: msg }] }
          }
        })
      });
    } catch (e) {
      return "飞书通知发送失败: " + e.message;
    }
  }else if(settings.tg_bot_token.includes("oapi.dingtalk.com") || settings.tg_bot_token.includes("api.dingtalk.com")) {
    // 钉钉机器人 Webhook
    try {
      await fetchWithRetry(settings.tg_bot_token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          msgtype: "markdown",
          markdown: { title: title, text: msg }
        })
      });
    } catch (e) {
      return "钉钉通知发送失败: " + e.message;
    }
  }else if(settings.tg_bot_token.includes("https://api.day.app/") || settings.tg_bot_token.indexOf("bark:") == 0) {
    let barkUrl = settings.tg_bot_token;
    if(barkUrl.indexOf("bark:") == 0) {
      barkUrl = barkUrl.replace("bark:", "");
    }
    try {
      await fetchWithRetry(barkUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title,
          markdown: msg,
          group: "Cloudflare Server Monitor"
        })
      });
    } catch (e) {
      return "Bark通知发送失败: " + e.message;
    }
  }else if(settings.tg_bot_token.includes("https://qyapi.weixin.qq.com")){
    try {
      await fetchWithRetry(settings.tg_bot_token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          msgtype: "text",
          text: {
            content: msg.replace(/\*/g, '')
          }
        })
      });
    } catch (e) {
      return "企业微信通知发送失败: " + e.message;
    }
  // Server 酱（使用 sendkey）
  }else if(settings.tg_bot_token.includes("https://sctapi.ftqq.com/") || settings.tg_bot_token.indexOf("server:") == 0) {
    let serverUrl = settings.tg_bot_token;
    if(serverUrl.indexOf("server:") == 0) {
      serverUrl = serverUrl.replace("server:", "");
    }
    try {
      await fetchWithRetry(serverUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title,
          desp: msg
        })
      });
    } catch (e) {
      return "Server酱通知发送失败: " + e.message;
    }
  }else if(settings.tg_bot_token.includes("https://wxpusher.zjiecode.com/api/send/message/SPT_")) {
    const match = settings.tg_bot_token.match(/\/message\/([^/]+)/);
    const spt = match ? match[1] : null;
    if (!spt) return "WxPusher 通知失败: 无法提取 SPT";
    try {
      await fetchWithRetry("https://wxpusher.zjiecode.com/api/send/message/simple-push", {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          "content": msg,
          "summary": title,
          "contentType":3,
          "spt": spt,
        })
      });
    } catch (e) {
      return "WxPusher通知发送失败: " + e.message;
    }
  }else if(settings.tg_bot_token.includes("/message?token=")) {
    try {
      await fetchWithRetry(settings.tg_bot_token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title,
          message: msg,
          priority: 5,
          extras: {
            "client::display": { "contentType": "text/markdown" }
          }
        })
      });
    } catch (e) {
      return "Gotify通知发送失败: " + e.message;
    }
  }else if(settings.tg_chat_id) {
    // Telegram Bot (最后 fallback，通过 chat_id 判断)
    try {
      await fetchWithRetry(`https://api.telegram.org/bot${settings.tg_bot_token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: settings.tg_chat_id,
          text: msg,
          parse_mode: 'Markdown'
        })
      });
    } catch (e) {
      return "Telegram 通知发送失败: " + e.message;
    }
  }else {
    return "未知的通知方式";
  }
}

export async function checkOfflineNodes(db) {
  const siteSettings = await loadSiteSettings(db);
  const tgNotifyMinutes = getTgNotifyMinutes(siteSettings.tg_notify);

  if (tgNotifyMinutes === 0 || !hasNotifyChannel(siteSettings)) return;

  try {
    const allServers = await getAllServers(db);
    
    const latestMetricsMap = await getLatestMetricsForAllServers(db);
    
    let alertState = {};
    const stateRes = await db.prepare(
      "SELECT value FROM settings WHERE key = 'alert_state'"
    ).first();
    
    if (stateRes) {
      try {
        alertState = JSON.parse(stateRes.value);
      } catch (e) {
        alertState = {};
      }
    }

    const now = Date.now();
    const offlineThreshold = tgNotifyMinutes * 60 * 1000;
    const offlineNodes = [];
    const recoveredNodes = [];

    for (const s of allServers) {
      if (s.offline_notify_disabled === '1') continue;

      const latestMetrics = latestMetricsMap.get(s.id);
      
      let isOffline = true;
      if (latestMetrics) {
        const diff = now - latestMetrics.timestamp;
        isOffline = diff > offlineThreshold;
      }

      if (isOffline && !alertState[s.id]) {
        offlineNodes.push({
          name: s.name,
          lastReportTime: latestMetrics?.timestamp
        });
        alertState[s.id] = true;
      } else if (!isOffline && alertState[s.id]) {
        recoveredNodes.push(s);
        delete alertState[s.id];
      }
    }

    if (offlineNodes.length > 0 || recoveredNodes.length > 0) {
      await db.prepare(
        'INSERT INTO settings (key, value) VALUES ("alert_state", ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
      ).bind(JSON.stringify(alertState)).run();
    }

    if (offlineNodes.length > 0) {
      const nodeList = offlineNodes
        .map(n => `• ${n.name} - ${formatLastReportTime(n.lastReportTime)}`)
        .join('\n');
      const msg = `⚠️ **节点离线告警** (${offlineNodes.length}个)\n\n${nodeList}`;
      await sendNotification(siteSettings, msg);
    }

    if (recoveredNodes.length > 0) {
      const nodeList = recoveredNodes.map(n => `• ${n.name}`).join('\n');
      const msg = `✅ **节点恢复通知** (${recoveredNodes.length}个)\n\n${nodeList}\n\n**时间:** ${new Date().toLocaleString('zh-CN', {timeZone: 'Asia/Shanghai'})}`;
      await sendNotification(siteSettings, msg);
    }
  } catch (e) {
    console.error('离线检测失败:', e);
  }
}

export async function checkResourceAlerts(env) {
  if (!env?.DB || !env?.METRICS_BROADCASTER) return;

  const db = env.DB;
  const siteSettings = await loadSiteSettings(db, { forceRefresh: true });
  if (!hasNotifyChannel(siteSettings)) return;

  const resourceConfig = getResourceAlertConfig(siteSettings);

  if (!resourceConfig.enabled || !resourceConfig.hasRules) {
    await clearResourceAlertState(db);
    return;
  }

  try {
    const allServers = await getAllServers(db);
    if (allServers.length === 0) {
      await clearResourceAlertState(db);
      return;
    }

    const serverMap = new Map(allServers.map(server => [String(server.id), server]));
    const id = env.METRICS_BROADCASTER.idFromName('global');
    const stub = env.METRICS_BROADCASTER.get(id);
    const activeMap = new Map();
    const evaluationMap = new Map();
    const configuredRules = [];
    const configuredRuleServers = [];
    const evaluatedRuleServers = [];

    const configSignature = JSON.stringify({
      rules: resourceConfig.rules.map(rule => ({
        id: rule.id,
        name: rule.name,
        metric: rule.metric,
        threshold: rule.threshold,
        servers: rule.servers,
        intervalMinutes: rule.intervalMinutes,
        mode: rule.mode
      }))
    });

    for (const rule of resourceConfig.rules) {
      const serverIds = getResourceAlertRuleServerIds(rule, allServers);
      if (serverIds.length === 0) continue;

      const ruleServers = [];
      for (const serverId of serverIds) {
        const server = serverMap.get(String(serverId));
        if (!server) continue;
        ruleServers.push({
          key: getResourceAlertRuleStateKey(rule, serverId),
          rule,
          server,
          serverId: String(serverId)
        });
      }
      if (ruleServers.length === 0) continue;
      configuredRuleServers.push(...ruleServers);
      configuredRules.push({ rule, serverIds, ruleServers });
    }

    if (configuredRuleServers.length === 0) {
      await clearResourceAlertState(db);
      return;
    }

    const evaluationResults = await evaluateResourceAlertRules(stub, configuredRules);
    for (const { rule, ruleServers } of configuredRules) {
      const result = evaluationResults.get(String(rule.id));
      if (!result) continue;
      const evaluatedServerIdSet = new Set(result.evaluatedServerIds);
      evaluatedRuleServers.push(...ruleServers.filter(item => evaluatedServerIdSet.has(item.serverId)));
      for (const alert of result.alerts) {
        activeMap.set(getResourceAlertRuleStateKey(rule, alert.serverId), { rule, alert });
      }
      for (const evaluation of result.evaluations || []) {
        evaluationMap.set(getResourceAlertRuleStateKey(rule, evaluation.serverId), evaluation);
      }
    }

    const stateRow = await db.prepare(
      `SELECT value FROM settings WHERE key = ?`
    ).bind(RESOURCE_ALERT_STATE_KEY).first();
    const hadStoredState = !!stateRow;
    const parsedState = parseResourceAlertState(stateRow);
    let alertState = parsedState.servers || {};

    const now = Date.now();
    const alertNodes = [];
    const recoveredNodes = [];
    const validStateKeys = new Set(configuredRuleServers.map(item => item.key));
    let stateChanged = hadStoredState && parsedState.signature !== configSignature;

    for (const key of Object.keys(alertState)) {
      if (!validStateKeys.has(key)) {
        delete alertState[key];
        stateChanged = true;
      }
    }

    for (const { key, rule, server } of evaluatedRuleServers) {
      const active = activeMap.get(key);
      const alert = active?.alert;
      const evaluation = evaluationMap.get(key);
      const currentState = alertState[key];
      const currentStatus = currentState
        ? getResourceAlertStateStatus(currentState)
        : '';
      const ruleIntervalMs = getResourceAlertRuleIntervalMs(rule);

      if (alert) {
        const isActiveAlert = currentStatus === RESOURCE_ALERT_STATE_ACTIVE;
        const recoveredAt = currentStatus === RESOURCE_ALERT_STATE_RECOVERED
          ? getResourceAlertStateTimestamp(currentState, 'recoveredAt')
          : 0;
        if (recoveredAt > 0 && now - recoveredAt < ruleIntervalMs) {
          continue;
        }

        if (!isActiveAlert) {
          alertNodes.push({ rule, server, alert });
          alertState[key] = {
            status: RESOURCE_ALERT_STATE_ACTIVE,
            alertAt: now,
            lastTriggeredAt: now,
            metrics: getStoredResourceAlertMetrics(alert)
          };
          stateChanged = true;
        } else {
          const lastTriggeredAt = getResourceAlertStateTimestamp(currentState, 'lastTriggeredAt');
          if (lastTriggeredAt === 0 || now - lastTriggeredAt >= ruleIntervalMs) {
            alertState[key] = {
              ...currentState,
              status: RESOURCE_ALERT_STATE_ACTIVE,
              alertAt: getResourceAlertStateTimestamp(currentState, 'alertAt') || now,
              lastTriggeredAt: now,
              metrics: getStoredResourceAlertMetrics(alert)
            };
            stateChanged = true;
          }
        }
      } else if (currentState) {
        if (currentStatus === RESOURCE_ALERT_STATE_ACTIVE) {
          if (!canRecoverResourceAlert(evaluation)) {
            continue;
          }

          recoveredNodes.push({ rule, server, metrics: evaluation?.metrics || [] });
          alertState[key] = {
            ...currentState,
            status: RESOURCE_ALERT_STATE_RECOVERED,
            recoveredAt: now,
            metrics: evaluation?.metrics || currentState.metrics
          };
          stateChanged = true;
        } else {
          const recoveredAt = getResourceAlertStateTimestamp(currentState, 'recoveredAt');
          if (recoveredAt === 0 || now - recoveredAt >= ruleIntervalMs) {
            delete alertState[key];
            stateChanged = true;
          }
        }
      }
    }

    const messageSections = [];
    if (alertNodes.length > 0) {
      const nodeList = alertNodes.map(({ rule, server, alert }) => {
        const metrics = alert.metrics.map(formatResourceMetric).join('；');
        const modeText = alert.mode === 'average' ? '平均' : '窗口样本连续';
        return `• ${getResourceAlertRuleName(rule)} / ${server.name} - ${modeText} ${rule.intervalMinutes} 分钟\n  ${metrics}`;
      }).join('\n');
      messageSections.push(`⚠️ **资源负载告警** (${alertNodes.length}个)\n\n${nodeList}`);
    }

    if (recoveredNodes.length > 0) {
      const nodeList = recoveredNodes
        .map(({ rule, server, metrics }) => {
          const metricText = (metrics && metrics.length > 0)
            ? '\n  ' + metrics.map(formatRecoveredResourceMetric).filter(Boolean).join('；')
            : '';
          return `• ${getResourceAlertRuleName(rule)} / ${server.name}${metricText}`;
        })
        .join('\n');
      messageSections.push(`✅ **资源负载恢复** (${recoveredNodes.length}个)\n\n${nodeList}`);
    }

    if (stateChanged) {
      await saveResourceAlertState(db, configSignature, alertState, hadStoredState);
    }

    if (messageSections.length > 0) {
      const msg = `${messageSections.join('\n\n')}\n\n**时间:** ${formatCurrentTime()}`;
      const notificationError = await sendNotification(siteSettings, msg);
      if (notificationError) {
        console.warn('[ResourceAlert] notification failed:', notificationError);
      }
    }
  } catch (e) {
    console.error('资源负载告警检测失败:', e);
  }
}

export async function checkExpiringServers(db) {
  const siteSettings = await loadSiteSettings(db);

  try {
    const allServers = await getAllServers(db);
    const now = Date.now();
    const expiringServers = [];
    const reminderDays = getExpireReminderDays(siteSettings.expire_reminder);
    const shouldNotify = reminderDays > 0 && hasNotifyChannel(siteSettings);
    let hasRenewedServers = false;

    for (const s of allServers) {
      if (!s.expire_date) continue;

      const billingCycle = normalizeBillingCycle(detectBillingCycle(s.price) || s.billing_cycle);
      const renewal = renewExpireDateIfNeeded(s.expire_date, billingCycle, s.auto_renewal, now, 1);
      if (renewal.renewed) {
        await db.prepare(
          'UPDATE servers SET expire_date = ?, billing_cycle = ? WHERE id = ?'
        ).bind(renewal.expire_date, billingCycle, s.id).run();
        s.expire_date = renewal.expire_date;
        s.billing_cycle = billingCycle;
        hasRenewedServers = true;
        debug(`[Cron] 服务器 ${s.name} 已自动续费，到期日期更新为 ${s.expire_date}`);
      }

      if (!shouldNotify) continue;

      const expTime = new Date(s.expire_date).getTime();
      if (isNaN(expTime)) continue;

      const diff = expTime - now;
      const days = Math.ceil(diff / (1000 * 3600 * 24));

      debug(`[Cron] 检测到服务器 ${s.name} 到期日期 ${s.expire_date}，剩余天数 ${days} 天`);

      if (days > 0 && days <= reminderDays) {
        expiringServers.push({ name: s.name, expire_date: s.expire_date, days });
      }
    }

    if (hasRenewedServers) {
      clearServersListCache();
    }

    if (expiringServers.length > 0) {
      const serverList = expiringServers.map(s => `• ${s.name} - 剩余${s.days}天 (${s.expire_date})`).join('\n');
      const msg = `⏰ **服务器到期提醒** (${expiringServers.length}个)\n\n${serverList}`;
      debug(`[Cron] 发送到期提醒通知: ${msg}`);
      await sendNotification(siteSettings, msg);
    }
  } catch (e) {
    console.error('到期检测失败:', e);
  }
}
