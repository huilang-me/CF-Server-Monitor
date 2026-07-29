import assert from 'node:assert/strict';
import test from 'node:test';
import { Miniflare } from 'miniflare';

import {
  buildSparseHistoryQuery,
  shouldUseSparseHistorySampling
} from '../src/database/historySampling.js';
import {
  DEFAULT_LONG_HISTORY_POINTS,
  normalizeLongHistoryPoints
} from '../src/utils/settings.js';

const TEST_SAMPLE_POINTS = DEFAULT_LONG_HISTORY_POINTS;

test('long-history point settings only accept supported values', () => {
  assert.equal(normalizeLongHistoryPoints(30), '30');
  assert.equal(normalizeLongHistoryPoints('120'), '120');
  assert.equal(normalizeLongHistoryPoints(160), String(DEFAULT_LONG_HISTORY_POINTS));
  assert.equal(normalizeLongHistoryPoints(undefined), String(DEFAULT_LONG_HISTORY_POINTS));
});

test('sparse sampling is limited to long id-range queries', () => {
  assert.equal(shouldUseSparseHistorySampling(1, true, false, false), false);
  assert.equal(shouldUseSparseHistorySampling(6, true, false, false), true);
  assert.equal(shouldUseSparseHistorySampling(6, false, false, false), false);
  assert.equal(shouldUseSparseHistorySampling(168, true, true, false), false);
  assert.equal(shouldUseSparseHistorySampling(168, true, true, true), true);
});

test('single-table sparse query uses bounded primary-key seeks', () => {
  const query = buildSparseHistoryQuery({
    columns: 'cpu, ram_used',
    queryStart: 1_000,
    firstRangeEnd: 2_000,
    queryEnd: 10_000,
    intervalMs: 1_000,
    idPrefix: 50_000_000_000_000,
    oldTableExists: false,
    tableBoundary: 0
  });

  assert.match(query.sql, /WITH RECURSIVE sample_ranges/);
  assert.match(query.sql, /SELECT json_object\('timestamp', timestamp, 'cpu', cpu/);
  assert.match(query.sql, /FROM metrics_history\s+WHERE id >= ranges\.start_id/);
  assert.match(query.sql, /ORDER BY id ASC\s+LIMIT 1/);
  assert.doesNotMatch(query.sql, /metrics_history_old/);
  assert.deepEqual(query.bindValues, [
    1_000,
    2_000,
    1_000,
    10_000,
    10_000,
    50_000_000_000_000,
    50_000_000_000_000
  ]);
});

test('cross-week sparse query falls back from the old table to the current table', () => {
  const query = buildSparseHistoryQuery({
    columns: 'cpu, loss_ct',
    queryStart: 1_000,
    firstRangeEnd: 2_000,
    queryEnd: 10_000,
    intervalMs: 1_000,
    idPrefix: 50_000_000_000_000,
    oldTableExists: true,
    tableBoundary: 5_000
  });

  assert.match(query.sql, /FROM metrics_history_old\s+WHERE id >= ranges\.start_id/);
  assert.match(query.sql, /COALESCE/);
  assert.match(query.sql, /ranges\.range_start < \?/);
  assert.match(query.sql, /ranges\.range_end > \?/);
  assert.deepEqual(query.bindValues.slice(-2), [5_000, 5_000]);
});

test('D1-compatible SQLite samples 6 hours without scanning the history table', async () => {
  const miniflare = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("OK"); } }',
    d1Databases: { DB: 'history-query-test' }
  });

  try {
    const db = await miniflare.getD1Database('DB');
    await db.prepare(`
      CREATE TABLE metrics_history (
        id INTEGER PRIMARY KEY,
        timestamp INTEGER,
        cpu REAL,
        ram_used REAL
      )
    `).run();

    const start = Date.UTC(2026, 6, 29, 0, 0, 0);
    const intervalMs = 6 * 60 * 60 * 1000 / TEST_SAMPLE_POINTS;
    const queryEnd = start + 6 * 60 * 60 * 1000;
    const rows = [];

    for (let offset = 0; offset < 6 * 60 * 60 * 1000; offset += 60_000) {
      const timestamp = start + offset;
      const date = new Date(timestamp);
      const timeKey = [
        String(date.getUTCFullYear() % 100).padStart(2, '0'),
        String(date.getUTCMonth() + 1).padStart(2, '0'),
        String(date.getUTCDate()).padStart(2, '0'),
        String(date.getUTCHours()).padStart(2, '0'),
        String(date.getUTCMinutes()).padStart(2, '0'),
        String(date.getUTCSeconds()).padStart(2, '0')
      ].join('');

      rows.push(
        `(${50_000_000_000_000 + Number(timeKey)}, ${timestamp}, ${offset / 60_000}, 1024)`
      );
    }

    await db.prepare(`
      INSERT INTO metrics_history (id, timestamp, cpu, ram_used)
      VALUES ${rows.join(',')}
    `).run();

    const query = buildSparseHistoryQuery({
      columns: 'cpu, ram_used',
      queryStart: start,
      firstRangeEnd: start + intervalMs,
      queryEnd,
      intervalMs,
      idPrefix: 50_000_000_000_000,
      oldTableExists: false,
      tableBoundary: 0
    });

    const result = await db.prepare(query.sql).bind(...query.bindValues).all();
    const samples = result.results
      .filter(row => row.sample_json)
      .map(row => JSON.parse(row.sample_json));
    assert.equal(samples.length, TEST_SAMPLE_POINTS);

    const originalResult = await db.prepare(`
      WITH history_rows AS (
        SELECT timestamp, cpu, ram_used
        FROM metrics_history
        WHERE id >= ? AND id <= ?
      ),
      bucketed AS (
        SELECT timestamp, cpu, ram_used, CAST(timestamp / ? AS INTEGER) AS bucket
        FROM history_rows
      ),
      sampled AS (
        SELECT
          timestamp,
          cpu,
          ram_used,
          ROW_NUMBER() OVER (PARTITION BY bucket ORDER BY timestamp) AS rn
        FROM bucketed
      )
      SELECT timestamp, cpu, ram_used FROM sampled WHERE rn = 1
    `).bind(0, Number.MAX_SAFE_INTEGER, intervalMs).all();
    assert.ok(
      result.meta.rows_read < originalResult.meta.rows_read,
      `expected fewer than ${originalResult.meta.rows_read} rows read, got ${result.meta.rows_read}`
    );

    const plan = await db.prepare(`EXPLAIN QUERY PLAN ${query.sql}`)
      .bind(...query.bindValues)
      .all();
    const historySteps = plan.results
      .map(row => String(row.detail))
      .filter(detail => detail.includes('metrics_history'));
    assert.ok(historySteps.some(detail => detail.includes('SEARCH metrics_history USING INTEGER PRIMARY KEY')));
    assert.ok(historySteps.every(detail => !detail.startsWith('SCAN metrics_history')));

    const tableBoundary = start + 3 * 60 * 60 * 1000;
    await db.prepare(`
      CREATE TABLE metrics_history_old (
        id INTEGER PRIMARY KEY,
        timestamp INTEGER,
        cpu REAL,
        ram_used REAL
      )
    `).run();
    await db.prepare(`
      INSERT INTO metrics_history_old
      SELECT * FROM metrics_history WHERE timestamp < ?
    `).bind(tableBoundary).run();
    await db.prepare('DELETE FROM metrics_history WHERE timestamp < ?')
      .bind(tableBoundary)
      .run();

    const crossWeekQuery = buildSparseHistoryQuery({
      columns: 'cpu, ram_used',
      queryStart: start,
      firstRangeEnd: start + intervalMs,
      queryEnd,
      intervalMs,
      idPrefix: 50_000_000_000_000,
      oldTableExists: true,
      tableBoundary
    });
    const crossWeekResult = await db.prepare(crossWeekQuery.sql)
      .bind(...crossWeekQuery.bindValues)
      .all();
    const crossWeekSamples = crossWeekResult.results
      .filter(row => row.sample_json)
      .map(row => JSON.parse(row.sample_json));
    assert.equal(crossWeekSamples.length, TEST_SAMPLE_POINTS);

    const crossWeekPlan = await db.prepare(`EXPLAIN QUERY PLAN ${crossWeekQuery.sql}`)
      .bind(...crossWeekQuery.bindValues)
      .all();
    const crossWeekHistorySteps = crossWeekPlan.results
      .map(row => String(row.detail))
      .filter(detail => detail.includes('metrics_history'));
    assert.ok(crossWeekHistorySteps.some(detail => detail.includes('SEARCH metrics_history USING INTEGER PRIMARY KEY')));
    assert.ok(crossWeekHistorySteps.some(detail => detail.includes('SEARCH metrics_history_old USING INTEGER PRIMARY KEY')));
    assert.ok(crossWeekHistorySteps.every(detail => !detail.startsWith('SCAN metrics_history')));
  } finally {
    await miniflare.dispose();
  }
});
