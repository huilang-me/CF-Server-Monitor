import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { parse, compileScript } from 'vue/compiler-sfc'
import { effectScope, onScopeDispose, reactive, ref, watch } from 'vue'
import { passkeyErrorKey } from '../src/frontend/utils/passkeyErrors.js'

// Compile the actual component setup, replacing only its external browser and
// network dependencies. No DOM or physical authenticator is needed to exercise
// responses that arrive after the user leaves the current settings context.
const source = fs.readFileSync(new URL('../src/frontend/views/admin/components/PasskeyManager.vue', import.meta.url), 'utf8')
const script = compileScript(parse(source).descriptor, { id: 'passkey-manager-test' }).content
const createComponent = new Function('dependencies', `
  const { ref, watch, onScopeDispose, startRegistration, WebAuthnAbortService, http, passkeyErrorKey } = dependencies
  ${script.replace(/^import .* from ['"].*['"]\s*$/gm, '').replace('export default', 'return')}
`)

const deferred = () => {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}
const options = { data: { options: { challenge: 'test' }, challengeId: 'challenge' } }

function mount(t, handlers = {}) {
  const calls = []
  let cancelled = 0
  const props = reactive({
    apiIndex: 0, active: true, available: true,
    trans: new Proxy({}, { get: (_, key) => String(key) })
  })
  const component = createComponent({
    ref, watch, onScopeDispose, passkeyErrorKey,
    startRegistration: handlers.startRegistration || (async () => ({ id: 'key' })),
    WebAuthnAbortService: { cancelCeremony: () => { cancelled++ } },
    http: {
      async postByIndex(path, data, index) {
        calls.push({ path, data, index })
        if (data.action === 'passkey_list') return { data: { credentials: [{ id: `key-${index}` }] } }
        return handlers.request?.(data, index) || { data: { success: true } }
      }
    }
  })
  const scope = effectScope()
  const state = scope.run(() => component.setup(props, { expose() {} }))
  t.after(() => scope.stop())
  return { props, state, calls, scope, get cancelled() { return cancelled } }
}

test('one registration flow passes the server options through for every authenticator type', async t => {
  let receivedOptions
  const { state, calls } = mount(t, {
    request: data => data.action === 'passkey_register_options' ? options : { data: { success: true } },
    startRegistration: async value => { receivedOptions = value.optionsJSON; return { id: 'key' } }
  })
  state.name.value = 'backup'
  state.password.value = 'password'
  await state.add()
  const begin = calls.find(call => call.data.action === 'passkey_register_options')
  const finish = calls.find(call => call.data.action === 'passkey_register_verify')
  assert.deepEqual(begin.data, { action: 'passkey_register_options', password: 'password' })
  assert.equal(receivedOptions, options.data.options)
  assert.equal(finish.data.name, 'backup')
  assert.equal(state.message.value, 'passkeyAdded')
  assert.equal(state.password.value, '')
  assert.equal(state.busy.value, false)
})

test('switching sites while registration options load does not open a stale device prompt', async t => {
  const response = deferred()
  let prompts = 0
  const { props, state, calls } = mount(t, {
    request: () => response.promise,
    startRegistration: async () => { prompts++; return { id: 'key' } }
  })
  state.password.value = 'password'
  const pending = state.add()
  props.apiIndex = 1
  response.resolve(options)
  await pending
  assert.equal(prompts, 0)
  assert.equal(calls.some(call => call.data.action === 'passkey_register_verify'), false)
  assert.equal(state.password.value, '')
  assert.equal(state.busy.value, false)
})

test('leaving settings cancels the device prompt and ignores a late credential', async t => {
  const started = deferred()
  const credential = deferred()
  const context = mount(t, {
    request: () => options,
    startRegistration: () => { started.resolve(); return credential.promise }
  })
  context.state.password.value = 'password'
  const pending = context.state.add()
  await started.promise
  context.props.active = false
  assert.equal(context.cancelled, 1)
  credential.resolve({ id: 'key' })
  await pending
  assert.equal(context.calls.some(call => call.data.action === 'passkey_register_verify'), false)
  assert.equal(context.state.message.value, '')
})

test('a completed request from an old site cannot clear the new form or overwrite its message', async t => {
  const verifying = deferred()
  const response = deferred()
  const { props, state } = mount(t, {
    request: (data) => {
      if (data.action === 'passkey_register_options') return options
      verifying.resolve()
      return response.promise
    }
  })
  state.password.value = 'password'
  const pending = state.add()
  await verifying.promise
  props.apiIndex = 1
  state.name.value = 'new site key'
  state.password.value = 'new password'
  response.resolve({ data: { success: true } })
  await pending
  assert.equal(state.name.value, 'new site key')
  assert.equal(state.password.value, 'new password')
  assert.equal(state.message.value, '')
})

test('component disposal cancels its active WebAuthn prompt', async t => {
  const started = deferred()
  const credential = deferred()
  const context = mount(t, {
    request: () => options,
    startRegistration: () => { started.resolve(); return credential.promise }
  })
  context.state.password.value = 'password'
  const pending = context.state.add()
  await started.promise
  context.scope.stop()
  assert.equal(context.cancelled, 1)
  credential.resolve({ id: 'key' })
  await pending
  assert.equal(context.calls.some(call => call.data.action === 'passkey_register_verify'), false)
})
