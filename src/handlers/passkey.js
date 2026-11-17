import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse
} from '@simplewebauthn/server';
import {
  buildAuthCookie,
  buildUaCookie,
  generateToken,
  getAuthenticatedToken,
  validateCredentials,
  hasAppPasswordAccess
} from '../middleware/auth.js';
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

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const CEREMONY_TIMEOUT_MS = 60000;
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
  await db.batch([db.prepare(`
    CREATE TABLE IF NOT EXISTS passkey_credentials (
      id TEXT PRIMARY KEY,
      rp_id TEXT NOT NULL,
      public_key TEXT NOT NULL,
      counter INTEGER NOT NULL,
      transports TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_used_at INTEGER
    )
  `), db.prepare(`
    CREATE TABLE IF NOT EXISTS passkey_challenges (
      id TEXT PRIMARY KEY,
      challenge TEXT NOT NULL,
      kind TEXT NOT NULL,
      origin TEXT NOT NULL,
      session_hash TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    )
  `)]);
  initializedDatabases.add(db);
}

function adminUsername(env, sys) {
  return sys?.username || env.API_USER_NAME || 'admin';
}

async function registrationSessionHash(request, env, sys) {
  const token = await getAuthenticatedToken(request, env, sys);
  if (!token) return '';
  // Changing the account credentials invalidates pending password-authorized
  // registrations, even when the existing administrator JWT remains valid.
  const binding = JSON.stringify([token, adminUsername(env, sys), sys?.password || env.API_SECRET]);
  return toB64(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(binding))));
}

function prepareChallenge(db, challenge, kind, origin, session = '') {
  const now = Date.now();
  const id = toB64(crypto.getRandomValues(new Uint8Array(32)));
  return {
    id,
    statements: [
      db.prepare('DELETE FROM passkey_challenges WHERE expires_at < ?').bind(now),
      db.prepare(`
        INSERT INTO passkey_challenges (id, challenge, kind, origin, session_hash, expires_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(id, challenge, kind, origin, session, now + CHALLENGE_TTL_MS)
    ]
  };
}

async function saveChallenge(db, options, kind, origin, session = '') {
  const { id, statements } = prepareChallenge(db, options.challenge, kind, origin, session);
  await db.batch(statements);
  return id;
}

async function consumeChallenge(db, id, kind, origin, session = '') {
  if (typeof id !== 'string' || id.length !== 43) return null;
  // DELETE ... RETURNING is a single D1/SQLite write: concurrent requests cannot
  // both consume the same challenge, including when verification later fails.
  return db.prepare(`
    DELETE FROM passkey_challenges
    WHERE id = ? AND kind = ? AND origin = ? AND session_hash = ? AND expires_at >= ?
    RETURNING challenge
  `).bind(id, kind, origin, session, Date.now()).first();
}

async function verifyCurrentPassword(data, env, sys) {
  if (typeof data.password !== 'string' || !data.password) return false;
  const username = adminUsername(env, sys);
  return (await validateCredentials(username, data.password, env, sys)).valid;
}

function credentialDescriptorsQuery(db, rpID) {
  return db.prepare('SELECT id, transports FROM passkey_credentials WHERE rp_id = ? ORDER BY created_at').bind(rpID);
}

function credentialDescriptorsFromResult(result) {
  const rows = result.results || [];
  return rows.map(row => ({ id: row.id, transports: JSON.parse(row.transports) }));
}

async function credentialDescriptors(db, rpID) {
  return credentialDescriptorsFromResult(await credentialDescriptorsQuery(db, rpID).all());
}

function loginResponse(request, sys, token) {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  headers.append('Set-Cookie', buildAuthCookie(request, token));
  const ua = buildUaCookie(request, sys?.ua);
  if (ua) headers.append('Set-Cookie', ua);
  return new Response(JSON.stringify({ success: true, token, message: 'loginSuccessful' }), { headers });
}

async function dispatchPasskeyAction({ request, env, sys, data }) {
  const trusted = passkeyOrigin(request);
  if (!trusted) return createBadRequestResponse('passkeyOriginInvalid');
  const { origin, rpID } = trusted;
  const db = env.DB;
  await ensureTables(db);

  if (data.action === 'passkey_login_options') {
    const turnstileEnabled = [sys?.turnstile_enabled, sys?.turnstile_login_enabled]
      .some(value => value === 'true' || value === true);
    if (turnstileEnabled && !hasAppPasswordAccess(request, sys) && !await verifyTurnstileToken(request.headers.get('X-Turnstile-Token'), sys?.turnstile_secret_key || '')) {
      return createErrorResponse(new AppError('verificationFailed', 403));
    }
    // Prepare a fresh challenge locally, then persist it and fetch the allowed
    // credentials in one D1 round trip before opening the device prompt.
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const { id, statements } = prepareChallenge(db, toB64(challenge), 'login', origin);
    const results = await db.batch([...statements, credentialDescriptorsQuery(db, rpID)]);
    const options = await generateAuthenticationOptions({
      rpID,
      challenge,
      userVerification: 'required',
      timeout: CEREMONY_TIMEOUT_MS,
      allowCredentials: credentialDescriptorsFromResult(results[2])
    });
    return createSuccessResponse({ options, challengeId: id });
  }

  if (data.action === 'passkey_login_verify') {
    const challenge = await consumeChallenge(db, data.challengeId, 'login', origin);
    if (!challenge) return createBadRequestResponse('passkeyChallengeInvalid');
    if (!isSameOriginClientData(data.credential)) return createBadRequestResponse('passkeyVerificationFailed');
    const row = await db.prepare('SELECT id, public_key, counter, transports FROM passkey_credentials WHERE id = ? AND rp_id = ?').bind(String(data.credential?.id || ''), rpID).first();
    if (!row) return createBadRequestResponse('passkeyVerificationFailed');
    let result;
    try {
      result = await verifyAuthenticationResponse({
        response: data.credential,
        expectedChallenge: challenge.challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: true,
        credential: {
          id: row.id,
          publicKey: fromB64(row.public_key),
          counter: row.counter,
          transports: JSON.parse(row.transports)
        }
      });
    } catch (_) { return createBadRequestResponse('passkeyVerificationFailed'); }
    if (!result.verified) return createBadRequestResponse('passkeyVerificationFailed');
    const counter = result.authenticationInfo.newCounter;
    const updated = await db.prepare(`
      UPDATE passkey_credentials SET counter = ?, last_used_at = ?
      WHERE id = ? AND rp_id = ? AND counter = ?
    `).bind(counter, Date.now(), row.id, rpID, row.counter).run();
    if (!updated.meta?.changes) return createBadRequestResponse('passkeyVerificationFailed');
    return loginResponse(request, sys, await generateToken(env, sys));
  }

  if (data.action === 'passkey_list') {
    const rows = (await db.prepare('SELECT id, name, created_at, last_used_at FROM passkey_credentials WHERE rp_id = ? ORDER BY created_at').bind(rpID).all()).results || [];
    return createSuccessResponse({ credentials: rows });
  }

  if (data.action === 'passkey_register_options') {
    if (!await verifyCurrentPassword(data, env, sys)) return createBadRequestResponse('invalidCredentials');
    const userName = adminUsername(env, sys);
    const options = await generateRegistrationOptions({
      rpName: 'CF Server Monitor', rpID, userID: new TextEncoder().encode('cfsm-admin'),
      userName, userDisplayName: userName,
      timeout: CEREMONY_TIMEOUT_MS, attestationType: 'none',
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
      excludeCredentials: await credentialDescriptors(db, rpID)
    });
    const session = await registrationSessionHash(request, env, sys);
    return createSuccessResponse({ options, challengeId: await saveChallenge(db, options, 'register', origin, session) });
  }

  if (data.action === 'passkey_register_verify') {
    const session = await registrationSessionHash(request, env, sys);
    const challenge = await consumeChallenge(db, data.challengeId, 'register', origin, session);
    if (!challenge) return createBadRequestResponse('passkeyChallengeInvalid');
    if (!isSameOriginClientData(data.credential)) return createBadRequestResponse('passkeyVerificationFailed');
    let result;
    try {
      result = await verifyRegistrationResponse({
        response: data.credential,
        expectedChallenge: challenge.challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: true
      });
    } catch (_) { return createBadRequestResponse('passkeyVerificationFailed'); }
    if (!result.verified) return createBadRequestResponse('passkeyVerificationFailed');
    const cred = result.registrationInfo.credential;
    const name = String(data.name || 'Passkey').trim().slice(0, 80) || 'Passkey';
    const inserted = await db.prepare(`
      INSERT INTO passkey_credentials (id, rp_id, public_key, counter, transports, name, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING
    `).bind(cred.id, rpID, toB64(cred.publicKey), cred.counter, JSON.stringify(cred.transports || []), name, Date.now()).run();
    if (!inserted.meta?.changes) return createBadRequestResponse('passkeyVerificationFailed');
    return createSuccessResponse({ success: true });
  }

  if (data.action === 'passkey_delete') {
    if (!await verifyCurrentPassword(data, env, sys)) return createBadRequestResponse('invalidCredentials');
    await db.prepare('DELETE FROM passkey_credentials WHERE id = ? AND rp_id = ?').bind(String(data.id || ''), rpID).run();
    return createSuccessResponse({ success: true });
  }
  return createBadRequestResponse('unknownAction');
}

export async function handlePasskeyAction(context) {
  let response;
  try {
    response = await dispatchPasskeyAction(context);
  } catch (error) {
    response = createErrorResponse(error);
  }
  // Challenges, account credential metadata and administrator sessions must
  // never be reused from a browser or intermediary cache.
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
