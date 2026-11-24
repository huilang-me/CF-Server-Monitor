import assert from 'node:assert/strict'
import test from 'node:test'

import { getLatencyRefreshMs, mergeLatencyWindows } from '../src/frontend/utils/latencyRefresh.js'

test('refresh interval is one latency block', () => {
  assert.equal(getLatencyRefreshMs({ points: 20, hours: 2 }), 6 * 60 * 1000)
  assert.equal(getLatencyRefreshMs(undefined), 6 * 60 * 1000)
})

test('merge replaces only ping and loss, matched by source and id', () => {
  const current = [
    { id: 'a', source: 's1', cpu: 50, ping: [{ ts: 1, ct: 10 }], loss: [{ ts: 1, ct: 0 }] },
    { id: 'a', source: 's2', cpu: 60, ping: [], loss: [] },
    { id: 'b', source: 's1', cpu: 70, ping: [{ ts: 1 }], loss: [{ ts: 1 }] }
  ]
  const fresh = [
    { id: 'a', source: 's1', cpu: 1, ping: [{ ts: 2, ct: 20 }], loss: [{ ts: 2, ct: 5 }] },
    { id: 'b', source: 's1', cpu: 1 }
  ]
  const merged = mergeLatencyWindows(current, fresh)
  assert.deepEqual(merged[0], { id: 'a', source: 's1', cpu: 50, ping: [{ ts: 2, ct: 20 }], loss: [{ ts: 2, ct: 5 }] })
  assert.equal(merged[1], current[1])
  assert.equal(merged[2], current[2])
})
