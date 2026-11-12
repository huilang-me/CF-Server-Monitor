import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../src/index.js';
import { MetricsBroadcaster } from '../src/durable/MetricsBroadcaster.js';
import { checkOfflineNodes, checkResourceAlerts } from '../src/services/notification.js';
import { clearAllCaches } from '../src/utils/cache.js';
import { DEFAULT_NOTIFICATION_TEMPLATE, SITE_FIELDS, loadSiteSettings } from '../src/utils/settings.js';
import { RESOURCE_ALERT_COMPACT_RESULT_FORMAT } from '../src/utils/config.js';

const NOW = Date.UTC(2026, 9, 22, 12, 2);
const MINUTE = 60_000;
globalThis.WebSocketRequestResponsePair = class {};

function makeSettings(overrides = {}) {
  return {
    ...Object.fromEntries(SITE_FIELDS.map(field => [field, ''])),
    jwt_secret: 'x'.repeat(32),
    tg_notify: '2',
    tg_bot_token: 'test-token',
    tg_chat_id: 'test-chat',
    notification_timezone: 'UTC',
    notification_template: DEFAULT_NOTIFICATION_TEMPLATE,
    resource_alert_rules: [{ id: 'cpu', metric: 'cpu', threshold: 80, intervalMinutes: 5 }],
    ...overrides
  };
}

function makeServer(index, overrides = {}) {
  return { id: `server-${index}`, name: `Server ${index}`, history_partition_id: index, timestamp: 0, ...overrides };
}

function makeDb(settings, servers = [makeServer(1)]) {
  const stats = { settings: 0, legacy: 0, servers: 0, history: 0, batches: 0, offline: 0, resource: 0, writes: 0 };
  const db = {
    stats, settings, servers,
    timestamps: new Map(servers.map(server => [server.id, NOW])),
    offlineState: {}, resourceState: null, failHistory: false, failSettings: false, failLegacy: false,
    prepare(sql) {
      return {
        args: [],
        bind(...args) { this.args = args; return this; },
        async first() {
          if (sql.includes("key = 'site_options'")) {
            stats.settings++;
            if (db.failSettings) throw new Error('simulated settings read failure');
            return { value: JSON.stringify(db.settings) };
          }
          if (sql.includes("key = 'alert_state'")) {
            stats.offline++;
            return { value: JSON.stringify(db.offlineState) };
          }
          assert.equal(this.args[0], 'resource_alert_state');
          stats.resource++;
          return db.resourceState === null ? null : { value: JSON.stringify(db.resourceState) };
        },
        async all() {
          if (sql.includes('FROM servers')) {
            stats.servers++;
            return { results: db.servers };
          }
          assert.equal(sql, 'SELECT * FROM settings');
          stats.legacy++;
          if (db.failLegacy) throw new Error('simulated legacy settings read failure');
          return { results: [] };
        },
        async run() {
          stats.writes++;
          if (sql.startsWith('DELETE')) {
            assert.equal(this.args[0], 'resource_alert_state');
            db.resourceState = null;
          } else if (sql.includes('"alert_state"')) {
            db.offlineState = JSON.parse(this.args[0]);
          } else {
            assert.equal(this.args[0], 'resource_alert_state');
            db.resourceState = JSON.parse(this.args[1]);
          }
          return { success: true, meta: { changes: 1 } };
        }
      };
    },
    async batch(statements) {
      stats.batches++;
      stats.history += statements.length;
      if (db.failHistory) throw new Error('simulated D1 failure');
      return statements.map(statement => {
        const partition = Math.floor(statement.args[0] / 10_000_000_000_000);
        const server = db.servers.find(item => item.history_partition_id === partition);
        const timestamp = db.timestamps.get(server?.id);
        return { results: timestamp === undefined ? [] : [{ timestamp }] };
      });
    }
  };
  return db;
}

function makeEnv(db, { legacy = false, failBatch = -1 } = {}) {
  const calls = [];
  const storage = { reads: 0, writes: 0 };
  const broadcaster = new MetricsBroadcaster({
    setWebSocketAutoResponse() {},
    getWebSockets() { return []; },
    storage: {
      async get() { storage.reads++; return null; },
      async put() { storage.writes++; }
    }
  }, { DB: db });
  const env = {
    DB: db,
    METRICS_BROADCASTER: {
      idFromName() { return 'global'; },
      get() {
        return {
          async fetch(url, options) {
            const body = JSON.parse(options.body);
            calls.push(body);
            if (calls.length - 1 === failBatch) return new Response('', { status: 503 });
            if (legacy) delete body.resultFormat;
            return broadcaster.fetch(new Request(url, { ...options, body: JSON.stringify(body) }));
          }
        };
      }
    }
  };
  return { env, broadcaster, calls, storage };
}

function setup(t) {
  clearAllCaches();
  t.after(clearAllCaches);
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const messages = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    messages.push(JSON.parse(options.body));
    return new Response('{"ok":true}', { status: 200 });
  });
  return messages;
}

function seedSamples(broadcaster, serverId, values, now = Date.now()) {
  const minute = Math.floor(now / MINUTE) * MINUTE;
  broadcaster.resourceAlertWindows.set(serverId, {
    samples: values.map((value, index) => ({
      ts: minute - (values.length - 1 - index) * MINUTE,
      minuteTs: minute - (values.length - 1 - index) * MINUTE,
      cpu: value, ram: value, disk: value, netIn: value, netOut: value, netTotal: value * 2,
      tcpConn: value, udpConn: value
    }))
  });
}

test('minute cron shares one settings read, preserves refresh cadence and adds no requests or writes', async t => {
  const messages = setup(t);
  const db = makeDb(makeSettings(), [makeServer(1), makeServer(2, { offline_notify_disabled: '1' })]);
  const { env, calls, storage } = makeEnv(db);
  await worker.scheduled({ cron: '*/1 * * * *' }, env, {});
  assert.deepEqual(db.stats, { settings: 1, legacy: 0, servers: 1, history: 1, batches: 1, offline: 1, resource: 1, writes: 0 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].resultFormat, RESOURCE_ALERT_COMPACT_RESULT_FORMAT);
  assert.deepEqual(storage, { reads: 1, writes: 0 });

  t.mock.timers.tick(MINUTE);
  db.timestamps.set('server-1', Date.now());
  await worker.scheduled({ cron: '*/1 * * * *' }, env, {});
  assert.equal(db.stats.settings, 1, 'odd minute reuses settings');
  t.mock.timers.tick(MINUTE);
  db.timestamps.set('server-1', Date.now());
  await worker.scheduled({ cron: '*/1 * * * *' }, env, {});
  assert.equal(db.stats.settings, 2, 'next even minute refreshes once');
  assert.equal(calls.length, 3);
  assert.equal(db.stats.writes, 0);
  assert.equal(messages.length, 0);
});

test('cold odd/even cron only loads disabled settings once, including legacy fallback', async t => {
  setup(t);
  for (const minute of [1, 2]) {
    for (const missingField of [false, true]) {
      clearAllCaches();
      t.mock.timers.setTime(NOW + (minute - 2) * MINUTE);
      const settings = makeSettings({ tg_notify: '0', tg_bot_token: '', resource_alert_rules: [] });
      if (missingField) delete settings.custom_ct_name;
      const db = makeDb(settings);
      const { env, calls } = makeEnv(db);
      await worker.scheduled({ cron: '*/1 * * * *' }, env, {});
      assert.deepEqual(db.stats, { settings: 1, legacy: Number(missingField), servers: 0, history: 0, batches: 0, offline: 0, resource: 0, writes: 0 });
      assert.equal(calls.length, 0);
    }
  }
});

test('minute cron keeps offline and resource alerts working when settings refresh fails', async t => {
  const messages = setup(t);
  t.mock.method(console, 'error', () => {});
  const db = makeDb(makeSettings());
  await loadSiteSettings(db);
  db.failSettings = true;
  db.timestamps.delete('server-1');
  const { env, broadcaster, calls } = makeEnv(db);
  seedSamples(broadcaster, 'server-1', [90, 90, 90, 90, 90]);

  await worker.scheduled({ cron: '*/1 * * * *' }, env, {});
  assert.equal(messages.length, 2, 'both alerts must use the last successful settings');
  assert.deepEqual(db.offlineState, { 'server-1': true });
  assert.equal(db.resourceState.servers['cpu:server-1'].status, 'active');
  assert.equal(db.stats.settings, 2, 'one initial load plus one failed refresh, with no retry');
  assert.equal(db.stats.writes, 2);
  assert.equal(calls.length, 1);

  t.mock.timers.tick(MINUTE);
  await worker.scheduled({ cron: '*/1 * * * *' }, env, {});
  assert.equal(db.stats.settings, 2, 'odd minute reuses fallback without another D1 read');
  assert.equal(db.stats.writes, 2);
  assert.equal(messages.length, 2, 'fallback must preserve alert deduplication');

  t.mock.timers.tick(MINUTE);
  db.failSettings = false;
  db.settings.tg_notify = '0';
  db.settings.resource_alert_rules = [];
  await worker.scheduled({ cron: '*/1 * * * *' }, env, {});
  assert.equal(db.stats.settings, 3, 'next even minute reads the recovered database once');
  assert.equal(db.stats.history, 2, 'newly disabled offline alerts stop querying history');
  assert.equal(calls.length, 2, 'newly disabled resource alerts stop querying the DO');
  assert.equal(db.resourceState, null);
  assert.equal(messages.length, 2);
});

test('expired settings survive repeated failures without increasing ordinary refresh frequency', async t => {
  setup(t);
  t.mock.method(console, 'error', () => {});
  const db = makeDb(makeSettings());
  const good = await loadSiteSettings(db);
  t.mock.timers.tick(121_000);
  db.failSettings = true;
  assert.equal(await loadSiteSettings(db), good);
  assert.equal(await loadSiteSettings(db), good);
  assert.equal(db.stats.settings, 2);

  t.mock.timers.tick(120_000);
  assert.equal(await loadSiteSettings(db), good);
  assert.equal(db.stats.settings, 3);
  db.failSettings = false;
  db.settings.tg_notify = '8';
  assert.equal(await loadSiteSettings(db), good, 'failure keeps the original 120-second retry cadence');
  t.mock.timers.tick(120_000);
  const refreshed = await loadSiteSettings(db);
  assert.notEqual(refreshed, good);
  assert.equal(refreshed.tg_notify, '8');
  assert.equal(db.stats.settings, 4);
  assert.equal(db.stats.writes, 0);
});

test('legacy settings failure cannot replace a successful snapshot with partial defaults', async t => {
  setup(t);
  t.mock.method(console, 'error', () => {});
  const db = makeDb(makeSettings());
  const good = await loadSiteSettings(db);
  delete db.settings.custom_ct_name;
  db.settings.tg_notify = '0';
  db.failLegacy = true;
  assert.equal(await loadSiteSettings(db, { forceRefresh: true }), good);
  assert.equal(await loadSiteSettings(db), good);
  assert.equal(good.tg_notify, '2');
  assert.equal(db.stats.settings, 2);
  assert.equal(db.stats.legacy, 1);
  assert.equal(db.stats.writes, 0);
});

test('cold settings failures still use defaults without repeated reads and recover on forced refresh', async t => {
  setup(t);
  t.mock.method(console, 'error', () => {});
  const db = makeDb(makeSettings());
  db.failSettings = true;
  const fallback = await loadSiteSettings(db);
  assert.equal(fallback.tg_notify, '0');
  assert.equal(fallback.tg_bot_token, '');
  assert.equal(await loadSiteSettings(db), fallback);
  assert.equal(db.stats.settings, 1);
  db.failSettings = false;
  const refreshed = await loadSiteSettings(db, { forceRefresh: true });
  assert.equal(refreshed.tg_notify, '2');
  assert.equal(refreshed.tg_bot_token, 'test-token');
  assert.equal(db.stats.settings, 2);
  assert.equal(db.stats.writes, 0);
});

test('cron keeps weekly rotation skip and does not force refresh without a DO binding', async t => {
  setup(t);
  const db = makeDb(makeSettings({ tg_notify: '0', tg_bot_token: '' }));
  await worker.scheduled({ cron: '*/1 * * * *' }, { DB: db }, {});
  await worker.scheduled({ cron: '*/1 * * * *' }, { DB: db }, {});
  assert.equal(db.stats.settings, 1);
  clearAllCaches();
  t.mock.timers.setTime(Date.UTC(2026, 9, 25, 0, 2));
  await worker.scheduled({ cron: '*/1 * * * *' }, { DB: db }, {});
  assert.equal(db.stats.settings, 1);
});

test('offline queries exclude disabled nodes and preserve trigger/recovery deduplication', async t => {
  const messages = setup(t);
  const settings = makeSettings();
  const db = makeDb(settings, [makeServer(1), makeServer(2), makeServer(3, { offline_notify_disabled: '1' })]);
  db.timestamps.delete('server-1');
  db.offlineState = { 'server-2': true, 'server-3': true };
  await checkOfflineNodes(db, { siteSettings: settings });
  assert.equal(db.stats.settings, 0);
  assert.equal(db.stats.history, 2);
  assert.equal(db.stats.writes, 1);
  assert.deepEqual(db.offlineState, { 'server-1': true, 'server-3': true });
  assert.equal(messages.length, 2);
  assert.ok(messages.every(message => !message.text.includes('Server 3')));
  await checkOfflineNodes(db, { siteSettings: settings });
  assert.equal(db.stats.writes, 1);
  assert.equal(messages.length, 2);
});

test('offline check does no history/state work when every node is disabled and skips D1 failures', async t => {
  const messages = setup(t);
  const settings = makeSettings();
  const db = makeDb(settings, [makeServer(1, { offline_notify_disabled: '1' })]);
  await checkOfflineNodes(db, { siteSettings: settings });
  assert.equal(db.stats.history, 0);
  assert.equal(db.stats.offline, 0);
  clearAllCaches();
  db.servers[0].offline_notify_disabled = '0';
  db.failHistory = true;
  t.mock.method(console, 'error', () => {});
  await checkOfflineNodes(db, { siteSettings: settings });
  assert.equal(db.stats.offline, 0);
  assert.equal(db.stats.writes, 0);
  assert.equal(messages.length, 0);
});

for (const mode of ['average', 'continuous']) {
  test(`compact and legacy responses preserve ${mode} alert states, recovery and cooldown`, async t => {
    const messages = setup(t);
    const runs = [];
    for (const legacy of [false, true]) {
      clearAllCaches();
      messages.length = 0;
      t.mock.timers.setTime(NOW);
      const settings = makeSettings({ resource_alert_rules: [{ id: 'cpu', metric: 'cpu', threshold: 80, intervalMinutes: 5, mode }] });
      const db = makeDb(settings);
      const { env, broadcaster, calls, storage } = makeEnv(db, { legacy });
      const snapshots = [];
      for (const step of [
        { values: [90, 90, 90, 90, 90], status: 'active', messages: 1, writes: 1 },
        { values: [80, 80, 80, 80, 80], status: 'active', messages: 1, writes: 1 },
        { values: [20, 20, 20, 20, 90], status: 'active', messages: 1, writes: 1 },
        { values: [20], status: 'active', messages: 1, writes: 1 },
        { values: [20, 20, 20, 20, 20], stale: true, status: 'active', messages: 1, writes: 1 },
        { values: [20, 20, 20, 20, 20], status: 'recovered', messages: 2, writes: 2 },
        { values: [90, 90, 90, 90, 90], status: 'recovered', messages: 2, writes: 2 },
        { values: [90, 90, 90, 90, 90], advance: 5, status: 'active', messages: 3, writes: 3 },
        { values: [90, 90, 90, 90, 90], status: 'active', messages: 3, writes: 3 },
        { values: [90, 90, 90, 90, 90], advance: 5, status: 'active', messages: 3, writes: 4 },
        { values: [20, 20, 20, 20, 20], status: 'recovered', messages: 4, writes: 5 },
        { values: [20, 20, 20, 20, 20], advance: 5, status: undefined, messages: 4, writes: 6 }
      ]) {
        t.mock.timers.tick((step.advance || 1) * MINUTE);
        seedSamples(broadcaster, 'server-1', step.values, Date.now() - (step.stale ? 3 * MINUTE : 0));
        await checkResourceAlerts(env, { siteSettings: settings });
        assert.equal(db.resourceState?.servers['cpu:server-1']?.status, step.status);
        assert.equal(messages.length, step.messages);
        assert.equal(db.stats.writes, step.writes);
        snapshots.push(structuredClone(db.resourceState));
      }
      assert.equal(db.stats.settings, 0);
      assert.equal(db.stats.resource, 12);
      assert.equal(calls.length, 12);
      assert.equal(storage.writes, 0);
      runs.push({ snapshots, messages: structuredClone(messages), stats: db.stats });
    }
    assert.deepEqual(runs[0], runs[1], 'formats must produce identical persisted state, notifications and D1 work');
  });
}

test('compact results preserve all rule/server batches and leave failed batches unchanged', async t => {
  const messages = setup(t);
  t.mock.method(console, 'warn', () => {});
  const servers = Array.from({ length: 501 }, (_, index) => makeServer(index + 1));
  const settings = makeSettings({ resource_alert_rules: Array.from({ length: 11 }, (_, index) => ({
    id: `rule-${index}`, metric: 'cpu', threshold: 80, intervalMinutes: 5
  })) });
  const db = makeDb(settings, servers);
  const { env, broadcaster, calls } = makeEnv(db, { failBatch: 1 });
  seedSamples(broadcaster, 'server-1', [90, 90, 90, 90, 90]);
  seedSamples(broadcaster, 'server-501', [90, 90, 90, 90, 90]);
  await checkResourceAlerts(env, { siteSettings: settings });
  assert.deepEqual(calls.map(call => call.rules.length), [20, 2]);
  assert.equal(db.stats.resource, 1);
  assert.equal(db.stats.writes, 1);
  assert.equal(Object.keys(db.resourceState.servers).length, 20);
  assert.equal(db.resourceState.servers['rule-10:server-1'], undefined);
  assert.equal(messages.length, 1);

  const saved = structuredClone(db.resourceState);
  const failedEnv = makeEnv(db, { failBatch: 0 });
  await checkResourceAlerts(failedEnv.env, { siteSettings: settings });
  assert.deepEqual(db.resourceState, saved, 'failed or insufficient evaluations must not recover active alerts');
  assert.equal(db.stats.writes, 1);
});

test('compact recovery preserves complete metric values for every configurable resource and both windows', async t => {
  const messages = setup(t);
  const runs = [];
  for (const legacy of [false, true]) {
    clearAllCaches();
    messages.length = 0;
    t.mock.timers.setTime(NOW);
    const settings = makeSettings({ resource_alert_rules: ['cpu', 'ram', 'disk', 'netIn', 'netOut', 'tcpConn', 'udpConn'].flatMap(metric =>
      ['average', 'continuous'].map(mode => ({
        id: `${metric}-${mode}`, metric, mode,
        threshold: metric.startsWith('net') ? 640 : 80,
        intervalMinutes: mode === 'average' ? 5 : 10
      }))
    ) });
    const db = makeDb(settings);
    const { env, broadcaster } = makeEnv(db, { legacy });
    for (const value of [90, 20]) {
      t.mock.timers.tick(MINUTE);
      seedSamples(broadcaster, 'server-1', Array(10).fill(value));
      for (const sample of broadcaster.resourceAlertWindows.get('server-1').samples) {
        sample.netIn *= 1_000_000;
        sample.netOut *= 1_000_000;
      }
      await checkResourceAlerts(env, { siteSettings: settings });
    }
    assert.equal(Object.keys(db.resourceState.servers).length, 14);
    assert.ok(Object.values(db.resourceState.servers).every(state => state.status === 'recovered'));
    assert.equal(db.stats.writes, 2);
    assert.equal(db.stats.resource, 2);
    assert.equal(messages.length, 2);
    runs.push({ state: db.resourceState, messages: structuredClone(messages) });
  }
  assert.deepEqual(runs[0], runs[1]);
});

test('tcp and udp connection alerts use count thresholds and recover', async t => {
  const messages = setup(t);
  const settings = makeSettings({
    resource_alert_rules: [
      { id: 'tcp', metric: 'tcpConn', threshold: 1000, intervalMinutes: 5 },
      { id: 'udp', metric: 'udpConn', threshold: 500, intervalMinutes: 5 }
    ]
  });
  const db = makeDb(settings);
  const { env, broadcaster } = makeEnv(db);

  seedSamples(broadcaster, 'server-1', [1500, 1500, 1500, 1500, 1500]);
  await checkResourceAlerts(env, { siteSettings: settings });
  assert.equal(db.resourceState.servers['tcp:server-1'].status, 'active');
  assert.equal(db.resourceState.servers['udp:server-1'].status, 'active');
  assert.equal(messages.length, 1);
  assert.match(messages[0].text, /TCP 连接数 1500/);
  assert.match(messages[0].text, /UDP 连接数 1500/);

  t.mock.timers.tick(MINUTE);
  seedSamples(broadcaster, 'server-1', [100, 100, 100, 100, 100]);
  await checkResourceAlerts(env, { siteSettings: settings });
  assert.equal(db.resourceState.servers['tcp:server-1'].status, 'recovered');
  assert.equal(db.resourceState.servers['udp:server-1'].status, 'recovered');
  assert.equal(messages.length, 2);
  assert.match(messages[1].text, /TCP 连接数 100/);
  assert.match(messages[1].text, /UDP 连接数 100/);
});

test('malformed compact recovery data cannot clear an active alert', async t => {
  const messages = setup(t);
  const settings = makeSettings();
  const db = makeDb(settings);
  const { env, broadcaster } = makeEnv(db);
  seedSamples(broadcaster, 'server-1', [90, 90, 90, 90, 90]);
  await checkResourceAlerts(env, { siteSettings: settings });
  const saved = structuredClone(db.resourceState);
  env.METRICS_BROADCASTER.get = () => ({
    async fetch() {
      return Response.json({ results: [{
        ruleId: 'cpu', format: RESOURCE_ALERT_COMPACT_RESULT_FORMAT,
        metricDefinitions: [{ metric: 'cpu', mode: 'average', threshold: 80 }],
        alerts: [], evaluations: [{ serverId: 'server-1', metrics: [[20, null, 20, 20, 20]] }]
      }] });
    }
  });
  await checkResourceAlerts(env, { siteSettings: settings });
  assert.deepEqual(db.resourceState, saved);
  assert.equal(db.stats.writes, 1);
  assert.equal(messages.length, 1);
});

test('compact resource responses are smaller and keep the legacy protocol available', async t => {
  setup(t);
  const db = makeDb(makeSettings());
  const { broadcaster } = makeEnv(db);
  const serverIds = Array.from({ length: 100 }, (_, index) => `server-${index + 1}`);
  for (const id of serverIds) seedSamples(broadcaster, id, [10, 20, 30, 40, 50]);
  const rules = Array.from({ length: 20 }, (_, index) => ({
    ruleId: `rule-${index}`, serverIds, mode: 'average', windowMinutes: 5, thresholds: { cpuPercent: 80 }
  }));
  const full = await broadcaster._evaluateResourceAlertRules(rules);
  const compact = await broadcaster._evaluateResourceAlertRules(rules, { resultFormat: RESOURCE_ALERT_COMPACT_RESULT_FORMAT });
  const fullBytes = Buffer.byteLength(JSON.stringify(full));
  const compactBytes = Buffer.byteLength(JSON.stringify(compact));
  assert.ok(compactBytes < fullBytes * 0.3, `${compactBytes} should be less than 30% of ${fullBytes}`);
  assert.equal(full.results[0].evaluatedServerIds.length, 100);
  assert.equal(compact.results[0].evaluations.length, 100);
  assert.equal(compact.results[0].evaluatedServerIds, undefined);
  assert.deepEqual(compact.results[0].metricDefinitions, [{ metric: 'cpu', mode: 'average', threshold: 80 }]);
  assert.deepEqual(compact.results[0].evaluations[0].metrics, [[30, 50, 10, 50, 30]]);
});
