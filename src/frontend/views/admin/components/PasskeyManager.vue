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
        <input id="passkey-name" v-model.trim="name" class="form-input" type="text" maxlength="80" :placeholder="trans.passkeyNamePlaceholder">
      </div>
      <div class="form-group">
        <label class="form-label" for="passkey-password">{{ trans.passkeyPassword }}</label>
        <input id="passkey-password" v-model="password" class="form-input" type="password" autocomplete="current-password" :placeholder="trans.passkeyPassword">
      </div>
      <p class="passkey-hint">{{ trans.passkeyPasswordHint }}</p>
      <button type="button" class="btn btn-primary" :disabled="busy || !password" @click="add">{{ busy ? '⏳' : '+' }} {{ trans.passkeyAdd }}</button>
      <p v-if="message" role="status" class="passkey-message">{{ message }}</p>
    </template>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue'
import { startRegistration } from '@simplewebauthn/browser'
import { http } from '../../../utils/http.js'

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

const request = (data, index = props.apiIndex) => http.postByIndex('/admin/api', data, index, { autoRedirect: false })
const formatDate = (value) => {
  const date = new Date(typeof value === 'number' && value < 1e12 ? value * 1000 : value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString()
}

const load = async () => {
  if (!props.active || !props.available) return
  loading.value = true
  const index = props.apiIndex
  try {
    const result = await request({ action: 'passkey_list' })
    if (index !== props.apiIndex) return
    if (result.error) throw new Error(result.error)
    credentials.value = Array.isArray(result.data?.credentials) ? result.data.credentials : []
  } catch (_) {
    if (index === props.apiIndex) message.value = props.trans.passkeyFailed
  } finally {
    loading.value = false
  }
}

watch(() => [props.active, props.available, props.apiIndex], () => {
  credentials.value = []
  password.value = ''
  message.value = ''
  load()
}, { immediate: true })

const add = async () => {
  if (busy.value || !password.value || !props.available) return
  busy.value = true
  message.value = ''
  const index = props.apiIndex
  try {
    const result = await request({ action: 'passkey_register_options', password: password.value }, index)
    password.value = ''
    if (result.error || !result.data?.options || !result.data?.challengeId) throw new Error(result.error || 'options')
    const credential = await startRegistration({ optionsJSON: result.data.options })
    if (index !== props.apiIndex || !props.available) throw new Error('siteChanged')
    const verified = await request({ action: 'passkey_register_verify', challengeId: result.data.challengeId, credential, name: name.value }, index)
    if (verified.error) throw new Error(verified.error)
    name.value = ''
    await load()
    message.value = props.trans.passkeyAdded
  } catch (_) {
    message.value = props.trans.passkeyFailed
  } finally {
    password.value = ''
    busy.value = false
  }
}

const remove = async (key) => {
  if (busy.value) return
  if (!password.value) {
    message.value = props.trans.passkeyPasswordRequired
    return
  }
  if (!window.confirm(props.trans.passkeyDeleteConfirm)) return
  busy.value = true
  message.value = ''
  try {
    const result = await request({ action: 'passkey_delete', id: key.id, password: password.value })
    if (result.error) throw new Error(result.error)
    await load()
    message.value = props.trans.passkeyDeleted
  } catch (_) {
    message.value = props.trans.passkeyFailed
  } finally {
    password.value = ''
    busy.value = false
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
