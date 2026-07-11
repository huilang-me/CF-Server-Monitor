import { getLatestMetricsForAllServers } from '../database/schema.js';
import { getAllServers } from '../utils/cache.js';
import { loadSiteSettings, saveSiteOptions, debug } from '../utils/settings.js';

const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;

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


export async function sendNotification(settings, msg) {
  if(!settings.tg_bot_token) return;
  const title = "💌 Cloudflare Server Monitor";
  if(settings.tg_chat_id) {
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
  }else if(settings.tg_bot_token.includes("open.feishu.cn")) {
    try {
      await fetchWithRetry(settings.tg_bot_token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({
          msg_type: "interactive",
          card: {
            schema: "2.0",
            header: { template: "blue",  title: { content: title, tag: "plain_text" } },
            body: { elements: [{tag: "markdown", content: msg}] }
          }
        })
      });
    } catch (e) {
      return "飞书机器人通知发送失败: " + e.message;
    }
  }else if(settings.tg_bot_token.includes("https://api.day.app/")) {
    try {
      await fetchWithRetry(settings.tg_bot_token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title,
          markdown: msg,
          group: "Cloudflare Server Monitor"
        })
      });
    } catch (e) {
      return "企业微信通知发送失败: " + e.message;
    }
  }else if(settings.tg_bot_token.includes("https://qyapi.weixin.qq.com")){
    try {
      await fetchWithRetry(settings.tg_bot_token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          msgtype: "markdown",
          markdown: { content: msg }
        })
      });
    } catch (e) {
      return "企业微信通知发送失败: " + e.message;
    }
  // Server 酱（使用 sendkey）
  }else if(settings.tg_bot_token.includes("https://sctapi.ftqq.com/")) {
    try {
      await fetchWithRetry(settings.tg_bot_token, {
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
  }else {
    return "未知的通知方式";
  }
}

export async function checkOfflineNodes(db) {
  const siteSettings = await loadSiteSettings(db);

  if (siteSettings.tg_notify !== 'true'|| !siteSettings.tg_bot_token) return;

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
    const offlineNodes = [];
    const recoveredNodes = [];

    for (const s of allServers) {
      if (s.offline_notify_disabled === '1') continue;

      const latestMetrics = latestMetricsMap.get(s.id);
      
      let isOffline = true;
      if (latestMetrics) {
        const diff = now - latestMetrics.timestamp;
        isOffline = diff > 300000;
      }

      if (isOffline && !alertState[s.id]) {
        offlineNodes.push(s);
        alertState[s.id] = true;
      } else if (!isOffline && alertState[s.id]) {
        recoveredNodes.push(s);
        delete alertState[s.id];
      }
    }

    if (offlineNodes.length > 0) {
      const nodeList = offlineNodes.map(n => `• ${n.name}`).join('\n');
      const msg = `⚠️ **节点离线告警** (${offlineNodes.length}个)\n\n${nodeList}\n\n**时间:** ${new Date().toLocaleString('zh-CN', {timeZone: 'Asia/Shanghai'})}`;
      await sendNotification(siteSettings, msg);
    }

    if (recoveredNodes.length > 0) {
      const nodeList = recoveredNodes.map(n => `• ${n.name}`).join('\n');
      const msg = `✅ **节点恢复通知** (${recoveredNodes.length}个)\n\n${nodeList}\n\n**时间:** ${new Date().toLocaleString('zh-CN', {timeZone: 'Asia/Shanghai'})}`;
      await sendNotification(siteSettings, msg);
    }

    if (offlineNodes.length > 0 || recoveredNodes.length > 0) {
      await db.prepare(
        'INSERT INTO settings (key, value) VALUES ("alert_state", ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
      ).bind(JSON.stringify(alertState)).run();
    }
  } catch (e) {
    console.error('离线检测失败:', e);
  }
}

export async function checkExpiringServers(db) {
  const siteSettings = await loadSiteSettings(db);

  if (siteSettings.expire_reminder !== 'true' || !siteSettings.tg_bot_token) {
    return;
  }
  try {
    const allServers = await getAllServers(db);
    const now = Date.now();
    const REMINDER_DAYS = 7;
    const expiringServers = [];

    for (const s of allServers) {
      if (!s.expire_date) continue;

      const expTime = new Date(s.expire_date).getTime();
      if (isNaN(expTime)) continue;

      const diff = expTime - now;
      const days = Math.ceil(diff / (1000 * 3600 * 24));

      debug(`[Cron] 检测到服务器 ${s.name} 到期日期 ${s.expire_date}，剩余天数 ${days} 天`);

      if (days > 0 && days <= REMINDER_DAYS) {
        expiringServers.push({ name: s.name, expire_date: s.expire_date, days });
      }
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