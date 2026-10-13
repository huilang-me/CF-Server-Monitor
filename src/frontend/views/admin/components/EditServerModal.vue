<template>
  <div id="editModal" class="modal-overlay" :class="{ active: show }">
    <div class="modal-dialog edit-server-modal">
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
      </div>
      <div class="form-row">
        <div class="form-group flex-1">
          <label class="form-label">{{ trans.tags }}</label>
          <input type="text" name="edit_tags" autocomplete="off" v-model="editForm.tags" class="form-input" :placeholder="trans.tagsPlaceholder">
        </div>

        <div class="form-group flex-1">
          <label class="form-label">{{ trans.region }} CN/US/GB</label>
          <input type="text" name="edit_region" autocomplete="off" v-model.trim="editForm.region" class="form-input" :placeholder="trans.regionPlaceholder">
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">{{ trans.note }}</label>
        <textarea name="edit_note" autocomplete="off" v-model="editForm.note" class="form-textarea" rows="2" :placeholder="trans.notePlaceholder"></textarea>
      </div>

      <div class="form-row mobile-two-row">
        <div class="form-group flex-1">
          <label class="form-label">{{ trans.currency }}</label>
          <select v-model="editForm.currency" class="form-select">
            <option v-for="item in currencySelectOptions" :key="item.symbol" :value="item.symbol">{{ currencyLabel(item) }}</option>
          </select>
        </div>

        <div class="form-group flex-1">
          <label class="form-label">{{ trans.price }}</label>
          <input type="text" name="edit_price" autocomplete="off" inputmode="decimal" v-model="editForm.price" class="form-input" placeholder="40.00" @blur="normalizePriceInput">
        </div>

        <div class="form-group flex-1">
          <label class="form-label">{{ trans.billingCycle }}</label>
          <select v-model="editForm.billing_cycle" class="form-select">
            <option v-for="item in billingCycleOptions" :key="item.value" :value="item.value">{{ cycleLabel(item) }}</option>
          </select>
        </div>

        <div class="form-group flex-1">
          <label class="form-label">{{ trans.expirationDate }}</label>
          <input type="date" name="edit_expire_date" autocomplete="off" v-model="editForm.expire_date" class="form-input" @click="openDatePicker">
        </div>
      </div>

      <div class="form-row mobile-two-row">
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
          <label class="form-label">
            {{ trans.trafficResetDay }}
            <HelpTooltip :text="trans.trafficResetDayTip" />
          </label>
          <select ref="editResetDayRef" name="edit_reset_day" v-model="editForm.reset_day" class="form-select">
            <option :value="0">0</option>
            <option v-for="day in 31" :key="day" :value="day">{{ day }}</option>
          </select>
        </div>
        <div class="form-group flex-1">
          <label class="form-label">
            {{ trans.trafficAlertPercent }} (%)
            <HelpTooltip :text="trans.trafficAlertPercentTip" />
          </label>
          <input type="number" name="edit_traffic_alert_percent" autocomplete="off" v-model="editForm.traffic_alert_percent" class="form-input" min="0" max="100" step="1">
        </div>
      </div>

      <div class="form-row mobile-two-row">
        <div class="form-group flex-1">
          <label class="form-label">
            {{ trans.collectInterval }}
            <HelpTooltip :text="trans.collectIntervalHint" />
          </label>
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
        <div class="form-group flex-1">
          <label class="form-label">
            {{ trans.connectionMode }}
            <HelpTooltip v-if="!isWssReportEnabled" :text="trans.wssReportDisabledConnectionHint" />
          </label>
          <select v-model="editForm.connection_mode" class="form-select" :disabled="!isWssReportEnabled">
            <option value="auto">{{ trans.connectionModeAuto }}</option>
            <option value="http">{{ trans.connectionModeHttp }}</option>
          </select>
        </div>
        <div v-if="isWssReportEnabled && editForm.connection_mode === 'auto'" class="form-group flex-1">
          <label class="form-label">{{ trans.wssReportInterval }}</label>
          <select v-model="editForm.wss_report_interval" class="form-select">
            <option v-for="second in 5" :key="second" :value="second">{{ second }}</option>
          </select>
        </div>
      </div>

      <div class="form-row mobile-two-row">
        <div class="form-group flex-1">
          <label class="form-label">
            {{ trans.pingMode }}
            <HelpTooltip :text="trans.pingModeIcmpRootHint" />
          </label>
          <select v-model="editForm.ping_mode" class="form-select">
            <option value="tcp">TCP</option>
            <option value="icmp">ICMP (root)</option>
          </select>
        </div>
        <div class="form-group flex-1">
          <label class="form-label">{{ trans.networkInterface }}</label>
          <input type="text" name="edit_interface" autocomplete="off" v-model.trim="editForm.interface" class="form-input" :placeholder="trans.networkInterfacePlaceholder">
        </div>
        <div class="form-group flex-1">
          <label class="form-label">
            {{ trans.rxCorrection }} (GB)
            <HelpTooltip :text="trans.correctionHint" />
          </label>
          <input type="number" name="edit_rx_correction" autocomplete="off" v-model="editForm.rx_correction" class="form-input" placeholder="0" min="0" step="0.1">
        </div>
        <div class="form-group flex-1">
          <label class="form-label">
            {{ trans.txCorrection }} (GB)
            <HelpTooltip :text="trans.correctionHint" />
          </label>
          <input type="number" name="edit_tx_correction" autocomplete="off" v-model="editForm.tx_correction" class="form-input" placeholder="0" min="0" step="0.1">
        </div>
      </div>

      <div class="form-row">
        <div class="form-group flex-1">
          <label class="form-label">
            {{ settings.custom_ct_name || trans.customCt }}
            <HelpTooltip :text="trans.pingNodeTip" />
          </label>
          <input type="text" name="edit_custom_ct" autocomplete="off" v-model.trim="editForm.custom_ct" :class="['form-input', { 'input-invalid': pingNodeErrors.custom_ct }]" :placeholder="settings.custom_ct || 'gd-ct-dualstack.ip.zstaticcdn.com'">
          <p v-if="pingNodeErrors.custom_ct" class="text-red text-sm mt-1">{{ pingNodeErrors.custom_ct }}</p>
        </div>
        <div class="form-group flex-1">
          <label class="form-label">
            {{ settings.custom_cu_name || trans.customCu }}
            <HelpTooltip :text="trans.pingNodeTip" />
          </label>
          <input type="text" name="edit_custom_cu" autocomplete="off" v-model.trim="editForm.custom_cu" :class="['form-input', { 'input-invalid': pingNodeErrors.custom_cu }]" :placeholder="settings.custom_cu || 'gd-cu-dualstack.ip.zstaticcdn.com'">
          <p v-if="pingNodeErrors.custom_cu" class="text-red text-sm mt-1">{{ pingNodeErrors.custom_cu }}</p>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group flex-1">
          <label class="form-label">
            {{ settings.custom_cm_name || trans.customCm }}
            <HelpTooltip :text="trans.pingNodeTip" />
          </label>
          <input type="text" name="edit_custom_cm" autocomplete="off" v-model.trim="editForm.custom_cm" :class="['form-input', { 'input-invalid': pingNodeErrors.custom_cm }]" :placeholder="settings.custom_cm || 'gd-cm-dualstack.ip.zstaticcdn.com'">
          <p v-if="pingNodeErrors.custom_cm" class="text-red text-sm mt-1">{{ pingNodeErrors.custom_cm }}</p>
        </div>
        <div class="form-group flex-1">
          <label class="form-label">
            {{ settings.custom_bd_name || trans.customBd }}
            <HelpTooltip :text="trans.pingNodeTip" />
          </label>
          <input type="text" name="edit_custom_bd" autocomplete="off" v-model.trim="editForm.custom_bd" :class="['form-input', { 'input-invalid': pingNodeErrors.custom_bd }]" :placeholder="settings.custom_bd || 'ip.zstaticcdn.com'">
          <p v-if="pingNodeErrors.custom_bd" class="text-red text-sm mt-1">{{ pingNodeErrors.custom_bd }}</p>
        </div>
      </div>
      <div class="form-row">
        <div v-for="(field, index) in ['node_1', 'node_2']" :key="field" class="form-group flex-1">
          <label class="form-label">
            {{ settings[`${field}_name`] || `Node ${index + 1}` }}
            <HelpTooltip :text="trans.pingNodeTip" />
          </label>
          <input type="text" :name="`edit_${field}`" autocomplete="off" v-model.trim="editForm[field]" :class="['form-input', { 'input-invalid': pingNodeErrors[field] }]" :placeholder="settings[field] || 'host[:port] / [IPv6]:port'">
          <p v-if="pingNodeErrors[field]" class="text-red text-sm mt-1">{{ pingNodeErrors[field] }}</p>
        </div>
      </div>
      <div class="form-row">
        <div v-for="(field, index) in ['node_3', 'node_4']" :key="field" class="form-group flex-1">
          <label class="form-label">
            {{ settings[`${field}_name`] || `Node ${index + 3}` }}
            <HelpTooltip :text="trans.pingNodeTip" />
          </label>
          <input type="text" :name="`edit_${field}`" autocomplete="off" v-model.trim="editForm[field]" :class="['form-input', { 'input-invalid': pingNodeErrors[field] }]" :placeholder="settings[field] || 'host[:port] / [IPv6]:port'">
          <p v-if="pingNodeErrors[field]" class="text-red text-sm mt-1">{{ pingNodeErrors[field] }}</p>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group flex-1">
          <div class="checkbox-item no-margin">
            <input type="checkbox" v-model="editForm.auto_renewal">
            <label>
              <b>{{ trans.autoRenewal }}</b>
            </label>
          </div>
        </div>

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

        <div v-if="hasNodeNotificationOptions" class="form-group">
          <div class="checkbox-item no-margin">
            <input type="checkbox" v-model="editForm.offline_notify_disabled">
            <label>
              <b>{{ trans.disableOfflineNotify }}</b>
            </label>
          </div>
        </div>
      </div>
      <div class="modal-footer flex-justify-between">
        <button @click="$emit('save')" class="btn btn-primary" :disabled="hasPingNodeErrors">{{ trans.save }}</button>
        <button @click="$emit('close')" class="btn">{{ trans.cancel }}</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, watch } from 'vue'
import HelpTooltip from '../../../components/HelpTooltip.vue'
import { PING_NODE_FIELDS, validatePingNode } from '../../../utils/pingNode.js'
import { currentLang } from '../../../utils/i18n.js'
import { BILLING_CYCLES, CURRENCY_OPTIONS, getLocalizedOptionField, normalizePrice, renewExpireDateIfNeeded } from '../../../utils/server.js'

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

const hasPingNodeErrors = computed(() => Object.values(pingNodeErrors.value).some(Boolean))

const billingCycleOptions = BILLING_CYCLES
const currencyOptions = CURRENCY_OPTIONS
const currencySelectOptions = computed(() => {
  const currentCurrency = String(editForm.value.currency || '').trim()
  if (!currentCurrency || currencyOptions.some(item => item.symbol === currentCurrency)) {
    return currencyOptions
  }
  return [
    { symbol: currentCurrency, nameZh: currentCurrency, nameEn: currentCurrency },
    ...currencyOptions
  ]
})

const cycleLabel = (item) => getLocalizedOptionField(item, 'label', currentLang.value)
const currencyLabel = (item) => `${item.symbol} ${getLocalizedOptionField(item, 'name', currentLang.value)}`

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
const hasNodeNotificationOptions = computed(() => (
  !!props.settings.tg_bot_token &&
  isOfflineNotifyEnabled.value
))
const isWssReportEnabled = computed(() => props.settings.wss_report_enabled === true)

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

watch(
  isWssReportEnabled,
  (enabled) => {
    if (!enabled) {
      editForm.value.connection_mode = 'http'
    }
  },
  { immediate: true }
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
