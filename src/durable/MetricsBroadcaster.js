// Durable Object: 服务器监控指标广播中心
// 负责维护 WebSocket 连接并在收到新指标时向订阅者实时推送
//
// - 连接通过 /api/ws?subscribe=<scope> 建立
//   scope = 'all'        -> 订阅所有服务器更新（首页）
//   scope = <serverId>   -> 只订阅某台服务器的更新（详情页）
//
// - 后端 /update 处理器在成功写入 DB 后，调用 /__do_push/<id>
//   由本 DO 向所有订阅者广播刚收到的指标。
//
// - 使用 DO WebSocket Hibernation API，闲置时休眠以节省资源。
//   通过 setWebSocketAutoResponse 自动响应 ping，无需唤醒 DO。

const MAX_SUBSCRIBE_IDS = 500;
const MAX_SERVER_ID_LENGTH = 64;
const SERVER_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;
const WS_POLICY_VIOLATION = 1008;
const LATEST_REPORT_TTL_MS = 5 * 60 * 1000;
const MAX_LATEST_REPORT_SERVERS = 1000;

function parseAllowedOrigins(corsAllowedOrigins) {
  if (!corsAllowedOrigins || corsAllowedOrigins.trim() === '') {
    return [];
  }
  return corsAllowedOrigins
    .split(',')
    .map(o => o.trim())
    .filter(o => o !== '');
}

export class MetricsBroadcaster {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    // 仅用于新页面快速接上最近一包数据；DO 重启或休眠回收后允许自然丢失。
    this.latestReportUpdates = new Map();

    // 自动响应 ping 心跳，DO 无需被唤醒
    // @ts-ignore - Cloudflare Workers 运行时提供 WebSocketRequestResponsePair
    this.state.setWebSocketAutoResponse(
      // @ts-ignore
      new WebSocketRequestResponsePair(
        JSON.stringify({ type: 'ping' }),
        JSON.stringify({ type: 'pong' })
      )
    );
  }

  _isValidServerId(id) {
    return (
      typeof id === 'string' &&
      id.length > 0 &&
      id.length <= MAX_SERVER_ID_LENGTH &&
      SERVER_ID_PATTERN.test(id)
    );
  }

  _isValidScope(scope) {
    return scope === 'all' || this._isValidServerId(scope);
  }

  _normalizeServerIds(ids) {
    if (ids === undefined) return { ok: true, ids: [] };
    if (!Array.isArray(ids) || ids.length > MAX_SUBSCRIBE_IDS) {
      return { ok: false, ids: [] };
    }

    const seen = new Set();
    const normalized = [];
    for (const id of ids) {
      if (typeof id !== 'string') {
        return { ok: false, ids: [] };
      }

      const value = id.trim();
      if (!this._isValidServerId(value)) {
        return { ok: false, ids: [] };
      }

      if (seen.has(value)) continue;
      seen.add(value);
      normalized.push(value);
    }
    return { ok: true, ids: normalized };
  }

  _closeInvalidSubscription(ws) {
    try {
      ws.close(WS_POLICY_VIOLATION, 'invalid subscription');
    } catch (_) {}
  }

  _getSubscribeScope(msg, current) {
    if (!Object.prototype.hasOwnProperty.call(msg, 'scope') || msg.scope === undefined) {
      return current.scope || 'all';
    }
    return typeof msg.scope === 'string' ? msg.scope : null;
  }

  // 根据 scope 和 serverIds 判断是否需要接收某台服务器的更新
  _shouldDeliver(sessionScope, serverId, serverIds) {
    if (!sessionScope) return false;
    if (sessionScope === 'all') {
      if (!serverIds || serverIds.length === 0) return false;
      return serverIds.includes(serverId);
    }
    return sessionScope === serverId;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // ── 1) WebSocket 接入 ──────────────────────────────
    if (path === '/ws' || path.endsWith('/ws')) {
      const upgradeHeader = request.headers.get('Upgrade');
      if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
        return new Response('Expected WebSocket upgrade request', { status: 426 });
      }

      const origin = request.headers.get('Origin');
      const allowedOrigins = parseAllowedOrigins(this.env.CORS_ALLOWED_ORIGINS);

      // Worker 转发时通过 X-Real-Origin 传递真实 origin，替代 DO 内部的 http://internal
      const realOrigin = request.headers.get('X-Real-Origin') || `${url.protocol}//${url.host}`;
      if (origin && allowedOrigins.length > 0 && !allowedOrigins.includes(origin) && origin !== realOrigin) {
        return new Response('Forbidden', { status: 403 });
      }

      const raw = url.searchParams.get('subscribe') || 'all';
      const scope = raw.trim().toLowerCase();
      if (!this._isValidScope(scope)) {
        return new Response('Invalid subscription scope', { status: 400 });
      }

      // @ts-ignore - Cloudflare Workers 运行时提供 WebSocketPair
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);

      // 使用 DO WebSocket Hibernation API 接管连接
      this.state.acceptWebSocket(server);

      // 将订阅 scope 和空 serverIds 附加到 WebSocket（休眠后仍保留）
      server.serializeAttachment({ scope, serverIds: [] });

      // 立即发送 hello 让客户端确认连接成功
      try {
        server.send(JSON.stringify({
          type: 'hello',
          ts: Date.now(),
          subscribed: scope
        }));
      } catch (_) {
      }

      const responseHeaders = new Headers();
      if (origin && allowedOrigins.length > 0) {
        responseHeaders.set('Access-Control-Allow-Origin', origin);
        responseHeaders.set('Access-Control-Allow-Credentials', 'true');
      } else if (allowedOrigins.length === 0) {
        responseHeaders.set('Access-Control-Allow-Origin', '*');
      }

      return new Response(null, {
        status: 101,
        webSocket: client,
        headers: responseHeaders
      });
    }

    // ── 2) 广播入口：/update 成功后由 Worker 内部转发 ──
    //     path: /push/<serverId>   body: { metrics } JSON
    if (method === 'POST' && (path.startsWith('/push/') || path.includes('/push/'))) {
      const parts = path.split('/push/');
      const serverId = decodeURIComponent((parts[1] || '').split('/')[0] || '');
      if (!serverId) {
        return new Response(JSON.stringify({ error: 'missing serverId' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      let payload = null;
      try {
        payload = await request.json();
      } catch (_) {
        return new Response(JSON.stringify({ error: 'invalid JSON' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      this._broadcast(serverId, payload);
      const count = this.state.getWebSockets().length;
      return new Response(JSON.stringify({ ok: true, subscribers: count }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // ── 2b) 批量推送入口 ──────────────────────────────
    //     body: { updates: [{ serverId, payload }, ...] }
    if (method === 'POST' && path === '/batch-push') {
      let body = null;
      try {
        body = await request.json();
      } catch (_) {
        return new Response(JSON.stringify({ error: 'invalid JSON' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const updates = body && body.updates;
      if (!Array.isArray(updates) || updates.length === 0) {
        return new Response(JSON.stringify({ error: 'missing or empty updates array' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const normalizedUpdates = this._normalizeBatchUpdates(updates);
      if (normalizedUpdates.length === 0) {
        return new Response(JSON.stringify({ error: 'missing valid updates' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const reportTs = Date.now();
      this._cacheLatestReportUpdates(normalizedUpdates, reportTs);
      this._broadcastBatch(normalizedUpdates, reportTs);

      const count = this.state.getWebSockets().length;
      return new Response(JSON.stringify({ ok: true, count: normalizedUpdates.length, subscribers: count }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Worker 内部读取每台服务器最近一次上报的完整样本包。
    if (method === 'POST' && path === '/latest-report-updates') {
      let body = null;
      try {
        body = await request.json();
      } catch (_) {
        return new Response(JSON.stringify({ error: 'invalid JSON' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const normalizedServerIds = this._normalizeServerIds(body?.serverIds);
      if (!normalizedServerIds.ok) {
        return new Response(JSON.stringify({ error: 'invalid serverIds' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const updates = this._getLatestReportUpdates(normalizedServerIds.ids);
      return new Response(JSON.stringify({ updates }), {
        headers: {
          'Cache-Control': 'no-store',
          'Content-Type': 'application/json'
        }
      });
    }

    // ── 3) 健康检查 ────────────────────────────────────
    if (method === 'GET' && (path === '/health' || path.endsWith('/health'))) {
      const count = this.state.getWebSockets().length;
      return new Response(JSON.stringify({ ok: true, subscribers: count }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response('Not found', { status: 404 });
  }

  // 向所有匹配 scope 的 WebSocket 广播推送
  _broadcast(serverId, payload) {
    const ts = Date.now();
    const updates = [{
      serverId,
      samples: [{ ts, data: payload }]
    }];
    this._cacheLatestReportUpdates(updates, ts);
    this._broadcastBatch(updates, ts);
  }

  _pruneLatestReportUpdates(now = Date.now()) {
    for (const [serverId, update] of this.latestReportUpdates) {
      if (!update || now - update.reportTs > LATEST_REPORT_TTL_MS) {
        this.latestReportUpdates.delete(serverId);
      }
    }
  }

  _cacheLatestReportUpdates(updates, reportTs = Date.now()) {
    this._pruneLatestReportUpdates(reportTs);

    for (const update of updates) {
      if (!update || !update.serverId || !Array.isArray(update.samples) || update.samples.length === 0) continue;
      const serverId = String(update.serverId);
      // delete + set 让 Map 的插入顺序同时代表最近更新时间，便于限制内存上限。
      this.latestReportUpdates.delete(serverId);
      this.latestReportUpdates.set(serverId, {
        serverId,
        reportTs,
        samples: update.samples
      });
    }

    while (this.latestReportUpdates.size > MAX_LATEST_REPORT_SERVERS) {
      const oldestServerId = this.latestReportUpdates.keys().next().value;
      if (oldestServerId === undefined) break;
      this.latestReportUpdates.delete(oldestServerId);
    }
  }

  _getLatestReportUpdates(serverIds) {
    const now = Date.now();
    this._pruneLatestReportUpdates(now);
    const updates = [];
    for (const serverId of serverIds) {
      const update = this.latestReportUpdates.get(serverId);
      if (update) {
        updates.push({
          ...update,
          reportAgeMs: Math.max(0, now - update.reportTs)
        });
      }
    }
    return updates;
  }

  // WebSocket 收到消息（ping 已被自动响应拦截，不会到达此处）
  _normalizeBatchUpdates(updates) {
    const now = Date.now();
    return updates.map(item => {
      if (!item || !item.serverId) return null;
      const serverId = String(item.serverId);
      const rawSamples = Array.isArray(item.samples)
        ? item.samples
        : (item.payload ? [{ ts: now, payload: item.payload }] : []);

      const samples = rawSamples.map(sample => {
        if (!sample || typeof sample !== 'object') return null;
        const data = sample.data || sample.payload || sample.metrics;
        if (!data || typeof data !== 'object') return null;
        const ts = Number(sample.ts || sample.timestamp || data.last_updated || now) || now;
        return { ts, data };
      }).filter(Boolean);

      if (samples.length === 0) return null;
      samples.sort((a, b) => a.ts - b.ts);
      return { serverId, samples };
    }).filter(Boolean);
  }

  _broadcastBatch(updates, ts = Date.now()) {
    const websockets = this.state.getWebSockets();

    for (const ws of websockets) {
      const attachment = ws.deserializeAttachment();
      if (!attachment) continue;

      const scopedUpdates = updates.filter(item => this._shouldDeliver(attachment.scope, item.serverId, attachment.serverIds));
      if (scopedUpdates.length === 0) continue;

      const message = JSON.stringify({
        type: 'batchUpdate',
        ts,
        updates: scopedUpdates
      });

      try {
        ws.send(message);
      } catch (_) {
        // WebSocket 已异常关闭，DO 会自动清理
      }
    }
  }

  webSocketMessage(ws, message) {
    // 保留处理扩展消息的入口
    try {
      const msg = JSON.parse(message || '{}');
      if (msg && msg.type === 'subscribe') {
        const current = ws.deserializeAttachment() || {};
        const rawScope = this._getSubscribeScope(msg, current);
        if (rawScope === null) {
          this._closeInvalidSubscription(ws);
          return;
        }

        const scope = rawScope.trim().toLowerCase();
        if (!this._isValidScope(scope)) {
          this._closeInvalidSubscription(ws);
          return;
        }

        const normalizedServerIds = this._normalizeServerIds(msg.ids);
        if (!normalizedServerIds.ok) {
          this._closeInvalidSubscription(ws);
          return;
        }

        const serverIds = normalizedServerIds.ids;
        ws.serializeAttachment({ scope, serverIds });
        try {
          ws.send(JSON.stringify({
            type: 'subscribed',
            ts: Date.now(),
            subscribed: scope,
            count: serverIds.length
          }));
        } catch (_) {}
        return;
      }
      if (msg && msg.type === 'pong') return;
    } catch (_) {}
  }

  // WebSocket 关闭 — DO 自动清理，无需手动移除
  webSocketClose(ws, code, reason) {}

  // WebSocket 错误 — DO 自动处理
  webSocketError(ws, error) {}
}

export default MetricsBroadcaster;
