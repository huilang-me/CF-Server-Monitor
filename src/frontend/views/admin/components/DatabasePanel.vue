<template>
  <div id="tab-database" class="tab-content" :class="{ active: activeTab === 'database' }">
    <div class="settings-section">
      <div class="section-title"><span>▸</span> {{ trans.dbManagement }}</div>

      <div class="settings-grid">
        <div class="form-group">
          <button @click="$emit('open-db-modal', 'upgrade')" class="btn btn-primary btn-lg" :disabled="dbLoading">⬆️ {{ trans.upgradeDatabase }}</button>
          <p class="text-muted text-sm mt-2">{{ trans.upgradeDesc }}</p>
        </div>

        <div class="form-group">
          <button @click="$emit('open-db-modal', 'clearHistory')" class="btn btn-red btn-lg" :disabled="dbLoading">🗑️ {{ trans.clearHistory }}</button>
          <p class="text-muted text-sm mt-2">{{ trans.clearHistoryDesc }}</p>
        </div>
      </div>
    </div>

    <div class="settings-section">
      <div class="section-title"><span>▸</span> {{ trans.exportServers }} / {{ trans.importServers }}</div>

      <div class="settings-grid">
        <div class="form-group">
          <button @click="handleExport" class="btn btn-primary btn-lg" :disabled="dbLoading || exporting">
            {{ exporting ? trans.exporting : '📤 ' + trans.exportServers }}
          </button>
          <p v-if="exportNotice" class="text-sm mt-2" :style="{ color: exportNotice.success ? 'var(--accent-green)' : 'var(--accent-red)' }">
            {{ exportNotice.success ? '✅' : '❌' }} {{ exportNotice.text }}
          </p>
        </div>

        <div class="form-group">
          <input
            ref="fileInput"
            type="file"
            accept=".json"
            style="display: none"
            @change="handleFileSelect"
          />
          <button @click="$refs.fileInput.click()" class="btn btn-lg" :disabled="dbLoading || importing">
            {{ importing ? trans.importing : '📥 ' + trans.importServers }}
          </button>
        </div>
      </div>

      <p class="text-muted text-sm mt-2">{{ trans.importSettingsNote }}</p>

      <div v-if="importResult" class="mt-3">
        <div :class="importResult.success ? 'warning-box' : 'danger-box'" class="mb-2">
          <div class="flex-center-gap-sm">
            <span :style="{ color: importResult.success ? 'var(--accent-green)' : 'var(--accent-red)', fontWeight: '600' }">
              {{ importResult.success ? '✅' : '❌' }} {{ trans.importResult }}
            </span>
          </div>
          <div class="mt-2 text-sm">
            <span style="color: var(--accent-green)">{{ trans.importedCount }}: {{ importResult.imported }}</span>
            <span class="ml-3" style="color: var(--accent-yellow)">{{ trans.skippedCount }}: {{ importResult.skipped }}</span>
          </div>
          <div v-if="importResult.skippedIds && importResult.skippedIds.length > 0" class="mt-2 text-sm text-muted">
            {{ trans.skippedIds }}: {{ importResult.skippedIds.join(', ') }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { adminApi } from '../../../utils/api'
import { parseServerBackup } from '../../../utils/backup'

const props = defineProps({
  trans: { type: Object, required: true },
  activeTab: { type: String, default: 'database' },
  dbLoading: { type: Boolean, default: false },
  selectedApiIndex: { type: Number, default: 0 }
})

defineEmits(['open-db-modal'])

const fileInput = ref(null)
const exporting = ref(false)
const importing = ref(false)
const importResult = ref(null)
const exportNotice = ref(null)

const emptyResult = () => ({ success: false, imported: 0, skipped: 0, skippedIds: [] })

const handleExport = async () => {
  exporting.value = true
  importResult.value = null
  exportNotice.value = null
  try {
    const result = await adminApi({ action: 'export_servers' }, props.selectedApiIndex)
    if (result.error || !result.data || !Array.isArray(result.data.servers)) {
      // 后端返回的是错误码，能翻译就翻译，不能就用通用失败文案
      exportNotice.value = {
        success: false,
        text: props.trans[result.error] || props.trans.serversExportFailed
      }
      return
    }

    // 服务器 + 站点/外观设置打成一个文件；环境相关字段由后端过滤，不会写进备份。
    const payload = {
      format: 'cfsm-backup',
      version: 1,
      exported_at: new Date().toISOString(),
      servers: result.data.servers,
      settings: result.data.settings || null
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `cfsm-backup-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    exportNotice.value = { success: true, text: props.trans.serversExported }
  } catch (e) {
    console.error('Export failed:', e)
    exportNotice.value = { success: false, text: props.trans.serversExportFailed }
  } finally {
    exporting.value = false
  }
}

const handleFileSelect = async (event) => {
  const file = event.target.files[0]
  if (!file) return

  importing.value = true
  importResult.value = null

  try {
    const text = await file.text()
    // 旧版纯服务器数组与新备份 { servers, settings } 都支持
    const { servers, settings } = parseServerBackup(text)

    if (servers.length === 0 && !settings) {
      importResult.value = emptyResult()
      return
    }

    const result = await adminApi({ action: 'import_servers', servers, settings }, props.selectedApiIndex)
    if (!result.error && result.data) {
      importResult.value = {
        success: result.data.success,
        imported: result.data.imported || 0,
        skipped: result.data.skipped || 0,
        skippedIds: result.data.skippedIds || []
      }
      if (result.data.imported > 0 || result.data.settings?.imported) {
        window.location.reload()
      }
    } else {
      importResult.value = emptyResult()
    }
  } catch (e) {
    console.error('Import failed:', e)
    importResult.value = emptyResult()
  } finally {
    importing.value = false
    if (fileInput.value) {
      fileInput.value.value = ''
    }
  }
}
</script>
