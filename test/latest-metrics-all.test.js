import assert from 'node:assert/strict';
import test from 'node:test';
import { Miniflare } from 'miniflare';

import { getLatestMetricsForAllServers } from '../src/database/schema.js';
import { buildHistoryId } from '../src/database/indexOptimization.js';
import { clearAllCaches, getLatestMetricsCache, setLatestMetricsCache } from '../src/utils/cache.js';

function createMiniflare() {
  return new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("OK"); } }',
    d1Databases: { DB: 'latest-metrics-all-test' }
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
      timestamp INTEGER DEFAULT 0,
      cpu INTEGER DEFAULT 0
    )
  `).run();
}

// 每台服务器在其 history 分区内插入两条上报，返回每台期望的最新完整行
function seedServer(serverRows, metricRows, expected, index, start) {
  const serverId = `server-${index}`;
  serverRows.push(`('${serverId}', 'srv${index}', ${index}, ${index}, ${start})`);
  const older = start + 60_000;
  const latest = start + 120_000 + index * 1000;
  metricRows.push(`(${buildHistoryId(index, older)}, '${serverId}', ${older}, ${index * 10})`);
  metricRows.push(`(${buildHistoryId(index, latest)}, '${serverId}', ${latest}, ${index * 100})`);
  expected.set(serverId, { timestamp: latest, cpu: index * 100 });
}

async function insertAll(db, serverRows, metricRows) {
  await db.prepare(`INSERT INTO servers (id, name, sort_order, history_partition_id, timestamp) VALUES ${serverRows.join(',')}`).run();
  await db.prepare(`INSERT INTO metrics_history (id, server_id, timestamp, cpu) VALUES ${metricRows.join(',')}`).run();
}

test('getLatestMetricsForAllServers returns the latest full row per server', async () => {
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
    await insertAll(db, serverRows, metricRows);

    const result = await getLatestMetricsForAllServers(db);

    assert.equal(result.size, 3);
    for (const [id, exp] of expected) {
      const row = result.get(id);
      assert.ok(row, `row for ${id}`);
      assert.equal(row.timestamp, exp.timestamp, `server ${id} latest timestamp`);
      assert.equal(row.cpu, exp.cpu, `server ${id} latest cpu`);
    }
  } finally {
    clearAllCaches();
    await miniflare.dispose();
  }
});

test('getLatestMetricsForAllServers batches more than 30 servers without mixing them up', async () => {
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
    await insertAll(db, serverRows, metricRows);

    const result = await getLatestMetricsForAllServers(db);

    assert.equal(result.size, 35);
    for (const [id, exp] of expected) {
      const row = result.get(id);
      assert.ok(row, `row for ${id}`);
      assert.equal(row.timestamp, exp.timestamp, `server ${id} latest timestamp`);
      assert.equal(row.cpu, exp.cpu, `server ${id} latest cpu`);
    }
  } finally {
    clearAllCaches();
    await miniflare.dispose();
  }
});

test('getLatestMetricsForAllServers skips servers without any report', async () => {
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
    await insertAll(db, serverRows, metricRows);

    const result = await getLatestMetricsForAllServers(db);

    assert.equal(result.size, 1);
    assert.equal(result.has('server-2'), false);
    assert.equal(result.get('server-1').cpu, expected.get('server-1').cpu);
  } finally {
    clearAllCaches();
    await miniflare.dispose();
  }
});

test('getLatestMetricsForAllServers returns the cache directly when fresh', async () => {
  clearAllCaches();
  const cached = new Map([['1', { timestamp: 111, cpu: 5 }]]);
  setLatestMetricsCache(cached);
  const fakeDb = {
    prepare: () => { throw new Error('should not query when cache is fresh'); }
  };

  const result = await getLatestMetricsForAllServers(fakeDb);

  assert.equal(result, cached);
});

test('getLatestMetricsForAllServers stores the result into the shared cache', async () => {
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
    await insertAll(db, serverRows, metricRows);

    const result = await getLatestMetricsForAllServers(db);

    const cache = getLatestMetricsCache().cache;
    assert.ok(cache, 'cache should be populated');
    assert.equal(cache.get('server-1').cpu, expected.get('server-1').cpu);
  } finally {
    clearAllCaches();
    await miniflare.dispose();
  }
});

test('getLatestMetricsForAllServers skips a server with an invalid history range without losing others', async () => {
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
    // 第二台的 startTimestamp 非法（1970），范围计算会抛错，应只跳过该台
    serverRows.push(`('server-2', 'srv2', 2, 2, 1000)`);
    await insertAll(db, serverRows, metricRows);

    const result = await getLatestMetricsForAllServers(db);

    assert.equal(result.size, 1);
    assert.equal(result.has('server-2'), false);
    assert.equal(result.get('server-1').cpu, expected.get('server-1').cpu);
  } finally {
    clearAllCaches();
    await miniflare.dispose();
  }
});

test('getLatestMetricsForAllServers falls back to per-server queries when the batch fails', async () => {
  clearAllCaches();
  const servers = [{ id: '1', history_partition_id: 1, timestamp: Date.UTC(2026, 0, 1) }];
  const fakeDb = {
    prepare: (sql) => {
      if (sql.includes('FROM servers')) {
        return { all: async () => ({ results: servers }) };
      }
      if (sql.includes('FROM metrics_history')) {
        return {
          bind: () => ({
            first: async () => ({ id: 1, server_id: '1', timestamp: 999, cpu: 42 })
          })
        };
      }
      return { all: async () => ({ results: [] }) };
    },
    batch: async () => { throw new Error('batch boom'); }
  };

  const result = await getLatestMetricsForAllServers(fakeDb);

  assert.equal(result.size, 1);
  assert.equal(result.get('1').cpu, 42);
  clearAllCaches();
});
