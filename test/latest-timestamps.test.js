import assert from 'node:assert/strict';
import test from 'node:test';
import { Miniflare } from 'miniflare';

import { getLatestTimestampsForAllServers } from '../src/database/schema.js';
import { buildHistoryId } from '../src/database/indexOptimization.js';
import { clearAllCaches, getLatestMetricsCache, setLatestMetricsCache } from '../src/utils/cache.js';

function createMiniflare() {
  return new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("OK"); } }',
    d1Databases: { DB: 'latest-timestamps-test' }
  });
}

async function createTables(db) {
  await db.prepare(`
    CREATE TABLE servers (
      id TEXT PRIMARY KEY,
      name TEXT,
      sort_order INTEGER,
      history_partition_id INTEGER DEFAULT 0,
      timestamp INTEGER DEFAULT 0
    )
  `).run();
  await db.prepare(`
    CREATE TABLE metrics_history (
      id INTEGER PRIMARY KEY,
      server_id TEXT NOT NULL,
      timestamp INTEGER DEFAULT 0
    )
  `).run();
}

// 每台服务器在其 history 分区内插入两条上报，返回每台的期望最新时间戳
function seedServer(serverRows, metricRows, expected, index, start) {
  const serverId = `server-${index}`;
  serverRows.push(`('${serverId}', 'srv${index}', ${index}, ${index}, ${start})`);
  const older = start + 60_000;
  const latest = start + 120_000 + index * 1000;
  metricRows.push(`(${buildHistoryId(index, older)}, '${serverId}', ${older})`);
  metricRows.push(`(${buildHistoryId(index, latest)}, '${serverId}', ${latest})`);
  expected.set(serverId, latest);
}

test('getLatestTimestampsForAllServers returns the latest timestamp per server', async () => {
  const miniflare = createMiniflare();
  try {
    const db = await miniflare.getD1Database('DB');
    await createTables(db);
    clearAllCaches();

    const start = Date.UTC(2026, 0, 1, 0, 0, 0);
    const serverRows = [];
    const metricRows = [];
    const expected = new Map();
    for (let index = 1; index <= 3; index++) {
      seedServer(serverRows, metricRows, expected, index, start);
    }

    await db.prepare(`INSERT INTO servers (id, name, sort_order, history_partition_id, timestamp) VALUES ${serverRows.join(',')}`).run();
    await db.prepare(`INSERT INTO metrics_history (id, server_id, timestamp) VALUES ${metricRows.join(',')}`).run();

    const result = await getLatestTimestampsForAllServers(db);

    assert.equal(result.size, 3);
    for (const [id, ts] of expected) {
      assert.equal(result.get(id), ts, `server ${id} latest timestamp`);
    }
  } finally {
    clearAllCaches();
    await miniflare.dispose();
  }
});

test('getLatestTimestampsForAllServers batches more than 30 servers without mixing them up', async () => {
  const miniflare = createMiniflare();
  try {
    const db = await miniflare.getD1Database('DB');
    await createTables(db);
    clearAllCaches();

    const start = Date.UTC(2026, 0, 1, 0, 0, 0);
    const serverRows = [];
    const metricRows = [];
    const expected = new Map();
    // 35 台 > 30 台/批，覆盖分块边界（30 + 5）
    for (let index = 1; index <= 35; index++) {
      seedServer(serverRows, metricRows, expected, index, start);
    }

    await db.prepare(`INSERT INTO servers (id, name, sort_order, history_partition_id, timestamp) VALUES ${serverRows.join(',')}`).run();
    await db.prepare(`INSERT INTO metrics_history (id, server_id, timestamp) VALUES ${metricRows.join(',')}`).run();

    const result = await getLatestTimestampsForAllServers(db);

    assert.equal(result.size, 35);
    for (const [id, ts] of expected) {
      assert.equal(result.get(id), ts, `server ${id} latest timestamp`);
    }
  } finally {
    clearAllCaches();
    await miniflare.dispose();
  }
});

test('getLatestTimestampsForAllServers skips servers without any report', async () => {
  const miniflare = createMiniflare();
  try {
    const db = await miniflare.getD1Database('DB');
    await createTables(db);
    clearAllCaches();

    const start = Date.UTC(2026, 0, 1, 0, 0, 0);
    const serverRows = [];
    const metricRows = [];
    const expected = new Map();
    seedServer(serverRows, metricRows, expected, 1, start);
    // 第二台只有服务器记录、没有任何指标上报
    serverRows.push(`('server-2', 'srv2', 2, 2, ${start})`);

    await db.prepare(`INSERT INTO servers (id, name, sort_order, history_partition_id, timestamp) VALUES ${serverRows.join(',')}`).run();
    await db.prepare(`INSERT INTO metrics_history (id, server_id, timestamp) VALUES ${metricRows.join(',')}`).run();

    const result = await getLatestTimestampsForAllServers(db);

    assert.equal(result.size, 1);
    assert.equal(result.has('server-2'), false);
    assert.equal(result.get('server-1'), expected.get('server-1'));
  } finally {
    clearAllCaches();
    await miniflare.dispose();
  }
});

test('getLatestTimestampsForAllServers reuses the full metrics cache without querying', async () => {
  const miniflare = createMiniflare();
  try {
    const db = await miniflare.getD1Database('DB');
    await createTables(db);
    clearAllCaches();

    // 故意不插入任何服务器：若走了查询路径会得到空 Map
    setLatestMetricsCache(new Map([
      ['1', { timestamp: 111 }],
      ['2', { timestamp: 222 }]
    ]));

    const result = await getLatestTimestampsForAllServers(db);

    assert.equal(result.size, 2);
    assert.equal(result.get('1'), 111);
    assert.equal(result.get('2'), 222);
  } finally {
    clearAllCaches();
    await miniflare.dispose();
  }
});

test('getLatestTimestampsForAllServers returns null when the query fails and no cache exists', async () => {
  clearAllCaches();
  const servers = [{ id: '1', history_partition_id: 1, timestamp: Date.UTC(2026, 0, 1) }];
  const fakeDb = {
    prepare: (sql) => ({
      all: async () => (sql.includes('FROM servers') ? { results: servers } : { results: [] }),
      bind: () => ({})
    }),
    batch: async () => { throw new Error('batch boom'); }
  };

  const result = await getLatestTimestampsForAllServers(fakeDb);

  // null 表示"获取失败"，调用方会跳过本次离线检测，而不是把全部服务器判为离线
  assert.equal(result, null);
});

test('getLatestTimestampsForAllServers does not pollute the shared metrics cache', async () => {
  const miniflare = createMiniflare();
  try {
    const db = await miniflare.getD1Database('DB');
    await createTables(db);
    clearAllCaches();

    const start = Date.UTC(2026, 0, 1, 0, 0, 0);
    const serverRows = [];
    const metricRows = [];
    const expected = new Map();
    seedServer(serverRows, metricRows, expected, 1, start);

    await db.prepare(`INSERT INTO servers (id, name, sort_order, history_partition_id, timestamp) VALUES ${serverRows.join(',')}`).run();
    await db.prepare(`INSERT INTO metrics_history (id, server_id, timestamp) VALUES ${metricRows.join(',')}`).run();

    await getLatestTimestampsForAllServers(db);

    // 轻量查询不得写回共享的"完整指标"缓存
    assert.equal(getLatestMetricsCache().cache, null);
  } finally {
    clearAllCaches();
    await miniflare.dispose();
  }
});
