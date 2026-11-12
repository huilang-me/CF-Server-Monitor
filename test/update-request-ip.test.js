import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyClientIpFallback,
  applyRequestIpFallback,
  resolveClientIpFromRequest
} from '../src/utils/metrics.js';

function createRequest(headers = {}) {
  return new Request('https://example.com/update', { method: 'POST', headers });
}

test('resolveClientIpFromRequest 优先使用 CF-Connecting-IP', () => {
  const request = createRequest({
    'CF-Connecting-IP': '203.0.113.9',
    'X-Real-IP': '198.51.100.7',
    'X-Forwarded-For': '192.0.2.5, 10.0.0.1'
  });

  assert.equal(resolveClientIpFromRequest(request), '203.0.113.9');
});

test('resolveClientIpFromRequest 在 CF 头缺失时回退 X-Forwarded-For 首个地址', () => {
  const request = createRequest({ 'X-Forwarded-For': '2001:db8::1, 10.0.0.1' });

  assert.equal(resolveClientIpFromRequest(request), '2001:db8::1');
});

test('resolveClientIpFromRequest 丢弃非法值与全零占位值', () => {
  assert.equal(resolveClientIpFromRequest(createRequest({ 'CF-Connecting-IP': '0.0.0.0' })), '');
  assert.equal(resolveClientIpFromRequest(createRequest({ 'CF-Connecting-IP': 'not-an-ip' })), '');
  assert.equal(resolveClientIpFromRequest(null), '');
});

test('applyRequestIpFallback 两个 IP 都为空时按 v4 补写 ip_v4', () => {
  const metrics = { ip_v4: '0', ip_v6: '' };

  applyRequestIpFallback(metrics, createRequest({ 'CF-Connecting-IP': '203.0.113.9' }));

  assert.equal(metrics.ip_v4, '203.0.113.9');
  assert.equal(metrics.ip_v6, '');
});

test('applyRequestIpFallback 按 v6 类型补写 ip_v6', () => {
  const metrics = { ip_v4: '0' };

  applyRequestIpFallback(metrics, createRequest({ 'CF-Connecting-IP': '2001:db8::1' }));

  assert.equal(metrics.ip_v4, '0');
  assert.equal(metrics.ip_v6, '2001:db8::1');
});

test('applyRequestIpFallback 把 IPv4-mapped IPv6 归为 v4', () => {
  const metrics = {};

  applyRequestIpFallback(metrics, createRequest({ 'CF-Connecting-IP': '::ffff:203.0.113.9' }));

  assert.equal(metrics.ip_v4, '203.0.113.9');
  assert.equal(metrics.ip_v6, undefined);
});

test('applyRequestIpFallback 已有任一 IP 时保持原值', () => {
  const metrics = { ip_v4: '0', ip_v6: '2001:db8::2' };

  applyRequestIpFallback(metrics, createRequest({ 'CF-Connecting-IP': '203.0.113.9' }));

  assert.deepEqual(metrics, { ip_v4: '0', ip_v6: '2001:db8::2' });
});

test('applyClientIpFallback 供 WebSocket 上报复用连接来源 IP', () => {
  const metrics = { ip_v4: '', ip_v6: '0' };

  applyClientIpFallback(metrics, '203.0.113.9');

  assert.equal(metrics.ip_v4, '203.0.113.9');
});

test('applyClientIpFallback 来源 IP 非法时不做修改', () => {
  const metrics = { ip_v4: '0', ip_v6: '0' };

  applyClientIpFallback(metrics, '0.0.0.0');

  assert.deepEqual(metrics, { ip_v4: '0', ip_v6: '0' });
});
