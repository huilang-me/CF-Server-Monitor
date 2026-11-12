import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';
import {
  estimateDurableObjectsBillableRequests,
  handleAdminAPI,
  sanitizeAdminSettings,
  summarizeDurableObjectsUsage
} from '../src/handlers/admin.js';
import { generateToken } from '../src/middleware/auth.js';
import {
  isValidThemeOptions,
  saveThemeOptions
} from '../src/utils/settings.js';

function makeSettingsDb(initialRows = {}) {
  const store = new Map(Object.entries(initialRows));
  const calls = [];
  return {
    store,
    calls,
    prepare(sql) {
      calls.push({ type: 'prepare', sql });
      const statement = {
        params: [],
        bind(...params) {
          statement.params = params;
          return statement;
        },
        async first() {
          calls.push({ type: 'first', sql, params: statement.params });
          throw new Error('saveThemeOptions should not read appearance_options before writing');
        },
        async run() {
          calls.push({ type: 'run', sql, params: statement.params });
          if (/INSERT INTO settings/.test(sql) && /json_set/.test(sql)) {
            const themeOptions = JSON.parse(statement.params[0]);
            let existing = {};
            try {
              const parsed = JSON.parse(store.get('appearance_options') || '{}');
              existing = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
            } catch (_) {
              existing = {};
            }
            store.set('appearance_options', JSON.stringify({
              ...existing,
              theme_options: themeOptions
            }));
          }
          return { success: true };
        }
      };
      return statement;
    }
  };
}

assert.equal(estimateDurableObjectsBillableRequests(0), 0);
assert.equal(estimateDurableObjectsBillableRequests(1), 1);
assert.equal(estimateDurableObjectsBillableRequests(20), 1);
assert.equal(estimateDurableObjectsBillableRequests(21), 2);
assert.equal(estimateDurableObjectsBillableRequests(100), 5);
assert.equal(estimateDurableObjectsBillableRequests('101'), 6);

assert.equal(estimateDurableObjectsBillableRequests({
  httpRequests: 12,
  hibernationWakeups: 20,
  inboundWebSocketMessages: 21,
  outboundWebSocketMessages: 1000
}), 34);

const usage = summarizeDurableObjectsUsage([
  { dimensions: { type: 'fetch' }, sum: { requests: 10 } },
  { dimensions: { type: 'websocket_message' }, sum: { requests: 21 } },
  { dimensions: { type: 'webSocketHibernation' }, sum: { requests: 20 } }
], [
  { sum: { inboundWebsocketMsgCount: 39, outboundWebsocketMsgCount: 100 } },
  { sum: { inboundWebsocketMsgCount: '1', outboundWebsocketMsgCount: '20' } }
]);

assert.deepEqual(usage, {
  httpRequests: 10,
  hibernationWakeups: 41,
  inboundWebSocketMessages: 40,
  outboundWebSocketMessages: 120,
  rawRequests: 51,
  billableRequests: 53
});

assert.equal(isValidThemeOptions({}), true);
assert.equal(isValidThemeOptions({ layout: 'compact' }), true);
assert.equal(isValidThemeOptions([]), false);
assert.equal(isValidThemeOptions(null), false);
assert.equal(isValidThemeOptions('{"layout":"compact"}'), false);

const safeAdminSettings = sanitizeAdminSettings({
  username: 'admin',
  password: 'pbkdf2_sha256$50000$salt$hash',
  jwt_secret: 'jwt-secret'
});
assert.equal(Object.hasOwn(safeAdminSettings, 'password'), false);
assert.equal(Object.hasOwn(safeAdminSettings, 'jwt_secret'), false);
assert.equal(safeAdminSettings.password_configured, true);
assert.equal(sanitizeAdminSettings({ password: '' }).password_configured, false);

const themeOptionsDb = makeSettingsDb({
  appearance_options: JSON.stringify({
    site_title: 'Keep Title',
    csp_api: 'https://api.example.com',
    theme_options: { old: true }
  }),
  site_options: JSON.stringify({
    is_public: 'false',
    theme_url: 'https://github.com/example/theme/tree/main'
  })
});

const savedAppearanceOptions = await saveThemeOptions(themeOptionsDb, {
  layout: 'compact',
  color: 'green'
});

assert.deepEqual(savedAppearanceOptions, {
  layout: 'compact',
  color: 'green'
});
assert.deepEqual(JSON.parse(themeOptionsDb.store.get('appearance_options')), {
  site_title: 'Keep Title',
  csp_api: 'https://api.example.com',
  theme_options: {
    layout: 'compact',
    color: 'green'
  }
});
assert.deepEqual(JSON.parse(themeOptionsDb.store.get('site_options')), {
  is_public: 'false',
  theme_url: 'https://github.com/example/theme/tree/main'
});
assert.equal(themeOptionsDb.calls.some(call => call.type === 'first'), false);
assert.equal(themeOptionsDb.calls.some(call => call.type === 'run' && /\$\.theme_options/.test(call.sql)), true);

function makeSortOrderDb() {
  const calls = [];
  const batches = [];
  return {
    calls,
    batches,
    prepare(sql) {
      calls.push({ type: 'prepare', sql });
      return {
        sql,
        params: [],
        bind(...params) {
          return {
            sql,
            params,
            async run() {
              calls.push({ type: 'run', sql, params });
              return { success: true };
            }
          };
        }
      };
    },
    async batch(statements) {
      batches.push(statements.map(stmt => ({ sql: stmt.sql, params: stmt.params })));
      return statements.map(() => ({ success: true }));
    }
  };
}

const adminSys = {
  username: 'admin'
};
const adminToken = await generateToken({ DB: makeSortOrderDb() }, adminSys);

const invalidOrderDb = makeSortOrderDb();
const invalidOrderResponse = await handleAdminAPI(
  new Request('https://monitor.example.com/admin/api', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`
    },
    body: JSON.stringify({
      action: 'save_order',
      orders: ['11111111-1111-4111-8111-111111111111', 'invalid-uuid']
    })
  }),
  { DB: invalidOrderDb },
  adminSys
);
assert.equal(invalidOrderResponse.status, 400);
assert.equal(invalidOrderDb.calls.length, 0);
assert.equal(invalidOrderDb.batches.length, 0);

const validOrderDb = makeSortOrderDb();
const firstServerId = '11111111-1111-4111-8111-111111111111';
const secondServerId = '22222222-2222-4222-8222-222222222222';
const validOrderResponse = await handleAdminAPI(
  new Request('https://monitor.example.com/admin/api', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`
    },
    body: JSON.stringify({
      action: 'save_order',
      orders: [secondServerId, firstServerId]
    })
  }),
  { DB: validOrderDb },
  adminSys
);
assert.equal(validOrderResponse.status, 200);
assert.equal(validOrderDb.calls.some(call => call.type === 'run'), false);
assert.equal(validOrderDb.batches.length, 1);
assert.deepEqual(validOrderDb.batches[0], [
  { sql: 'UPDATE servers SET sort_order = ? WHERE id = ?', params: [0, secondServerId] },
  { sql: 'UPDATE servers SET sort_order = ? WHERE id = ?', params: [1, firstServerId] }
]);

const miniflare = new Miniflare({
  modules: true,
  script: 'export default { fetch() { return new Response("OK"); } }',
  d1Databases: { DB: 'admin-save-order-test' }
});
try {
  const d1 = await miniflare.getD1Database('DB');
  await d1.prepare('CREATE TABLE servers (id TEXT PRIMARY KEY, sort_order INTEGER)').run();
  await d1.prepare('INSERT INTO servers (id, sort_order) VALUES (?, 0), (?, 1)').bind(firstServerId, secondServerId).run();

  const rejectedReorder = await handleAdminAPI(
    new Request('https://monitor.example.com/admin/api', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        action: 'save_order',
        orders: [secondServerId, 'invalid-uuid']
      })
    }),
    { DB: d1 },
    adminSys
  );
  assert.equal(rejectedReorder.status, 400);
  const unchangedRows = await d1.prepare('SELECT id, sort_order FROM servers ORDER BY sort_order ASC').all();
  assert.deepEqual(unchangedRows.results, [
    { id: firstServerId, sort_order: 0 },
    { id: secondServerId, sort_order: 1 }
  ]);

  const appliedReorder = await handleAdminAPI(
    new Request('https://monitor.example.com/admin/api', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        action: 'save_order',
        orders: [secondServerId, firstServerId]
      })
    }),
    { DB: d1 },
    adminSys
  );
  assert.equal(appliedReorder.status, 200);
  const updatedRows = await d1.prepare('SELECT id, sort_order FROM servers ORDER BY sort_order ASC').all();
  assert.deepEqual(updatedRows.results, [
    { id: secondServerId, sort_order: 0 },
    { id: firstServerId, sort_order: 1 }
  ]);
} finally {
  await miniflare.dispose();
}

console.log('admin usage tests passed');
