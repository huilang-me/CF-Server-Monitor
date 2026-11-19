<template>
  <div id="autoDiscoveryModal" class="modal-overlay" :class="{ active: show }">
    <div class="modal-dialog">
      <div class="modal-header">
        <div class="modal-title">{{ trans.autoAdd }}</div>
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
          </select>
        </div>

        <div class="form-group flex-1">
          <label class="form-label">{{ trans.serverName }}</label>
          <input
            type="text"
            :value="name"
            class="form-input"
            maxlength="100"
            :placeholder="trans.autoAddNamePlaceholder"
            @input="$emit('update:name', $event.target.value)"
          >
        </div>

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
      </div>

      <div class="form-row">
        <div class="form-group flex-1">
          <label class="form-label">
            Agent {{ trans.version }}
            <HelpTooltip :text="trans.installVersionTip" />
          </label>
          <input
            type="text"
            :value="version"
            class="form-input"
            :placeholder="trans.installVersionPlaceholder"
            @input="$emit('update:version', $event.target.value)"
          >
        </div>

        <div class="form-group flex-1">
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
            :value="ghProxy"
            class="form-input mt-2"
            :placeholder="trans.ghProxyPlaceholder"
            @input="$emit('update:gh-proxy', $event.target.value)"
          >
        </div>

        <div class="form-group flex-1">
          <label class="form-label">
            {{ trans.installInstance }}
            <HelpTooltip :text="trans.installInstanceTip" />
          </label>
          <input
            type="text"
            :value="instance"
            class="form-input"
            maxlength="32"
            :placeholder="trans.installInstancePlaceholder"
            @input="$emit('update:instance', $event.target.value)"
          >
          <p v-if="instanceHasInvalidChars" class="text-red text-sm">{{ trans.instanceNameInvalid }}</p>
        </div>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label class="form-label">&nbsp;</label>
          <div class="checkbox-item no-margin">
            <input
              id="cfg_auto_discovery_auto_update"
              type="checkbox"
              :checked="autoUpdate"
              @change="$emit('update:auto-update', $event.target.checked)"
            >
            <label for="cfg_auto_discovery_auto_update"><b>{{ trans.autoUpdate }}</b></label>
            <HelpTooltip :text="trans.autoUpdateRiskDesc" />
          </div>
        </div>
      </div>

      <div class="form-group">
        <div class="cmd-output-wrapper" :class="{ copied }">
          <span class="cmd-prompt">{{ targetOs === 'windows' ? 'PS' : '$' }}</span>
          <pre class="cmd-output">{{ installCommand }}</pre>
        </div>
      </div>

      <div class="modal-footer flex-justify-between">
        <button @click="$emit('copy-cmd')" class="btn btn-primary">{{ copied ? '✅ ' + trans.copied : '📋 ' + trans.copy }}</button>
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
  show: { type: Boolean, default: false },
  targetOs: { type: String, default: 'linux' },
  name: { type: String, default: '' },
  installMode: { type: String, default: 'current-user' },
  instance: { type: String, default: '' },
  version: { type: String, default: '' },
  autoUpdate: { type: Boolean, default: false },
  ghProxy: { type: String, default: '' },
  installCommand: { type: String, default: '' },
  copied: { type: Boolean, default: false }
})

const emit = defineEmits([
  'close',
  'copy-cmd',
  'update:target-os',
  'update:name',
  'update:install-mode',
  'update:instance',
  'update:version',
  'update:auto-update',
  'update:gh-proxy'
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
    const currentProxy = String(props.ghProxy || '').trim()
    if (manualCustomGhProxy.value || (!isKnownGhProxy(currentProxy) && currentProxy)) {
      return CUSTOM_GH_PROXY_VALUE
    }
    return currentProxy
  },
  set: (value) => {
    if (value === CUSTOM_GH_PROXY_VALUE) {
      manualCustomGhProxy.value = true
      if (isKnownGhProxy(props.ghProxy)) {
        emit('update:gh-proxy', '')
      }
      return
    }
    manualCustomGhProxy.value = false
    emit('update:gh-proxy', value)
  }
})

const showCustomGhProxy = computed(() => selectedGhProxy.value === CUSTOM_GH_PROXY_VALUE)
const instanceHasInvalidChars = computed(() => hasInvalidInstanceChars(props.instance))

watch(
  () => props.show,
  (show) => {
    if (show && isKnownGhProxy(props.ghProxy)) {
      manualCustomGhProxy.value = false
    }
  }
)
</script>
