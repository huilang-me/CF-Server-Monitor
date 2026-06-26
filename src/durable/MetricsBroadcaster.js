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

  // 根据 scope 判断是否需要接收某台服务器的更新
  _shouldDeliver(sessionScope, serverId) {
    if (!sessionScope) return false;
    if (sessionScope === 'all') return true;
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
      // const allowedOrigins = parseAllowedOrigins(this.env.CORS_ALLOWED_ORIGINS);

      const raw = url.searchParams.get('subscribe') || 'all';
      const scope = raw.trim().toLowerCase();

      // @ts-ignore - Cloudflare Workers 运行时提供 WebSocketPair
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);

      // 使用 DO WebSocket Hibernation API 接管连接
      this.state.acceptWebSocket(server);

      // 将订阅 scope 附加到 WebSocket（休眠后仍保留）
      server.serializeAttachment({ scope });

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
      responseHeaders.set('Access-Control-Allow-Origin', origin || '*');
      responseHeaders.set('Access-Control-Allow-Credentials', 'true');

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

      this._broadcastBatch(normalizedUpdates);

      const count = this.state.getWebSockets().length;
      return new Response(JSON.stringify({ ok: true, count: normalizedUpdates.length, subscribers: count }), {
        headers: { 'Content-Type': 'application/json' }
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
    const message = JSON.stringify({
      type: 'update',
      serverId,
      ts: Date.now(),
      data: payload
    });

    const websockets = this.state.getWebSockets();
    for (const ws of websockets) {
      const attachment = ws.deserializeAttachment();
      if (!attachment || !this._shouldDeliver(attachment.scope, serverId)) {
        continue;
      }
      try {
        ws.send(message);
      } catch (_) {
        // WebSocket 已异常关闭，DO 会自动清理
      }
    }
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

  _broadcastBatch(updates) {
    const ts = Date.now();
    const websockets = this.state.getWebSockets();

    for (const ws of websockets) {
      const attachment = ws.deserializeAttachment();
      if (!attachment) continue;

      const scopedUpdates = updates.filter(item => this._shouldDeliver(attachment.scope, item.serverId));
      if (scopedUpdates.length === 0) continue;

      const only = scopedUpdates.length === 1 ? scopedUpdates[0] : null;
      const singleSample = only && only.samples.length === 1 ? only.samples[0] : null;
      const message = singleSample
        ? JSON.stringify({
            type: 'update',
            serverId: only.serverId,
            ts,
            data: singleSample.data
          })
        : JSON.stringify({
            type: 'batchUpdate',
            ts,
            updates: scopedUpdates
          });

      try {
        ws.send(message);
      } catch (_) {
        // WebSocket 宸插紓甯稿叧闂紝DO 浼氳嚜鍔ㄦ竻鐞?
      }
    }
  }

  webSocketMessage(ws, message) {
    // 保留处理扩展消息的入口
    try {
      const msg = JSON.parse(message || '{}');
      if (msg && msg.type === 'pong') return;
    } catch (_) {}
  }

  // WebSocket 关闭 — DO 自动清理，无需手动移除
  webSocketClose(ws, code, reason) {}

  // WebSocket 错误 — DO 自动处理
  webSocketError(ws, error) {}
}

export default MetricsBroadcaster;
