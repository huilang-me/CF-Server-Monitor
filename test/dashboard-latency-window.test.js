import assert from 'node:assert/strict';
import test from 'node:test';
import { Miniflare } from 'miniflare';

import { getDashboardLatencyHistory } from '../src/database/schema.js';
import { buildHistoryId } from '../src/database/indexOptimization.js';
import {
  DASHBOARD_LATENCY_WINDOW_HOURS,
  DASHBOARD_LATENCY_WINDOW_POINTS,
  DASHBOARD_LATENCY_WINDOW_QUERY_CONCURRENCY
} from '../src/utils/config.js';

function createMiniflare() {
  return new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("OK"); } }',
    d1Databases: { DB: 'dashboard-latency-window-test' }
  });
}

async function createHistoryTable(db) {
  await db.prepare(`
    CREATE TABLE metrics_history (
      id INTEGER PRIMARY KEY,
      timestamp INTEGER,
      ping_ct INTEGER,
      ping_cu INTEGER,
      ping_cm INTEGER,
      ping_bd INTEGER,
      loss_ct INTEGER,
      loss_cu INTEGER,
      loss_cm INTEGER,
      loss_bd INTEGER,
      ping_node_1 INTEGER DEFAULT 0,
      ping_node_2 INTEGER DEFAULT 0,
      ping_node_3 INTEGER DEFAULT 0,
      ping_node_4 INTEGER DEFAULT 0,
      loss_node_1 INTEGER DEFAULT NULL,
      loss_node_2 INTEGER DEFAULT NULL,
      loss_node_3 INTEGER DEFAULT NULL,
      loss_node_4 INTEGER DEFAULT NULL
    )
  `).run();
}

function latencyRow(partitionId, timestamp, value) {
  return `(${buildHistoryId(partitionId, timestamp)}, ${timestamp}, ${value}, ${value + 1}, ${value + 2}, ${value + 3}, ${value % 10}, ${(value + 1) % 10}, ${(value + 2) % 10}, ${(value + 3) % 10})`;
}

test('dashboard latency history samples two hours from D1 into at most 20 real points', async () => {
  const miniflare = createMiniflare();

  try {
    const db = await miniflare.getD1Database('DB');
    await createHistoryTable(db);

    const partitionId = 1;
    const start = Date.UTC(2026, 6, 29, 0, 0, 0);
    const rows = [];
    for (let index = 0; index < 120; index++) {
      rows.push(latencyRow(partitionId, start + index * 60_000, 20 + index));
    }

    await db.prepare(`
      INSERT INTO metrics_history (
        id, timestamp,
        ping_ct, ping_cu, ping_cm, ping_bd,
        loss_ct, loss_cu, loss_cm, loss_bd
      )
      VALUES ${rows.join(',')}
    `).run();

    const history = await getDashboardLatencyHistory(db, [{
      id: 'server-1',
      history_partition_id: partitionId,
      timestamp: start
    }], {
      now: start + 120 * 60_000,
      cache: false
    });

    const window = history.get('server-1');
    assert.equal(window.ping.length, 20);
    assert.equal(window.loss.length, 20);
    assert.equal(new Set(window.ping.map(point => point.ts)).size, 20);
    assert.equal(window.ping.every(point => point.ct >= 20), true);
    assert.equal(window.loss.every(point => point.ct >= 0 && point.ct <= 100), true);
  } finally {
    await miniflare.dispose();
  }
});

test('dashboard latency window config exposes the public contract', () => {
  assert.equal(DASHBOARD_LATENCY_WINDOW_POINTS, 20);
  assert.equal(DASHBOARD_LATENCY_WINDOW_HOURS, 2);
});

test('dashboard latency history preserves empty buckets inside the window', async () => {
  const miniflare = createMiniflare();

  try {
    const db = await miniflare.getD1Database('DB');
    await createHistoryTable(db);

    const partitionId = 3;
    const now = Date.UTC(2026, 6, 29, 4, 0, 0);
    const queryStart = now - DASHBOARD_LATENCY_WINDOW_HOURS * 60 * 60 * 1000;
    const queryEnd = Math.floor(now / 1000) * 1000 + 1000;
    const intervalMs = Math.max(10_000, Math.ceil((queryEnd - queryStart) / DASHBOARD_LATENCY_WINDOW_POINTS));
    const slotTimestamp = index => queryStart + index * intervalMs + 1000;

    await db.prepare(`
      INSERT INTO metrics_history (
        id, timestamp,
        ping_ct, ping_cu, ping_cm, ping_bd,
        loss_ct, loss_cu, loss_cm, loss_bd
      )
      VALUES
        ${latencyRow(partitionId, slotTimestamp(0), 20)},
        ${latencyRow(partitionId, slotTimestamp(5), 50)},
        ${latencyRow(partitionId, slotTimestamp(19), 90)}
    `).run();

    const history = await getDashboardLatencyHistory(db, [{
      id: 'server-gap',
      history_partition_id: partitionId,
      timestamp: queryStart
    }], {
      now,
      cache: false
    });

    const window = history.get('server-gap');
    assert.equal(window.ping.length, DASHBOARD_LATENCY_WINDOW_POINTS);
    assert.equal(window.loss.length, DASHBOARD_LATENCY_WINDOW_POINTS);
    assert.equal(window.ping[0].ct, 20);
    assert.equal(window.ping[1].ct, undefined);
    assert.equal(window.ping[5].ct, 50);
    assert.equal(window.ping[6].ct, undefined);
    assert.equal(window.ping[19].ct, 90);
    assert.equal(window.loss[1].ct, undefined);
    assert.equal(window.ping[5].ts, queryStart + 5 * intervalMs);
  } finally {
    await miniflare.dispose();
  }
});

test('dashboard latency history cache is reused for five minutes per server', async () => {
  const miniflare = createMiniflare();

  try {
    const db = await miniflare.getD1Database('DB');
    await createHistoryTable(db);

    const partitionId = 2;
    const start = Date.UTC(2026, 6, 29, 1, 0, 0);
    await db.prepare(`
      INSERT INTO metrics_history (
        id, timestamp,
        ping_ct, ping_cu, ping_cm, ping_bd,
        loss_ct, loss_cu, loss_cm, loss_bd
      )
      VALUES ${latencyRow(partitionId, start, 30)}
    `).run();

    const server = {
      id: 'server-cache',
      history_partition_id: partitionId,
      timestamp: start
    };
    const first = await getDashboardLatencyHistory(db, [server], {
      now: start + 60_000
    });
    assert.equal(first.get('server-cache').ping.at(-1).ct, 30);

    await db.prepare(`
      INSERT INTO metrics_history (
        id, timestamp,
        ping_ct, ping_cu, ping_cm, ping_bd,
        loss_ct, loss_cu, loss_cm, loss_bd
      )
      VALUES ${latencyRow(partitionId, start + 60_000, 90)}
    `).run();

    const cached = await getDashboardLatencyHistory(db, [server], {
      now: start + 4 * 60_000
    });
    assert.equal(cached.get('server-cache').ping.at(-1).ct, 30);

    const refreshed = await getDashboardLatencyHistory(db, [server], {
      now: start + 6 * 60_000
    });
    assert.equal(refreshed.get('server-cache').ping.at(-1).ct, 90);
  } finally {
    await miniflare.dispose();
  }
});

test('dashboard latency history batches more than 20 servers and preserves per-server order', async () => {
  const miniflare = createMiniflare();

  try {
    const db = await miniflare.getD1Database('DB');
    await createHistoryTable(db);

    const start = Date.UTC(2026, 6, 29, 2, 0, 0);
    const servers = [];
    const rows = [];
    for (let index = 1; index <= 25; index++) {
      servers.push({
        id: `batch-server-${index}`,
        history_partition_id: index,
        timestamp: start
      });
      rows.push(latencyRow(index, start, 10 + index));
    }

    await db.prepare(`
      INSERT INTO metrics_history (
        id, timestamp,
        ping_ct, ping_cu, ping_cm, ping_bd,
        loss_ct, loss_cu, loss_cm, loss_bd
      )
      VALUES ${rows.join(',')}
    `).run();

    let batchCalls = 0;
    const wrappedDb = {
      prepare: sql => db.prepare(sql),
      batch: async statements => {
        batchCalls++;
        return db.batch(statements);
      }
    };

    const history = await getDashboardLatencyHistory(wrappedDb, servers, {
      now: start + 60_000,
      cache: false
    });

    assert.equal(batchCalls, Math.ceil(servers.length / DASHBOARD_LATENCY_WINDOW_QUERY_CONCURRENCY));
    assert.equal(history.size, 25);
    for (let index = 1; index <= 25; index++) {
      const window = history.get(`batch-server-${index}`);
      assert.ok(window, `window for batch-server-${index}`);
      assert.equal(window.ping.at(-1).ct, 10 + index);
    }
  } finally {
    await miniflare.dispose();
  }
});

test('dashboard latency history falls back to per-server queries when batch fails', async () => {
  const miniflare = createMiniflare();

  try {
    const db = await miniflare.getD1Database('DB');
    await createHistoryTable(db);

    const start = Date.UTC(2026, 6, 29, 3, 0, 0);
    await db.prepare(`
      INSERT INTO metrics_history (
        id, timestamp,
        ping_ct, ping_cu, ping_cm, ping_bd,
        loss_ct, loss_cu, loss_cm, loss_bd
      )
      VALUES ${latencyRow(1, start, 42)}
    `).run();

    let batchThrew = false;
    const wrappedDb = {
      prepare: sql => db.prepare(sql),
      batch: async () => {
        batchThrew = true;
        throw new Error('batch boom');
      }
    };

    const history = await getDashboardLatencyHistory(wrappedDb, [{
      id: 'fallback-server-1',
      history_partition_id: 1,
      timestamp: start
    }], {
      now: start + 60_000,
      cache: false
    });

    assert.equal(batchThrew, true);
    assert.equal(history.size, 1);
    assert.equal(history.get('fallback-server-1').ping.at(-1).ct, 42);
  } finally {
    await miniflare.dispose();
  }
});
