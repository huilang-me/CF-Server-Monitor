import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  APP_PASSWORD_MAX_LENGTH,
  APP_PASSWORD_MIN_LENGTH,
  clearSiteSettingsCache,
  normalizeAppPassword,
  validateAppPassword
} from '../src/utils/settings.js';
import { APP_PASSWORD_HEADER, generateToken, hasAppPasswordAccess } from '../src/middleware/auth.js';
import { handleAdminAPI } from '../src/handlers/admin.js';
import { handleServerAPI, handleServersAPI } from '../src/handlers/dashboard.js';
import { clearServerDetailCache, clearServersListCache } from '../src/utils/cache.js';

const APP_PASSWORD = 'app-pass-0123456789';

const normalizeSql = (sql) => String(sql).replace(/\s+/g, ' ').trim();

function createServer(id, { isHidden = 0 } = {}) {
  return {
    id,
    name: id,
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
    is_hidden: isHidden
  };
}

// 只覆盖仪表盘读取所需的语句：服务器列表、单台详情、最新指标（返回空）。
function createDashboardDb(servers) {
  function prepare(sql) {
    const text = normalizeSql(sql);
    const statement = {
      args: [],
      bind(...values) {
        statement.args = values;
        return statement;
      },
      async first() {
        if (/^SELECT \* FROM servers WHERE id = \?$/.test(text)) {
          return servers.find(server => server.id === statement.args[0]) || null;
        }
        return null;
      },
      async all() {
        if (/^SELECT \* FROM servers ORDER BY sort_order ASC$/.test(text)) {
          return { results: servers.map(server => ({ ...server })) };
        }
        return { results: [] };
      },
      async run() {
        return { success: true };
      }
    };
    return statement;
  }

  return { prepare, batch: async () => [] };
}

// 保存设置只需要 site_options 的读改写。
function createSettingsDb() {
  const writes = [];
  const siteOptions = {};

  function prepare(sql) {
    const text = normalizeSql(sql);
    const statement = {
      args: [],
      bind(...values) {
        statement.args = values;
        return statement;
      },
      async first() {
        if (/^SELECT value FROM settings WHERE key = 'site_options'$/.test(text)) {
          return { value: JSON.stringify(siteOptions) };
        }
        return null;
      },
      async all() {
        return { results: [] };
      },
      async run() {
        writes.push({ sql: text, args: [...statement.args] });
        return { success: true };
      }
    };
    return statement;
  }

  return { prepare, writes, batch: async () => [] };
}

function createRequest(path, headers = {}) {
  return new Request(`https://example.com${path}`, { headers });
}

function createSaveRequest(token, settings) {
  return new Request('https://example.com/admin', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ action: 'save_settings', settings })
  });
}

const resetCaches = () => {
  clearSiteSettingsCache();
  clearServersListCache();
  clearServerDetailCache();
};

test('validateAppPassword 只接受 16-32 位可见 ASCII', () => {
  assert.deepEqual(validateAppPassword(''), { valid: true, value: '' });
  assert.deepEqual(validateAppPassword('   '), { valid: true, value: '' });

  assert.equal(validateAppPassword('a'.repeat(APP_PASSWORD_MIN_LENGTH - 1)).valid, false);
  assert.equal(validateAppPassword('a'.repeat(APP_PASSWORD_MIN_LENGTH)).valid, true);
  assert.equal(validateAppPassword('a'.repeat(APP_PASSWORD_MAX_LENGTH)).valid, true);
  assert.equal(validateAppPassword('a'.repeat(APP_PASSWORD_MAX_LENGTH + 1)).valid, false);

  // 空格、中文、控制字符都不能原样放进请求头。
  assert.equal(validateAppPassword('app pass 01234567').valid, false);
  assert.equal(validateAppPassword('口令口令口令口令口令口令口令口令').valid, false);
  assert.equal(validateAppPassword('app-pass-0123\r\n4567').valid, false);

  // 非法值归一化为空，避免异常数据继续参与放行。
  assert.equal(normalizeAppPassword('short'), '');
  assert.equal(normalizeAppPassword('bad pass 0123456'), '');
  assert.equal(normalizeAppPassword(APP_PASSWORD), APP_PASSWORD);
});

test('hasAppPasswordAccess 未配置口令时一律不放行', () => {
  const request = createRequest('/api/servers', { [APP_PASSWORD_HEADER]: APP_PASSWORD });

  assert.equal(hasAppPasswordAccess(request, {}), false);
  assert.equal(hasAppPasswordAccess(request, { app_password: '' }), false);
  assert.equal(hasAppPasswordAccess(request, null), false);
});

test('hasAppPasswordAccess 按请求头精确匹配口令', () => {
  const sys = { app_password: APP_PASSWORD };

  assert.equal(hasAppPasswordAccess(createRequest('/api/servers', { [APP_PASSWORD_HEADER]: APP_PASSWORD }), sys), true);
  assert.equal(hasAppPasswordAccess(createRequest('/api/servers', { [APP_PASSWORD_HEADER]: ` ${APP_PASSWORD} ` }), sys), true);
  assert.equal(hasAppPasswordAccess(createRequest('/api/servers'), sys), false);
  assert.equal(hasAppPasswordAccess(createRequest('/api/servers', { [APP_PASSWORD_HEADER]: '' }), sys), false);
  assert.equal(hasAppPasswordAccess(createRequest('/api/servers', { [APP_PASSWORD_HEADER]: 'app-pass-0123456780' }), sys), false);
  assert.equal(hasAppPasswordAccess(createRequest('/api/servers', { [APP_PASSWORD_HEADER]: 'short' }), sys), false);
});

test('私有站点：带 App 口令可查看隐藏服务器，无口令返回 401', async () => {
  resetCaches();
  const hidden = createServer('hidden-1', { isHidden: 1 });
  const env = { DB: createDashboardDb([hidden]) };
  const sys = { is_public: 'false', app_password: APP_PASSWORD, show_three_net_details: 'false' };

  const unauthorized = await handleServerAPI(createRequest('/api/server?id=hidden-1'), env, sys);
  assert.equal(unauthorized.status, 401);

  const wrongPassword = await handleServerAPI(
    createRequest('/api/server?id=hidden-1', { [APP_PASSWORD_HEADER]: 'app-pass-0123456780' }),
    env,
    sys
  );
  assert.equal(wrongPassword.status, 401);

  const authorized = await handleServerAPI(
    createRequest('/api/server?id=hidden-1', { [APP_PASSWORD_HEADER]: APP_PASSWORD }),
    env,
    sys
  );
  assert.equal(authorized.status, 200);
  assert.equal((await authorized.json()).id, 'hidden-1');
});

test('公开站点：带 App 口令时列表包含隐藏服务器，无口令时过滤', async () => {
  resetCaches();
  const visible = createServer('visible-1');
  const hidden = createServer('hidden-1', { isHidden: 1 });
  const env = { DB: createDashboardDb([visible, hidden]) };
  const sys = { is_public: 'true', app_password: APP_PASSWORD, show_three_net_details: 'false' };

  const publicList = await handleServersAPI(createRequest('/api/servers'), env, sys);
  assert.equal(publicList.status, 200);
  assert.deepEqual((await publicList.json()).servers.map(server => server.id), ['visible-1']);

  const appList = await handleServersAPI(
    createRequest('/api/servers', { [APP_PASSWORD_HEADER]: APP_PASSWORD }),
    env,
    sys
  );
  assert.equal(appList.status, 200);
  assert.deepEqual((await appList.json()).servers.map(server => server.id).sort(), ['hidden-1', 'visible-1']);
});

test('save_settings 会校验并落库 app_password，非法长度直接拒绝', async () => {
  clearSiteSettingsCache();
  const db = createSettingsDb();
  const env = { API_SECRET: 'secret', DB: db };
  const sys = { password: 'hashed', jwt_secret: 'x'.repeat(32) };
  const token = await generateToken(env, sys);

  const saved = await handleAdminAPI(
    createSaveRequest(token, { app_password: APP_PASSWORD }),
    env,
    sys,
    null,
    { waitUntil() {} }
  );
  assert.equal(saved.status, 200);
  const siteWrite = db.writes.find(entry => entry.args[0] === 'site_options');
  assert.ok(siteWrite, 'site_options 未被写入');
  assert.equal(JSON.parse(siteWrite.args[1]).app_password, APP_PASSWORD);

  const before = db.writes.length;
  const rejected = await handleAdminAPI(
    createSaveRequest(token, { app_password: 'too-short' }),
    { API_SECRET: 'secret', DB: db },
    { password: 'hashed', jwt_secret: 'x'.repeat(32) },
    null,
    { waitUntil() {} }
  );
  assert.equal(rejected.status, 400);
  assert.equal((await rejected.json()).error, 'invalidAppPassword');
  assert.equal(db.writes.length, before, '校验失败时不应写库');

  // 留空表示关闭，允许保存。
  const cleared = await handleAdminAPI(
    createSaveRequest(token, { app_password: '' }),
    { API_SECRET: 'secret', DB: db },
    { password: 'hashed', jwt_secret: 'x'.repeat(32) },
    null,
    { waitUntil() {} }
  );
  assert.equal(cleared.status, 200);
  const lastSiteWrite = db.writes.filter(entry => entry.args[0] === 'site_options').pop();
  assert.equal(JSON.parse(lastSiteWrite.args[1]).app_password, '');
  clearSiteSettingsCache();
});

test('全局 Turnstile 对 App 口令放行，登录处的校验仍然保留', () => {
  const indexSource = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  assert.match(indexSource, /turnstileEnabled && !hasAppPasswordAccess\(request, sys\)/);

  const adminSource = readFileSync(new URL('../src/handlers/admin.js', import.meta.url), 'utf8');
  const loginStart = adminSource.indexOf('async function handleLoginAction');
  const loginGate = adminSource.slice(loginStart, adminSource.indexOf('validateCredentials', loginStart));
  assert.doesNotMatch(loginGate, /hasAppPasswordAccess/, '登录校验不应接入 App 口令');
});

test('App 口令不参与后台管理鉴权', async () => {
  clearSiteSettingsCache();
  const db = createSettingsDb();
  const request = new Request('https://example.com/admin', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      [APP_PASSWORD_HEADER]: APP_PASSWORD
    },
    body: JSON.stringify({ action: 'save_settings', settings: { app_password: APP_PASSWORD } })
  });

  const response = await handleAdminAPI(
    request,
    { API_SECRET: 'secret', DB: db },
    { password: 'hashed', jwt_secret: 'x'.repeat(32), app_password: APP_PASSWORD },
    null,
    { waitUntil() {} }
  );
  assert.equal(response.status, 401);
  assert.deepEqual(db.writes, []);
});
