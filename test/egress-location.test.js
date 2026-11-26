import test from 'node:test';
import assert from 'node:assert/strict';
import { saveMetricsHistory } from '../src/database/schema.js';
import { toBroadcastSamples } from '../src/handlers/update.js';
import { HISTORY_ALL_QUERY_COLUMNS, HISTORY_INSERT_COLUMNS } from '../src/utils/historyFields.js';
import { mergeMetricsIntoServer } from '../src/utils/metrics.js';
import {
  applyEgressLocation,
  egressLocationFromCf,
  egressLocationFromHeaders,
  writeEgressLocationHeaders
} from '../src/utils/egressLocation.js';

test('egressLocationFromCf 返回清理后的近似出口位置和两位小数坐标', () => {
  assert.deepEqual(egressLocationFromCf({
    city: ' San Francisco\n',
    region: 'California',
    regionCode: 'CA',
    country: 'us',
    latitude: '37.7749',
    longitude: '-122.4194'
  }), {
    egress_city: 'San Francisco',
    egress_region: 'California',
    egress_region_code: 'CA',
    egress_country: 'US',
    egress_latitude: 37.77,
    egress_longitude: -122.42
  });
});

test('无 Cloudflare 定位时返回 null，非法或不完整坐标不会变成地图点', () => {
  assert.equal(egressLocationFromCf(undefined), null);
  assert.deepEqual(egressLocationFromCf({
    city: 'Example City',
    country: 'US',
    latitude: '91',
    longitude: '-122'
  }), {
    egress_city: 'Example City',
    egress_region: '',
    egress_region_code: '',
    egress_country: 'US',
    egress_latitude: null,
    egress_longitude: null
  });
});

test('WebSocket 位置头由 Worker 元数据覆盖，并可在 Durable Object 侧读取', () => {
  const headers = new Headers({
    'X-CFSM-Egress-City': 'Forged city',
    'X-CFSM-Egress-Latitude': '1'
  });
  writeEgressLocationHeaders(headers, {
    egress_city: 'Tokyo',
    egress_country: 'JP',
    egress_latitude: 35.68,
    egress_longitude: 139.69
  });

  assert.deepEqual(egressLocationFromHeaders(headers), {
    egress_city: 'Tokyo',
    egress_region: '',
    egress_region_code: '',
    egress_country: 'JP',
    egress_latitude: 35.68,
    egress_longitude: 139.69
  });
});

test('缺少可信 Cloudflare 定位时删除探针自带的出口位置字段', () => {
  const metrics = { egress_city: 'Forged city', egress_latitude: 10, cpu: 5 };
  applyEgressLocation(metrics, null);
  assert.deepEqual(metrics, { cpu: 5 });
});

test('历史写入按固定列顺序保存出口位置字段', async () => {
  let values = null;
  const db = {
    prepare() {
      return {
        bind(...args) {
          values = args;
          return { run: async () => ({ success: true }) };
        }
      };
    }
  };
  const metrics = {
    egress_city: 'Tokyo',
    egress_region: 'Tokyo',
    egress_region_code: '13',
    egress_country: 'JP',
    egress_latitude: 35.68,
    egress_longitude: 139.69
  };

  await saveMetricsHistory(db, 'server-1', 1, metrics, 'JP', 1737638340000, 'test');

  for (const [field, expected] of Object.entries(metrics)) {
    assert.equal(values[HISTORY_INSERT_COLUMNS.indexOf(field)], expected, field);
  }
  assert.equal(values.length, HISTORY_INSERT_COLUMNS.length);
});

test('/api/history/all 固定投影包含已持久化的出口位置字段', () => {
  for (const field of [
    'egress_city',
    'egress_region',
    'egress_region_code',
    'egress_country',
    'egress_latitude',
    'egress_longitude'
  ]) {
    assert.ok(HISTORY_ALL_QUERY_COLUMNS.includes(field), `${field} is selected by history API`);
  }
});

test('出口位置随实时广播发送，但原始探针 IP 仍从 payload 中删除', () => {
  const trustedLocation = {
    egress_city: 'Tokyo',
    egress_country: 'JP',
    egress_latitude: 35.68,
    egress_longitude: 139.69
  };
  const samples = toBroadcastSamples('server-1', [
    { ts: 1737638340000, metrics: { cpu: 9, egress_city: 'Forged', egress_latitude: 0 } },
    { ts: 1737638341000, metrics: { cpu: 10, egress_city: 'Forged', egress_latitude: 1 } }
  ], 'JP', 'test', { ...trustedLocation, ip_v4: '203.0.113.9' }, trustedLocation);

  for (const sample of samples) {
    assert.equal(sample.payload.egress_city, 'Tokyo');
    assert.equal(sample.payload.egress_latitude, 35.68);
    assert.equal(sample.payload.egress_longitude, 139.69);
    assert.equal(Object.hasOwn(sample.payload, 'ip_v4'), false);
  }
});

test('最新指标合并进节点对象时保留出口位置字段', () => {
  const server = {};
  mergeMetricsIntoServer(server, {
    egress_city: 'Tokyo',
    egress_country: 'JP',
    egress_latitude: 35.68,
    egress_longitude: 139.69
  });

  assert.equal(server.egress_city, 'Tokyo');
  assert.equal(server.egress_country, 'JP');
  assert.equal(server.egress_latitude, 35.68);
  assert.equal(server.egress_longitude, 139.69);
});
