import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { Miniflare } from 'miniflare';

import {
  HISTORY_MAX_PARTITION_ID,
  insertServerWithPartition
} from '../src/database/indexOptimization.js';

// 直接跑生产 SQL：替身实现的分配逻辑无法证明 SERVER_INSERT_SQL 本身正确。
const miniflare = new Miniflare({
  modules: true,
  script: 'export default { fetch() { return new Response("OK"); } }',
  d1Databases: { DB: 'server-insert-sql-test' }
});
const db = await miniflare.getD1Database('DB');

await db.prepare(`
  CREATE TABLE servers (
    id TEXT PRIMARY KEY,
    name TEXT,
    server_group TEXT,
    region TEXT,
    "interface" TEXT,
    sort_order INTEGER,
    history_partition_id INTEGER,
    timestamp INTEGER
  )
`).run();

after(async () => {
  await miniflare.dispose();
});

async function resetServers() {
  await db.prepare('DELETE FROM servers').run();
}

test('SERVER_INSERT_SQL 空表取 1 号分区并返回 changes=1', async () => {
  await resetServers();

  const result = await insertServerWithPartition(db, { id: 'a', name: 'A' });

  assert.equal(result.meta.changes, 1);
  const row = await db.prepare('SELECT * FROM servers WHERE id = ?').bind('a').first();
  assert.equal(row.history_partition_id, 1);
  assert.equal(row.sort_order, 0);
  assert.equal(row.server_group, 'Default');
});

test('SERVER_INSERT_SQL 删除后复用空洞', async () => {
  await resetServers();

  await insertServerWithPartition(db, { id: 'a', name: 'A' });
  await insertServerWithPartition(db, { id: 'b', name: 'B' });
  await insertServerWithPartition(db, { id: 'c', name: 'C' });
  await db.prepare('DELETE FROM servers WHERE id = ?').bind('b').run();
  await insertServerWithPartition(db, { id: 'd', name: 'D' });

  const { results } = await db.prepare(
    'SELECT id, history_partition_id, sort_order FROM servers ORDER BY sort_order ASC'
  ).all();
  assert.deepEqual(
    results.map(row => [row.id, row.history_partition_id, row.sort_order]),
    [['a', 1, 0], ['c', 3, 2], ['d', 2, 3]]
  );
});

test('SERVER_INSERT_SQL 分区耗尽时 changes=0 且不写入', async () => {
  await resetServers();

  // 单条 INSERT 填满分区表，避免 900 次 batch 拖慢测试。
  const fillers = Array.from({ length: HISTORY_MAX_PARTITION_ID }, (_, index) =>
    `('filler-${index}', 'F${index}', ${index}, ${index + 1}, 0)`
  ).join(',');
  await db.prepare(
    `INSERT INTO servers (id, name, sort_order, history_partition_id, timestamp) VALUES ${fillers}`
  ).run();

  await assert.rejects(
    () => insertServerWithPartition(db, { id: 'overflow', name: 'X' }),
    /No available history partition id/
  );
  const row = await db.prepare('SELECT COUNT(*) AS n FROM servers WHERE id = ?').bind('overflow').first();
  assert.equal(row.n, 0);
});

test('SERVER_INSERT_SQL 并发写入分区号与 sort_order 均不重复', async () => {
  await resetServers();

  await Promise.all(
    Array.from({ length: 20 }, (_, index) =>
      insertServerWithPartition(db, { id: `s${index}`, name: `S${index}` })
    )
  );

  const { results } = await db.prepare(
    'SELECT history_partition_id, sort_order FROM servers'
  ).all();
  assert.equal(results.length, 20);
  assert.equal(new Set(results.map(row => Number(row.history_partition_id))).size, 20);
  assert.equal(new Set(results.map(row => Number(row.sort_order))).size, 20);
});
