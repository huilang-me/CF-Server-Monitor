import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { ref } from 'vue'

const source = fs.readFileSync(new URL('../src/frontend/views/admin/composables/useTurnstile.js', import.meta.url), 'utf8')
const createTurnstile = new Function('dependencies', `
  const { ref, clearTurnstileToken, fetchTurnstileConfigByIndex, getTurnstileToken,
    hasSharedTurnstileVerified, isTurnstileValueEnabled, loadTurnstileScript,
    setTurnstileToken } = dependencies
  ${source.replace(/^import[\s\S]*?from ['"].*['"]\s*$/gm, '').replace('export function', 'function')}
  return useTurnstile()
`)

test('a late config response from a previous site cannot enable login prefetch on a protected site', async () => {
  let resolveOld
  const oldResponse = new Promise(resolve => { resolveOld = resolve })
  const turnstile = createTurnstile({
    ref, clearTurnstileToken() {}, getTurnstileToken: () => '',
    hasSharedTurnstileVerified: () => false,
    isTurnstileValueEnabled: value => value === true,
    loadTurnstileScript: async () => {}, setTurnstileToken() {},
    fetchTurnstileConfigByIndex: index => index === 0 ? oldResponse : Promise.resolve({
      data: { turnstile_enabled: false, turnstile_login_enabled: true, turnstile_site_key: 'current-site' }
    })
  })
  const old = turnstile.loadTurnstileConfig(0)
  assert.equal(await turnstile.loadTurnstileConfig(1), true)
  resolveOld({ data: { turnstile_login_enabled: false } })
  assert.equal(await old, false)
  assert.equal(turnstile.turnstileLoginEnabled.value, true)
  assert.equal(turnstile.turnstileSiteKey.value, 'current-site')
})

test('missing or malformed config cannot authorize speculative login options', async () => {
  for (const data of [null, {}, { turnstile_enabled: false }, { turnstile_enabled: 'unknown', turnstile_login_enabled: false }]) {
    const turnstile = createTurnstile({
      ref, clearTurnstileToken() {}, getTurnstileToken: () => '',
      hasSharedTurnstileVerified: () => false,
      isTurnstileValueEnabled: value => value === true,
      loadTurnstileScript: async () => {}, setTurnstileToken() {},
      fetchTurnstileConfigByIndex: async () => ({ data })
    })
    assert.equal(await turnstile.loadTurnstileConfig(0), false)
  }
})
