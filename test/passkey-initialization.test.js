import test from 'node:test';
import assert from 'node:assert/strict';
import { handlePasskeyAction } from '../src/handlers/passkey.js';

function request() {
  return new Request('https://example.com/admin/api', { method: 'POST', headers: { Origin: 'https://example.com' } });
}

test('concurrent requests do not share pending database initialization I/O', async () => {
  let started = 0;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const db = {
    prepare() {
      return {
        bind() { return this; },
        async all() { return { results: [] }; }
      };
    },
    async batch(statements) {
      assert.equal(statements.length, 6, 'schema and indexes share one D1 round trip');
      started++;
      await gate;
      return statements.map(() => ({ success: true }));
    }
  };
  const invoke = () => handlePasskeyAction({ request: request(), env: { DB: db }, sys: {}, data: { action: 'passkey_list' } });
  const pending = [invoke(), invoke()];
  try {
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(started, 2, 'each request must start its own D1 initialization');
  } finally {
    release();
    await Promise.all(pending);
  }
  await invoke();
  assert.equal(started, 2, 'only completed initialization should be cached');
});

test('failed database initialization is retried', async () => {
  let attempts = 0;
  const db = {
    prepare() {
      return {
        bind() { return this; },
        async all() { return { results: [] }; }
      };
    },
    async batch() {
      if (++attempts === 1) throw new Error('temporary failure');
      return [{ success: true }, { success: true }];
    }
  };
  const invoke = () => handlePasskeyAction({ request: request(), env: { DB: db }, sys: {}, data: { action: 'passkey_list' } });
  assert.equal((await invoke()).status, 500);
  assert.equal((await invoke()).status, 200);
  assert.equal(attempts, 2);
});
