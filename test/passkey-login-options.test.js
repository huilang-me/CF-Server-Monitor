import test from 'node:test'
import assert from 'node:assert/strict'
import { createPasskeyLoginOptions } from '../src/frontend/utils/passkeyLogin.js'

const deferred = () => {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

test('prepared login options can be consumed synchronously, once, without a second request', async () => {
  const options = { challengeId: 'challenge', options: { challenge: 'random' } }
  let requests = 0
  const cache = createPasskeyLoginOptions(async () => { requests++; return options })
  await cache.prepare()
  assert.equal(cache.take(), options)
  assert.equal(cache.take(), null)
  assert.equal(requests, 1)
})

test('a click arriving during preparation shares the same request', async () => {
  const response = deferred()
  let requests = 0
  const cache = createPasskeyLoginOptions(() => { requests++; return response.promise })
  const first = cache.prepare()
  assert.equal(cache.take(), null)
  const second = cache.prepare()
  assert.equal(first, second)
  response.resolve({ challengeId: 'once' })
  await second
  assert.equal(cache.take().challengeId, 'once')
  assert.equal(requests, 1)
})

test('expired options are discarded and the next attempt obtains a fresh challenge', async () => {
  let now = 0
  let requests = 0
  const cache = createPasskeyLoginOptions(async () => ({ challengeId: ++requests }), () => now)
  await cache.prepare()
  now = 60_000
  assert.equal(cache.take(), null)
  await cache.prepare()
  assert.equal(cache.take().challengeId, 2)
})

test('a response from a discarded context cannot replace a new site challenge', async () => {
  const oldResponse = deferred()
  let requests = 0
  const cache = createPasskeyLoginOptions(() => ++requests === 1 ? oldResponse.promise : Promise.resolve({ challengeId: 'new' }))
  const pending = cache.prepare()
  cache.clear()
  await cache.prepare()
  oldResponse.resolve({ challengeId: 'old' })
  assert.equal(await pending, null)
  assert.equal(cache.take().challengeId, 'new')
})

test('failed preparation is not cached and does not trigger background retries', async () => {
  let requests = 0
  const cache = createPasskeyLoginOptions(async () => {
    if (++requests === 1) throw new Error('network failure')
    return { challengeId: 'retry' }
  })
  await assert.rejects(cache.prepare(), /network failure/)
  assert.equal(requests, 1)
  assert.equal(cache.take(), null)
  await cache.prepare()
  assert.equal(cache.take().challengeId, 'retry')
})
