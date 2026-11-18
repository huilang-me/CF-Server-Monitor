import test from 'node:test';
import assert from 'node:assert/strict';
import { handlePasskeyAction, LOGIN_CHALLENGE_IP_RATE_LIMIT, LOGIN_CHALLENGE_CAPACITY, LOGIN_CHALLENGE_WINDOW_MS } from '../src/handlers/passkey.js';
import { createPasskeyTestDb } from './passkey-d1.js';

const [major, minor] = process.versions.node.split('.').map(Number);
const sqliteAvailable = major > 22 || (major === 22 && minor >= 5);

async function setup(t) {
  const db = await createPasskeyTestDb();
  t.after(() => db.close());
  const env = { DB: db, API_SECRET: 'test-secret-with-sufficient-entropy' };
  const invoke = (action, data = {}, ip = null, extraHeaders = {}) => handlePasskeyAction({
    request: new Request('https://example.com/admin/api', {
      method: 'POST', headers: { Origin: 'https://example.com', ...(ip ? { 'CF-Connecting-IP': ip } : {}), ...extraHeaders }
    }), env, sys: {}, data: { action, ...data }
  });
  return { db, invoke };
}

test('per-IP limit is atomic and cannot be bypassed by consuming challenges', { skip: !sqliteAvailable }, async t => {
  const { db, invoke } = await setup(t);
  const oldNow = Date.now;
  let now = 1800000000000;
  Date.now = () => now;
  try {
    const responses = await Promise.all(Array.from({ length: LOGIN_CHALLENGE_IP_RATE_LIMIT + 5 }, () => invoke('passkey_login_options', {}, '198.51.100.1')));
    const allowed = responses.filter(response => response.status === 200);
    assert.equal(allowed.length, LOGIN_CHALLENGE_IP_RATE_LIMIT);
    assert.equal(responses.filter(response => response.status === 429).length, 5);
    assert.equal(responses.find(response => response.status === 429).headers.get('Retry-After'), '60');
    const { challengeId } = await allowed[0].json();
    assert.equal((await invoke('passkey_login_verify', { challengeId, credential: {} }, '198.51.100.1')).status, 400);
    assert.equal((await invoke('passkey_login_options', {}, '198.51.100.1')).status, 429);
    now += LOGIN_CHALLENGE_WINDOW_MS;
    assert.equal((await invoke('passkey_login_options', {}, '198.51.100.1')).status, 200);
    const rows = await db.prepare('SELECT scope FROM passkey_login_rate').all();
    assert.ok(rows.results.every(row => !row.scope.includes('198.51.100.1')));
  } finally { Date.now = oldNow; }
});

test('different IPs do not share a global per-minute rate limit', { skip: !sqliteAvailable }, async t => {
  const { db, invoke } = await setup(t);
  const oldNow = Date.now;
  Date.now = () => 1800000000000;
  try {
    const responses = await Promise.all(Array.from({ length: 65 }, (_, i) => invoke('passkey_login_options', {}, `198.51.100.${i + 1}`)));
    assert.equal(responses.filter(response => response.status === 200).length, 65);
    const rows = await db.prepare('SELECT COUNT(*) AS total FROM passkey_login_rate').first();
    assert.equal(rows.total, 65);
    const count = await db.prepare("SELECT COUNT(*) AS total FROM passkey_challenges WHERE kind = 'login'").first();
    assert.equal(count.total, 65);
  } finally { Date.now = oldNow; }
});

test('missing or invalid IPs share a bucket and forwarded headers cannot evade it', { skip: !sqliteAvailable }, async t => {
  const { invoke } = await setup(t);
  const oldNow = Date.now;
  Date.now = () => 1800000000000;
  try {
    for (let i = 0; i < LOGIN_CHALLENGE_IP_RATE_LIMIT; i++) {
      const invalid = i % 2 ? 'deadbeef' : '999.999.999.999';
      assert.equal((await invoke('passkey_login_options', {}, invalid, { 'X-Forwarded-For': `203.0.113.${i + 1}` })).status, 200);
    }
    assert.equal((await invoke('passkey_login_options', {}, null, { 'X-Forwarded-For': '203.0.113.254' })).status, 429);
  } finally { Date.now = oldNow; }
});

test('existing challenge table upgrades in place without losing its records', { skip: !sqliteAvailable }, async t => {
  const { db, invoke } = await setup(t);
  await db.prepare(`CREATE TABLE passkey_challenges (
    id TEXT PRIMARY KEY, challenge TEXT NOT NULL, kind TEXT NOT NULL,
    origin TEXT NOT NULL, session_hash TEXT NOT NULL, expires_at INTEGER NOT NULL
  )`).run();
  await db.prepare("INSERT INTO passkey_challenges VALUES ('existing', 'challenge', 'login', 'https://example.com', '', ?)").bind(Date.now() + 300000).run();
  assert.equal((await invoke('passkey_list')).status, 200);
  const existing = await db.prepare("SELECT challenge FROM passkey_challenges WHERE id = 'existing'").first();
  assert.equal(existing.challenge, 'challenge');
  const indexes = await db.prepare("PRAGMA index_list('passkey_challenges')").all();
  assert.ok(indexes.results.some(row => row.name === 'idx_passkey_challenges_expires_at'));
});

test('batch failure rolls back challenge and rate counters before retry', { skip: !sqliteAvailable }, async t => {
  const { db, invoke } = await setup(t);
  assert.equal((await invoke('passkey_list')).status, 200);
  const batch = db.batch;
  db.batch = statements => batch.call(db, [...statements, db.prepare('INSERT INTO missing_table VALUES (1)')]);
  try {
    assert.equal((await invoke('passkey_login_options')).status, 500);
  } finally { db.batch = batch; }
  assert.equal((await db.prepare('SELECT COUNT(*) AS total FROM passkey_challenges').first()).total, 0);
  assert.equal((await db.prepare('SELECT COUNT(*) AS total FROM passkey_login_rate').first()).total, 0);
  assert.equal((await invoke('passkey_login_options')).status, 200);
});

test('capacity is enforced and expired challenges are removed using an index', { skip: !sqliteAvailable }, async t => {
  const { db, invoke } = await setup(t);
  const oldNow = Date.now;
  Date.now = () => 1800000000000;
  try {
    // Initialise existing installations, then fill the active challenge limit.
    assert.equal((await invoke('passkey_list')).status, 200);
    for (let i = 0; i < LOGIN_CHALLENGE_CAPACITY; i++) {
      await db.prepare("INSERT INTO passkey_challenges VALUES (?, 'challenge', 'login', 'https://example.com', '', ?)").bind(`seed-${i}`, Date.now() + 1000).run();
    }
    assert.equal((await invoke('passkey_login_options')).status, 429);
    const rows = await db.prepare('SELECT COUNT(*) AS total FROM passkey_login_rate').first();
    assert.equal(rows.total, 0);
    await db.prepare("UPDATE passkey_challenges SET expires_at = ? WHERE id = 'seed-0'").bind(Date.now() - 1).run();
    assert.equal((await invoke('passkey_login_options')).status, 200);
    const plan = await db.prepare('EXPLAIN QUERY PLAN SELECT id FROM passkey_challenges WHERE expires_at < ? LIMIT 100').bind(Date.now()).all();
    assert.ok(plan.results.some(row => String(row.detail).includes('idx_passkey_challenges_expires_at')));
  } finally { Date.now = oldNow; }
});

test('a large expired backlog is cleaned in bounded batches', { skip: !sqliteAvailable }, async t => {
  const { db, invoke } = await setup(t);
  assert.equal((await invoke('passkey_list')).status, 200);
  for (let i = 0; i < 250; i++) {
    await db.prepare("INSERT INTO passkey_challenges VALUES (?, 'challenge', 'login', 'https://example.com', '', ?)").bind(`expired-${i}`, 0).run();
  }
  assert.equal((await invoke('passkey_login_options')).status, 200);
  const remaining = await db.prepare('SELECT COUNT(*) AS total FROM passkey_challenges WHERE expires_at = 0').first();
  assert.equal(remaining.total, 150);
});
