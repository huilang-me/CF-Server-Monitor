import assert from 'node:assert/strict';
import test from 'node:test';
import { buildResourceAlertNotificationPayloads, evaluateTrafficAlert } from '../src/services/notification.js';
import { clearSiteSettingsCache, normalizeNotificationLanguage } from '../src/utils/settings.js';

const netInAlert = [{
  server: { name: 'web-1' },
  alert: { metrics: [{ metric: 'netIn', threshold: 1000, current: 5000000, triggerValue: 5000000 }] }
}];

test('notification language defaults to Chinese for missing or unknown values', () => {
  assert.equal(normalizeNotificationLanguage(undefined), 'zh');
  assert.equal(normalizeNotificationLanguage('fr'), 'zh');
  assert.equal(normalizeNotificationLanguage(' ES '), 'es');
});

test('resource alert payloads keep Chinese text when no language is configured', () => {
  const [payload] = buildResourceAlertNotificationPayloads(netInAlert, [], {});
  assert.equal(payload.context.event, '资源负载告警');
  assert.equal(payload.msg, 'web-1  下行网速 40.0 Mbps');
});

test('resource alert payloads are rendered in Spanish', () => {
  const [alert, recovered] = buildResourceAlertNotificationPayloads(netInAlert, netInAlert, { notification_language: 'es' });
  assert.equal(alert.context.event, 'Alerta de carga de recursos');
  assert.equal(alert.context.emoji, '❌');
  assert.equal(alert.msg, 'web-1  Velocidad de descarga 40.0 Mbps');
  assert.equal(recovered.context.event, 'Carga de recursos normalizada');
  assert.equal(recovered.context.emoji, '✅');
});

test('monthly traffic alert sends a Spanish Telegram message', async () => {
  clearSiteSettingsCache();
  const siteSettings = {
    jwt_secret: 'a'.repeat(64),
    tg_bot_token: '123:abc',
    tg_chat_id: '42',
    traffic_alert_threshold: '80',
    notification_language: 'es'
  };
  const db = {
    prepare(sql) {
      return {
        bind() { return this; },
        async first() {
          return sql.includes("key = 'site_options'") ? { value: JSON.stringify(siteSettings) } : null;
        },
        async all() { return { results: [] }; },
        async run() { return { success: true, meta: { changes: 1 } }; }
      };
    }
  };
  const requests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), body: JSON.parse(options.body) });
    return { ok: true, async text() { return ''; }, async json() { return { ok: true }; } };
  };
  try {
    await evaluateTrafficAlert(
      { DB: db },
      { id: 'srv-1', name: 'Box', traffic_limit: '100', traffic_calc_type: 'total', traffic_alert_percent: null, traffic_alert_state: null },
      { net_rx_monthly: 90 * 1024 ** 3, net_tx_monthly: 0 }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /api\.telegram\.org\/bot123:abc\/sendMessage/);
  assert.equal(requests[0].body.chat_id, '42');
  assert.match(requests[0].body.text, /Alerta de tráfico mensual/);
  assert.match(requests[0].body.text, /Box  Usados 90\.0 GB de 100 GB este mes \(90\.0% ≥ 80%\)/);
  assert.doesNotMatch(requests[0].body.text, /[一-鿿]/);
});
