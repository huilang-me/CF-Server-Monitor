import { checkAuth } from '../middleware/auth.js';
import { createSuccessResponse, createBadRequestResponse, createUnauthorizedResponse, createNotFoundResponse } from '../utils/errors.js';

const SOURCES = ['IP2LOCATION', 'SCAMALYTICS', 'ipapi', 'AbuseIPDB', 'IPQS', 'DBIP'];
const FACTOR_SOURCES = ['IP2LOCATION', 'ipapi', 'ipregistry', 'IPQS', 'SCAMALYTICS', 'ipdata', 'IPinfo', 'DBIP'];
const FACTORS = ['Proxy', 'Tor', 'VPN', 'Server', 'Abuser', 'Robot'];
const ID = /^[a-zA-Z0-9_.:-]{1,64}$/;
const text = (value, limit = 120) => typeof value === 'string' && value.trim().toLowerCase() !== 'null'
  ? value.trim().replace(/[\x00-\x1f\x7f]/g, '').slice(0, limit) : '';

export async function digest(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}

export function normalizeReport(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid report');
  const ip = text(raw.Head?.IP, 45);
  const parts = ip.split('.');
  if (parts.length !== 4 || parts.some(p => !/^\d{1,3}$/.test(p) || Number(p) > 255)) throw new Error('Invalid IPv4 report');
  const scores = SOURCES.map(source => {
    const input = raw.Score?.[source];
    const cleaned = typeof input === 'number' ? String(input) : text(input, 20);
    const value = /^\d+(\.\d+)?%?$/.test(cleaned) ? Number(cleaned.replace('%', '')) : null;
    return { source, value: value !== null && value <= 100 ? value : null, unit: cleaned.endsWith('%') ? '%' : '' };
  });
  const status = text(raw.Media?.ChatGPT?.Status, 30);
  const chatgptStatus = ({ Yes: 'available', Block: 'blocked', WebOnly: 'web_only', APPOnly: 'app_only' })[status] || 'unknown';
  const info = {
    asn: text(raw.Info?.ASN, 20), organization: text(raw.Info?.Organization),
    country: text(raw.Info?.Region?.Code, 8), type: text(raw.Info?.Type, 40)
  };
  if (!info.asn && scores.every(s => s.value === null) && chatgptStatus === 'unknown') throw new Error('Report contains no usable measurements');
  return {
    ip,
    data: {
      ip: `${parts[0]}.${parts[1]}.*.*`, version: text(raw.Head?.Version, 40), info, scores,
      chatgpt: { status: chatgptStatus, region: text(raw.Media?.ChatGPT?.Region, 8), type: text(raw.Media?.ChatGPT?.Type, 30) },
      usage: ['IPinfo', 'ipregistry', 'ipapi', 'AbuseIPDB', 'IP2LOCATION'].map(source => ({
        source, usage: text(raw.Type?.Usage?.[source], 40), company: text(raw.Type?.Company?.[source], 40)
      })),
      factors: FACTOR_SOURCES.map(source => ({ source, ...Object.fromEntries(FACTORS.map(factor => {
        const value = raw.Factor?.[factor]?.[source];
        return [factor, typeof value === 'boolean' ? value : null];
      })) })),
      partial: scores.some(s => s.value === null) || chatgptStatus === 'unknown'
    }
  };
}

async function readBoundedJson(request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Empty request');
  let total = 0;
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > 32768) { await reader.cancel(); throw new Error('Report too large'); }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(body));
}

export async function handleIpQualityReport(request, env) {
  const id = new URL(request.url).searchParams.get('id') || '';
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer /, '');
  if (!ID.test(id) || !/^[a-f0-9]{64}$/.test(token)) return createUnauthorizedResponse();
  const row = await env.DB.prepare('SELECT q.* FROM ip_quality_reports q JOIN servers s ON s.id=q.server_id WHERE q.server_id=?').bind(id).first();
  if (!row || await digest(token) !== row.token_hash) return createUnauthorizedResponse();
  let body;
  try { body = await readBoundedJson(request); } catch { return createBadRequestResponse('Invalid report JSON'); }
  const checkedAt = body?.checked_at;
  const now = Date.now();
  if (!Number.isSafeInteger(checkedAt) || checkedAt > now + 300000 || checkedAt < now - 7 * 86400000) return createBadRequestResponse('Invalid report time');
  if (row.last_attempt && checkedAt <= row.last_attempt) return createSuccessResponse({ success: true, duplicate: true });
  if (body.error) {
    const error = ['timeout', 'invalid_report', 'check_failed'].includes(body.error) ? body.error : 'check_failed';
    await env.DB.prepare('UPDATE ip_quality_reports SET last_attempt=?, error=? WHERE server_id=? AND (last_attempt IS NULL OR last_attempt<?)')
      .bind(checkedAt, error, id, checkedAt).run();
    return createSuccessResponse({ success: true });
  }
  let report;
  try { report = normalizeReport(body.report); } catch { return createBadRequestResponse('Invalid IP quality report'); }
  const fingerprint = await digest(report.ip);
  report.data.ip_changed = Boolean(row.ip_fingerprint && fingerprint !== row.ip_fingerprint);
  await env.DB.prepare('UPDATE ip_quality_reports SET last_attempt=?, last_success=?, ip_fingerprint=?, report=?, error=NULL WHERE server_id=? AND (last_attempt IS NULL OR last_attempt<?)')
    .bind(checkedAt, checkedAt, fingerprint, JSON.stringify(report.data), id, checkedAt).run();
  return createSuccessResponse({ success: true });
}

export async function handleIpQualityRead(request, env, sys) {
  const admin = await checkAuth(request, env, sys);
  if (sys?.is_public !== 'true' && !admin) return createUnauthorizedResponse();
  const id = new URL(request.url).searchParams.get('id');
  if (id && !ID.test(id)) return createBadRequestResponse('Invalid server id');
  const result = await env.DB.prepare(`SELECT s.id, s.name, s.is_hidden, q.server_id, q.last_attempt, q.last_success, q.report, q.error
    FROM servers s LEFT JOIN ip_quality_reports q ON q.server_id=s.id ${id ? 'WHERE s.id=?' : ''} ORDER BY s.sort_order ASC`)
    .bind(...(id ? [id] : [])).all();
  const visible = result.results.filter(row => admin || (row.is_hidden !== '1' && row.is_hidden !== 1));
  if (id && !visible.length) return createNotFoundResponse();
  return createSuccessResponse({ reports: visible.map(row => ({
    server_id: row.id, name: row.name, enabled: Boolean(row.server_id),
    last_attempt: row.last_attempt, last_success: row.last_success, error: row.error,
    stale: Boolean(row.last_success && Date.now() - row.last_success > 36 * 3600000),
    report: row.report ? JSON.parse(row.report) : null
  })) }, { 'Cache-Control': 'no-store' });
}
