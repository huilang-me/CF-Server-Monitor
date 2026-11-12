import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { Miniflare } from 'miniflare';

import { handleAdminAPI } from '../src/handlers/admin.js';
import { parseServerBackup } from '../src/frontend/utils/backup.js';
import { generateToken } from '../src/middleware/auth.js';
import {
  clearSiteSettingsCache,
  clearAppearanceSettingsCache,
  IMPORTABLE_SITE_FIELDS,
  IMPORTABLE_APPEARANCE_FIELDS,
  SETTINGS_EXCLUDED_FIELDS,
  saveAppearanceOptions
} from '../src/utils/settings.js';

// 用真实 D1 跑导入导出：字段过滤和 JSON 合并逻辑都在 SQL 里，替身证明不了正确性。
const miniflare = new Miniflare({
  modules: true,
  script: 'export default { fetch() { return new Response("OK"); } }',
  d1Databases: {
    DB: 'import-export-settings-test',
    SETTINGS_ONLY: 'import-export-settings-only-test',
    ROUND_TRIP: 'import-export-round-trip-test'
  }
});
const db = await miniflare.getD1Database('DB');

// 与 schema.js 的 servers 表保持一致：导入 SQL 直接写全字段，缺列会整条跳过。
const SERVERS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS servers (
  id TEXT PRIMARY KEY,
  name TEXT,
  server_group TEXT DEFAULT 'Default',
  region TEXT DEFAULT '',
  tags TEXT DEFAULT '',
  note TEXT DEFAULT '',
  price TEXT DEFAULT '',
  billing_cycle TEXT DEFAULT 'month',
  auto_renewal TEXT DEFAULT '0',
  currency TEXT DEFAULT '¥',
  expire_date TEXT DEFAULT '',
  traffic_limit TEXT DEFAULT '',
  traffic_calc_type TEXT DEFAULT 'total',
  traffic_alert_percent INTEGER DEFAULT NULL,
  traffic_alert_state TEXT,
  "interface" TEXT DEFAULT '',
  reset_day INTEGER DEFAULT 1,
  collect_interval INTEGER DEFAULT 0,
  report_interval INTEGER DEFAULT 60,
  wss_report_interval INTEGER DEFAULT 2,
  connection_mode TEXT DEFAULT 'auto',
  ping_mode TEXT DEFAULT 'tcp',
  auto_update TEXT DEFAULT '0',
  custom_ct TEXT DEFAULT '',
  custom_cu TEXT DEFAULT '',
  custom_cm TEXT DEFAULT '',
  custom_bd TEXT DEFAULT '',
  node_1 TEXT DEFAULT '',
  node_2 TEXT DEFAULT '',
  node_3 TEXT DEFAULT '',
  node_4 TEXT DEFAULT '',
  rx_correction REAL DEFAULT NULL,
  tx_correction REAL DEFAULT NULL,
  offline_notify_disabled TEXT DEFAULT '0',
  is_hidden TEXT DEFAULT '0',
  sort_order INTEGER DEFAULT 0,
  history_partition_id INTEGER DEFAULT 0,
  timestamp INTEGER DEFAULT 0
)`;

async function createSchema(database) {
  await database.prepare('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)').run();
  await database.prepare(SERVERS_TABLE_SQL).run();
}

await createSchema(db);

after(async () => {
  await miniflare.dispose();
});

const JWT_SECRET = 'x'.repeat(32);
const SYS = { password: 'hashed-password', jwt_secret: JWT_SECRET };

function createRequest(token, body) {
  return new Request('https://example.com/admin', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(body)
  });
}

async function adminCall(body) {
  const env = { API_SECRET: 'secret', DB: db };
  const token = await generateToken(env, SYS);
  const response = await handleAdminAPI(createRequest(token, body), env, SYS, null, { waitUntil() {} });
  return { status: response.status, data: await response.json() };
}

async function seedSettings(siteOptions, appearanceOptions) {
  await db.prepare('DELETE FROM settings').run();
  await db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)')
    .bind('site_options', JSON.stringify(siteOptions)).run();
  await db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)')
    .bind('appearance_options', JSON.stringify(appearanceOptions)).run();
  clearSiteSettingsCache();
  clearAppearanceSettingsCache();
}

async function readSetting(key) {
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first();
  return row ? JSON.parse(row.value) : null;
}

test('环境相关字段不在导入导出白名单内', () => {
  for (const field of [
    'username', 'password', 'jwt_secret',
    'turnstile_enabled', 'turnstile_login_enabled', 'turnstile_site_key', 'turnstile_secret_key',
    'ua', 'resource_alert_rules', 'csp_static', 'csp_api', 'servers_optimized'
  ]) {
    assert.ok(SETTINGS_EXCLUDED_FIELDS.includes(field), `${field} 应被排除`);
    assert.equal(IMPORTABLE_SITE_FIELDS.includes(field), false, `${field} 不应出现在站点白名单`);
    assert.equal(IMPORTABLE_APPEARANCE_FIELDS.includes(field), false, `${field} 不应出现在外观白名单`);
  }
  assert.ok(IMPORTABLE_SITE_FIELDS.includes('is_public'));
  assert.ok(IMPORTABLE_APPEARANCE_FIELDS.includes('site_title'));
});

test('export_servers 不会带出凭据、Turnstile、UA、告警规则与 CSP', async () => {
  await seedSettings(
    {
      username: 'admin',
      password: 'hashed-password',
      jwt_secret: JWT_SECRET,
      turnstile_enabled: 'true',
      turnstile_site_key: 'site-key',
      turnstile_secret_key: 'secret-key',
      ua: 'CustomUA/1.0',
      resource_alert_rules: [{ id: 'rule-1' }],
      cloudflare_account_id: 'acc',
      cloudflare_token: 'token',
      servers_optimized: 'true',
      is_public: 'false'
    },
    { site_title: 'My Monitor', csp_static: 'https://cdn.example.com', display_mode: 'table' }
  );

  const { status, data } = await adminCall({ action: 'export_servers' });
  assert.equal(status, 200);

  const site = data.settings.site;
  for (const field of SETTINGS_EXCLUDED_FIELDS) {
    assert.equal(field in site, false, `导出不应包含 ${field}`);
  }
  assert.equal(site.is_public, 'false');
  // Cloudflare 账号/令牌按需求随备份一起导出，同账号迁移需要它。
  assert.equal(site.cloudflare_account_id, 'acc');
  assert.equal(site.cloudflare_token, 'token');

  const appearance = data.settings.appearance;
  assert.equal(appearance.site_title, 'My Monitor');
  assert.equal('csp_static' in appearance, false);
  assert.equal('csp_api' in appearance, false);
});

test('import_servers 只写入白名单设置，凭据与 UA 保持原值', async () => {
  await seedSettings(
    { username: 'admin', password: 'hashed-password', jwt_secret: JWT_SECRET, ua: 'cfsm', is_public: 'true' },
    { site_title: 'Old Title', csp_static: 'https://old.example.com' }
  );

  const { status, data } = await adminCall({
    action: 'import_servers',
    servers: [],
    settings: {
      site: {
        is_public: 'false',
        ua: 'HijackedUA/1.0',
        password: 'plain-text',
        username: 'attacker',
        jwt_secret: 'y'.repeat(32),
        turnstile_enabled: 'true',
        resource_alert_rules: [{ id: 'other-site-rule' }],
        servers_optimized: 'false',
        cloudflare_account_id: 'new-acc',
        cloudflare_token: 'new-token'
      },
      appearance: { site_title: 'Imported Title', csp_static: 'https://evil.example.com' }
    }
  });

  assert.equal(status, 200);
  assert.equal(data.settings.imported, true);
  assert.ok(data.settings.ignoredFields.includes('password'));
  assert.ok(data.settings.ignoredFields.includes('ua'));
  assert.ok(data.settings.ignoredFields.includes('csp_static'));

  const site = await readSetting('site_options');
  assert.equal(site.is_public, 'false', '白名单字段应被覆盖');
  assert.equal(site.password, 'hashed-password', '密码不能被覆盖');
  assert.equal(site.username, 'admin', '账号不能被覆盖');
  assert.equal(site.jwt_secret, JWT_SECRET, 'JWT 密钥不能被覆盖');
  assert.equal(site.ua, 'cfsm', 'UA 不能被覆盖');
  assert.equal(site.turnstile_enabled, undefined, 'Turnstile 不能被写入');
  assert.equal(site.cloudflare_account_id, 'new-acc', 'Cloudflare 账号应随备份导入');
  assert.equal(site.cloudflare_token, 'new-token', 'Cloudflare 令牌应随备份导入');
  assert.equal(site.servers_optimized, undefined, '分区标记不能被写入');

  const appearance = await readSetting('appearance_options');
  assert.equal(appearance.site_title, 'Imported Title');
  assert.equal(appearance.csp_static, 'https://old.example.com', 'CSP 不能被覆盖');
});

test('saveAppearanceOptions 只合并传入字段，不清空其它外观配置', async () => {
  await seedSettings({}, { site_title: 'Keep Me', custom_bg: 'bg-url' });

  await saveAppearanceOptions(db, { display_mode: 'ring' });

  const appearance = await readSetting('appearance_options');
  assert.equal(appearance.site_title, 'Keep Me');
  assert.equal(appearance.custom_bg, 'bg-url');
  assert.equal(appearance.display_mode, 'ring');
  // 未传入的字段不能被补成默认值，否则老库靠 legacy 单键存的配置会被悄悄改掉。
  assert.equal('preferred_theme' in appearance, false);
  assert.equal('default_language' in appearance, false);
});

test('旧版纯服务器数组备份仍然可以导入', async () => {
  await seedSettings({ is_public: 'true' }, {});

  const { status, data } = await adminCall({
    action: 'import_servers',
    servers: [{ id: '3f2b1c9d-1111-4222-8333-444455556666', name: 'HK-01' }]
  });

  assert.equal(status, 200);
  assert.equal(data.imported, 1);
  assert.equal(data.settings.imported, false);
  const row = await db.prepare('SELECT name FROM servers WHERE id = ?')
    .bind('3f2b1c9d-1111-4222-8333-444455556666').first();
  assert.equal(row.name, 'HK-01');
});

test('数组里混入 null / 字符串不会 500', async () => {
  await seedSettings({ is_public: 'true' }, {});

  const { status, data } = await adminCall({
    action: 'import_servers',
    servers: [null, 'oops', 42]
  });

  assert.equal(status, 200);
  assert.equal(data.imported, 0);
  assert.equal(data.skipped, 3);
});

test('settings.site 不是对象时不会 500', async () => {
  await seedSettings({ is_public: 'true' }, {});

  const { status, data } = await adminCall({
    action: 'import_servers',
    settings: { site: 'junk', appearance: { site_title: 'Only Appearance' } }
  });

  assert.equal(status, 200);
  assert.equal(data.settings.imported, true);
  assert.equal(data.settings.site, 0);
  assert.equal(data.settings.appearance, 1);
  assert.equal((await readSetting('appearance_options')).site_title, 'Only Appearance');
});

test('只导入设置时不需要 servers 表', async () => {
  const onlyDb = await miniflare.getD1Database('SETTINGS_ONLY');
  await onlyDb.prepare('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)').run();
  await onlyDb.prepare('DELETE FROM settings').run();
  await onlyDb.prepare('INSERT INTO settings (key, value) VALUES (?, ?)')
    .bind('site_options', JSON.stringify({ jwt_secret: JWT_SECRET, is_public: 'true' })).run();
  clearSiteSettingsCache();
  clearAppearanceSettingsCache();

  const env = { API_SECRET: 'secret', DB: onlyDb };
  const token = await generateToken(env, SYS);
  const response = await handleAdminAPI(
    createRequest(token, { action: 'import_servers', settings: { site: { is_public: 'false' } } }),
    env,
    SYS,
    null,
    { waitUntil() {} }
  );

  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.settings.imported, true);
  const row = await onlyDb.prepare('SELECT value FROM settings WHERE key = ?').bind('site_options').first();
  assert.equal(JSON.parse(row.value).is_public, 'false');
  clearSiteSettingsCache();
  clearAppearanceSettingsCache();
});

async function insertServerRow(database, row) {
  const columns = Object.keys(row);
  const quoted = columns.map((column) => (column === 'interface' ? '"interface"' : column));
  await database.prepare(
    `INSERT INTO servers (${quoted.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`
  ).bind(...columns.map((column) => row[column])).run();
}

const RICH_SITE = {
  auto_discovery: 'true',
  is_public: 'false',
  show_price: 'false',
  show_expire: 'true',
  show_tf: 'false',
  show_three_net_details: 'true',
  wss_report_enabled: 'true',
  wss_report_hours: [0, 6, 12, 18],
  frontend_ws_timeout_minutes: '30',
  long_history_points: '240',
  tg_notify: '10',
  tg_bot_token: '123456:token',
  tg_chat_id: '-1001234567890',
  notification_timezone: 'Asia/Shanghai',
  notification_language: 'zh',
  expire_notification_time: '9',
  notification_webhook_enabled: 'true',
  notification_webhook_url: 'https://example.com/hook',
  notification_webhook_method: 'POST',
  notification_webhook_format: 'json',
  notification_webhook_headers: '{"X-Token":"abc"}',
  notification_webhook_body: '{"text":"{{message}}"}',
  notification_template: '{{emoji}} {{event}} {{message}}',
  cloudflare_account_id: 'acc-1',
  cloudflare_token: 'cf-token-1',
  custom_ct: 'ct.example.com',
  custom_cu: 'cu.example.com',
  custom_cm: 'cm.example.com',
  custom_bd: 'bd.example.com',
  node_1: 'n1.example.com',
  node_2: 'n2.example.com',
  node_3: 'n3.example.com',
  node_4: 'n4.example.com',
  custom_ct_name: 'CT',
  custom_cu_name: 'CU',
  custom_cm_name: 'CM',
  custom_bd_name: 'BD',
  node_1_name: 'N1',
  node_2_name: 'N2',
  node_3_name: 'N3',
  node_4_name: 'N4',
  expire_reminder: '7',
  traffic_alert_threshold: '85',
  theme_url: 'https://github.com/owner/repo/tree/main',
  jwt_secret: JWT_SECRET,
  // 下面故意混入排除字段，用来验证导出会丢掉它们
  username: 'admin',
  password: 'hashed-password',
  ua: 'CustomUA/1.0',
  turnstile_enabled: 'true',
  resource_alert_rules: [{ id: 'rule-1' }],
  servers_optimized: 'true'
};

const RICH_APPEARANCE = {
  site_title: 'Round Trip',
  custom_bg: 'https://cdn.example.com/bg.jpg',
  custom_bg_mobile: 'https://cdn.example.com/bg-m.jpg',
  favicon: 'https://cdn.example.com/f.ico',
  custom_head: '<meta name="x" content="1">',
  custom_script: 'console.log(1)',
  display_mode: 'table',
  preferred_theme: 'dark',
  default_language: 'ja',
  theme_options: { accent: '#123456' },
  csp_static: 'https://old.example.com',
  csp_api: 'https://old-api.example.com'
};

const RICH_SERVER = {
  id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  name: 'Rich-01',
  server_group: 'HK',
  region: 'HK',
  tags: 'a,b',
  note: 'round trip',
  // 价格入库前统一走 normalizePrice（toFixed(2)），库里只会是这种格式
  price: '10.00',
  billing_cycle: 'month',
  auto_renewal: '0',
  currency: '¥',
  expire_date: '2099-01-01',
  traffic_limit: '1000',
  traffic_calc_type: 'total',
  traffic_alert_percent: 80,
  interface: 'eth0',
  reset_day: 15,
  collect_interval: 1,
  report_interval: 60,
  wss_report_interval: 2,
  connection_mode: 'auto',
  ping_mode: 'tcp',
  auto_update: '1',
  custom_ct: 'ct.example.com',
  custom_cu: 'cu.example.com',
  custom_cm: 'cm.example.com',
  custom_bd: 'bd.example.com',
  node_1: 'n1.example.com',
  node_2: 'n2.example.com',
  node_3: 'n3.example.com',
  node_4: 'n4.example.com',
  rx_correction: 1.5,
  tx_correction: -2,
  offline_notify_disabled: '1',
  is_hidden: '0',
  sort_order: 0,
  history_partition_id: 1,
  timestamp: 1730000000000
};

test('导出 → 导入 → 再导出：设置与服务器保持一致', async () => {
  const target = await miniflare.getD1Database('ROUND_TRIP');
  await createSchema(target);
  await target.prepare('DELETE FROM settings').run();
  await target.prepare('DELETE FROM servers').run();

  await seedSettings(RICH_SITE, RICH_APPEARANCE);
  await db.prepare('DELETE FROM servers').run();
  await insertServerRow(db, RICH_SERVER);
  await insertServerRow(db, {
    ...RICH_SERVER,
    id: 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff',
    name: 'Rich-02',
    price: '5.00',
    currency: '$',
    traffic_alert_percent: null,
    sort_order: 1,
    history_partition_id: 5
  });

  clearSiteSettingsCache();
  clearAppearanceSettingsCache();
  const exported = await adminCall({ action: 'export_servers' });
  assert.equal(exported.status, 200);

  // 走一遍前端实际使用的文件格式与解析
  const { servers, settings } = parseServerBackup(JSON.stringify({
    format: 'cfsm-backup',
    version: 1,
    exported_at: new Date().toISOString(),
    servers: exported.data.servers,
    settings: exported.data.settings
  }));

  const env = { API_SECRET: 'secret', DB: target };
  const token = await generateToken(env, SYS);
  const importedRes = await handleAdminAPI(
    createRequest(token, { action: 'import_servers', servers, settings }),
    env,
    SYS,
    null,
    { waitUntil() {} }
  );
  assert.equal(importedRes.status, 200);
  const imported = await importedRes.json();
  assert.equal(imported.imported, 2);
  assert.equal(imported.skipped, 0);
  assert.equal(imported.settings.site, IMPORTABLE_SITE_FIELDS.length);
  assert.equal(imported.settings.appearance, IMPORTABLE_APPEARANCE_FIELDS.length);
  // 导出已过滤排除字段，所以导入时没有东西可忽略
  assert.deepEqual(imported.settings.ignoredFields, []);

  clearSiteSettingsCache();
  clearAppearanceSettingsCache();
  const reExportedRes = await handleAdminAPI(
    createRequest(token, { action: 'export_servers' }),
    env,
    SYS,
    null,
    { waitUntil() {} }
  );
  const reExported = await reExportedRes.json();

  // 设置必须逐字段一致（含默认值合并后的结果）
  assert.deepEqual(reExported.settings, exported.data.settings);

  // 服务器：traffic_alert_state 不参与迁移，其余字段应完全一致
  const stripVolatile = (rows) => rows.map(({ traffic_alert_state, ...rest }) => rest);
  assert.deepEqual(stripVolatile(reExported.servers), stripVolatile(exported.data.servers));

  clearSiteSettingsCache();
  clearAppearanceSettingsCache();
});
