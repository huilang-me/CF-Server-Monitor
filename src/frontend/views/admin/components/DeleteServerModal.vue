<template>
  <div id="deleteModal" class="modal-overlay" :class="{ active: show }">
    <div class="modal-dialog">
      <div class="modal-header">
        <div class="modal-title">{{ currentServerName }}</div>
        <button class="modal-close" @click="$emit('close')">✕</button>
      </div>
      <input type="hidden" :value="deleteServerId">

      <div class="mb-4">
        <div class="flex-center-gap-sm mb-3">
          <span class="danger-icon text-xl">⚠️</span>
          <span class="danger-label">{{ trans.dangerWarning }}</span>
        </div>
        <p class="text-secondary text-sm line-height-1-6">
          {{ trans.deleteConfirm }}
          <br><br>
          <strong class="text-primary">{{ trans.recommendUninstall }}：</strong>
        </p>
      </div>
  
      <div class="form-row">
        <div class="form-group flex-1 mb-3">
          <label class="form-label">{{ trans.targetOs }}</label>
          <select :value="deleteTargetOs" class="form-select" @change="$emit('update:delete-target-os', $event.target.value)">
            <option value="linux">Linux (systemd)</option>
            <option value="unix">OpenWrt/Alpine/Synology DSM/FreeBSD</option>
            <option value="mac">macOS</option>
            <option value="windows">Windows</option>
          </select>
        </div>

        <div class="form-group flex-1 mb-3">
          <label class="form-label">{{ trans.agentVersionSelect }}</label>
          <select :value="deleteVersion" class="form-select" @change="$emit('update:delete-version', $event.target.value)">
            <option value="go">{{ trans.agentVersionGo }}</option>
            <option value="shell">{{ trans.agentVersionShell }}</option>
          </select>
        </div>
      </div>

      <div v-if="deleteVersion === 'go'" class="form-row">
        <div v-if="deleteTargetOs === 'linux' && deleteVersion === 'go'" class="form-group flex-1 mb-3">
          <label class="form-label">
            {{ trans.uninstallMode }}
          </label>
          <select :value="deleteInstallMode" class="form-select" @change="$emit('update:delete-install-mode', $event.target.value)">
            <option value="current-user">{{ trans.uninstallModeCurrentUser }}</option>
            <option value="cfsm-user">{{ trans.uninstallModeCfsmUser }}</option>
          </select>
        </div>

        <div class="form-group flex-1 mb-3">
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
            :value="deleteGhProxy"
            class="form-input mt-2"
            :placeholder="trans.ghProxyPlaceholder"
            @input="$emit('update:delete-gh-proxy', $event.target.value)"
          >
        </div>
      </div>

      <div v-if="deleteVersion === 'go'" class="form-row">
        <div class="form-group flex-1 mb-3">
          <label class="form-label">
            {{ trans.installInstance }}
            <HelpTooltip :text="trans.installInstanceTip" />
          </label>
          <input
            type="text"
            :value="deleteInstance"
            class="form-input"
            maxlength="32"
            :disabled="deleteAllInstances"
            :placeholder="trans.installInstancePlaceholder"
            @input="$emit('update:delete-instance', $event.target.value)"
          >
          <p v-if="instanceHasInvalidChars && !deleteAllInstances" class="text-red text-sm">{{ trans.instanceNameInvalid }}</p>
        </div>

        <div class="form-group">
          <label class="form-label">&nbsp;</label>
          <div class="checkbox-item no-margin">
            <input
              id="cfg_delete_all_instances"
              type="checkbox"
              :checked="deleteAllInstances"
              @change="$emit('update:delete-all-instances', $event.target.checked)"
            >
            <label for="cfg_delete_all_instances"><b>{{ trans.uninstallAllInstances }}</b></label>
            <HelpTooltip :text="trans.uninstallAllInstancesTip" />
          </div>
        </div>
      </div>

      <div class="cmd-input-wrapper mb-3" :class="{ copied: uninstallCopied }">
        <span class="cmd-prompt">{{ deleteTargetOs === 'windows' ? 'PS' : '$' }}</span>
        <textarea
          v-if="deleteTargetOs === 'linux' && deleteVersion === 'go' && deleteInstallMode === 'cfsm-user'"
          readonly
          :value="uninstallCommand"
          class="cmd-input flex-1"
          rows="8"
        />
        <input v-else type="text" readonly :value="uninstallCommand" class="cmd-input flex-1">
        <button @click="$emit('copy-uninstall')" class="btn btn-icon btn-green ml-2" :aria-label="trans.copy">{{ uninstallCopied ? '✅' : '📋' }}</button>
      </div>

      <div class="modal-footer flex-justify-between">
        <button @click="$emit('confirm-delete')" class="btn btn-red">{{ trans.confirmDelete }}</button>
        <button @click="$emit('close')" class="btn">{{ trans.cancelAction }}</button>
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
  deleteServerId: { type: [String, Number], default: '' },
  currentServerName: { type: String, default: '' },
  deleteTargetOs: { type: String, default: 'linux' },
  deleteVersion: { type: String, default: 'go' },
  deleteInstallMode: { type: String, default: 'current-user' },
  deleteGhProxy: { type: String, default: '' },
  deleteInstance: { type: String, default: '' },
  deleteAllInstances: { type: Boolean, default: false },
  uninstallCommand: { type: String, default: '' },
  uninstallCopied: { type: Boolean, default: false }
})

const emit = defineEmits([
  'close',
  'confirm-delete',
  'copy-uninstall',
  'update:delete-target-os',
  'update:delete-version',
  'update:delete-install-mode',
  'update:delete-gh-proxy',
  'update:delete-instance',
  'update:delete-all-instances'
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
    const currentProxy = String(props.deleteGhProxy || '').trim()
    if (manualCustomGhProxy.value || (!isKnownGhProxy(currentProxy) && currentProxy)) {
      return CUSTOM_GH_PROXY_VALUE
    }
    return currentProxy
  },
  set: (value) => {
    if (value === CUSTOM_GH_PROXY_VALUE) {
      manualCustomGhProxy.value = true
      if (isKnownGhProxy(props.deleteGhProxy)) {
        emit('update:delete-gh-proxy', '')
      }
      return
    }
    manualCustomGhProxy.value = false
    emit('update:delete-gh-proxy', value)
  }
})

const showCustomGhProxy = computed(() => selectedGhProxy.value === CUSTOM_GH_PROXY_VALUE)
const instanceHasInvalidChars = computed(() => hasInvalidInstanceChars(props.deleteInstance))

watch(
  () => props.show,
  (show) => {
    if (show && isKnownGhProxy(props.deleteGhProxy)) {
      manualCustomGhProxy.value = false
    }
  }
)
</script>
