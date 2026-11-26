import assert from 'node:assert/strict';
import test from 'node:test';
import { Miniflare } from 'miniflare';

import {
  getServerStatusHistory,
  pruneServerStatusHistory,
  recordServerStatusTransitions
} from '../src/database/statusHistory.js';

async function withDatabase(run) {
  const miniflare = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("OK"); } }',
    d1Databases: { DB: 'status-history-test' }
  });

  try {
    const db = await miniflare.getD1Database('DB');
    await run(db);
  } finally {
    await miniflare.dispose();
  }
}

test('records a baseline once and appends only actual observed status transitions', async () => {
  await withDatabase(async (db) => {
    const server = { id: 'server-1' };
    const t0 = Date.UTC(2026, 10, 20, 12, 0, 0);

    assert.equal(await recordServerStatusTransitions(db, [server], new Map([['server-1', t0 - 1000]]), t0), 1);
    assert.equal(await recordServerStatusTransitions(db, [server], new Map([['server-1', t0 + 59_000]]), t0 + 60_000), 0);
    assert.equal(await recordServerStatusTransitions(db, [server], new Map([['server-1', t0 + 60_000]]), t0 + 6 * 60_000), 1);
    assert.equal(await recordServerStatusTransitions(db, [server], new Map([['server-1', t0 + 7 * 60_000]]), t0 + 7 * 60_000), 1);

    const result = await getServerStatusHistory(db, ['server-1'], t0 + 7 * 60_000);
    assert.deepEqual(result.records.map(({ is_online, event_type }) => [is_online, event_type]), [
      [1, 'baseline'],
      [0, 'transition'],
      [1, 'transition']
    ]);
    assert.ok(result.records.every((row) => row.t <= result.generated_at));
  });
});

test('an unavailable first report establishes an offline baseline, not an outage event', async () => {
  await withDatabase(async (db) => {
    const now = Date.UTC(2026, 10, 20, 12, 0, 0);
    await recordServerStatusTransitions(db, [{ id: 'server-2' }], new Map(), now);

    const result = await getServerStatusHistory(db, ['server-2'], now);
    assert.equal(result.records.length, 1);
    assert.equal(result.records[0].is_online, 0);
    assert.equal(result.records[0].event_type, 'baseline');
  });
});

test('pruning keeps one pre-window state anchor plus all transitions in the seven-day window', async () => {
  await withDatabase(async (db) => {
    const now = Date.UTC(2026, 10, 26, 12, 0, 0);
    const t0 = now - 10 * 24 * 60 * 60 * 1000;
    const server = { id: 'server-3' };

    await recordServerStatusTransitions(db, [server], new Map([['server-3', t0]]), t0);
    await recordServerStatusTransitions(db, [server], new Map(), t0 + 2 * 24 * 60 * 60 * 1000);
    await recordServerStatusTransitions(db, [server], new Map([['server-3', now - 24 * 60 * 60 * 1000]]), now - 24 * 60 * 60 * 1000);

    const deleted = await pruneServerStatusHistory(db, now);
    assert.equal(deleted, 1);

    const result = await getServerStatusHistory(db, ['server-3'], now);
    assert.deepEqual(result.records.map((row) => [row.is_online, row.event_type]), [
      [0, 'transition'],
      [1, 'transition']
    ]);
    assert.equal(result.records[0].t, Math.floor((t0 + 2 * 24 * 60 * 60 * 1000) / 1000));
  });
});
