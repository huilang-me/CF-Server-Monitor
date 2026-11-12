import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  clearSiteSettingsCache,
  DEFAULT_USER_AGENT,
  USER_AGENT_MAX_LENGTH,
  sanitizeUserAgent,
  validateUserAgent
} from '../src/utils/settings.js';
import { describeAgentConfig } from '../src/utils/agentConfig.js';
import { handleAdminAPI } from '../src/handlers/admin.js';
import { handleUpdate } from '../src/handlers/update.js';
import { MetricsBroadcaster } from '../src/durable/MetricsBroadcaster.js';
import { buildClearUaCookie, buildUaCookie, generateToken } from '../src/middleware/auth.js';
import { clearServerDetailCache } from '../src/utils/cache.js';

// MetricsBroadcaster 构造时会用到 Workers 运行时的 WebSocketRequestResponsePair。
globalThis.WebSocketRequestResponsePair = class WebSocketRequestResponsePair {
  constructor(request, response) {
    this.request = request;
    this.response = response;
  }
};

const normalizeSql = (sql) => String(sql).replace(/\s+/g, ' ').trim();

// 覆盖 ua 下发的三条链路末端：save_settings 落库、/update 响应头、WSS ack 帧。
// 三者都只依赖「已加载的 settings」，因此共用同一个最小 D1 替身。
function createSettingsDb({ ua = DEFAULT_USER_AGENT, server = null } = {}) {
  const writes = [];
  const siteOptions = { ua, auto_discovery: 'false', collect_interval: 1, report_interval: 60, reset_day: 1 };

  function prepare(sql) {
    const text = normalizeSql(sql);
    const args = [];
    const statement = {
      bind(...values) {
        args.push(...values);
        return statement;
      },
      async first() {
        if (/^SELECT value FROM settings WHERE key = 'site_options'$/.test(text)) {
          return { value: JSON.stringify(siteOptions) };
        }
        if (/^SELECT \* FROM servers WHERE id = \?$/.test(text)) {
          return server ? { ...server } : null;
        }
        if (/MAX\(sort_order\)/.test(text)) {
          return { max_order: 0 };
        }
        return null;
      },
      async all() {
        return { results: [] };
      },
      async run() {
        writes.push({ sql: text, args: [...args] });
        return { success: true };
      }
    };
    return statement;
  }

  return { prepare, writes, batch: async () => [] };
}

function createAgentServer(id = 'srv-ua-1') {
  return {
    id,
    name: 'web-01',
    server_group: 'Default',
    region: '',
    interface: 'eth0',
    sort_order: 0,
    history_partition_id: 1,
    timestamp: Date.now(),
    traffic_limit: 0,
    reset_day: 1,
    collect_interval: 1,
    report_interval: 60,
    ping_mode: 'tcp',
    rx_correction: null,
    tx_correction: null,
    is_hidden: 0
  };
}

function createAdminRequest(token, settings) {
  return new Request('https://example.com/admin', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ action: 'save_settings', settings })
  });
}

test('validateUserAgent 接受常见 UA', () => {
  const accepted = [
    'cfsm',
    'cf-probe_1.2.3',
    'MyAgent/1.0',
    'cfsm (edge)',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'MyAgent/1.0 (+https://example.com)'
  ];
  for (const value of accepted) {
    const result = validateUserAgent(value);
    assert.equal(result.valid, true, value);
    assert.equal(result.value, value);
  }
});

test('validateUserAgent 空值回退默认 UA', () => {
  for (const value of ['', '   ', null, undefined]) {
    const result = validateUserAgent(value);
    assert.equal(result.valid, true);
    assert.equal(result.value, DEFAULT_USER_AGENT);
  }
});

test('validateUserAgent 拒绝会破坏 header / 配置文件 / 安装命令的字符', () => {
  const rejected = [
    'ua"quote',
    'ua\\backslash',
    "ua'single",
    'ua$var',
    'ua&other',
    'ua|pipe',
    'ua<semi',
    'ua>semi',
    'ua`tick',
    'ua%20',
    'ua!bang',
    'ua[bracket]',
    'ua{brace}',
    '中文UA',
    'ua\r\nInjected: 1'
  ];
  for (const value of rejected) {
    const result = validateUserAgent(value);
    assert.equal(result.valid, false, JSON.stringify(value));
    assert.equal(result.value, DEFAULT_USER_AGENT);
    assert.equal(sanitizeUserAgent(value), DEFAULT_USER_AGENT);
  }
});

test('cfsm_ua 使用 URL 编码写入，避免分号等字符写坏 Cookie 头', () => {
  const request = new Request('https://example.com/admin');
  const cookie = buildUaCookie(request, 'MyAgent/1.0 (edge)');
  assert.match(cookie, /^cfsm_ua=MyAgent%2F1\.0%20\(edge\); Max-Age=604800; Path=\/; HttpOnly; SameSite=Lax; Secure$/);

  // 分号编码后不会注入新的 Cookie 属性。
  assert.match(buildUaCookie(request, 'ua;semi'), /^cfsm_ua=ua%3Bsemi;/);
  assert.equal(buildUaCookie(request, ''), '');
  assert.match(buildClearUaCookie(request), /^cfsm_ua=; Max-Age=0;/);
});

test('validateUserAgent 限制长度', () => {
  const longest = 'a'.repeat(USER_AGENT_MAX_LENGTH);
  assert.equal(validateUserAgent(longest).valid, true);
  assert.equal(validateUserAgent('a'.repeat(USER_AGENT_MAX_LENGTH + 1)).valid, false);
});

test('UA 不参与配置 md5，只走独立下发通道', async () => {
  const server = { collect_interval: 1, report_interval: 60, reset_day: 15, ping_mode: 'tcp' };
  const base = await describeAgentConfig(server, { ua: 'cfsm' });
  const custom = await describeAgentConfig(server, { ua: 'MyAgent/1.0' });
  assert.equal(custom.serialized, base.serialized);
  assert.equal(custom.md5, base.md5);
  assert.equal(custom.ua, 'MyAgent/1.0');
  assert.equal((await describeAgentConfig(server, null)).ua, DEFAULT_USER_AGENT);
  assert.equal((await describeAgentConfig(server, { ua: 'bad"ua' })).ua, DEFAULT_USER_AGENT);
});

test('save_settings 会把 ua 落库，非法值拒绝保存', async () => {
  clearSiteSettingsCache();
  const db = createSettingsDb();
  const env = { API_SECRET: 'secret', DB: db };
  const sys = { password: 'hashed', jwt_secret: 'x'.repeat(32) };
  const token = await generateToken(env, sys);

  const response = await handleAdminAPI(
    createAdminRequest(token, { ua: 'MyAgent/1.0' }),
    env,
    sys,
    null,
    { waitUntil() {} }
  );
  assert.equal(response.status, 200);

  const siteWrite = db.writes.find(entry => entry.args[0] === 'site_options');
  assert.ok(siteWrite, 'site_options 未被写入');
  const persisted = JSON.parse(siteWrite.args[1]);
  assert.equal(persisted.ua, 'MyAgent/1.0');

  // 非法值必须在写库前被拦下，避免带引号/中文的值进库后被静默回退成 cfsm。
  const before = db.writes.length;
  const rejected = await handleAdminAPI(
    createAdminRequest(token, { ua: 'bad"ua' }),
    { API_SECRET: 'secret', DB: db },
    { password: 'hashed', jwt_secret: 'x'.repeat(32) },
    null,
    { waitUntil() {} }
  );
  assert.equal(rejected.status, 400);
  assert.equal((await rejected.json()).error, 'invalidUserAgent');
  assert.equal(db.writes.length, before);
  clearSiteSettingsCache();
});

test('非法 ua 不会留下「外观已保存、设置未保存」的半成品', async () => {
  clearSiteSettingsCache();
  const db = createSettingsDb();
  const env = { API_SECRET: 'secret', DB: db };
  const sys = { password: 'hashed', jwt_secret: 'x'.repeat(32) };
  const token = await generateToken(env, sys);

  // display_mode 会触发 appearance_options 写库；ua 非法时必须在写库前就被拦下。
  const response = await handleAdminAPI(
    createAdminRequest(token, { ua: 'bad"ua', display_mode: 'card' }),
    env,
    sys,
    null,
    { waitUntil() {} }
  );
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'invalidUserAgent');
  assert.deepEqual(db.writes, [], '校验失败时不应有任何写库动作');
  clearSiteSettingsCache();
});

test('POST /update 只在认证且配置协商成功时返回 X-Ua', async () => {
  clearSiteSettingsCache();
  clearServerDetailCache();
  const server = createAgentServer();
  const db = createSettingsDb({ ua: 'MyAgent/1.0', server });
  const env = { API_SECRET: 'secret', DB: db };
  const report = (secret) => new Request('https://example.com/update', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Agent-Config-Schema': '7',
      'X-Agent-Config-Md5': 'none'
    },
    body: JSON.stringify({ id: server.id, secret, metrics: { cpu: '1' } })
  });

  const ok = await handleUpdate(report('secret'), env, { waitUntil() {} });
  assert.ok(ok.status === 200 || ok.status === 204, `unexpected status ${ok.status}`);
  assert.equal(ok.headers.get('X-Ua'), 'MyAgent/1.0');

  // 未认证请求不得看到该头，否则任何人都能读到防火墙放行值。
  const unauthorized = await handleUpdate(report('wrong'), env, { waitUntil() {} });
  assert.equal(unauthorized.status, 401);
  assert.equal(unauthorized.headers.get('X-Ua'), null);
  clearSiteSettingsCache();
  clearServerDetailCache();
});

test('WSS ack 的配置协商帧携带 ua', async () => {
  clearSiteSettingsCache();
  const server = createAgentServer();
  const broadcaster = new MetricsBroadcaster({
    setWebSocketAutoResponse() {},
    getWebSockets() {
      return [];
    },
    storage: {
      async get() {
        return null;
      },
      async put() {}
    }
  }, { DB: createSettingsDb({ ua: 'MyAgent/1.0', server }) });

  const ack = await broadcaster._buildAgentConfigAck({
    serverId: server.id,
    agentConfig: { requested: true, schema: 7, md5: 'none' }
  });
  assert.equal(ack?.ua, 'MyAgent/1.0');

  // 普通 ack（未请求配置协商）不带 ua，避免每条帧都重复下发。
  const plainAck = await broadcaster._buildAgentConfigAck({ serverId: server.id });
  assert.equal(plainAck, null);
  clearSiteSettingsCache();
});

test('后台保存设置的载荷包含 ua（回归：漏提交导致永远存不进库）', () => {
  const source = readFileSync(new URL('../src/frontend/views/admin/index.vue', import.meta.url), 'utf8');
  const start = source.indexOf("action: 'save_settings'");
  assert.ok(start > 0, '未找到 save_settings 载荷');
  const end = source.indexOf('if (shouldChangePassword', start);
  const payload = source.slice(start, end > start ? end : undefined);
  assert.match(payload, /\bua: String\(settings\.value\.ua/, '保存载荷缺少 ua 字段');
});
