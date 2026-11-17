import test from 'node:test';
import assert from 'node:assert/strict';
import { generateToken } from '../src/middleware/auth.js';
import { handleAdminAPI } from '../src/handlers/admin.js';
import { createAuthenticator } from './passkey-authenticator.js';
import { createPasskeyTestDb } from './passkey-d1.js';

const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number);
const sqliteAvailable = nodeMajor > 22 || (nodeMajor === 22 && nodeMinor >= 5);

test('Passkey registration and authentication enforce WebAuthn security', { skip: !sqliteAvailable }, async t => {
  const db = await createPasskeyTestDb();
  t.after(() => db.close());
  const env = { DB: db, API_SECRET: 'correct-horse-battery-staple-000000' };
  const sys = { jwt_secret: '0123456789abcdef0123456789abcdef', username: 'admin', password: '' };
  const token = await generateToken(env, sys);
  const auth = createAuthenticator();
  const backup = createAuthenticator();

  async function request(action, fields = {}, { authenticated = false, authToken = token, origin = 'https://example.com', url = 'https://example.com/admin/api', headers = {} } = {}) {
    const request = new Request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json', Origin: origin,
        ...(authenticated ? { Authorization: `Bearer ${authToken}` } : {}), ...headers
      },
      body: JSON.stringify({ action, ...fields })
    });
    const response = await handleAdminAPI(request, env, sys);
    return { status: response.status, body: await response.json() };
  }
  const denied = result => assert.ok(result.status >= 400 || result.body.error, JSON.stringify(result));

  await t.test('registration requires an authenticated session and the correct password', async () => {
    denied(await request('passkey_register_options', { password: env.API_SECRET }));
    denied(await request('passkey_register_options', { password: 'wrong' }, { authenticated: true }));
  });

  await t.test('external security key is selectable without restricting the normal passkey flow', async () => {
    const normal = await request('passkey_register_options', { password: env.API_SECRET }, { authenticated: true });
    const external = await request('passkey_register_options', { password: env.API_SECRET, authenticatorType: 'security-key' }, { authenticated: true });
    assert.equal(normal.status, 200, JSON.stringify(normal));
    assert.equal(external.status, 200, JSON.stringify(external));
    assert.equal(normal.body.options.authenticatorSelection.authenticatorAttachment, undefined);
    assert.equal(external.body.options.authenticatorSelection.authenticatorAttachment, 'cross-platform');
    assert.ok(external.body.options.hints.includes('security-key'));
    for (const { body: { options } } of [normal, external]) {
      assert.equal(options.authenticatorSelection.userVerification, 'required');
      assert.equal(options.user.name, 'admin');
      assert.equal(options.user.displayName, options.user.name);
    }
  });

  await t.test('cross-origin requests cannot start or manage a credential', async () => {
    denied(await request('passkey_register_options', { password: env.API_SECRET }, { authenticated: true, origin: 'https://evil.example' }));
    denied(await request('passkey_login_options', {}, { origin: 'https://evil.example' }));
  });

  await t.test('login preserves the existing Turnstile requirement', async () => {
    sys.turnstile_login_enabled = 'true';
    sys.turnstile_secret_key = 'test-secret';
    try {
      denied(await request('passkey_login_options'));
    } finally {
      delete sys.turnstile_login_enabled;
      delete sys.turnstile_secret_key;
    }
  });

  await t.test('registration rejects an authenticator without user verification', async () => {
    const begin = await request('passkey_register_options', { password: env.API_SECRET }, { authenticated: true });
    assert.equal(begin.status, 200, JSON.stringify(begin));
    const { challengeId, options } = begin.body;
    const credential = auth.registration({ challenge: options.challenge, userVerified: false });
    denied(await request('passkey_register_verify', { challengeId, credential }, { authenticated: true }));
  });

  await t.test('registration refuses cross-origin iframe client data', async () => {
    for (const options of [{ crossOrigin: true }, { topOrigin: 'https://evil.example' }]) {
      const begin = await request('passkey_register_options', { password: env.API_SECRET }, { authenticated: true });
      assert.equal(begin.status, 200, JSON.stringify(begin));
      const credential = auth.registration({ challenge: begin.body.options.challenge, ...options });
      denied(await request('passkey_register_verify', { challengeId: begin.body.challengeId, credential }, { authenticated: true }));
    }
  });

  await t.test('registration challenges cannot be used for login', async () => {
    const begin = await request('passkey_register_options', { password: env.API_SECRET }, { authenticated: true });
    assert.equal(begin.status, 200, JSON.stringify(begin));
    const { challengeId, options } = begin.body;
    const credential = auth.assertion({ challenge: options.challenge });
    denied(await request('passkey_login_verify', { challengeId, credential }));
  });

  await t.test('registration challenge cannot be used from another valid session', async () => {
    const begin = await request('passkey_register_options', { password: env.API_SECRET }, { authenticated: true });
    const realNow = Date.now;
    let anotherToken;
    try {
      Date.now = () => realNow() + 2000;
      anotherToken = await generateToken(env, sys);
    } finally {
      Date.now = realNow;
    }
    assert.notEqual(anotherToken, token);
    const credential = createAuthenticator().registration({ challenge: begin.body.options.challenge });
    denied(await request('passkey_register_verify', {
      challengeId: begin.body.challengeId, credential
    }, { authenticated: true, authToken: anotherToken }));
  });

  await t.test('a real credential can register, but its challenge cannot be replayed', async () => {
    const options = await request('passkey_register_options', { password: env.API_SECRET }, { authenticated: true });
    assert.equal(options.status, 200, JSON.stringify(options));
    const { challengeId, options: publicOptions } = options.body;
    const credential = auth.registration({ challenge: publicOptions.challenge });
    const fields = { challengeId, credential, name: 'test key' };
    const verified = await request('passkey_register_verify', fields, { authenticated: true });
    assert.equal(verified.status, 200, JSON.stringify(verified));
    denied(await request('passkey_register_verify', fields, { authenticated: true }));
  });

  await t.test('expired challenges cannot be used', async () => {
    const begin = await request('passkey_login_options');
    const { challengeId, options } = begin.body;
    await db.prepare('UPDATE passkey_challenges SET expires_at = ? WHERE id = ?').bind(0, challengeId).run();
    const credential = auth.assertion({ challenge: options.challenge, counter: 1 });
    denied(await request('passkey_login_verify', { challengeId, credential }));

    const reg = await request('passkey_register_options', { password: env.API_SECRET }, { authenticated: true });
    await db.prepare('UPDATE passkey_challenges SET expires_at = ? WHERE id = ?').bind(0, reg.body.challengeId).run();
    const second = createAuthenticator();
    denied(await request('passkey_register_verify', {
      challengeId: reg.body.challengeId,
      credential: second.registration({ challenge: reg.body.options.challenge })
    }, { authenticated: true }));
  });

  await t.test('valid assertion signs in and replay is rejected', async () => {
    const options = await request('passkey_login_options');
    assert.equal(options.status, 200, JSON.stringify(options));
    const { challengeId, options: publicOptions } = options.body;
    const fields = { challengeId, credential: auth.assertion({ challenge: publicOptions.challenge, counter: 1 }) };
    const login = await request('passkey_login_verify', fields);
    assert.equal(login.status, 200, JSON.stringify(login));
    assert.ok(login.body.token);
    denied(await request('passkey_login_verify', fields));
  });

  await t.test('successful Turnstile verification authorizes one login ceremony', async () => {
    const oldFetch = globalThis.fetch;
    let calls = 0;
    sys.turnstile_login_enabled = 'true';
    sys.turnstile_secret_key = 'test-secret';
    globalThis.fetch = async (url, options) => {
      assert.equal(url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
      assert.equal(JSON.parse(options.body).response, 'test-token');
      calls++;
      return Response.json({ success: true });
    };
    try {
      const begin = await request('passkey_login_options', {}, { headers: { 'X-Turnstile-Token': 'test-token' } });
      assert.equal(begin.status, 200, JSON.stringify(begin));
      const { challengeId, options } = begin.body;
      const login = await request('passkey_login_verify', {
        challengeId, credential: auth.assertion({ challenge: options.challenge, counter: 2 })
      });
      assert.equal(login.status, 200, JSON.stringify(login));
      assert.equal(calls, 1);
    } finally {
      globalThis.fetch = oldFetch;
      delete sys.turnstile_login_enabled;
      delete sys.turnstile_secret_key;
    }
  });

  await t.test('tampered signature, wrong origin and missing user verification are rejected', async () => {
    for (const options of [
      { invalidSignature: true }, { userVerified: false }, { origin: 'https://evil.example' },
      { crossOrigin: true }, { topOrigin: 'https://evil.example' }
    ]) {
      const begin = await request('passkey_login_options');
      assert.equal(begin.status, 200, JSON.stringify(begin));
      const { challengeId, options: publicOptions } = begin.body;
      const credential = auth.assertion({ challenge: publicOptions.challenge, counter: 3, ...options });
      denied(await request('passkey_login_verify', { challengeId, credential }));
    }
  });

  await t.test('a credential registered for one host cannot log in to another Worker host', async () => {
    const target = { origin: 'https://other.example', url: 'https://other.example/admin/api' };
    const begin = await request('passkey_login_options', {}, target);
    assert.equal(begin.status, 200, JSON.stringify(begin));
    const credential = auth.assertion({ challenge: begin.body.options.challenge, origin: target.origin, counter: 3 });
    denied(await request('passkey_login_verify', { challengeId: begin.body.challengeId, credential }, target));
  });

  await t.test('a challenge is accepted at most once under concurrent verification', async () => {
    const begin = await request('passkey_login_options');
    assert.equal(begin.status, 200, JSON.stringify(begin));
    const { challengeId, options } = begin.body;
    const fields = { challengeId, credential: auth.assertion({ challenge: options.challenge, counter: 4 }) };
    const results = await Promise.all([request('passkey_login_verify', fields), request('passkey_login_verify', fields)]);
    assert.equal(results.filter(result => result.status === 200 && !result.body.error).length, 1, JSON.stringify(results));
  });

  await t.test('multiple credentials can be registered and the backup remains usable', async () => {
    const begin = await request('passkey_register_options', { password: env.API_SECRET }, { authenticated: true });
    assert.equal(begin.status, 200, JSON.stringify(begin));
    const { challengeId, options } = begin.body;
    const registration = await request('passkey_register_verify', {
      challengeId, credential: backup.registration({ challenge: options.challenge }), name: 'backup key'
    }, { authenticated: true });
    assert.equal(registration.status, 200, JSON.stringify(registration));
    const list = await request('passkey_list', {}, { authenticated: true });
    assert.equal(list.status, 200, JSON.stringify(list));
    assert.equal(list.body.credentials.length, 2);
  });

  await t.test('deleting a credential requires the current password', async () => {
    denied(await request('passkey_delete', { id: auth.id, password: 'wrong' }, { authenticated: true }));
    denied(await request('passkey_delete', { id: auth.id, password: env.API_SECRET }));
    const deletion = await request('passkey_delete', { id: auth.id, password: env.API_SECRET }, { authenticated: true });
    assert.equal(deletion.status, 200, JSON.stringify(deletion));
    const revokedBegin = await request('passkey_login_options');
    denied(await request('passkey_login_verify', {
      challengeId: revokedBegin.body.challengeId,
      credential: auth.assertion({ challenge: revokedBegin.body.options.challenge, counter: 5 })
    }));
    const begin = await request('passkey_login_options');
    const { challengeId, options } = begin.body;
    const login = await request('passkey_login_verify', {
      challengeId, credential: backup.assertion({ challenge: options.challenge, counter: 1 })
    });
    assert.equal(login.status, 200, JSON.stringify(login));
    assert.ok(login.body.token);
  });
});
