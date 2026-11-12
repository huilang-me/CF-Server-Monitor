import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTO_DISCOVERY_ERROR_NO_NAME,
  AUTO_DISCOVERY_MODE_CREATED,
  AUTO_DISCOVERY_MODE_FAILED,
  AUTO_DISCOVERY_MODE_REUSED,
  discoverServer,
  isAutoDiscoveryEnabled,
  resolveDiscoveredServerName
} from '../src/utils/autoDiscovery.js';
import { HISTORY_MAX_PARTITION_ID, insertServerWithPartition } from '../src/database/indexOptimization.js';
import { clearServerDetailCache, clearServersListCache } from '../src/utils/cache.js';
import { clearSiteSettingsCache } from '../src/utils/settings.js';
import { handleUpdate } from '../src/handlers/update.js';

const normalizeSql = (sql) => String(sql).replace(/\s+/g, ' ').trim();

function createFakeDb(initialServers = [], siteOptions = null) {
  const servers = initialServers.map(server => ({ ...server }));
  const state = { inserted: [], deleted: [], failInsert: false, failSelectById: false };

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
          return siteOptions ? { value: JSON.stringify(siteOptions) } : null;
        }
        if (/^SELECT id FROM servers WHERE name = \?/.test(text)) {
          const matches = servers
            .filter(server => server.name === args[0])
            .sort((a, b) =>
              (a.sort_order - b.sort_order) ||
              (a.timestamp - b.timestamp) ||
              String(a.id).localeCompare(String(b.id))
            );
          return matches.length > 0 ? { id: matches[0].id } : null;
        }
        if (/^SELECT \* FROM servers WHERE id = \?$/.test(text)) {
          if (state.failSelectById) throw new Error('D1_ERROR');
          const row = servers.find(server => server.id === args[0]);
          return row ? { ...row } : null;
        }
        return null;
      },
      async all() {
        if (/FROM servers/.test(text)) {
          return { results: servers.map(server => ({ ...server })) };
        }
        return { results: [] };
      },
      async run() {
        if (text.includes('INSERT INTO servers')) {
          if (state.failInsert) throw new Error('D1_ERROR');
          // 测试替身：只用于 discoverServer 流程，SQL 本身由 test/server-insert-sql.test.js 用真实 D1 覆盖。
          const [, id, name, server_group, region, iface, timestamp] = args;
          const usedPartitionIds = new Set(
            servers.map(server => Number(server.history_partition_id)).filter(pid => pid > 0)
          );
          let history_partition_id = 0;
          for (let pid = 1; pid <= HISTORY_MAX_PARTITION_ID; pid++) {
            if (!usedPartitionIds.has(pid)) {
              history_partition_id = pid;
              break;
            }
          }
          if (!history_partition_id) return { meta: { changes: 0 } };
          const sort_order = servers.reduce(
            (max, server) => Math.max(max, Number(server.sort_order ?? -1)),
            -1
          ) + 1;
          servers.push({
            id,
            name,
            server_group,
            region,
            interface: iface,
            sort_order,
            history_partition_id,
            timestamp
          });
          state.inserted.push(id);
          return { meta: { changes: 1 } };
        } else if (text.startsWith('DELETE FROM servers')) {
          const index = servers.findIndex(server => server.id === args[0]);
          if (index >= 0) servers.splice(index, 1);
          state.deleted.push(args[0]);
        }
        return { success: true };
      }
    };

    return statement;
  }

  return { servers, state, prepare };
}

test('isAutoDiscoveryEnabled only accepts the explicit switch', () => {
  assert.equal(isAutoDiscoveryEnabled({ auto_discovery: 'true' }), true);
  assert.equal(isAutoDiscoveryEnabled({ auto_discovery: true }), true);
  assert.equal(isAutoDiscoveryEnabled({ auto_discovery: 'false' }), false);
  assert.equal(isAutoDiscoveryEnabled({ auto_discovery: '' }), false);
  assert.equal(isAutoDiscoveryEnabled({}), false);
  assert.equal(isAutoDiscoveryEnabled(), false);
});

test('resolveDiscoveredServerName prefers name, then CF-Connecting-IP', () => {
  assert.equal(
    resolveDiscoveredServerName({
      name: ' web-01 ',
      request: { headers: { get: () => '198.51.100.7' } }
    }),
    'web-01'
  );

  assert.equal(
    resolveDiscoveredServerName({
      request: { headers: { get: () => '198.51.100.7' } }
    }),
    '198.51.100.7'
  );

  assert.equal(resolveDiscoveredServerName({ request: null }), '');
  assert.equal(resolveDiscoveredServerName(), '');

  // metrics.ip_v4 / ip_v6 不再参与命名。
  assert.equal(
    resolveDiscoveredServerName({
      metrics: { ip_v4: '203.0.113.9', ip_v6: '2001:db8::1' },
      request: { headers: { get: () => '198.51.100.7' } }
    }),
    '198.51.100.7'
  );
  assert.equal(resolveDiscoveredServerName({ metrics: { ip_v4: '203.0.113.9' } }), '');

  // 连接来源 IP 的占位值同样不能被当成服务器名称。
  assert.equal(
    resolveDiscoveredServerName({ request: { headers: { get: () => '0' } } }),
    ''
  );
  assert.equal(
    resolveDiscoveredServerName({ request: { headers: { get: () => '0.0.0.0' } } }),
    ''
  );
});

test('discoverServer creates a server when no server matches the name', async () => {
  clearServersListCache();
  const db = createFakeDb();

  const result = await discoverServer({ DB: db }, { name: 'web-01' });

  assert.equal(result.mode, AUTO_DISCOVERY_MODE_CREATED);
  assert.ok(result.id);
  assert.equal(db.servers.length, 1);
  assert.equal(db.servers[0].name, 'web-01');
  assert.equal(db.servers[0].server_group, 'Default');
  assert.equal(db.servers[0].history_partition_id, 1);
  assert.equal(db.servers[0].sort_order, 0);
});

test('insertServerWithPartition only treats changes===0 as no free partition', async () => {
  const makeDb = result => ({
    prepare: () => ({ bind: () => ({ run: async () => result }) })
  });

  // 测试替身/包装层可能不返回 meta，写入其实已经成功，不能误判为“分区已满”。
  await assert.doesNotReject(() =>
    insertServerWithPartition(makeDb({ success: true }), { id: 'x', name: 'X' })
  );
  await assert.doesNotReject(() =>
    insertServerWithPartition(makeDb({ meta: {} }), { id: 'x', name: 'X' })
  );
  await assert.rejects(
    () => insertServerWithPartition(makeDb({ meta: { changes: 0 } }), { id: 'x', name: 'X' }),
    /No available history partition id/
  );
});

test('discoverServer reuses an existing server with the same name', async () => {
  clearServersListCache();
  const db = createFakeDb([
    { id: 'existing-id', name: 'web-01', sort_order: 0, timestamp: 1, history_partition_id: 1 }
  ]);

  const result = await discoverServer({ DB: db }, { name: 'web-01' });

  assert.equal(result.mode, AUTO_DISCOVERY_MODE_REUSED);
  assert.equal(result.id, 'existing-id');
  assert.equal(db.servers.length, 1);
  assert.deepEqual(db.state.inserted, []);
});

test('discoverServer uses CF-Connecting-IP as the name', async () => {
  clearServersListCache();
  const db = createFakeDb();

  const result = await discoverServer(
    { DB: db },
    { request: { headers: { get: () => '198.51.100.7' } } }
  );

  assert.equal(result.mode, AUTO_DISCOVERY_MODE_CREATED);
  assert.equal(db.servers[0].name, '198.51.100.7');
});

test('discoverServer fails silently without any name source', async () => {
  clearServersListCache();
  const db = createFakeDb();

  const result = await discoverServer({ DB: db }, { metrics: {}, request: null });

  assert.equal(result.mode, AUTO_DISCOVERY_MODE_FAILED);
  assert.equal(result.code, AUTO_DISCOVERY_ERROR_NO_NAME);
  assert.equal(result.id, '');
  assert.equal(db.servers.length, 0);
});

test('handleUpdate keeps the original 404 for an unbound report when the switch is off', async () => {
  clearServersListCache();
  const db = createFakeDb();
  const request = new Request('https://example.com/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: '', secret: 'test-secret', metrics: { cpu: '1' } })
  });

  const response = await handleUpdate(
    request,
    { API_SECRET: 'test-secret', DB: db },
    { waitUntil() {} }
  );

  assert.equal(response.status, 404);
  assert.equal(response.headers.get('X-CFSM-Auto-Discovery'), null);
  assert.equal(response.headers.get('X-CFSM-Server-Id'), null);
  assert.deepEqual(db.state.inserted, []);
});

test('discoverServer reports db_error and leaves the table untouched when insert fails', async () => {
  clearServersListCache();
  const db = createFakeDb();
  db.state.failInsert = true;

  const result = await discoverServer({ DB: db }, { name: 'web-01' });

  assert.equal(result.mode, AUTO_DISCOVERY_MODE_FAILED);
  assert.equal(result.code, 'db_error');
  assert.equal(result.id, '');
  assert.equal(db.servers.length, 0);
});

test('handleUpdate rejects an unbound report without metrics before creating a server', async () => {
  clearServersListCache();
  clearSiteSettingsCache();
  const db = createFakeDb([], { auto_discovery: 'true' });
  const request = new Request('https://example.com/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: '', secret: 'test-secret', name: 'web-01' })
  });

  const response = await handleUpdate(
    request,
    { API_SECRET: 'test-secret', DB: db },
    { waitUntil() {} }
  );

  assert.equal(response.status, 400);
  assert.equal(response.headers.get('X-CFSM-Auto-Discovery'), null);
  assert.equal(response.headers.get('X-CFSM-Server-Id'), null);
  assert.deepEqual(db.state.inserted, []);
  assert.equal(db.servers.length, 0);
  clearSiteSettingsCache();
});

test('handleUpdate creates the server once the payload is valid', async () => {
  clearServersListCache();
  clearSiteSettingsCache();
  const db = createFakeDb([], { auto_discovery: 'true' });
  const request = new Request('https://example.com/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: '', secret: 'test-secret', name: 'web-01', metrics: { cpu: '1' } })
  });

  const response = await handleUpdate(
    request,
    { API_SECRET: 'test-secret', DB: db },
    { waitUntil() {} }
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('X-CFSM-Auto-Discovery'), AUTO_DISCOVERY_MODE_CREATED);
  assert.equal(db.state.inserted.length, 1);
  assert.equal(db.servers.length, 1);
  assert.equal(db.servers[0].name, 'web-01');
  assert.equal(response.headers.get('X-CFSM-Server-Id'), db.servers[0].id);
  clearSiteSettingsCache();
});

// 建号已经成功，只是随后读详情失败：必须仍然回传 id，
// 否则 Agent 下一次上报还是空 id，只会撞到同名服务器然后退出。
test('handleUpdate still returns the new id when reloading the detail fails', async () => {
  clearServersListCache();
  clearServerDetailCache();
  clearSiteSettingsCache();
  const db = createFakeDb([], { auto_discovery: 'true' });
  db.state.failSelectById = true;
  const request = new Request('https://example.com/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: '', secret: 'test-secret', name: 'web-01', metrics: { cpu: '1' } })
  });

  const response = await handleUpdate(
    request,
    { API_SECRET: 'test-secret', DB: db },
    { waitUntil() {} }
  );

  assert.equal(response.status, 404);
  assert.equal(response.headers.get('X-CFSM-Auto-Discovery'), AUTO_DISCOVERY_MODE_CREATED);
  assert.equal(db.state.inserted.length, 1);
  assert.equal(response.headers.get('X-CFSM-Server-Id'), db.servers[0].id);
  clearSiteSettingsCache();
});

test('handleUpdate refuses to write when the discovered name already exists', async () => {
  clearServersListCache();
  clearSiteSettingsCache();
  const db = createFakeDb(
    [{ id: 'existing-id', name: '198.51.100.7', sort_order: 0, timestamp: 1, history_partition_id: 1 }],
    { auto_discovery: 'true' }
  );
  const request = new Request('https://example.com/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '198.51.100.7' },
    body: JSON.stringify({ id: '', secret: 'test-secret', metrics: { cpu: '1' } })
  });

  const response = await handleUpdate(
    request,
    { API_SECRET: 'test-secret', DB: db },
    { waitUntil() {} }
  );

  assert.equal(response.status, 404);
  assert.equal(response.headers.get('X-CFSM-Auto-Discovery'), AUTO_DISCOVERY_MODE_REUSED);
  assert.equal(response.headers.get('X-CFSM-Server-Id'), null);
  assert.deepEqual(db.state.inserted, []);
  assert.equal(db.servers.length, 1);
  clearSiteSettingsCache();
});
