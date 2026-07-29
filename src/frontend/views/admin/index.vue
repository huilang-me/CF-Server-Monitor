<template>
  <div>
    <AdminLogin
      v-if="!isLoggedIn"
      :trans="trans"
      :is-multiple-mode="isMultipleMode"
      :api-bases="apiBases"
      :selected-api-index="selectedApiIndex"
      :login-form="loginForm"
      :password-visible="passwordVisible"
      :login-error="loginError"
      :login-loading="loginLoading"
      :turnstile-site-key="turnstileSiteKey"
      :turnstile-login-enabled="turnstileLoginEnabled"
      :turnstile-enabled="turnstileEnabled"
      :turnstile-verified="turnstileVerified"
      @login="handleLogin"
      @toggle-password="togglePassword"
      @api-index-change="handleApiIndexChange"
    />

    <div v-else class="container admin-container" id="admin-content">
      <TerminalHeader :title="trans.adminPanel" />
      <div v-if="adminSiteLoading" class="admin-loading-overlay">
        <div class="loading-content">
          <div class="loading-spinner"></div>
          <div class="loading-text">$ {{ trans.switchingSite }}</div>
        </div>
      </div>

      <div class="main-panel">
        <div class="panel-header">
          <div class="panel-title">
            <span class="prompt">$</span> {{ trans.sudoStatus }}
          </div>
          <div class="header-actions">
            <button @click="refreshServers" class="btn" :disabled="adminSiteLoading">↻ {{ trans.refresh }}</button>
            <select
              v-if="isMultipleMode"
              v-model.number="selectedApiIndex"
              class="form-select admin-site-select"
              :title="trans.apiEndpoint"
              :disabled="adminSiteLoading"
              @change="handleAdminApiIndexChange"
            >
              <option
                v-for="(base, index) in apiBases"
                :key="index"
                :value="index"
              >
                [{{ index }}] {{ base }}
              </option>
            </select>
            <button @click="logout" class="btn btn-red">🚪 {{ trans.logout }}</button>
          </div>
        </div>

        <div class="stats-grid" id="stats-panel">
          <div class="stat-card">
            <div class="stat-main-value" id="stat-total">{{ stats.total }}</div>
            <div class="stat-label">{{ trans.totalServers }}</div>
          </div>
          <div class="stat-card">
            <div class="stat-main-value" id="stat-online">{{ stats.online }}</div>
            <div class="stat-label">{{ trans.online }}</div>
          </div>
          <div class="stat-card">
            <div class="stat-main-value" id="stat-offline">{{ stats.offline }}</div>
            <div class="stat-label">{{ trans.offline }}</div>
          </div>
          <div class="stat-card">
            <div class="stat-main-value" id="stat-avg-cpu">{{ stats.avg_cpu }}%</div>
            <div class="stat-label">{{ trans.avgCpu }}</div>
          </div>
        </div>
      </div>

      <div class="main-panel">
        <div class="tabs">
          <button
            class="tab-btn"
            :class="{ active: activeTab === 'servers' }"
            @click="activeTab = 'servers'"
          >▸ {{ trans.servers }}</button>
          <button
            class="tab-btn"
            :class="{ active: activeTab === 'settings' }"
            @click="activeTab = 'settings'"
          >▸ {{ trans.settings }}</button>
          <button
            class="tab-btn"
            :class="{ active: activeTab === 'database' }"
            @click="activeTab = 'database'"
          >▸ {{ trans.dbManagement }}</button>
          <button
            class="tab-btn"
            :class="{ active: activeTab === 'themeStore' }"
            @click="activeTab = 'themeStore'"
          >▸ {{ trans.themeStore }}</button>
        </div>

        <ServerTable
          v-model:new-server-name="newServerName"
          v-model:new-server-group="newServerGroup"
          :trans="trans"
          :servers="servers"
          :selected-servers="selectedServers"
          :groups="groups"
          :active-tab="activeTab"
          :selected-api-index="selectedApiIndex"
          :theme-url="settings.theme_url"
          :latest-agent-version="latestAgentVersion"
          :copied-server-id="copiedServerId"
          :copied-note-server-id="copiedNoteServerId"
          :copied-spec-key="copiedSpecKey"
          @add-server="addServer"
          @batch-delete="batchDelete"
          @toggle-select-all="toggleSelectAll"
          @select-all="handleSelectAll"
          @drag-start="handleDragStart"
          @drop="handleDrop"
          @toggle-server="toggleServer"
          @copy-note="copyServerNote"
          @copy-spec="copyServerSpec"
          @copy-cmd="copyCmd"
          @edit="openEditModal"
          @delete="openDeleteModal"
        />

        <SettingsPanel
          ref="settingsPanelRef"
          :trans="trans"
          :settings="settings"
          :servers="servers"
          :password-visible="passwordVisible"
          :active-tab="activeTab"
          :selected-api-base="selectedApiBase"
          :current-origin="currentOrigin"
          :saving="saving"
          :change-admin-password="changeAdminPassword"
          :test-notification-loading="testNotificationLoading"
          :d1-usage-loading="d1UsageLoading"
          @toggle-password="togglePassword"
          @toggle-admin-password-change="toggleAdminPasswordChange"
          @save-settings="saveSettings"
          @upload-bg="uploadBg"
          @upload-favicon="uploadFavicon"
          @send-test-notification="sendTestNotification"
          @query-d1-usage="queryD1Usage"
        />

        <DatabasePanel
          :trans="trans"
          :active-tab="activeTab"
          :db-loading="dbLoading"
          :selected-api-index="selectedApiIndex"
          @open-db-modal="openDbModal"
        />

        <ThemeStorePanel
          :trans="trans"
          :active-tab="activeTab"
          :selected-api-index="selectedApiIndex"
          :current-theme-url="settings.theme_url"
          @theme-applied="settings.theme_url = $event"
        />
      </div>

      <EditServerModal
        :trans="trans"
        :show="showEditModal"
        v-model:edit-form="editForm"
        :current-server-name="currentServerName"
        :settings="settings"
        @save="saveEdit"
        @close="closeEditModal"
        @toggle-auto-update="handleAutoUpdateToggle"
      />

      <div v-if="showAutoUpdateWarning" id="autoUpdateWarningModal" class="modal-overlay auto-update-warning-modal active">
        <div class="modal-dialog">
          <div class="modal-header">
            <div class="modal-title">{{ trans.autoUpdateRiskTitle }}</div>
            <button class="modal-close" @click="cancelAutoUpdateWarning">✕</button>
          </div>

          <div class="danger-box mb-4">
            <div class="flex-center-gap-sm mb-2">
              <span class="danger-icon text-xl">⚠️</span>
              <span class="danger-label">{{ trans.autoUpdateRiskTitle }}</span>
            </div>
            <p class="text-secondary text-sm line-height-1-6">
              {{ trans.autoUpdateRiskDesc }}
            </p>
          </div>

          <div class="modal-footer flex-justify-between">
            <button @click="confirmAutoUpdateWarning" class="btn btn-primary">{{ trans.autoUpdateRiskConfirm }}</button>
            <button @click="cancelAutoUpdateWarning" class="btn">{{ trans.autoUpdateRiskCancel }}</button>
          </div>
        </div>
      </div>

      <DeleteServerModal
        :trans="trans"
        :show="showDeleteModal"
        :delete-server-id="deleteServerId"
        :current-server-name="currentServerName"
        :delete-target-os="deleteTargetOs"
        :uninstall-command="getUninstallCommand()"
        :uninstall-copied="uninstallCopied"
        @close="closeDeleteModal"
        @confirm-delete="confirmDelete"
        @copy-uninstall="copyUninstallCmd"
        @update:delete-target-os="deleteTargetOs = $event"
      />

      <CopyCommandModal
        :trans="trans"
        :show="showCopyModal"
        :current-server-name="currentServerName"
        :target-os="targetOs"
        :collect-interval="collectInterval"
        :report-interval="reportInterval"
        :custom-ct="customCt"
        :custom-cu="customCu"
        :custom-cm="customCm"
        :custom-bd="customBd"
        :reset-day="resetDay"
        :rx-correction="rxCorrection"
        :tx-correction="txCorrection"
        :auto-update="autoUpdate"
        :install-command="getCustomInstallCommand()"
        :copied-cmd="copiedCmd"
        @close="closeCopyModal"
        @copy-cmd="copyCustomCmd"
        @update:target-os="targetOs = $event"
        @open-edit-from-copy="openEditModalFromCopy"
      />

      <div id="dbModal" class="modal-overlay" :class="{ active: showDbModal }">
        <div class="modal-dialog">
          <div class="modal-header">
            <div class="modal-title">$ {{ dbOperation === 'clearHistory' ? 'CLEAR HISTORY' : 'ALTER DATABASE' }}</div>
            <button class="modal-close" @click="closeDbModal" :disabled="dbLoading">✕</button>
          </div>

          <div v-if="dbOperation === 'clearHistory'" class="mb-4">
            <div class="flex-center-gap-sm mb-3">
              <span class="danger-icon text-xl">⚠️</span>
              <span class="danger-label">{{ trans.dangerOperation }}</span>
            </div>
            <p class="text-secondary text-sm line-height-1-6">
              {{ trans.clearHistoryWarning }}
            </p>
          </div>

          <div v-if="dbOperation === 'upgrade'" class="mb-4">
            <div class="flex-center-gap-sm mb-3">
              <span class="warning-icon text-xl">ℹ️</span>
              <span style="color: var(--accent-yellow); font-weight: 600;">{{ trans.upgradeDatabase }}</span>
            </div>
            <p class="text-secondary text-sm line-height-1-6">
              {{ trans.upgradeDesc }}
            </p>
          </div>

          <div v-if="dbResult" :class="dbResult.success ? 'warning-box' : 'danger-box'" class="mb-4">
            <div class="flex-center-gap-sm">
              <span :style="{ color: dbResult.success ? 'var(--accent-green)' : 'var(--accent-red)', fontWeight: '600' }">
                {{ dbResult.success ? '✅' : '❌' }} {{ getMessage(dbResult.message) || (dbResult.success ? trans.operationSuccess : trans.operationFailed) }}
              </span>
            </div>
            <div v-if="dbResult.error" class="text-red mt-2">
              {{ getMessage(dbResult.error) }}
            </div>
          </div>

          <div v-if="!(dbResult && dbResult.success)" class="modal-footer flex-justify-between">
            <button
              v-if="!dbResult"
              @click="dbOperation === 'clearHistory' ? handleClearHistory() : handleUpgradeDatabase()"
              class="btn btn-red"
              :disabled="dbLoading"
            >
              {{ dbLoading ? (dbOperation === 'clearHistory' ? trans.clearing : trans.upgrading) : (dbOperation === 'clearHistory' ? trans.confirmClear : trans.upgradeDatabase) }}
            </button>
            <button @click="closeDbModal" class="btn" :disabled="dbLoading">{{ trans.cancel }}</button>
          </div>
        </div>
      </div>

      <div v-if="d1UsageResult" id="d1UsageModal" class="modal-overlay active">
        <div class="modal-dialog">
          <div class="modal-header">
            <div class="modal-title">$ D1 & Workers quota --utc</div>
            <button class="modal-close" @click="d1UsageResult = null">✕</button>
          </div>

          <div v-if="d1UsageResult.success" class="mb-4">
            <div class="warning-box mb-4">
              {{ getMessage(d1UsageResult.message) || trans.d1UsageQueried }}
            </div>
            <div class="quota-section">
              <div class="quota-section-title">{{ trans.todayUsage }}</div>
              <div class="quota-progress-list">
                <div class="quota-progress-item">
                  <div class="flex-justify-between text-sm mb-1">
                    <span>{{ trans.d1RowsRead }}：{{ formatNumber(d1UsageResult.usage.today.rowsRead) }} / {{ formatNumber(5000000) }}</span>
                    <span>{{ getUsagePercent(d1UsageResult.usage.today.rowsRead, 5000000) }}%</span>
                  </div>
                  <div class="quota-progress-bar">
                    <div class="quota-progress-fill" :style="{ width: getUsagePercent(d1UsageResult.usage.today.rowsRead, 5000000) + '%' }"></div>
                  </div>
                </div>
                <div class="quota-progress-item">
                  <div class="flex-justify-between text-sm mb-1">
                    <span>{{ trans.d1RowsWritten }}：{{ formatNumber(d1UsageResult.usage.today.rowsWritten) }} / {{ formatNumber(100000) }}</span>
                    <span>{{ getUsagePercent(d1UsageResult.usage.today.rowsWritten, 100000) }}%</span>
                  </div>
                  <div class="quota-progress-bar">
                    <div class="quota-progress-fill" :style="{ width: getUsagePercent(d1UsageResult.usage.today.rowsWritten, 100000) + '%' }"></div>
                  </div>
                </div>
                <div class="quota-progress-item">
                  <div class="flex-justify-between text-sm mb-1">
                    <span>{{ trans.workersRequests }}：{{ formatNumber(d1UsageResult.usage.today.workersRequests) }} / {{ formatNumber(100000) }}</span>
                    <span>{{ getUsagePercent(d1UsageResult.usage.today.workersRequests, 100000) }}%</span>
                  </div>
                  <div v-if="d1UsageResult.usage.today.workersRequests" class="quota-progress-bar">
                    <div class="quota-progress-fill" :style="{ width: getUsagePercent(d1UsageResult.usage.today.workersRequests, 100000) + '%' }"></div>
                  </div>
                </div>
              </div>
            </div>

            <div class="quota-section mt-4">
              <div class="quota-section-title">{{ trans.last24HoursUsage }}</div>
              <div class="quota-progress-list">
                <div class="quota-progress-item">
                  <div class="flex-justify-between text-sm mb-1">
                    <span>{{ trans.d1RowsRead }}：{{ formatNumber(d1UsageResult.usage.last24Hours.rowsRead) }} / {{ formatNumber(5000000) }}</span>
                    <span>{{ getUsagePercent(d1UsageResult.usage.last24Hours.rowsRead, 5000000) }}%</span>
                  </div>
                  <div class="quota-progress-bar">
                    <div class="quota-progress-fill" :style="{ width: getUsagePercent(d1UsageResult.usage.last24Hours.rowsRead, 5000000) + '%' }"></div>
                  </div>
                </div>
                <div class="quota-progress-item">
                  <div class="flex-justify-between text-sm mb-1">
                    <span>{{ trans.d1RowsWritten }}：{{ formatNumber(d1UsageResult.usage.last24Hours.rowsWritten) }} / {{ formatNumber(100000) }}</span>
                    <span>{{ getUsagePercent(d1UsageResult.usage.last24Hours.rowsWritten, 100000) }}%</span>
                  </div>
                  <div class="quota-progress-bar">
                    <div class="quota-progress-fill" :style="{ width: getUsagePercent(d1UsageResult.usage.last24Hours.rowsWritten, 100000) + '%' }"></div>
                  </div>
                </div>
                <div v-if="d1UsageResult.usage.last24Hours.workersRequests" class="quota-progress-item">
                  <div class="flex-justify-between text-sm mb-1">
                    <span>{{ trans.workersRequests }}：{{ formatNumber(d1UsageResult.usage.last24Hours.workersRequests) }} / {{ formatNumber(100000) }}</span>
                    <span>{{ getUsagePercent(d1UsageResult.usage.last24Hours.workersRequests, 100000) }}%</span>
                  </div>
                  <div class="quota-progress-bar">
                    <div class="quota-progress-fill" :style="{ width: getUsagePercent(d1UsageResult.usage.last24Hours.workersRequests, 100000) + '%' }"></div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div v-else class="danger-box mb-4">
            {{ getMessage(d1UsageResult.error) }}
          </div>

          <div class="modal-footer flex-justify-between">
            <div></div>
            <button @click="d1UsageResult = null" class="btn">{{ trans.close }}</button>
          </div>
        </div>
      </div>

      <div v-if="validationError" id="validationErrorModal" class="modal-overlay active">
        <div class="modal-dialog">
          <div class="modal-header">
            <div class="modal-title">$ {{ trans.validationError }}</div>
            <button class="modal-close" @click="validationError = null">✕</button>
          </div>

          <div class="danger-box mb-4">
            <div class="flex-center-gap-sm">
              <span class="danger-icon text-xl">⚠️</span>
              <span class="danger-label">{{ validationError }}</span>
            </div>
          </div>

          <div class="modal-footer flex-justify-between">
            <div></div>
            <button @click="validationError = null" class="btn">{{ trans.close }}</button>
          </div>
        </div>
      </div>

      <div v-if="saveResult" class="modal-overlay active">
        <div class="modal-dialog">
          <div class="modal-header">
            <div class="modal-title">$ save --result</div>
            <button class="modal-close" @click="saveResult = null">✕</button>
          </div>

          <div v-if="saveResult.success" class="success-box mb-4">
            <div class="flex-center-gap-sm">
              <span style="color: var(--accent-green); font-weight: 600;">
                ✅ {{ saveResult.message || trans.saveSuccess }}
              </span>
            </div>
          </div>

          <div v-else class="danger-box mb-4">
            <div class="flex-center-gap-sm">
              <span class="danger-label">❌ {{ saveResult.error }}</span>
            </div>
          </div>

          <div class="modal-footer flex-justify-between">
            <div></div>
            <button @click="saveResult = null" class="btn">{{ trans.close }}</button>
          </div>
        </div>
      </div>

      <div v-if="alertMessage" class="modal-overlay active">
        <div class="modal-dialog">
          <div class="modal-header">
            <div class="modal-title">$ alert</div>
            <button class="modal-close" @click="alertMessage = null">✕</button>
          </div>

          <div class="mb-4">
            <p class="text-secondary text-sm">{{ alertMessage }}</p>
          </div>

          <div class="modal-footer flex-justify-between">
            <div></div>
            <button @click="alertMessage = null" class="btn">{{ trans.close }}</button>
          </div>
        </div>
      </div>

      <Footer />
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import TerminalHeader from '../../components/TerminalHeader.vue'
import Footer from '../../components/Footer.vue'
import AdminLogin from './components/AdminLogin.vue'
import ServerTable from './components/ServerTable.vue'
import SettingsPanel from './components/SettingsPanel.vue'
import DatabasePanel from './components/DatabasePanel.vue'
import ThemeStorePanel from './components/ThemeStorePanel.vue'
import EditServerModal from './components/EditServerModal.vue'
import DeleteServerModal from './components/DeleteServerModal.vue'
import CopyCommandModal from './components/CopyCommandModal.vue'
import { adminApi, login, logout as apiLogout, upgradeDatabase, clearHistory, getApiBases, fetchConfig } from '../../utils/api'
import { hasMultipleApiBases } from '../../utils/config.js'
import { t, useTranslation } from '../../utils/i18n'
import { PING_NODE_FIELDS, validatePingNode } from '../../utils/pingNode.js'
import { normalizeDisplayMode, resolveDisplayMode } from '../../utils/displayMode.js'
import { HISTORY } from '../../utils/constants.js'
import { usePasswordVisibility } from '../../composables/usePasswordVisibility'
import { useTurnstile } from './composables/useTurnstile'
import { detectBillingCycle, detectCurrencySymbol, normalizeBillingCycle, normalizeCurrency, normalizePrice, renewExpireDateIfNeeded } from '../../utils/server.js'

const trans = useTranslation()
const route = useRoute()
const router = useRouter()

const getMessage = (msg) => {
  if (typeof msg === 'string') {
    const translated = t(msg)
    return translated !== msg ? translated : msg
  }
  return ''
}

const normalizeTgNotifySetting = (value) => {
  if (value === true || value === 'true') return '5'
  if (value === false || value === 'false' || value === undefined || value === null || value === '') return '0'

  const minutes = Number(value)
  if (Number.isInteger(minutes) && (minutes === 0 || (minutes >= 2 && minutes <= 30))) {
    return String(minutes)
  }

  return '0'
}

const isTgNotifyEnabled = (value) => normalizeTgNotifySetting(value) !== '0'

const normalizeExpireReminderSetting = (value) => {
  if (value === true || value === 'true') return '7'
  if (value === false || value === 'false' || value === undefined || value === null || value === '') return '0'

  const days = Number(value)
  if (Number.isInteger(days) && days >= 0 && days <= 7) {
    return String(days)
  }

  return '0'
}

const isExpireReminderEnabled = (value) => normalizeExpireReminderSetting(value) !== '0'

const normalizeLongHistoryPointsSetting = (value) => {
  const points = Number(value)
  return String(
    HISTORY.LONG_RANGE_POINT_OPTIONS.includes(points)
      ? points
      : HISTORY.DEFAULT_LONG_RANGE_POINTS
  )
}

const normalizeResourceAlertModeSetting = (value) => {
  const mode = String(value || '').trim().toLowerCase()
  return mode === 'continuous' ? 'continuous' : 'average'
}

const normalizeResourceAlertIntervalSetting = (value) => {
  const minutes = Number(value)
  if (Number.isInteger(minutes) && minutes >= 5 && minutes <= 10) {
    return String(minutes)
  }
  return '5'
}

const normalizeResourceAlertMetricSetting = (value) => {
  const metric = String(value || '').trim()
  return ['cpu', 'ram', 'disk', 'netIn', 'netOut'].includes(metric) ? metric : 'cpu'
}

const defaultResourceAlertThreshold = (metric) => (
  metric === 'netIn' || metric === 'netOut' ? '100' : '80'
)

const normalizeResourceAlertThresholdSetting = (value, metric) => {
  if (value === undefined || value === null || value === '') return defaultResourceAlertThreshold(metric)
  const number = Number(value)
  const max = metric === 'netIn' || metric === 'netOut' ? 100000 : 100
  if (!Number.isFinite(number) || number <= 0 || number > max) return defaultResourceAlertThreshold(metric)
  return String(Math.round(number * 100) / 100)
}

const normalizeResourceAlertServersSetting = (value) => {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  return value.map(item => String(item || '').trim()).filter(id => {
    if (!id || id.length > 64 || !/^[A-Za-z0-9._:-]+$/.test(id) || seen.has(id)) return false
    seen.add(id)
    return true
  })
}

const normalizeResourceAlertRulesSetting = (value) => {
  let rules = Array.isArray(value) ? value : []
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value)
      rules = Array.isArray(parsed) ? parsed : []
    } catch (_) {
      rules = []
    }
  }
  return rules.map((rule, index) => {
    const metric = normalizeResourceAlertMetricSetting(rule?.metric)
    return {
      id: String(rule?.id || `rule_${index + 1}`).replace(/[^A-Za-z0-9._:-]/g, '').slice(0, 64) || `rule_${index + 1}`,
      name: String(rule?.name || '').trim().slice(0, 80) || `Resource Alert ${index + 1}`,
      metric,
      threshold: normalizeResourceAlertThresholdSetting(rule?.threshold, metric),
      servers: normalizeResourceAlertServersSetting(rule?.servers || rule?.serverIds),
      intervalMinutes: normalizeResourceAlertIntervalSetting(rule?.intervalMinutes || rule?.windowMinutes),
      mode: normalizeResourceAlertModeSetting(rule?.mode)
    }
  }).slice(0, 20)
}

const isResourceAlertEnabled = (rules) => normalizeResourceAlertRulesSetting(rules).length > 0

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

const formatThemeOptions = (value) => {
  const normalized = value === undefined || value === null ? {} : value
  try {
    return JSON.stringify(normalized, null, 2)
  } catch (_) {
    return '{}'
  }
}

const parseThemeOptions = (value) => {
  const raw = String(value || '').trim()
  if (!raw) return { valid: true, value: {} }
  try {
    const parsed = JSON.parse(raw)
    if (!isPlainObject(parsed)) {
      return { valid: false }
    }
    return { valid: true, value: parsed }
  } catch (_) {
    return { valid: false }
  }
}

const formatNumber = (value) => Number(value || 0).toLocaleString()
const getUsagePercent = (used, limit) => {
  if (!limit) return 0
  return Math.min(100, Number(((Number(used || 0) / Number(limit)) * 100).toFixed(2)))
}

const isMultipleMode = computed(() => hasMultipleApiBases())
const apiBases = getApiBases()
const normalizeApiIndex = (value) => {
  const index = parseInt(value, 10)
  if (Number.isNaN(index) || index < 0 || index >= apiBases.length) return 0
  return index
}
const selectedApiIndex = ref(normalizeApiIndex(route.query.apiIndex))
const selectedApiBase = computed(() => apiBases[selectedApiIndex.value] || apiBases[0])
const currentOrigin = computed(() => window.location.origin)

const syncApiIndexQuery = () => {
  if (!isMultipleMode.value) return
  if (String(route.query.apiIndex ?? '') === String(selectedApiIndex.value)) return
  router.replace({
    path: '/admin',
    query: {
      ...route.query,
      apiIndex: String(selectedApiIndex.value)
    }
  })
}

const adminApiForSite = (data) => adminApi(data, selectedApiIndex.value)

const isLoggedIn = ref(false)
const loginForm = ref({ username: '', password: '' })
const loginError = ref('')
const loginLoading = ref(false)
const adminSiteLoading = ref(false)
const activeTab = ref('servers')
const servers = ref([])
const selectedServers = ref([])
const stats = ref({ total: '-', online: 0, offline: 0, avg_cpu: 0 })
const groups = ref(['Default'])
const latestAgentVersion = ref('')
const newServerName = ref('')
const newServerGroup = ref('')

const settings = ref({
  site_title: '',
  custom_bg: '',
  favicon: '',
  custom_head: '',
  custom_script: '',
  display_mode: 'bar',
  theme_options: '{}',
  is_public: false,
  show_price: true,
  show_expire: true,
  show_tf: true,
  show_time: true,
  show_long_history: false,
  long_history_points: String(HISTORY.DEFAULT_LONG_RANGE_POINTS),
  tg_notify: '0',
  expire_reminder: '0',
  resource_alert_rules: [],
  tg_bot_token: '',
  tg_chat_id: '',
  turnstile_enabled: false,
  turnstile_site_key: '',
  turnstile_secret_key: '',
  cloudflare_account_id: '',
  cloudflare_token: '',
  jwt_secret: '',
  username: '',
  password: '',
  confirm_password: '',
  custom_ct: '',
  custom_cu: '',
  custom_cm: '',
  custom_bd: '',
  theme_url: '',
  csp_static: '',
  csp_api: ''
})
const apiSecret = ref('')
const changeAdminPassword = ref(false)

const clearAdminPasswordInputs = () => {
  settings.value.password = ''
  settings.value.confirm_password = ''
}

const toggleAdminPasswordChange = () => {
  changeAdminPassword.value = !changeAdminPassword.value
  if (!changeAdminPassword.value) {
    clearAdminPasswordInputs()
  }
}

const { visibility: passwordVisible, toggle: togglePassword } = usePasswordVisibility([
  'login', 'tgBotToken', 'tgChatId', 'turnstileSecret', 'cloudflareToken', 'jwtSecret', 'password', 'confirmPassword'
])

const {
  turnstileEnabled, turnstileLoginEnabled, turnstileSiteKey,
  turnstileToken, turnstileVerified,
  hasSharedTurnstileVerified, loadTurnstileConfig: loadTurnstileConfigBase,
  renderTurnstile, resetTurnstile, clearTurnstile
} = useTurnstile()

const showEditModal = ref(false)
const editForm = ref({
  id: '',
  name: '',
  server_group: '',
  region: '',
  tags: '',
  note: '',
  price: '',
  billing_cycle: 'month',
  auto_renewal: false,
  currency: '¥',
  expire_date: '',
  traffic_limit: '',
  traffic_calc_type: 'total',
  reset_day: 1,
  collect_interval: 0,
  report_interval: 60,
  custom_ct: '',
  custom_cu: '',
  custom_cm: '',
  custom_bd: '',
  rx_correction: '',
  tx_correction: '',
  auto_update: false,
  is_hidden: false,
  offline_notify_disabled: false
})

const showDeleteModal = ref(false)
const deleteServerId = ref('')

const copiedServerId = ref(null)
const copiedNoteServerId = ref(null)
const copiedSpecKey = ref(null)
const deleteTargetOs = ref('linux')
const uninstallCopied = ref(false)
const saving = ref(false)


const showDbModal = ref(false)
const dbOperation = ref('')
const dbLoading = ref(false)
const dbResult = ref(null)
const d1UsageLoading = ref(false)
const d1UsageResult = ref(null)
const validationError = ref(null)
const alertMessage = ref(null)
const showAutoUpdateWarning = ref(false)
const autoUpdatePendingEnable = ref(false)

const testNotificationLoading = ref(false)

const saveResult = ref(null)

const settingsPanelRef = ref(null)

const showCopyModal = ref(false)
const copyServerId = ref('')
const currentServerName = ref('')
const targetOs = ref('linux')
const collectInterval = ref(0)
const reportInterval = ref(60)
const customCt = ref('')
const customCu = ref('')
const customCm = ref('')
const customBd = ref('')
const resetDay = ref(1)
const rxCorrection = ref('')
const txCorrection = ref('')
const autoUpdate = ref(false)
const copiedCmd = ref(false)

const getPingNodeLabel = (field) => ({
  custom_ct: trans.value.customCt,
  custom_cu: trans.value.customCu,
  custom_cm: trans.value.customCm,
  custom_bd: trans.value.customBd
})[field] || field

const getPingNodeValidation = (source) => {
  const values = {}
  for (const field of PING_NODE_FIELDS) {
    const result = validatePingNode(source[field])
    if (!result.valid) {
      return { valid: false, field }
    }
    values[field] = result.value
  }
  return { valid: true, values }
}

const buildPingNodeError = (field) => `${getPingNodeLabel(field)}: ${trans.value.invalidPingNodeFormat}`

const copyTextToClipboard = async (text) => {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch (e) {
      // Fall back to the textarea path below.
    }
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  document.execCommand('copy')
  document.body.removeChild(textarea)
}

const copyServerNote = async (server) => {
  const note = String(server?.note || '')
  if (!note.trim()) return

  try {
    await copyTextToClipboard(note)
    copiedNoteServerId.value = server.id
    setTimeout(() => {
      if (copiedNoteServerId.value === server.id) {
        copiedNoteServerId.value = null
      }
    }, 1500)
  } catch (e) {
    console.error('[ERROR] Copy note failed:', e)
  }
}

const copyServerSpec = async ({ key, text } = {}) => {
  const value = String(text || '').trim()
  if (!key || !value || value === '-') return

  try {
    await copyTextToClipboard(value)
    copiedSpecKey.value = key
    setTimeout(() => {
      if (copiedSpecKey.value === key) {
        copiedSpecKey.value = null
      }
    }, 1500)
  } catch (e) {
    console.error('[ERROR] Copy spec failed:', e)
  }
}

const handleLogin = async () => {
  loginError.value = ''
  loginLoading.value = true

  if (turnstileLoginEnabled.value && !turnstileToken.value) {
    loginError.value = 'Please complete the verification'
    loginLoading.value = false
    return
  }

  if (turnstileEnabled.value && !turnstileVerified.value && !turnstileToken.value) {
    loginError.value = 'Please complete the verification'
    loginLoading.value = false
    return
  }

  const result = await login(loginForm.value.username, loginForm.value.password, turnstileToken.value, selectedApiIndex.value)
  if (!result.error) {
    isLoggedIn.value = true
    syncApiIndexQuery()
    clearTurnstile()
    turnstileVerified.value = hasSharedTurnstileVerified()
    await Promise.all([
      loadSettings(),
      loadServers(),
      loadLatestAgentVersion()
    ])
  } else {
    loginError.value = result.status === 403 ? 'Please complete the verification' : trans.value.errorInvalidUsername
    loginForm.value.password = ''
    clearTurnstile()
    resetTurnstile('#admin-turnstile-container')
  }
  loginLoading.value = false
}

const logout = async () => {
  try {
    await adminApiForSite({ action: 'clear_theme_preview_auth' })
  } catch (_) {
  }
  apiLogout()
  isLoggedIn.value = false
  latestAgentVersion.value = ''
  clearTurnstile()
  await loadTurnstileConfig()
}

const checkLoginStatus = () => {
  const token = localStorage.getItem('jwt_token')
  return !!token
}

const initAdmin = async () => {
  const hasCreds = checkLoginStatus()
  if (hasCreds) {
    isLoggedIn.value = true
    syncApiIndexQuery()
    const savedTurnstileToken = localStorage.getItem('turnstile_token')
    if (savedTurnstileToken) {
      turnstileToken.value = savedTurnstileToken
    }
    await Promise.all([
      loadSettings(),
      loadServers(),
      loadLatestAgentVersion()
    ])
  } else {
    await loadTurnstileConfig()
  }
}

const loadTurnstileConfig = async () => {
  await loadTurnstileConfigBase(selectedApiIndex.value, isMultipleMode.value, loginError)
  if (turnstileSiteKey.value && (turnstileLoginEnabled.value || (turnstileEnabled.value && !turnstileVerified.value))) {
    await nextTick()
    renderTurnstile('#admin-turnstile-container', turnstileSiteKey.value)
  }
}

const handleApiIndexChange = async (newIndex) => {
  selectedApiIndex.value = newIndex
  syncApiIndexQuery()
  await nextTick()
  await loadTurnstileConfig()
}

const resetAdminContext = () => {
  selectedServers.value = []
  showEditModal.value = false
  showDeleteModal.value = false
  showCopyModal.value = false
  showDbModal.value = false
  validationError.value = null
}

const switchAdminSite = async () => {
  resetAdminContext()
  adminSiteLoading.value = true
  try {
    await Promise.all([
      loadSettings(),
      loadServers(),
      loadLatestAgentVersion()
    ])
  } finally {
    adminSiteLoading.value = false
  }
}

const handleAdminApiIndexChange = async () => {
  syncApiIndexQuery()
  await switchAdminSite()
}

const loadLatestAgentVersion = async () => {
  try {
    const config = await fetchConfig(selectedApiIndex.value)
    latestAgentVersion.value = config?.last_agent_version || ''
  } catch (e) {
    console.error('[ERROR] Load latest agent version failed:', e)
    latestAgentVersion.value = ''
  }
}

const loadSettings = async () => {
  try {
    const result = await adminApiForSite({ action: 'get_settings' })
    if (!result.error) {
      const data = result.data
      const settingsData = data.settings || {}
      settings.value = {
        site_title: settingsData.site_title || '',
        custom_bg: settingsData.custom_bg || '',
        favicon: settingsData.favicon || '',
        custom_head: settingsData.custom_head || '',
        custom_script: settingsData.custom_script || '',
        display_mode: resolveDisplayMode(settingsData),
        theme_options: formatThemeOptions(settingsData.theme_options),
        is_public: settingsData.is_public === 'true',
        show_price: settingsData.show_price === 'true',
        show_expire: settingsData.show_expire === 'true',
        show_tf: settingsData.show_tf === 'true',
        show_time: settingsData.show_time === 'true',
        show_long_history: settingsData.show_long_history === 'true',
        long_history_points: normalizeLongHistoryPointsSetting(settingsData.long_history_points),
        tg_notify: normalizeTgNotifySetting(settingsData.tg_notify),
        expire_reminder: normalizeExpireReminderSetting(settingsData.expire_reminder),
        resource_alert_rules: normalizeResourceAlertRulesSetting(settingsData.resource_alert_rules),
        tg_bot_token: settingsData.tg_bot_token || '',
        tg_chat_id: settingsData.tg_chat_id || '',
        turnstile_enabled: settingsData.turnstile_enabled === 'true',
        turnstile_login_enabled: settingsData.turnstile_login_enabled === 'true',
        turnstile_site_key: settingsData.turnstile_site_key || '',
        turnstile_secret_key: settingsData.turnstile_secret_key || '',
        cloudflare_account_id: settingsData.cloudflare_account_id || '',
        cloudflare_token: settingsData.cloudflare_token || '',
        jwt_secret: '',
        username: settingsData.username || '',
        password: '',
        confirm_password: '',
        custom_ct: settingsData.custom_ct || '',
        custom_cu: settingsData.custom_cu || '',
        custom_cm: settingsData.custom_cm || '',
        custom_bd: settingsData.custom_bd || '',
        theme_url: settingsData.theme_url || '',
        csp_static: settingsData.csp_static || '',
        csp_api: settingsData.csp_api || ''
      }
      changeAdminPassword.value = false
      apiSecret.value = data.api_secret || ''
    }
  } catch (e) {
    console.error('[ERROR] Load settings failed:', e)
  }
}

const saveSettings = async () => {
  if (saving.value) return

  validationError.value = null

  const jwtSecret = settings.value.jwt_secret
  if (jwtSecret && jwtSecret.length > 0 && jwtSecret.length < 32) {
    validationError.value = trans.value.jwtSecretMinLength
    return
  }

  if (jwtSecret && /\s/.test(jwtSecret)) {
    validationError.value = trans.value.jwtSecretNoWhitespace
    return
  }

  if (!settings.value.username || settings.value.username.trim().length === 0) {
    validationError.value = trans.value.usernameRequired
    return
  }

  const shouldChangePassword = changeAdminPassword.value && (
    settings.value.password.length > 0 ||
    settings.value.confirm_password.length > 0
  )

  if (shouldChangePassword) {
    if (settings.value.password !== settings.value.confirm_password) {
      validationError.value = trans.value.passwordMismatch
      return
    }
  }

  if (settings.value.turnstile_enabled || settings.value.turnstile_login_enabled) {
    if (!settings.value.turnstile_site_key || settings.value.turnstile_site_key.trim().length === 0) {
      validationError.value = trans.value.turnstileSiteKeyRequired
      return
    }
    if (!settings.value.turnstile_secret_key || settings.value.turnstile_secret_key.trim().length === 0) {
      validationError.value = trans.value.turnstileSecretKeyRequired
      return
    }
  }

  if (isTgNotifyEnabled(settings.value.tg_notify) || isExpireReminderEnabled(settings.value.expire_reminder) || isResourceAlertEnabled(settings.value.resource_alert_rules)) {
    if (!settings.value.tg_bot_token || settings.value.tg_bot_token.trim().length === 0) {
      validationError.value = trans.value.tgBotTokenRequired
      return
    }
  }

  const pingNodeValidation = getPingNodeValidation(settings.value)
  if (!pingNodeValidation.valid) {
    validationError.value = buildPingNodeError(pingNodeValidation.field)
    return
  }

  const themeOptionsResult = parseThemeOptions(settings.value.theme_options)
  if (!themeOptionsResult.valid) {
    validationError.value = trans.value.invalidThemeOptionsFormat
    return
  }

  if (settingsPanelRef.value) {
    const cspStaticValid = settingsPanelRef.value.validateCspField('csp_static')
    const cspApiValid = settingsPanelRef.value.validateCspField('csp_api')
    if (!cspStaticValid || !cspApiValid) {
      return
    }
  }

  saving.value = true
  saveResult.value = null

  const data = {
    action: 'save_settings',
    settings: {
      site_title: settings.value.site_title,
      custom_bg: settings.value.custom_bg,
      favicon: settings.value.favicon,
      custom_head: settings.value.custom_head,
      custom_script: settings.value.custom_script,
      display_mode: normalizeDisplayMode(settings.value.display_mode),
      appearance_options: {
        theme_options: themeOptionsResult.value
      },
      is_public: settings.value.is_public ? 'true' : 'false',
      show_price: settings.value.show_price ? 'true' : 'false',
      show_expire: settings.value.show_expire ? 'true' : 'false',
      show_tf: settings.value.show_tf ? 'true' : 'false',
      show_time: settings.value.show_time ? 'true' : 'false',
      show_long_history: settings.value.show_long_history ? 'true' : 'false',
      long_history_points: normalizeLongHistoryPointsSetting(settings.value.long_history_points),
      tg_notify: normalizeTgNotifySetting(settings.value.tg_notify),
      expire_reminder: normalizeExpireReminderSetting(settings.value.expire_reminder),
      resource_alert_rules: normalizeResourceAlertRulesSetting(settings.value.resource_alert_rules),
      tg_bot_token: settings.value.tg_bot_token,
      tg_chat_id: settings.value.tg_chat_id,
      turnstile_enabled: settings.value.turnstile_enabled ? 'true' : 'false',
      turnstile_login_enabled: settings.value.turnstile_login_enabled ? 'true' : 'false',
      turnstile_site_key: settings.value.turnstile_site_key,
      turnstile_secret_key: settings.value.turnstile_secret_key,
      cloudflare_account_id: settings.value.cloudflare_account_id,
      cloudflare_token: settings.value.cloudflare_token,
      username: settings.value.username,
      custom_ct: pingNodeValidation.values.custom_ct,
      custom_cu: pingNodeValidation.values.custom_cu,
      custom_cm: pingNodeValidation.values.custom_cm,
      custom_bd: pingNodeValidation.values.custom_bd,
      csp_static: settings.value.csp_static || '',
      csp_api: settings.value.csp_api || ''
    }
  }

  if (shouldChangePassword && settings.value.password.length > 0) {
    data.settings.password = settings.value.password
  }

  if (jwtSecret && jwtSecret.length > 0) {
    data.settings.jwt_secret = jwtSecret
  }

  try {
    const result = await adminApiForSite(data)
    if (!result.error) {
      saveResult.value = { success: true }
      clearAdminPasswordInputs()
      changeAdminPassword.value = false
      settings.value.jwt_secret = ''
      loadSettings()
    } else {
      saveResult.value = { success: false, error: getMessage(result.error) || 'fail' }
    }
  } catch (e) {
    saveResult.value = { success: false, error: e.message }
  } finally {
    saving.value = false
  }
}

const loadServers = async () => {
  try {
    const result = await adminApiForSite({ action: 'list' })
    if (!result.error) {
      const data = result.data
      servers.value = data.servers || []
      stats.value = data.stats || { total: servers.value.length, online: 0, offline: servers.value.length, avg_cpu: 0 }

      const serverGroups = [...new Set(servers.value.map(s => s.server_group || trans.value.default))]
      groups.value = serverGroups
    }
  } catch (e) {
    console.error('[ERROR] Load servers failed:', e)
  }
}

const refreshServers = async () => {
  await Promise.all([
    loadServers(),
    loadLatestAgentVersion()
  ])
}

const addServer = async () => {
  const name = newServerName.value.trim()
  if (!name) {
    validationError.value = trans.value.enterServerName
    return
  }

  try {
    const result = await adminApiForSite({ action: 'add', name, server_group: newServerGroup.value })
    if (!result.error) {
      saveResult.value = { success: true, message: getMessage(result.data.message) || trans.value.serverAdded }
      newServerName.value = ''
      newServerGroup.value = ''
      loadServers()
    } else {
      saveResult.value = { success: false, error: getMessage(result.error) || 'Fail' }
    }
  } catch (e) {
    saveResult.value = { success: false, error: e.message }
  }
}

const getInstallCommand = (serverId) => {
  const HOST = selectedApiBase.value
  return `curl -sL ${HOST}/install.sh | bash -s install -id=${serverId} -secret='${apiSecret.value}' -url=${HOST}/update`
}

const getUninstallCommand = () => {
  const HOST = selectedApiBase.value
  if (deleteTargetOs.value === 'windows') {
    return `irm ${HOST}/cf-server-monitor.ps1 -OutFile cf-server-monitor.ps1; powershell -ExecutionPolicy Bypass -File .\\cf-server-monitor.ps1 uninstall`
  }
  const shell = deleteTargetOs.value === 'alpine' || deleteTargetOs.value === 'openwrt' ? 'sh' : 'bash'
  const sudoPrefix = deleteTargetOs.value === 'mac' ? 'sudo ' : ''
  const script = deleteTargetOs.value === 'alpine' ? 'install-alpine.sh'
    : deleteTargetOs.value === 'openwrt' ? 'install-openwrt.sh'
    : deleteTargetOs.value === 'mac' ? 'install-mac.sh'
    : deleteTargetOs.value === 'synology' ? 'install-synology.sh'
    : 'install.sh'
  return `curl -sL ${HOST}/${script} | ${sudoPrefix}${shell} -s uninstall`
}

const copyCmd = (serverId) => {
  const server = servers.value.find(s => s.id === serverId)
  copyServerId.value = serverId
  currentServerName.value = server?.name || ''
  targetOs.value = 'linux'
  collectInterval.value = server?.collect_interval ?? 0
  reportInterval.value = server?.report_interval || 60
  customCt.value = server?.custom_ct || settings.value.custom_ct
  customCu.value = server?.custom_cu || settings.value.custom_cu
  customCm.value = server?.custom_cm || settings.value.custom_cm
  customBd.value = server?.custom_bd || settings.value.custom_bd
  resetDay.value = server?.reset_day ?? 1
  rxCorrection.value = server?.rx_correction ?? ''
  txCorrection.value = server?.tx_correction ?? ''
  autoUpdate.value = server?.auto_update === '1' || server?.auto_update === 1 || server?.auto_update === true
  copiedCmd.value = false
  showCopyModal.value = true
}

const hasCorrectionValue = (value) => value !== null && value !== undefined && value !== ''

const getCustomInstallCommand = () => {
  const HOST = selectedApiBase.value
  const autoUpdateFlag = autoUpdate.value ? 1 : 0
  if (targetOs.value === 'windows') {
    const params = [
      'install',
      `-Id '${copyServerId.value}'`,
      `-Secret '${apiSecret.value}'`,
      `-Url '${HOST}/update'`,
      `-CollectInterval ${collectInterval.value}`,
      `-ReportInterval ${reportInterval.value}`,
      `-ResetDay ${resetDay.value ?? 1}`,
      `-AutoUpdate ${autoUpdateFlag}`
    ]
    if (customCt.value) params.push(`-CtNode '${customCt.value}'`)
    if (customCu.value) params.push(`-CuNode '${customCu.value}'`)
    if (customCm.value) params.push(`-CmNode '${customCm.value}'`)
    if (customBd.value) params.push(`-BdNode '${customBd.value}'`)
    if (hasCorrectionValue(rxCorrection.value)) params.push(`-RxCorrection ${rxCorrection.value}`)
    if (hasCorrectionValue(txCorrection.value)) params.push(`-TxCorrection ${txCorrection.value}`)
    return `irm ${HOST}/cf-server-monitor.ps1 -OutFile cf-server-monitor.ps1; powershell -ExecutionPolicy Bypass -File .\\cf-server-monitor.ps1 ${params.join(' ')}`
  }
  const shell = targetOs.value === 'alpine' || targetOs.value === 'openwrt' ? 'sh' : 'bash'
  const sudoPrefix = targetOs.value === 'mac' ? 'sudo ' : ''
  const script = targetOs.value === 'alpine' ? 'install-alpine.sh'
    : targetOs.value === 'openwrt' ? 'install-openwrt.sh'
    : targetOs.value === 'mac' ? 'install-mac.sh'
    : targetOs.value === 'synology' ? 'install-synology.sh'
    : 'install.sh'
  let cmd = `curl -sL ${HOST}/${script} | ${sudoPrefix}${shell} -s install -id=${copyServerId.value} -secret='${apiSecret.value}' -url=${HOST}/update -collect_interval=${collectInterval.value} -interval=${reportInterval.value} -reset_day=${resetDay.value ?? 1} -auto_update=${autoUpdateFlag}`
  if (customCt.value) cmd += ` -ct=${customCt.value}`
  if (customCu.value) cmd += ` -cu=${customCu.value}`
  if (customCm.value) cmd += ` -cm=${customCm.value}`
  if (customBd.value) cmd += ` -bd=${customBd.value}`
  if (hasCorrectionValue(rxCorrection.value)) cmd += ` -rx_correction=${rxCorrection.value}`
  if (hasCorrectionValue(txCorrection.value)) cmd += ` -tx_correction=${txCorrection.value}`
  return cmd
}

const copyCustomCmd = async () => {
  const cmd = getCustomInstallCommand()
  try {
    await navigator.clipboard.writeText(cmd)
  } catch (e) {
    document.execCommand('copy')
  }

  copiedCmd.value = true
  setTimeout(() => {
    copiedCmd.value = false
  }, 1500)
}

const closeCopyModal = () => {
  showCopyModal.value = false
}

const openEditModalFromCopy = () => {
  const server = servers.value.find(s => s.id === copyServerId.value)
  if (server) {
    showCopyModal.value = false
    openEditModal(server)
  }
}

const copyUninstallCmd = async () => {
  const cmd = getUninstallCommand()
  try {
    await navigator.clipboard.writeText(cmd)
  } catch (e) {
    document.execCommand('copy')
  }

  uninstallCopied.value = true
  setTimeout(() => {
    uninstallCopied.value = false
  }, 1500)
}

const openEditModal = (server) => {
  editForm.value = {
    id: server.id,
    name: server.name || '',
    server_group: server.server_group || '',
    region: server.region_override ?? (server.region || ''),
    tags: server.tags || '',
    note: server.note || '',
    price: normalizePrice(server.price),
    billing_cycle: normalizeBillingCycle(detectBillingCycle(server.price) || server.billing_cycle),
    auto_renewal: server.auto_renewal === '1' || server.auto_renewal === 1 || server.auto_renewal === true,
    currency: normalizeCurrency(server.currency || detectCurrencySymbol(server.price) || '¥'),
    expire_date: server.expire_date || '',
    traffic_limit: server.traffic_limit || '',
    traffic_calc_type: server.traffic_calc_type || 'total',
    reset_day: server.reset_day ?? 1,
    collect_interval: server.collect_interval ?? 0,
    report_interval: server.report_interval || 60,
    custom_ct: server.custom_ct || '',
    custom_cu: server.custom_cu || '',
    custom_cm: server.custom_cm || '',
    custom_bd: server.custom_bd || '',
    rx_correction: server.rx_correction ?? '',
    tx_correction: server.tx_correction ?? '',
    auto_update: server.auto_update === '1' || server.auto_update === 1 || server.auto_update === true,
    is_hidden: server.is_hidden === '1',
    offline_notify_disabled: server.offline_notify_disabled === '1'
  }
  currentServerName.value = server.name || ''
  showEditModal.value = true
}

const closeEditModal = () => {
  cancelAutoUpdateWarning()
  showEditModal.value = false
}

const handleAutoUpdateToggle = (nextValue) => {
  if (!nextValue) {
    editForm.value.auto_update = false
    cancelAutoUpdateWarning()
    return
  }
  autoUpdatePendingEnable.value = true
  showAutoUpdateWarning.value = true
}

const confirmAutoUpdateWarning = () => {
  if (autoUpdatePendingEnable.value) {
    editForm.value.auto_update = true
  }
  autoUpdatePendingEnable.value = false
  showAutoUpdateWarning.value = false
}

const cancelAutoUpdateWarning = () => {
  autoUpdatePendingEnable.value = false
  showAutoUpdateWarning.value = false
}

const saveEdit = async () => {
  validationError.value = null

  const pingNodeValidation = getPingNodeValidation(editForm.value)
  if (!pingNodeValidation.valid) {
    validationError.value = buildPingNodeError(pingNodeValidation.field)
    return
  }

  const normalizedBillingCycle = normalizeBillingCycle(editForm.value.billing_cycle)
  const normalizedAutoRenewal = editForm.value.auto_renewal ? '1' : '0'
  const normalizedPrice = normalizePrice(editForm.value.price)
  const normalizedCurrency = normalizeCurrency(editForm.value.currency || detectCurrencySymbol(editForm.value.price) || '¥')
  const normalizedExpireDate = renewExpireDateIfNeeded(
    editForm.value.expire_date,
    normalizedBillingCycle,
    normalizedAutoRenewal
  ).expire_date

  editForm.value.price = normalizedPrice
  editForm.value.currency = normalizedCurrency
  editForm.value.billing_cycle = normalizedBillingCycle
  editForm.value.expire_date = normalizedExpireDate

  const data = {
    action: 'edit',
    id: editForm.value.id,
    name: editForm.value.name,
    server_group: editForm.value.server_group,
    region: editForm.value.region,
    tags: editForm.value.tags,
    note: editForm.value.note,
    price: normalizedPrice,
    billing_cycle: normalizedBillingCycle,
    auto_renewal: normalizedAutoRenewal,
    currency: normalizedCurrency,
    expire_date: normalizedExpireDate,
    traffic_limit: editForm.value.traffic_limit,
    traffic_calc_type: editForm.value.traffic_calc_type,
    reset_day: editForm.value.reset_day,
    collect_interval: editForm.value.collect_interval,
    report_interval: editForm.value.report_interval,
    custom_ct: pingNodeValidation.values.custom_ct,
    custom_cu: pingNodeValidation.values.custom_cu,
    custom_cm: pingNodeValidation.values.custom_cm,
    custom_bd: pingNodeValidation.values.custom_bd,
    rx_correction: editForm.value.rx_correction,
    tx_correction: editForm.value.tx_correction,
    auto_update: editForm.value.auto_update ? '1' : '0',
    is_hidden: editForm.value.is_hidden ? '1' : '0',
    offline_notify_disabled: editForm.value.offline_notify_disabled ? '1' : '0'
  }

  try {
    const result = await adminApiForSite(data)
    if (!result.error) {
      saveResult.value = { success: true, message: getMessage(result.data.message) || trans.value.serverEdited }
      cancelAutoUpdateWarning()
      showEditModal.value = false
      loadServers()
    } else {
      saveResult.value = { success: false, error: getMessage(result.error) || 'Fail' }
    }
  } catch (e) {
    saveResult.value = { success: false, error: e.message }
  }
}

const openDeleteModal = (id) => {
  deleteServerId.value = id
  const server = servers.value.find(s => s.id === id)
  currentServerName.value = server?.name || ''
  deleteTargetOs.value = 'linux'
  uninstallCopied.value = false
  showDeleteModal.value = true
}

const closeDeleteModal = () => {
  showDeleteModal.value = false
}

const confirmDelete = async () => {
  try {
    const result = await adminApiForSite({ action: 'delete', id: deleteServerId.value })
    if (!result.error) {
      saveResult.value = { success: true, message: getMessage(result.data.message) || trans.value.serverDeleted }
      showDeleteModal.value = false
      loadServers()
    } else {
      saveResult.value = { success: false, error: getMessage(result.error) || 'Fail' }
    }
  } catch (e) {
    saveResult.value = { success: false, error: e.message }
  }
}

const batchDelete = async () => {
  if (selectedServers.value.length === 0) {
    alertMessage.value = trans.value.selectServers
    return
  }
  if (!confirm(trans.value.confirmDeleteServers + selectedServers.value.length + trans.value.irreversible)) return

  try {
    const result = await adminApiForSite({ action: 'batch_delete', ids: selectedServers.value })
    if (!result.error) {
      saveResult.value = { success: true, message: getMessage(result.data.message) || trans.value.serversDeleted }
      selectedServers.value = []
      loadServers()
    } else {
      saveResult.value = { success: false, error: getMessage(result.error) || 'Fail' }
    }
  } catch (e) {
    saveResult.value = { success: false, error: e.message }
  }
}

const handleSelectAll = (e) => {
  const checked = e.target.checked
  selectedServers.value = checked ? servers.value.map(s => s.id) : []
}

const toggleSelectAll = () => {
  if (selectedServers.value.length === servers.value.length) {
    selectedServers.value = []
  } else {
    selectedServers.value = servers.value.map(s => s.id)
  }
}

const toggleServer = (id) => {
  const index = selectedServers.value.indexOf(id)
  if (index === -1) {
    selectedServers.value.push(id)
  } else {
    selectedServers.value.splice(index, 1)
  }
}

let draggedRow = null

const handleDragStart = (e) => {
  const row = e.target.closest('.server-row')
  draggedRow = row ? row.dataset.serverId : null
  e.dataTransfer.effectAllowed = 'move'
}

const handleDrop = async (e, targetId) => {
  if (!draggedRow || draggedRow === targetId) return

  const rows = Array.from(document.querySelectorAll('.server-row'))
  const draggedIndex = rows.findIndex(r => r.dataset.serverId === draggedRow)
  const targetIndex = rows.findIndex(r => r.dataset.serverId === targetId)

  const orders = rows.map(r => r.dataset.serverId)
  const [dragged] = orders.splice(draggedIndex, 1)
  orders.splice(targetIndex, 0, dragged)

  try {
    const result = await adminApiForSite({ action: 'save_order', orders })
    if (!result.error) {
      loadServers()
    }
  } catch (e) {
    console.error('[ERROR] Save order failed:', e)
  }

  draggedRow = null
}

const uploadImageSetting = (e, field) => {
  const file = e.target.files[0]
  if (!file) return
  if (file.size > 800 * 1024) {
    alertMessage.value = trans.value.imageSizeWarning
    return
  }
  const reader = new FileReader()
  reader.onload = function(event) {
    settings.value[field] = event.target.result
  }
  reader.readAsDataURL(file)
}

const uploadBg = (e) => uploadImageSetting(e, 'custom_bg')

const uploadFavicon = (e) => uploadImageSetting(e, 'favicon')

const handleUpgradeDatabase = async () => {
  dbOperation.value = 'upgrade'
  dbLoading.value = true
  dbResult.value = null

  try {
    const result = await upgradeDatabase(selectedApiIndex.value)
    dbResult.value = result
  } catch (e) {
    dbResult.value = { success: false, error: e.message }
  } finally {
    dbLoading.value = false
  }
}

const handleClearHistory = async () => {
  dbOperation.value = 'clearHistory'
  dbLoading.value = true
  dbResult.value = null

  try {
    const result = await clearHistory(selectedApiIndex.value)
    dbResult.value = result
  } catch (e) {
    dbResult.value = { success: false, error: e.message }
  } finally {
    dbLoading.value = false
  }
}

const openDbModal = (operation) => {
  dbOperation.value = operation
  dbResult.value = null
  showDbModal.value = true
}

const closeDbModal = () => {
  if (!dbLoading.value) {
    showDbModal.value = false
  }
}

const queryD1Usage = async () => {
  if (d1UsageLoading.value) return
  d1UsageLoading.value = true
  d1UsageResult.value = null
  alertMessage.value = null

  try {
    const result = await adminApiForSite({
      action: 'd1_usage',
      cloudflare_account_id: settings.value.cloudflare_account_id,
      cloudflare_token: settings.value.cloudflare_token
    })
    if (!result.error) {
      d1UsageResult.value = result.data
    } else {
      alertMessage.value = getMessage(result.error) || result.error || trans.value.operationFailed
    }
  } catch (e) {
    alertMessage.value = getMessage(e.message) || e.message || trans.value.operationFailed
  } finally {
    d1UsageLoading.value = false
  }
}

const sendTestNotification = async () => {
  if (testNotificationLoading.value) return
  testNotificationLoading.value = true
  try {
    const result = await adminApiForSite({
      action: 'send_test_notification',
      tg_bot_token: settings.value.tg_bot_token,
      tg_chat_id: settings.value.tg_chat_id
    })
    if (!result.error) {
      alertMessage.value = getMessage(result.data.message) || trans.value.testNotificationSent
    } else {
      alertMessage.value = getMessage(result.error) || trans.value.testNotificationFailed
    }
  } catch (e) {
    alertMessage.value = trans.value.testNotificationFailed + ': ' + e.message
  } finally {
    testNotificationLoading.value = false
  }
}

watch(() => route.query.apiIndex, async (value) => {
  const nextIndex = normalizeApiIndex(value)
  if (nextIndex === selectedApiIndex.value) return

  selectedApiIndex.value = nextIndex

  if (isLoggedIn.value) {
    await switchAdminSite()
  } else {
    await loadTurnstileConfig()
  }
})

onMounted(() => {
  initAdmin()
})
</script>
