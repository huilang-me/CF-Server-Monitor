<template>
  <div id="editModal" class="modal-overlay" :class="{ active: show }">
    <div class="modal-dialog">
      <div class="modal-header">
        <div class="modal-title">{{ currentServerName }}</div>
        <button class="modal-close" @click="$emit('close')">✕</button>
      </div>
      <input type="hidden" v-model="editForm.id">

      <div class="form-row">
        <div class="form-group flex-1">
          <label class="form-label">{{ trans.hostnameLabel }} <span class="required">*</span></label>
          <input type="text" name="edit_name" autocomplete="off" v-model="editForm.name" class="form-input" placeholder="e.g. My Server">
        </div>

        <div class="form-group flex-1">
          <label class="form-label">{{ trans.groupName }}</label>
          <input type="text" name="edit_server_group" autocomplete="off" v-model="editForm.server_group" class="form-input" placeholder="e.g. US VPS">
        </div>

        <div class="form-group flex-1">
          <label class="form-label">{{ trans.tags }}</label>
          <input type="text" name="edit_tags" autocomplete="off" v-model="editForm.tags" class="form-input" :placeholder="trans.tagsPlaceholder">
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">{{ trans.note }}</label>
        <textarea name="edit_note" autocomplete="off" v-model="editForm.note" class="form-textarea" rows="2" :placeholder="trans.notePlaceholder"></textarea>
      </div>

      <div class="form-row">
        <div class="form-group flex-1">
          <label class="form-label">{{ trans.price }}</label>
          <input type="text" name="edit_price" autocomplete="off" inputmode="decimal" v-model="editForm.price" class="form-input" placeholder="40.00" @blur="normalizePriceInput">
        </div>

        <div class="form-group flex-1">
          <label class="form-label">{{ trans.currency }}</label>
          <input type="text" v-model="editForm.currency" class="form-input" list="currency-list" placeholder="e.g. $, ¥, €">
          <datalist id="currency-list">
            <option v-for="item in currencyOptions" :key="item.symbol" :value="item.symbol">{{ currencyLabel(item) }}</option>
          </datalist>
        </div>

        <div class="form-group flex-1">
          <label class="form-label">{{ trans.billingCycle }}</label>
          <select v-model="editForm.billing_cycle" class="form-select">
            <option v-for="item in billingCycleOptions" :key="item.value" :value="item.value">{{ cycleLabel(item) }}</option>
          </select>
        </div>
      </div>

      <div class="form-row">
        <div class="form-group flex-1">
          <label class="form-label">{{ trans.expirationDate }}</label>
          <input type="date" name="edit_expire_date" autocomplete="off" v-model="editForm.expire_date" class="form-input" @click="openDatePicker">
        </div>

        <div class="form-group flex-1">
          <label class="form-label">{{ trans.autoRenewal }}</label>
          <div class="checkbox-item no-margin">
            <input type="checkbox" v-model="editForm.auto_renewal">
            <label>
              <b>{{ trans.enabled }}</b>
            </label>
          </div>
        </div>
      </div>


      <div class="form-row">
        <div class="form-group flex-1">
          <label class="form-label">{{ trans.trafficLimit }} (GB)</label>
          <input type="number" name="edit_traffic_limit" autocomplete="off" v-model="editForm.traffic_limit" class="form-input" placeholder="e.g. 1000" min="0" step="1">
        </div>
        <div class="form-group flex-1">
          <label class="form-label">{{ trans.trafficCalcType }}</label>
          <select v-model="editForm.traffic_calc_type" class="form-select">
            <option value="total">{{ trans.trafficCalcTotal }}</option>
            <option value="ul">{{ trans.trafficCalcUl }}</option>
            <option value="dl">{{ trans.trafficCalcDl }}</option>
            <option value="max">{{ trans.trafficCalcMax }}</option>
          </select>
        </div>
        <div class="form-group flex-1">
          <label class="form-label">{{ trans.trafficResetDay }}</label>
          <select ref="editResetDayRef" name="edit_reset_day" v-model="editForm.reset_day" class="form-select">
            <option :value="0">0</option>
            <option v-for="day in 31" :key="day" :value="day">{{ day }}</option>
          </select>
        </div>
      </div>

      <div class="form-row">
        <div class="form-group flex-1">
          <label class="form-label">{{ trans.collectInterval }}</label>
          <select v-model="editForm.collect_interval" class="form-select">
            <option :value="0">0</option>
            <option :value="1">1</option>
            <option :value="2">2</option>
            <option :value="5">5</option>
            <option :value="10">10</option>
          </select>
        </div>
        <div class="form-group flex-1">
          <label class="form-label">{{ trans.reportInterval }}</label>
          <select v-model="editForm.report_interval" class="form-select">
            <option :value="30">30</option>
            <option :value="60">60</option>
            <option :value="120">120</option>
            <option :value="180">180</option>
          </select>
        </div>
      </div>

      <div class="text-muted text-sm mb-3">
        <span class="warning-icon">[i]</span> {{ trans.collectIntervalHint }}<br>
        <span class="warning-icon">[i]</span> {{ trans.trafficResetDayTip }}
      </div>

      <div class="mb-4">
        <div class="section-title">
          <span>▸</span>
          <span>{{ trans.agentNetwork }}</span>
          <span class="text-muted text-xs">({{ trans.installOnly }})</span>
        </div>
        <div class="form-group">
          <label class="form-label">{{ trans.agentBaseUrl }}</label>
          <input
            type="url"
            name="edit_agent_base_url"
            autocomplete="off"
            v-model.trim="editForm.agent_base_url"
            :class="['form-input', { 'input-invalid': baseUrlError }]"
            :placeholder="trans.agentBaseUrlPlaceholder"
          >
          <p v-if="baseUrlError" class="text-red text-sm mt-1">{{ baseUrlError }}</p>
          <p v-else class="text-muted text-sm mt-1">{{ trans.agentBaseUrlHint }}</p>
        </div>
        <div class="form-group no-margin">
          <label class="form-label">{{ trans.agentProxyUrl }}</label>
          <div class="password-input-wrapper">
            <input
              type="text"
              name="edit_agent_proxy_url"
              autocomplete="off"
              data-lpignore="true"
              data-1p-ignore="true"
              data-bwignore="true"
              data-form-type="other"
              v-model.trim="editForm.agent_proxy_url"
              :class="['form-input', { 'secret-input-masked': !proxyVisible, 'input-invalid': proxyUrlError }]"
              :placeholder="trans.agentProxyUrlPlaceholder"
            >
            <button type="button" class="password-toggle" @click="proxyVisible = !proxyVisible">
              {{ proxyVisible ? '🙈' : '👁️' }}
            </button>
          </div>
          <p v-if="proxyUrlError" class="text-red text-sm mt-1">{{ proxyUrlError }}</p>
          <p v-else class="text-muted text-sm mt-1">{{ trans.agentProxyUrlHint }}</p>
        </div>
        <div class="warning-box mt-3">
          <span class="warning-icon">[i]</span> {{ trans.agentNetworkInstallWarning }}
        </div>
      </div>

      <div class="form-row">
        <div class="form-group flex-1">
          <label class="form-label">{{ trans.customCt }} <span class="text-xs text-muted">({{ trans.serverLevel }})</span></label>
          <input type="text" name="edit_custom_ct" autocomplete="off" v-model.trim="editForm.custom_ct" :class="['form-input', { 'input-invalid': pingNodeErrors.custom_ct }]" :placeholder="settings.custom_ct || 'gd-ct-dualstack.ip.zstaticcdn.com'">
          <p v-if="pingNodeErrors.custom_ct" class="text-red text-sm mt-1">{{ pingNodeErrors.custom_ct }}</p>
        </div>
        <div class="form-group flex-1">
          <label class="form-label">{{ trans.customCu }} <span class="text-xs text-muted">({{ trans.serverLevel }})</span></label>
          <input type="text" name="edit_custom_cu" autocomplete="off" v-model.trim="editForm.custom_cu" :class="['form-input', { 'input-invalid': pingNodeErrors.custom_cu }]" :placeholder="settings.custom_cu || 'gd-cu-dualstack.ip.zstaticcdn.com'">
          <p v-if="pingNodeErrors.custom_cu" class="text-red text-sm mt-1">{{ pingNodeErrors.custom_cu }}</p>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group flex-1">
          <label class="form-label">{{ trans.customCm }} <span class="text-xs text-muted">({{ trans.serverLevel }})</span></label>
          <input type="text" name="edit_custom_cm" autocomplete="off" v-model.trim="editForm.custom_cm" :class="['form-input', { 'input-invalid': pingNodeErrors.custom_cm }]" :placeholder="settings.custom_cm || 'gd-cm-dualstack.ip.zstaticcdn.com'">
          <p v-if="pingNodeErrors.custom_cm" class="text-red text-sm mt-1">{{ pingNodeErrors.custom_cm }}</p>
        </div>
        <div class="form-group flex-1">
          <label class="form-label">{{ trans.customBd }} <span class="text-xs text-muted">({{ trans.serverLevel }})</span></label>
          <input type="text" name="edit_custom_bd" autocomplete="off" v-model.trim="editForm.custom_bd" :class="['form-input', { 'input-invalid': pingNodeErrors.custom_bd }]" :placeholder="settings.custom_bd || 'ip.zstaticcdn.com'">
          <p v-if="pingNodeErrors.custom_bd" class="text-red text-sm mt-1">{{ pingNodeErrors.custom_bd }}</p>
        </div>
      </div>

      <div class="form-row">
        <div class="form-group flex-1">
          <label class="form-label">{{ trans.rxCorrection }} (GB)</label>
          <input type="number" name="edit_rx_correction" autocomplete="off" v-model="editForm.rx_correction" class="form-input" placeholder="0" min="0" step="0.1">
        </div>
        <div class="form-group flex-1">
          <label class="form-label">{{ trans.txCorrection }} (GB)</label>
          <input type="number" name="edit_tx_correction" autocomplete="off" v-model="editForm.tx_correction" class="form-input" placeholder="0" min="0" step="0.1">
        </div>
      </div>
      <div class="text-muted text-sm mb-3">
        <span class="warning-icon">[i]</span> {{ trans.correctionHint }}
      </div>
      <div class="form-row">
        <div class="form-group">
          <div class="checkbox-item no-margin">
            <input type="checkbox" :checked="editForm.auto_update" @change="handleAutoUpdateChange">
            <label>
              <b>{{ trans.autoUpdate }}</b>
            </label>
          </div>
        </div>

        <div class="form-group">
          <div class="checkbox-item no-margin">
            <input type="checkbox" v-model="editForm.is_hidden">
            <label>
              <b>{{ trans.hideFromPublic }}</b>
            </label>
          </div>
        </div>

        <div v-if="isOfflineNotifyEnabled && settings.tg_bot_token" class="form-group">
          <div class="checkbox-item no-margin">
            <input type="checkbox" v-model="editForm.offline_notify_disabled">
            <label>
              <b>{{ trans.disableOfflineNotify }}</b>
            </label>
          </div>
        </div>
      </div>

      <div class="modal-footer flex-justify-between">
        <button @click="$emit('save')" class="btn btn-primary" :disabled="hasValidationErrors">{{ trans.save }}</button>
        <button @click="$emit('close')" class="btn">{{ trans.cancel }}</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { PING_NODE_FIELDS, validatePingNode } from '../../../utils/pingNode.js'
import { currentLang } from '../../../utils/i18n.js'
import { BILLING_CYCLES, CURRENCY_OPTIONS, normalizePrice, renewExpireDateIfNeeded } from '../../../../utils/serverBilling.js'
import { normalizeAgentBaseUrl, normalizeAgentProxyUrl } from '../../../../utils/agentNetwork.js'

const editForm = defineModel('editForm', { type: Object, required: true })

const props = defineProps({
  trans: { type: Object, required: true },
  show: { type: Boolean, default: false },
  currentServerName: { type: String, default: '' },
  settings: { type: Object, required: true }
})

const pingNodeErrorMessage = computed(() => (
  props.trans.invalidPingNodeFormat || 'Use domain, IPv4, or host:port. Port must be 1-65535.'
))

const pingNodeErrors = computed(() => Object.fromEntries(
  PING_NODE_FIELDS.map(field => [
    field,
    validatePingNode(editForm.value[field]).valid ? '' : pingNodeErrorMessage.value
  ])
))

const proxyVisible = ref(false)
watch(() => props.show, (show) => {
  if (show) proxyVisible.value = false
})
const baseUrlError = computed(() => (
  normalizeAgentBaseUrl(editForm.value.agent_base_url).valid ? '' : props.trans.invalidAgentBaseUrl
))
const proxyUrlError = computed(() => (
  normalizeAgentProxyUrl(editForm.value.agent_proxy_url).valid ? '' : props.trans.invalidAgentProxyUrl
))
const hasValidationErrors = computed(() => (
  Object.values(pingNodeErrors.value).some(Boolean) || !!baseUrlError.value || !!proxyUrlError.value
))

const billingCycleOptions = BILLING_CYCLES
const currencyOptions = CURRENCY_OPTIONS

const cycleLabel = (item) => currentLang.value === 'zh' ? item.labelZh : item.labelEn
const currencyLabel = (item) => currentLang.value === 'zh'
  ? `${item.symbol} ${item.nameZh}`
  : `${item.symbol} ${item.nameEn}`

const normalizeTgNotifySetting = (value) => {
  if (value === true || value === 'true') return '5'
  if (value === false || value === 'false' || value === undefined || value === null || value === '') return '0'

  const minutes = Number(value)
  if (Number.isInteger(minutes) && (minutes === 0 || (minutes >= 2 && minutes <= 30))) {
    return String(minutes)
  }

  return '0'
}

const isOfflineNotifyEnabled = computed(() => normalizeTgNotifySetting(props.settings.tg_notify) !== '0')

const normalizePriceInput = () => {
  editForm.value.price = normalizePrice(editForm.value.price)
}

const openDatePicker = (event) => {
  const input = event?.currentTarget
  if (typeof input?.showPicker !== 'function') return
  try {
    input.showPicker()
  } catch (_) {}
}

watch(
  () => [editForm.value.auto_renewal, editForm.value.billing_cycle, editForm.value.expire_date],
  () => {
    if (!editForm.value.auto_renewal) return
    const renewal = renewExpireDateIfNeeded(
      editForm.value.expire_date,
      editForm.value.billing_cycle,
      editForm.value.auto_renewal
    )
    if (renewal.renewed) {
      editForm.value.expire_date = renewal.expire_date
    }
  }
)

const emit = defineEmits(['save', 'close', 'toggle-auto-update'])

const handleAutoUpdateChange = (event) => {
  const nextValue = event.target.checked
  if (nextValue) {
    event.target.checked = false
  }
  emit('toggle-auto-update', nextValue)
}
</script>
