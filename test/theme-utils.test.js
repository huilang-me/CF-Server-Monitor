import test from 'node:test'
import assert from 'node:assert/strict'
import { formatBytes, isOnline, metricLabel, metricText, normalizeGpu, validHistoryHours } from '../src/utils.js'

test('history range is restricted to documented values', () => {
  assert.equal(validHistoryHours('0.167'), true)
  assert.equal(validHistoryHours('168'), true)
  assert.equal(validHistoryHours('2'), false)
})

test('online threshold is five minutes', () => {
  assert.equal(isOnline(700000, 999999), true)
  assert.equal(isOnline(699999, 1000000), false)
  assert.equal(isOnline(0, 1000000), false)
})

test('metric values preserve false/null/zero distinction', () => {
  assert.equal(metricLabel(false), 'hidden')
  assert.equal(metricLabel(undefined), 'hidden')
  assert.equal(metricLabel(null), 'timeout')
  assert.equal(metricLabel(0), 'value')
  assert.equal(metricText(null, 'ms', 'zh'), '超时')
  assert.equal(metricText(0, '%', 'en'), '0 %')
})

test('byte formatting uses B/s compatible units', () => {
  assert.equal(formatBytes(0), '0 B')
  assert.equal(formatBytes(1024), '1.0 KB')
  assert.equal(formatBytes(1048576), '1.0 MB')
})

test('GPU info accepts arrays and JSON strings', () => {
  const gpu = [{ id: '0', name: 'GPU', info: 20 }]
  assert.deepEqual(normalizeGpu(gpu), gpu)
  assert.deepEqual(normalizeGpu(JSON.stringify(gpu)), gpu)
  assert.deepEqual(normalizeGpu('invalid'), [])
  assert.deepEqual(normalizeGpu({}), [])
})
