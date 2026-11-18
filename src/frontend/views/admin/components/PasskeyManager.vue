<template>
  <div class="settings-section">
    <div class="section-title"><span>▸</span> {{ trans.passkeyTitle }}</div>
    <p class="passkey-hint">{{ trans.passkeyDescription }}</p>
    <p v-if="!available" class="passkey-hint">{{ trans.passkeySameOrigin }}</p>
    <template v-else>
      <p v-if="!credentials.length && !loading" class="passkey-hint">{{ trans.passkeyEmpty }}</p>
      <ul v-else class="passkey-list">
        <li v-for="key in credentials" :key="key.id" class="passkey-row">
          <span><strong>{{ key.name || 'Passkey' }}</strong><small v-if="key.created_at">{{ formatDate(key.created_at) }}</small></span>
          <button type="button" class="btn btn-sm" :disabled="busy" @click="remove(key)">{{ trans.passkeyDelete }}</button>
        </li>
      </ul>
      <div class="form-group">
        <label class="form-label" for="passkey-name">{{ trans.passkeyName }}</label>
        <input id="passkey-name" v-model.trim="name" class="form-input" type="text" maxlength="80" :disabled="busy" :placeholder="trans.passkeyNamePlaceholder">
      </div>
      <div class="form-group">
        <label class="form-label" for="passkey-password">{{ trans.passkeyPassword }}</label>
        <input id="passkey-password" v-model="password" class="form-input" type="password" autocomplete="current-password" :disabled="busy" :placeholder="trans.passkeyPassword">
      </div>
      <p class="passkey-hint">{{ trans.passkeyPasswordHint }}</p>
      <button type="button" class="btn btn-primary" :disabled="busy || !password" @click="add">{{ busy ? '⏳' : '+' }} {{ trans.passkeyAdd }}</button>
      <p v-if="message" role="status" class="passkey-message">{{ message }}</p>
    </template>
  </div>
</template>

<script setup>
import { onScopeDispose, ref, watch } from 'vue'
import { startRegistration, WebAuthnAbortService } from '@simplewebauthn/browser'
import { http } from '../../../utils/http.js'
import { passkeyErrorKey } from '../../../utils/passkeyErrors.js'

const props = defineProps({
  trans: { type: Object, required: true },
  apiIndex: { type: Number, default: 0 },
  active: { type: Boolean, default: false },
  available: { type: Boolean, default: false }
})

const credentials = ref([])
const name = ref('')
const password = ref('')
const message = ref('')
const loading = ref(false)
const busy = ref(false)
let contextVersion = 0
let loadVersion = 0
let registrationActive = false

const isCurrent = (version) => version === contextVersion && props.active && props.available
const resetContext = () => {
  contextVersion++
  loadVersion++
  if (registrationActive) WebAuthnAbortService.cancelCeremony()
  registrationActive = false
  busy.value = false
  loading.value = false
  credentials.value = []
  name.value = ''
  password.value = ''
  message.value = ''
}

onScopeDispose(resetContext)

const request = (data, index = props.apiIndex) => http.postByIndex('/admin/api', data, index, { autoRedirect: false })
const formatDate = (value) => {
  const date = new Date(typeof value === 'number' && value < 1e12 ? value * 1000 : value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString()
}

const load = async () => {
  if (!props.active || !props.available) return
  loading.value = true
  const context = contextVersion
  const version = ++loadVersion
  const index = props.apiIndex
  try {
    const result = await request({ action: 'passkey_list' }, index)
    if (!isCurrent(context) || version !== loadVersion) return
    if (result.error) throw new Error(result.error)
    credentials.value = Array.isArray(result.data?.credentials) ? result.data.credentials : []
  } catch (_) {
    if (isCurrent(context) && version === loadVersion) message.value = props.trans.passkeyFailed
  } finally {
    if (isCurrent(context) && version === loadVersion) loading.value = false
  }
}

watch(() => [props.active, props.available, props.apiIndex], () => {
  resetContext()
  load()
}, { immediate: true, flush: 'sync' })

const add = async () => {
  if (busy.value || !password.value || !props.available) return
  busy.value = true
  message.value = ''
  const index = props.apiIndex
  const context = contextVersion
  const credentialName = name.value
  let stage = 'options'
  try {
    const result = await request({ action: 'passkey_register_options', password: password.value }, index)
    if (!isCurrent(context)) return
    password.value = ''
    if (result.error || !result.data?.options || !result.data?.challengeId) throw new Error(result.error || 'options')
    stage = 'device'
    registrationActive = true
    const credential = await startRegistration({ optionsJSON: result.data.options })
    if (!isCurrent(context)) return
    registrationActive = false
    stage = 'verify'
    const verified = await request({ action: 'passkey_register_verify', challengeId: result.data.challengeId, credential, name: credentialName }, index)
    if (!isCurrent(context)) return
    if (verified.error) throw new Error(verified.error)
    name.value = ''
    await load()
    if (isCurrent(context)) message.value = props.trans.passkeyAdded
  } catch (error) {
    if (isCurrent(context)) message.value = props.trans[passkeyErrorKey(error, stage)] || props.trans.passkeyFailed
  } finally {
    if (isCurrent(context)) {
      registrationActive = false
      password.value = ''
      busy.value = false
    }
  }
}

const remove = async (key) => {
  if (busy.value) return
  if (!password.value) {
    message.value = props.trans.passkeyPasswordRequired
    return
  }
  if (!window.confirm(props.trans.passkeyDeleteConfirm)) return
  const index = props.apiIndex
  const context = contextVersion
  busy.value = true
  message.value = ''
  try {
    const result = await request({ action: 'passkey_delete', id: key.id, password: password.value }, index)
    if (!isCurrent(context)) return
    if (result.error) throw new Error(result.error)
    await load()
    if (isCurrent(context)) message.value = props.trans.passkeyDeleted
  } catch (_) {
    if (isCurrent(context)) message.value = props.trans.passkeyFailed
  } finally {
    if (isCurrent(context)) {
      password.value = ''
      busy.value = false
    }
  }
}
</script>

<style scoped>
.passkey-hint { margin: 0 0 12px; font-size: 0.86em; opacity: 0.75; line-height: 1.5; }
.passkey-list { list-style: none; padding: 0; margin: 0 0 16px; }
.passkey-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--border-color, #444); }
.passkey-row small { display: block; opacity: 0.7; margin-top: 3px; }
.passkey-message { margin: 10px 0 0; font-size: 0.9em; }
</style>
