import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';
import { buildAuthCookie, buildUaCookie, generateToken, validateCredentials, hasAppPasswordAccess } from '../middleware/auth.js';
import { verifyTurnstileToken } from '../utils/common.js';
import { createSuccessResponse, createBadRequestResponse, createErrorResponse, AppError } from '../utils/errors.js';

// WebAuthn ceremonies are restricted to the Worker origin. In particular, never
// derive an allowed origin from the untrusted Origin header or forwarded headers.
export function passkeyOrigin(request) {
  const url = new URL(request.url);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === 'localhost')) return null;
  if (request.headers.get('Origin') !== url.origin) return null;
  return { origin: url.origin, rpID: url.hostname };
}

const TTL = 5 * 60 * 1000;
const toB64 = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64 = value => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));

function isSameOriginClientData(credential) {
  try {
    const client = JSON.parse(new TextDecoder().decode(fromB64(credential.response.clientDataJSON)));
    return client.crossOrigin !== true && client.topOrigin === undefined;
  } catch (_) { return false; }
}

// Never share an in-flight D1 promise across Worker requests: Cloudflare I/O
// belongs to the request that created it. A concurrent request can safely run
// the idempotent CREATE statements itself until initialization is complete.
const initializedDatabases = new WeakSet();
async function ensureTables(db) {
  if (initializedDatabases.has(db)) return;
  await db.prepare(`CREATE TABLE IF NOT EXISTS passkey_credentials (id TEXT PRIMARY KEY, rp_id TEXT NOT NULL, public_key TEXT NOT NULL, counter INTEGER NOT NULL, transports TEXT NOT NULL, name TEXT NOT NULL, created_at INTEGER NOT NULL, last_used_at INTEGER)`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS passkey_challenges (id TEXT PRIMARY KEY, challenge TEXT NOT NULL, kind TEXT NOT NULL, origin TEXT NOT NULL, session_hash TEXT NOT NULL, expires_at INTEGER NOT NULL)`).run();
  initializedDatabases.add(db);
}

async function sessionHash(request) {
  const auth = request.headers.get('Authorization') || '';
  const cookie = request.headers.get('Cookie') || '';
  const value = auth.startsWith('Bearer ') ? auth.slice(7) : (cookie.split(';').map(x => x.trim()).find(x => x.startsWith('cfsm_auth=')) || '').slice(10);
  if (!value) return '';
  return toB64(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))));
}

async function saveChallenge(db, options, kind, origin, session = '') {
  const now = Date.now();
  const id = toB64(crypto.getRandomValues(new Uint8Array(32)));
  await db.prepare('DELETE FROM passkey_challenges WHERE expires_at < ?').bind(now).run();
  await db.prepare('INSERT INTO passkey_challenges (id, challenge, kind, origin, session_hash, expires_at) VALUES (?, ?, ?, ?, ?, ?)').bind(id, options.challenge, kind, origin, session, now + TTL).run();
  return id;
}

async function consumeChallenge(db, id, kind, origin, session = '') {
  if (typeof id !== 'string' || id.length !== 43) return null;
  // DELETE ... RETURNING is a single D1/SQLite write: concurrent requests cannot
  // both consume the same challenge, including when verification later fails.
  return db.prepare('DELETE FROM passkey_challenges WHERE id = ? AND kind = ? AND origin = ? AND session_hash = ? AND expires_at >= ? RETURNING challenge').bind(id, kind, origin, session, Date.now()).first();
}

async function verifyCurrentPassword(data, env, sys) {
  if (typeof data.password !== 'string' || !data.password) return false;
  const username = sys?.username || env.API_USER_NAME || 'admin';
  return (await validateCredentials(username, data.password, env, sys)).valid;
}

async function credentialsForRp(db, rpID) {
  return (await db.prepare('SELECT * FROM passkey_credentials WHERE rp_id = ? ORDER BY created_at').bind(rpID).all()).results || [];
}

function cookieResponse(request, env, sys, token) {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  headers.append('Set-Cookie', buildAuthCookie(request, token));
  const ua = buildUaCookie(request, sys?.ua);
  if (ua) headers.append('Set-Cookie', ua);
  return new Response(JSON.stringify({ success: true, token, message: 'loginSuccessful' }), { headers });
}

export async function handlePasskeyAction({ request, env, sys, data }) {
  const trusted = passkeyOrigin(request);
  if (!trusted) return createBadRequestResponse('passkeyOriginInvalid');
  const { origin, rpID } = trusted;
  const db = env.DB;
  await ensureTables(db);

  if (data.action === 'passkey_login_options') {
    const turnstileEnabled = sys?.turnstile_enabled === 'true' || sys?.turnstile_enabled === true || sys?.turnstile_login_enabled === 'true' || sys?.turnstile_login_enabled === true;
    if (turnstileEnabled && !hasAppPasswordAccess(request, sys) && !await verifyTurnstileToken(request.headers.get('X-Turnstile-Token'), sys?.turnstile_secret_key || '')) {
      return createErrorResponse(new AppError('verificationFailed', 403));
    }
    const rows = await credentialsForRp(db, rpID);
    const options = await generateAuthenticationOptions({ rpID, userVerification: 'required', timeout: 60000, allowCredentials: rows.map(row => ({ id: row.id, transports: JSON.parse(row.transports) })) });
    return createSuccessResponse({ options, challengeId: await saveChallenge(db, options, 'login', origin) });
  }

  if (data.action === 'passkey_login_verify') {
    const challenge = await consumeChallenge(db, data.challengeId, 'login', origin);
    if (!challenge) return createBadRequestResponse('passkeyChallengeInvalid');
    if (!isSameOriginClientData(data.credential)) return createBadRequestResponse('passkeyVerificationFailed');
    const row = await db.prepare('SELECT * FROM passkey_credentials WHERE id = ? AND rp_id = ?').bind(String(data.credential?.id || ''), rpID).first();
    if (!row) return createBadRequestResponse('passkeyVerificationFailed');
    try {
      const result = await verifyAuthenticationResponse({ response: data.credential, expectedChallenge: challenge.challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true, credential: { id: row.id, publicKey: fromB64(row.public_key), counter: row.counter, transports: JSON.parse(row.transports) } });
      if (!result.verified) return createBadRequestResponse('passkeyVerificationFailed');
      const counter = result.authenticationInfo.newCounter;
      const updated = await db.prepare('UPDATE passkey_credentials SET counter = ?, last_used_at = ? WHERE id = ? AND rp_id = ? AND counter = ?').bind(counter, Date.now(), row.id, rpID, row.counter).run();
      if (!updated.meta?.changes) return createBadRequestResponse('passkeyVerificationFailed');
      return cookieResponse(request, env, sys, await generateToken(env, sys));
    } catch (_) { return createBadRequestResponse('passkeyVerificationFailed'); }
  }

  if (data.action === 'passkey_list') {
    const rows = await credentialsForRp(db, rpID);
    return createSuccessResponse({ credentials: rows.map(({ id, name, created_at, last_used_at }) => ({ id, name, created_at, last_used_at })) });
  }

  if (data.action === 'passkey_register_options') {
    if (!await verifyCurrentPassword(data, env, sys)) return createBadRequestResponse('invalidCredentials');
    const rows = await credentialsForRp(db, rpID);
    const userName = sys?.username || env.API_USER_NAME || 'admin';
    const options = await generateRegistrationOptions({
      rpName: 'CF Server Monitor', rpID, userID: new TextEncoder().encode('cfsm-admin'),
      userName, userDisplayName: userName,
      timeout: 60000, attestationType: 'none',
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
      // Give iOS an explicit external-key path, without restricting normal
      // iCloud/Windows Hello registrations to an external authenticator.
      ...(data.authenticatorType === 'security-key' ? { preferredAuthenticatorType: 'securityKey' } : {}),
      excludeCredentials: rows.map(row => ({ id: row.id, transports: JSON.parse(row.transports) }))
    });
    return createSuccessResponse({ options, challengeId: await saveChallenge(db, options, 'register', origin, await sessionHash(request)) });
  }

  if (data.action === 'passkey_register_verify') {
    const challenge = await consumeChallenge(db, data.challengeId, 'register', origin, await sessionHash(request));
    if (!challenge) return createBadRequestResponse('passkeyChallengeInvalid');
    if (!isSameOriginClientData(data.credential)) return createBadRequestResponse('passkeyVerificationFailed');
    try {
      const result = await verifyRegistrationResponse({ response: data.credential, expectedChallenge: challenge.challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true });
      if (!result.verified) return createBadRequestResponse('passkeyVerificationFailed');
      const cred = result.registrationInfo.credential;
      const name = String(data.name || 'Passkey').trim().slice(0, 80) || 'Passkey';
      await db.prepare('INSERT INTO passkey_credentials (id, rp_id, public_key, counter, transports, name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(cred.id, rpID, toB64(cred.publicKey), cred.counter, JSON.stringify(cred.transports || []), name, Date.now()).run();
      return createSuccessResponse({ success: true });
    } catch (_) { return createBadRequestResponse('passkeyVerificationFailed'); }
  }

  if (data.action === 'passkey_delete') {
    if (!await verifyCurrentPassword(data, env, sys)) return createBadRequestResponse('invalidCredentials');
    await db.prepare('DELETE FROM passkey_credentials WHERE id = ? AND rp_id = ?').bind(String(data.id || ''), rpID).run();
    return createSuccessResponse({ success: true });
  }
  return createBadRequestResponse('unknownAction');
}
