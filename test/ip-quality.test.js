import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { digest, normalizeReport, handleIpQualityRead, handleIpQualityReport } from '../src/handlers/ipQuality.js';

const token = 'a'.repeat(64);
const fixture = () => ({
  Head: { IP: '203.0.113.42', Version: 'v2026-09-04' },
  Info: { ASN: '64500', Organization: 'Example ISP', Region: { Code: 'US' }, Type: 'Geo-consistent' },
  Score: { IP2LOCATION: '3', SCAMALYTICS: '0', ipapi: '0.32%', IPQS: '75', AbuseIPDB: 'null', DBIP: '-1' },
  Factor: { Proxy: { IPQS: true, ipapi: false }, VPN: { IPQS: true } },
  Media: { ChatGPT: { Status: 'Yes', Region: 'US', Type: 'Native' } },
  private_key: 'must-not-leak'
});
async function setup() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('CREATE TABLE servers (id TEXT PRIMARY KEY, name TEXT, is_hidden TEXT, sort_order INTEGER)');
  sqlite.exec("INSERT INTO servers VALUES ('one','CloudLead-US','0',0),('hidden','Hidden','1',1),('other','Other','0',2)");
  sqlite.exec(readFileSync(new URL('../scripts/ip-quality-schema.sql', import.meta.url), 'utf8'));
  sqlite.prepare('INSERT INTO ip_quality_reports(server_id,token_hash) VALUES (?,?)').run('one', await digest(token));
  const DB = { prepare(sql) { return { bind(...args) { const query = sqlite.prepare(sql); return {
    first: async () => query.get(...args) || null,
    all: async () => ({ results: query.all(...args) }),
    run: async () => query.run(...args)
  }; } }; } };
  return { env: { DB }, sqlite };
}
function post(data, credential = token, id = 'one') {
  return new Request(`https://monitor.test/ip-quality/report?id=${id}`, {
    method: 'POST', headers: { Authorization: `Bearer ${credential}` }, body: JSON.stringify(data)
  });
}

test('normalizes scores without inventing missing values; masks IP and allowlists report fields', () => {
  const result = normalizeReport(fixture()).data;
  assert.equal(result.ip, '203.0.*.*');
  assert.equal(result.chatgpt.status, 'available');
  assert.deepEqual(result.scores.find(s => s.source === 'ipapi'), { source: 'ipapi', value: 0.32, unit: '%' });
  assert.equal(result.scores.find(s => s.source === 'AbuseIPDB').value, null);
  assert.equal(result.scores.find(s => s.source === 'DBIP').value, null);
  assert.equal(result.factors.find(s => s.source === 'ipapi').Proxy, false);
  assert.equal(result.factors.find(s => s.source === 'IPinfo').Proxy, null);
  assert.equal(result.partial, true);
  assert.ok(!JSON.stringify(result).includes('must-not-leak'));
  assert.throws(() => normalizeReport({ Head: { IP: '203.0.113.256' } }));
  assert.throws(() => normalizeReport({ Head: { IP: '203.0.113.2' } }));
});

test('report token is scoped to one registered server and invalid reports cannot overwrite data', async () => {
  const { env, sqlite } = await setup();
  const time = Date.now() - 1000;
  const data = { checked_at: time, report: fixture() };
  assert.equal((await handleIpQualityReport(post(data, 'b'.repeat(64)), env)).status, 401);
  assert.equal((await handleIpQualityReport(post(data, token, 'other'), env)).status, 401);
  assert.equal((await handleIpQualityReport(post(data), env)).status, 200);
  assert.equal((await handleIpQualityReport(post({ checked_at: time + 1, report: { Head: { IP: 'bad' } } }), env)).status, 400);
  assert.equal((await handleIpQualityReport(post({ ...data, padding: 'x'.repeat(33000) }), env)).status, 400);
  assert.equal(sqlite.prepare('SELECT last_success FROM ip_quality_reports').get().last_success, time);
  sqlite.close();
});

test('failure retains last success, late reports cannot roll back state, IP changes are detected', async () => {
  const { env, sqlite } = await setup();
  const time = Date.now() - 10000;
  await handleIpQualityReport(post({ checked_at: time, report: fixture() }), env);
  await handleIpQualityReport(post({ checked_at: time + 1000, error: 'timeout' }), env);
  let row = sqlite.prepare('SELECT * FROM ip_quality_reports').get();
  assert.equal(row.last_success, time);
  assert.equal(row.error, 'timeout');
  assert.ok(row.report);
  await handleIpQualityReport(post({ checked_at: time, report: fixture() }), env);
  assert.equal(sqlite.prepare('SELECT error FROM ip_quality_reports').get().error, 'timeout');
  const next = fixture(); next.Head.IP = '203.0.113.43';
  await handleIpQualityReport(post({ checked_at: time + 2000, report: next }), env);
  row = sqlite.prepare('SELECT * FROM ip_quality_reports').get();
  assert.equal(row.error, null);
  assert.equal(JSON.parse(row.report).ip_changed, true);
  assert.ok(!row.report.includes('203.0.113.43'));
  sqlite.close();
});

test('public read respects private mode and hidden servers without exposing upload credentials', async () => {
  const { env, sqlite } = await setup();
  const request = new Request('https://monitor.test/api/ip-quality');
  assert.equal((await handleIpQualityRead(request, env, { is_public: 'false' })).status, 401);
  const response = await handleIpQualityRead(request, env, { is_public: 'true' });
  const body = await response.json();
  assert.deepEqual(body.reports.map(r => r.name), ['CloudLead-US', 'Other']);
  assert.equal(body.reports[1].enabled, false);
  assert.ok(!JSON.stringify(body).includes('token_hash'));
  assert.equal((await handleIpQualityRead(new Request('https://monitor.test/api/ip-quality?id=hidden'), env, { is_public: 'true' })).status, 404);
  sqlite.close();
});
