import test from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';
import { handlePasskeyAction, LOGIN_CHALLENGE_CAPACITY, LOGIN_CHALLENGE_IP_RATE_LIMIT, LOGIN_CHALLENGE_WINDOW_MS } from '../src/handlers/passkey.js';

test('Miniflare D1 enforces the rate limit atomically and restores access in the next window', async () => {
  const miniflare = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("OK"); } }',
    d1Databases: { DB: 'passkey-rate-d1-test' }
  });
  const oldNow = Date.now;
  let now = 1800000000000;
  try {
    const db = await miniflare.getD1Database('DB');
    const env = { DB: db, API_SECRET: 'test-secret-with-sufficient-entropy' };
    const invoke = () => handlePasskeyAction({
      request: new Request('https://example.com/admin/api', {
        method: 'POST', headers: { Origin: 'https://example.com', 'CF-Connecting-IP': '198.51.100.1' }
      }), env, sys: {}, data: { action: 'passkey_login_options' }
    });
    Date.now = () => now;
    assert.equal((await invoke()).status, 200);
    await db.prepare("UPDATE passkey_login_rate SET issued = ? WHERE scope LIKE 'ip:%'").bind(LOGIN_CHALLENGE_IP_RATE_LIMIT - 1).run();
    const results = await Promise.all(Array.from({ length: 5 }, invoke));
    assert.equal(results.filter(response => response.status === 200).length, 1);
    assert.equal(results.filter(response => response.status === 429).length, 4);
    assert.equal(results.find(response => response.status === 429).headers.get('Retry-After'), '60');
    const count = await db.prepare("SELECT COUNT(*) AS total FROM passkey_challenges WHERE kind = 'login'").first();
    assert.equal(count.total, 2);
    now += LOGIN_CHALLENGE_WINDOW_MS;
    assert.equal((await invoke()).status, 200);

    await db.prepare(`
      WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < ?)
      INSERT INTO passkey_challenges (id, challenge, kind, origin, session_hash, expires_at)
      SELECT 'seed-' || n, 'challenge', 'login', 'https://example.com', '', ? FROM seq
    `).bind(LOGIN_CHALLENGE_CAPACITY - 3, now + 300000).run();
    assert.equal((await invoke()).status, 429, 'active challenge capacity is enforced');

    const indexes = await db.prepare("PRAGMA index_list('passkey_challenges')").all();
    assert.ok(indexes.results.some(row => row.name === 'idx_passkey_challenges_expires_at'));
    await assert.rejects(db.batch([
      db.prepare("INSERT INTO passkey_challenges VALUES ('rollback', 'challenge', 'login', 'https://example.com', '', ?)").bind(now + 10000),
      db.prepare('INSERT INTO missing_table VALUES (1)')
    ]));
    assert.equal(await db.prepare("SELECT id FROM passkey_challenges WHERE id = 'rollback'").first(), null);
  } finally {
    Date.now = oldNow;
    await miniflare.dispose();
  }
});
