<template>
  <div id="copyModal" class="modal-overlay" :class="{ active: show }">
    <div class="modal-dialog">
      <div class="modal-header">
        <div class="modal-title">{{ currentServerName }}</div>
        <button class="modal-close" @click="$emit('close')">✕</button>
      </div>

      <div class="form-row">
        <div class="form-group flex-1">
          <label class="form-label">{{ trans.targetOs }}</label>
          <select :value="targetOs" class="form-select" @change="$emit('update:target-os', $event.target.value)">
            <option value="linux">Linux (systemd)</option>
            <option value="unix">OpenWrt/Alpine/Synology DSM/FreeBSD</option>
            <option value="mac">macOS</option>
            <option value="windows">Windows</option>
            <option value="docker">Docker</option>
          </select>
        </div>

        <div class="form-group flex-1">
          <label class="form-label">
            Agent {{ trans.version }}
            <HelpTooltip :text="targetOs === 'docker' ? trans.dockerVersionTip : trans.installVersionTip" />
          </label>
          <input
            type="text"
            :value="installVersion"
            class="form-input"
            :placeholder="targetOs === 'docker' ? 'latest' : trans.installVersionPlaceholder"
            @input="$emit('update:install-version', $event.target.value)"
          >
        </div>
      </div>

      <div v-if="targetOs !== 'docker'" class="form-row">
        <div v-if="targetOs === 'linux'" class="form-group flex-1">
          <label class="form-label">
            {{ trans.installMode }}
            <HelpTooltip :text="trans.nonRootInstallTip" />
          </label>
          <select :value="installMode" class="form-select" @change="$emit('update:install-mode', $event.target.value)">
            <option value="current-user">{{ trans.installModeCurrentUser }}</option>
            <option value="cfsm-user">{{ trans.installModeCfsmUser }}</option>
          </select>
        </div>

        <div v-if="targetOs !== 'docker'" class="form-group flex-1">
          <label class="form-label">
            {{ trans.ghProxy }}
            <HelpTooltip :text="trans.ghProxyTip" />
          </label>
          <select v-model="selectedGhProxy" class="form-select">
            <option v-for="option in ghProxyOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
            <option :value="CUSTOM_GH_PROXY_VALUE">{{ trans.custom || 'Custom' }}</option>
          </select>
          <input
            v-if="showCustomGhProxy"
            type="text"
            :value="installGhProxy"
            class="form-input mt-2"
            :placeholder="trans.ghProxyPlaceholder"
            @input="$emit('update:install-gh-proxy', $event.target.value)"
          >
        </div>

        <div class="form-group flex-1">
          <label class="form-label">
            {{ trans.installInstance }}
            <HelpTooltip :text="trans.installInstanceTip" />
          </label>
          <input
            type="text"
            :value="installInstance"
            class="form-input"
            maxlength="32"
            :placeholder="trans.installInstancePlaceholder"
            @input="$emit('update:install-instance', $event.target.value)"
          >
          <p v-if="instanceHasInvalidChars" class="text-red text-sm">{{ trans.instanceNameInvalid }}</p>
        </div>
      </div>

      <div class="config-list">
        <div class="config-row">
          <span class="config-label">{{ trans.collectInterval }}</span>
          <span class="config-value">{{ formatWithUnit(collectInterval, 's') }}</span>
        </div>
        <div class="config-row">
          <span class="config-label">{{ trans.reportInterval }}</span>
          <span class="config-value">{{ formatWithUnit(reportInterval, 's') }}</span>
        </div>
        <div v-if="connectionMode === 'auto'" class="config-row">
          <span class="config-label">{{ trans.wssReportInterval }}</span>
          <span class="config-value">{{ formatWithUnit(wssReportInterval, 's') }}</span>
        </div>
        <div class="config-row">
          <span class="config-label">{{ trans.connectionMode }}</span>
          <span class="config-value">{{ connectionMode === 'http' ? trans.connectionModeHttp : trans.connectionModeAuto }}</span>
        </div>
        <div class="config-row">
          <span class="config-label">{{ trans.pingMode }}</span>
          <span class="config-value">{{ effectivePingMode === 'icmp' ? 'ICMP (root)' : 'TCP' }}</span>
        </div>
        <div class="config-row">
          <span class="config-label">{{ trans.trafficResetDay }}</span>
          <span class="config-value">{{ isBlank(resetDay) ? '-' : resetDay }}</span>
        </div>
        <div class="config-row">
          <span class="config-label">{{ trans.autoUpdate }}</span>
          <span class="config-value">
            <span :class="['config-badge', autoUpdate ? 'is-enabled' : 'is-disabled']">
              {{ autoUpdate ? trans.enabled : trans.disabled }}
            </span>
          </span>
        </div>
        <div class="config-row">
          <span class="config-label">{{ trans.networkInterface }}</span>
          <span class="config-value">{{ isBlank(networkInterface) ? '-' : networkInterface }}</span>
        </div>
        <div class="config-row">
          <span class="config-label">{{ trans.rxCorrection }} (GB)</span>
          <span class="config-value">{{ formatWithUnit(rxCorrection, 'GB') }}</span>
        </div>
        <div class="config-row">
          <span class="config-label">{{ trans.txCorrection }} (GB)</span>
          <span class="config-value">{{ formatWithUnit(txCorrection, 'GB') }}</span>
        </div>
        <div class="config-row">
          <span class="config-label">{{ settings.custom_ct_name || trans.customCt }}</span>
          <span class="config-value">{{ isBlank(customCt) ? '-' : customCt }}</span>
        </div>
        <div class="config-row">
          <span class="config-label">{{ settings.custom_cu_name || trans.customCu }}</span>
          <span class="config-value">{{ isBlank(customCu) ? '-' : customCu }}</span>
        </div>
        <div class="config-row">
          <span class="config-label">{{ settings.custom_cm_name || trans.customCm }}</span>
          <span class="config-value">{{ isBlank(customCm) ? '-' : customCm }}</span>
        </div>
        <div class="config-row">
          <span class="config-label">{{ settings.custom_bd_name || 'BGP' }}</span>
          <span class="config-value">{{ isBlank(customBd) ? '-' : customBd }}</span>
        </div>
        <div v-for="(node, index) in [node1, node2, node3, node4]" :key="index" class="config-row">
          <span class="config-label">{{ settings[`node_${index + 1}_name`] || `Node ${index + 1}` }}</span><span class="config-value">{{ isBlank(node) ? '-' : node }}</span>
        </div>
      </div>

      <div class="form-group">
        <div class="cmd-output-wrapper" :class="{ copied: copiedCmd }">
          <span class="cmd-prompt">{{ targetOs === 'windows' ? 'PS' : '$' }}</span>
          <pre class="cmd-output">{{ installCommand }}</pre>
        </div>
      </div>

      <div class="modal-footer flex-justify-between">
        <div class="flex items-center gap-2">
          <button @click="$emit('copy-cmd')" class="btn btn-primary">{{ copiedCmd ? '✅ ' + trans.copied : '📋 ' + trans.copy }}</button> &nbsp; <button @click="$emit('open-edit-from-copy')" class="btn btn-blue">✏️ {{ trans.edit }}</button>
        </div>
        <button @click="$emit('close')" class="btn">{{ trans.cancel }}</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import HelpTooltip from '../../../components/HelpTooltip.vue'
import { hasInvalidInstanceChars } from '../../../utils/instance-command.js'

const props = defineProps({
  trans: { type: Object, required: true },
  settings: { type: Object, default: () => ({}) },
  show: { type: Boolean, default: false },
  currentServerName: { type: String, default: '' },
  targetOs: { type: String, default: 'linux' },
  installMode: { type: String, default: 'current-user' },
  installGhProxy: { type: String, default: '' },
  installVersion: { type: String, default: '' },
  installInstance: { type: String, default: '' },
  collectInterval: { type: [Number, String], default: 0 },
  reportInterval: { type: [Number, String], default: 60 },
  wssReportInterval: { type: [Number, String], default: 2 },
  connectionMode: { type: String, default: 'auto' },
  pingMode: { type: String, default: 'tcp' },
  customCt: { type: String, default: '' },
  customCu: { type: String, default: '' },
  customCm: { type: String, default: '' },
  customBd: { type: String, default: '' },
  node1: { type: String, default: '' }, node2: { type: String, default: '' }, node3: { type: String, default: '' }, node4: { type: String, default: '' },
  networkInterface: { type: String, default: '' },
  resetDay: { type: [Number, String], default: 1 },
  rxCorrection: { type: [Number, String], default: '' },
  txCorrection: { type: [Number, String], default: '' },
  autoUpdate: { type: Boolean, default: false },
  installCommand: { type: String, default: '' },
  copiedCmd: { type: Boolean, default: false }
})

const emit = defineEmits([
  'close',
  'copy-cmd',
  'open-edit-from-copy',
  'update:target-os',
  'update:install-mode',
  'update:install-gh-proxy',
  'update:install-version',
  'update:install-instance'
])

const CUSTOM_GH_PROXY_VALUE = '__custom__'
const ghProxyOptions = [
  { value: '', label: props.trans.ghProxyPlaceholder || 'Direct' },
  { value: 'https://ghfast.top/', label: 'https://ghfast.top/' },
  { value: 'https://ghproxy.net/', label: 'https://ghproxy.net/' },
  { value: 'https://gh.llkk.cc/', label: 'https://gh.llkk.cc/' },
  { value: 'https://gh-proxy.com/', label: 'https://gh-proxy.com/' }
]

const manualCustomGhProxy = ref(false)
const isKnownGhProxy = (value) => ghProxyOptions.some(option => option.value === String(value || '').trim())

const selectedGhProxy = computed({
  get: () => {
    const currentProxy = String(props.installGhProxy || '').trim()
    if (manualCustomGhProxy.value || (!isKnownGhProxy(currentProxy) && currentProxy)) {
      return CUSTOM_GH_PROXY_VALUE
    }
    return currentProxy
  },
  set: (value) => {
    if (value === CUSTOM_GH_PROXY_VALUE) {
      manualCustomGhProxy.value = true
      if (isKnownGhProxy(props.installGhProxy)) {
        emit('update:install-gh-proxy', '')
      }
      return
    }
    manualCustomGhProxy.value = false
    emit('update:install-gh-proxy', value)
  }
})

const showCustomGhProxy = computed(() => selectedGhProxy.value === CUSTOM_GH_PROXY_VALUE)
const instanceHasInvalidChars = computed(() => hasInvalidInstanceChars(props.installInstance))
const effectivePingMode = computed(() => (
  props.targetOs === 'linux' && props.installMode === 'cfsm-user'
    ? 'tcp'
    : (props.pingMode === 'icmp' ? 'icmp' : 'tcp')
))

watch(
  () => props.show,
  (show) => {
    if (show && isKnownGhProxy(props.installGhProxy)) {
      manualCustomGhProxy.value = false
    }
  }
)

const isBlank = (value) => value === '' || value === null || value === undefined
const formatWithUnit = (value, unit) => (isBlank(value) ? '-' : `${value} ${unit}`)
</script>
