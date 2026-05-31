<template>
  <div>
    <div v-if="!isLoggedIn" id="login-overlay" style="position:fixed;top:0;left:0;width:100%;height:100%;background:var(--bg-primary);z-index:9999;display:flex;align-items:center;justify-content:center;">
      <div style="background:var(--bg-secondary);border:1px solid var(--border-active);border-radius:6px;padding:32px;width:420px;max-width:90%;box-shadow:0 20px 60px rgba(0,0,0,0.5);">
        <div style="text-align:center;margin-bottom:24px;">
          <div style="font-size:40px;margin-bottom:12px;">🔐</div>
          <h2 style="color:var(--accent-green);margin:0;font-size:18px;text-transform:uppercase;letter-spacing:1px;">{{ trans.adminLogin }}</h2>
          <p style="color:var(--text-muted);font-size:12px;margin-top:8px;">{{ trans.enterCredentials }}</p>
        </div>
        <form @submit.prevent="handleLogin">
          <div style="margin-bottom:16px;">
            <label style="display:block;color:var(--text-muted);font-size:11px;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;">{{ trans.username }}</label>
            <input type="text" v-model="loginForm.username" required style="width:100%;padding:10px 12px;background:var(--input-bg);border:1px solid var(--input-border);border-radius:4px;color:var(--text-primary);font-family:var(--terminal-font);font-size:13px;" placeholder="admin">
          </div>
          <div style="margin-bottom:20px;">
            <label style="display:block;color:var(--text-muted);font-size:11px;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;">{{ trans.password }}</label>
            <input type="password" v-model="loginForm.password" required style="width:100%;padding:10px 12px;background:var(--input-bg);border:1px solid var(--input-border);border-radius:4px;color:var(--text-primary);font-family:var(--terminal-font);font-size:13px;" placeholder="••••••••">
          </div>
          <div v-if="loginError" id="login-error" style="padding:10px;background:rgba(248,81,73,0.1);border:1px solid rgba(248,81,73,0.3);border-radius:4px;color:var(--accent-red);font-size:12px;margin-bottom:16px;text-align:center;">{{ loginError }}</div>
          <button type="submit" style="width:100%;padding:12px;background:var(--accent-green);border:1px solid var(--accent-green);border-radius:4px;color:#000;font-family:var(--terminal-font);font-size:14px;font-weight:600;cursor:pointer;text-transform:uppercase;letter-spacing:1px;transition:all 0.2s;">{{ trans.login }}</button>
        </form>
      </div>
    </div>

    <div v-else class="container" id="admin-content">
      <TerminalHeader :title="trans.adminPanel" />
      
      <div class="main-panel">
        <div class="panel-header">
          <div class="panel-title">
            <span class="prompt">$</span> {{ trans.sudoStatus }}
          </div>
          <div class="header-actions">
            <button @click="refreshStats" class="btn">↻ {{ trans.refresh }}</button>
            <button @click="logout" class="btn btn-red">🚪 {{ trans.logout }}</button>
            <a href="/" class="btn">▸ {{ trans.dashboard }}</a>
          </div>
        </div>

        <div class="stats-grid" id="stats-panel">
          <div class="stat-card">
            <div class="stat-value" id="stat-total">{{ stats.total }}</div>
            <div class="stat-label">{{ trans.totalServers }}</div>
          </div>
          <div class="stat-card">
            <div class="stat-value" id="stat-online">{{ stats.online }}</div>
            <div class="stat-label">{{ trans.onlineCount }}</div>
          </div>
          <div class="stat-card">
            <div class="stat-value" id="stat-offline">{{ stats.offline }}</div>
            <div class="stat-label">{{ trans.offlineCount }}</div>
          </div>
          <div class="stat-card">
            <div class="stat-value" id="stat-avg-cpu">{{ stats.avg_cpu }}%</div>
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
        </div>

        <div id="tab-servers" class="tab-content" :class="{ active: activeTab === 'servers' }">
          <div class="alert alert-info">
            <span class="alert-icon">[i]</span>
            <span>{{ trans.clickToCopy }} <strong>📋</strong> {{ trans.installCommand }}。{{ trans.interval }}</span>
          </div>

          <div class="toolbar">
            <input type="text" v-model="newServerName" class="toolbar-input" :placeholder="'> ' + trans.serverName + '...'">
            <select v-model="newServerGroup" class="toolbar-select">
              <option v-for="group in groups" :key="group" :value="group">{{ group }}</option>
            </select>
            <button @click="addServer" class="btn btn-primary">+ {{ trans.addServer }}</button>
          </div>

          <div class="batch-actions">
            <button @click="batchDelete" class="btn btn-red">🗑 {{ trans.batchDelete }}</button>
            <button @click="toggleSelectAll" class="btn">☐ {{ trans.toggleAll }}</button>
          </div>

          <div class="table-wrapper">
            <table class="terminal-table">
              <thead>
                <tr>
                  <th style="width:35px; text-align:center;">↕️</th>
                  <th style="width:30px;"><input type="checkbox" id="select-all" @change="handleSelectAll" style="accent-color: var(--accent-green);"></th>
                  <th>{{ trans.hostname.toUpperCase() }}</th>
                  <th>{{ trans.group.toUpperCase() }}</th>
                  <th>{{ trans.price.toUpperCase() }}</th>
                  <th>{{ trans.expire.toUpperCase() }}</th>
                  <th>{{ trans.bandwidth.toUpperCase() }}</th>
                  <th>{{ trans.traffic.toUpperCase() }}</th>
                  <th>{{ trans.status.toUpperCase() }}</th>
                  <th>{{ trans.actions.toUpperCase() }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-if="servers.length === 0">
                  <td colspan="10" class="empty-state"><span class="empty-icon">📦</span> {{ trans.noServers }}</td>
                </tr>
                <tr 
                  v-for="server in servers" 
                  :key="server.id"
                  class="server-row"
                  :data-server-id="server.id"
                  draggable="true"
                  @dragstart="handleDragStart"
                  @dragover.prevent
                  @drop="handleDrop($event, server.id)"
                >
                  <td class="drag-handle" style="text-align:center; cursor:move; user-select:none;" :title="trans.dragSort">⋮⋮</td>
                  <td style="text-align:center;"><input type="checkbox" class="server-checkbox" :value="server.id" v-model="selectedServers"></td>
                  <td>
                    <div style="display:flex; align-items:center; gap:8px;">
                      <span v-if="server.country">
                        <img :src="'https://flagcdn.com/24x18/' + (server.country || 'xx').toLowerCase() + '.png'" :alt="server.country" style="vertical-align: middle; border-radius: 2px; filter: brightness(0.9);">
                      </span>
                      <span v-else>🏳️</span>
                      <a :href="'/server/' + server.id" style="color:var(--text-primary); font-weight:bold; text-decoration:none;">{{ server.name }}</a>
                    </div>
                  </td>
                  <td><span class="group-tag">{{ server.server_group || trans.default }}</span></td>
                  <td><span class="price-tag">{{ server.price || '-' }}</span></td>
                  <td><span class="date-text">{{ server.expire_date || '-' }}</span></td>
                  <td><span class="spec-text">{{ server.bandwidth || '-' }}</span></td>
                  <td><span class="spec-text">{{ server.traffic_limit || '-' }}</span></td>
                  <td>
                    <span :style="{ color: getStatusColor(server), fontWeight: 'bold' }">{{ getStatusText(server) }}</span>
                  </td>
                  <td>
                    <div class="action-group">
                      <div class="cmd-input-wrapper">
                        <span class="cmd-prompt">$</span>
                        <input type="text" readonly :value="getInstallCommand(server.id)" class="cmd-input">
                      </div>
                      <div class="action-btns">
                        <button @click="copyCmd(getInstallCommand(server.id))" class="btn btn-icon btn-green" :title="trans.copy">📋</button>
                        <button @click="openEditModal(server)" class="btn btn-icon btn-blue" :title="trans.edit">✏️</button>
                        <button @click="openDeleteModal(server.id)" class="btn btn-icon btn-red" :title="trans.delete">🗑️</button>
                      </div>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div id="tab-settings" class="tab-content" :class="{ active: activeTab === 'settings' }">
          <div class="settings-grid">
            <div class="settings-section">
              <div class="section-title"><span>▸</span> {{ trans.appearance }}</div>

              <div class="form-group">
                <label class="form-label">{{ trans.bgImage }}</label>
                <div style="display:flex; gap:8px;">
                  <input type="text" v-model="settings.custom_bg" class="form-input" placeholder="https://..." style="flex:1;">
                  <div class="upload-btn-wrapper">
                    <button class="btn" style="margin:0;">📁 {{ trans.upload }}</button>
                    <input type="file" accept="image/*" @change="uploadBg">
                  </div>
                </div>
                <img v-if="settings.custom_bg" :src="settings.custom_bg" class="bg-preview">
              </div>

              <div class="form-group">
                <label class="form-label">{{ trans.customHead }}</label>
                <textarea v-model="settings.custom_head" class="form-textarea" rows="3" placeholder="<link rel='stylesheet' href='...'">
                </textarea>
              </div>

              <div class="form-group">
                <label class="form-label">{{ trans.customScript }}</label>
                <textarea v-model="settings.custom_script" class="form-textarea" rows="4" placeholder="console.log('Hello');">
                </textarea>
              </div>
            </div>

            <div>
              <div class="settings-section" style="margin-bottom: 20px;">
                <div class="section-title"><span>▸</span> {{ trans.displayOptions }}</div>

                <div class="checkbox-item">
                  <input type="checkbox" id="cfg_is_public" v-model="settings.is_public">
                  <label><b>{{ trans.publicAccess }}</b></label>
                </div>

                <div class="checkbox-item">
                  <input type="checkbox" id="cfg_show_price" v-model="settings.show_price">
                  <label>{{ trans.showPrice }}</label>
                </div>

                <div class="checkbox-item">
                  <input type="checkbox" id="cfg_show_expire" v-model="settings.show_expire">
                  <label>{{ trans.showExpire }}</label>
                </div>

                <div class="checkbox-item">
                  <input type="checkbox" id="cfg_show_bw" v-model="settings.show_bw">
                  <label>{{ trans.showBw }}</label>
                </div>

                <div class="checkbox-item">
                  <input type="checkbox" id="cfg_show_tf" v-model="settings.show_tf">
                  <label>{{ trans.showTf }}</label>
                </div>
              </div>

              <div class="settings-section">
                <div class="section-title"><span>▸</span> {{ trans.notifications }}</div>

                <div class="form-group">
                  <label class="form-label">{{ trans.offlineAlert }}</label>
                  <select v-model="settings.tg_notify" class="form-select">
                    <option value="false">[OFF] {{ trans.disabled }}</option>
                    <option value="true">[ON] {{ trans.notifyOffline }}</option>
                  </select>
                </div>

                <div class="form-group">
                  <label class="form-label">{{ trans.telegramToken }}</label>
                  <input type="password" v-model="settings.tg_bot_token" class="form-input" placeholder="Bot Token or Webhook URL">
                </div>

                <div class="form-group">
                  <label class="form-label">{{ trans.chatId }}</label>
                  <input type="password" v-model="settings.tg_chat_id" class="form-input" placeholder="Telegram Chat ID (optional for WeChat)">
                </div>
              </div>
            </div>
          </div>

          <div style="margin-top: 20px; text-align: right;">
            <button @click="saveSettings" class="btn btn-primary" style="padding: 12px 24px; font-size: 14px;">💾 {{ trans.saveConfig }}</button>
          </div>
        </div>
      </div>

      <div id="editModal" class="modal-overlay" :style="{ display: showEditModal ? 'block' : 'none' }">
        <div class="modal-dialog">
          <div class="modal-header">
            <div class="modal-title">$ vim /etc/server.conf</div>
            <button class="modal-close" @click="closeEditModal">✕</button>
          </div>
          <input type="hidden" v-model="editForm.id">

          <div class="form-group">
            <label class="form-label">{{ trans.hostnameLabel }} <span class="required">*</span></label>
            <input type="text" v-model="editForm.name" class="form-input" placeholder="e.g. My Server">
          </div>

          <div class="form-group">
            <label class="form-label">{{ trans.groupName }}</label>
            <input type="text" v-model="editForm.server_group" class="form-input" placeholder="e.g. US VPS">
          </div>

          <div class="form-group">
            <label class="form-label">{{ trans.price }}</label>
            <input type="text" v-model="editForm.price" class="form-input" placeholder="e.g. $40/year">
          </div>

          <div class="form-group">
            <label class="form-label">{{ trans.expirationDate }}</label>
            <input type="date" v-model="editForm.expire_date" class="form-input">
          </div>

          <div class="form-group">
            <label class="form-label">{{ trans.bandwidth }}</label>
            <input type="text" v-model="editForm.bandwidth" class="form-input" placeholder="e.g. 1Gbps">
          </div>

          <div class="form-group">
            <label class="form-label">{{ trans.trafficLimit }}</label>
            <input type="text" v-model="editForm.traffic_limit" class="form-input" placeholder="e.g. 1TB/month">
          </div>

          <div class="form-group">
            <div class="checkbox-item" style="margin:0;">
              <input type="checkbox" v-model="editForm.is_hidden">
              <label>
                <b>{{ trans.hideFromPublic }}</b><br>
                <span style="font-size:10px;color:var(--text-muted);">{{ trans.hideDesc }}</span>
              </label>
            </div>
          </div>

          <div class="modal-footer">
            <button @click="closeEditModal" class="btn">{{ trans.cancel }}</button>
            <button @click="saveEdit" class="btn btn-primary">{{ trans.save }}</button>
          </div>
        </div>
      </div>

      <div id="deleteModal" class="modal-overlay" :style="{ display: showDeleteModal ? 'block' : 'none' }">
        <div class="modal-dialog">
          <div class="modal-header">
            <div class="modal-title">$ rm -rf /etc/server.conf</div>
            <button class="modal-close" @click="closeDeleteModal">✕</button>
          </div>
          <input type="hidden" v-model="deleteServerId">

          <div style="margin-bottom: 16px;">
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px;">
              <span style="color: var(--accent-red); font-size: 20px;">⚠️</span>
              <span style="color: var(--accent-red); font-weight: 600;">{{ trans.dangerWarning }}</span>
            </div>
            <p style="color: var(--text-secondary); font-size: 12px; line-height: 1.6;">
              {{ trans.deleteConfirm }}
              <br><br>
              <strong style="color: var(--text-primary);">{{ trans.recommendUninstall }}：</strong>
            </p>
          </div>

          <div class="cmd-input-wrapper" style="margin-bottom: 12px;">
            <span class="cmd-prompt">$</span>
            <input type="text" readonly :value="getUninstallCommand()" class="cmd-input" style="flex: 1;">
            <button @click="copyUninstallCmd" class="btn btn-icon btn-green" :title="trans.copy" style="margin-left: 8px;">📋</button>
          </div>

          <p style="color: var(--text-muted); font-size: 11px; margin-bottom: 16px;">
            <span style="color: var(--accent-yellow);">[i]</span> {{ trans.clickToCopyCmd }}
          </p>

          <div class="modal-footer" style="justify-content: space-between;">
            <button @click="confirmDelete" class="btn btn-red">{{ trans.confirmDelete }}</button>
            <button @click="closeDeleteModal" class="btn">{{ trans.cancelAction }}</button>
          </div>
        </div>
      </div>

      <Footer />
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import TerminalHeader from '../components/TerminalHeader.vue'
import Footer from '../components/Footer.vue'
import { adminApi, login, logout as apiLogout, formatBytes } from '../utils/api'
import { t, currentLang } from '../utils/i18n'
import { translations } from '../utils/i18n'

const API_BASE = window.location.origin

const trans = computed(() => translations[currentLang.value] || translations.en)

const isLoggedIn = ref(false)
const loginForm = ref({ username: '', password: '' })
const loginError = ref('')
const activeTab = ref('servers')
const servers = ref([])
const selectedServers = ref([])
const stats = ref({ total: '-', online: 0, offline: 0, avg_cpu: 0 })
const groups = ref(['Default'])
const newServerName = ref('')
const newServerGroup = ref('Default')

const settings = ref({
  custom_bg: '',
  custom_head: '',
  custom_script: '',
  is_public: false,
  show_price: true,
  show_expire: true,
  show_bw: true,
  show_tf: true,
  tg_notify: 'false',
  tg_bot_token: '',
  tg_chat_id: ''
})
const apiSecret = ref('')

const showEditModal = ref(false)
const editForm = ref({
  id: '',
  name: '',
  server_group: '',
  price: '',
  expire_date: '',
  bandwidth: '',
  traffic_limit: '',
  is_hidden: false
})

const showDeleteModal = ref(false)
const deleteServerId = ref('')

const handleLogin = async () => {
    loginError.value = ''
    const res = await login(loginForm.value.username, loginForm.value.password)
    if (res.ok) {
      isLoggedIn.value = true
      loadSettings()
      loadServers()
      refreshStats()
    } else {
      loginError.value = trans.errorInvalidUsername
      loginForm.value.password = ''
    }
  }

const logout = () => {
  apiLogout()
  isLoggedIn.value = false
}

const checkLoginStatus = () => {
  const saved = localStorage.getItem('admin_credentials')
  if (saved) {
    try {
      const creds = JSON.parse(saved)
      return creds.username && creds.password
    } catch (e) {
      localStorage.removeItem('admin_credentials')
    }
  }
  return false
}

const initAdmin = () => {
  const hasCreds = checkLoginStatus()
  if (hasCreds) {
    isLoggedIn.value = true
    loadSettings()
    loadServers()
    refreshStats()
  }
}

const loadSettings = async () => {
  try {
    const res = await adminApi({ action: 'get_settings' })
    if (res.ok) {
      const data = await res.json()
      const settingsData = data.settings || {}
      settings.value = {
        custom_bg: settingsData.custom_bg || '',
        custom_head: settingsData.custom_head || '',
        custom_script: settingsData.custom_script || '',
        is_public: settingsData.is_public === 'true',
        show_price: settingsData.show_price === 'true',
        show_expire: settingsData.show_expire === 'true',
        show_bw: settingsData.show_bw === 'true',
        show_tf: settingsData.show_tf === 'true',
        tg_notify: settingsData.tg_notify || 'false',
        tg_bot_token: settingsData.tg_bot_token || '',
        tg_chat_id: settingsData.tg_chat_id || ''
      }
      apiSecret.value = data.api_secret || ''
    }
  } catch (e) {
    console.error('[ERROR] Load settings failed:', e)
  }
}

const saveSettings = async () => {
    const data = {
      action: 'save_settings',
      settings: {
        custom_bg: settings.value.custom_bg,
        custom_head: settings.value.custom_head,
        custom_script: settings.value.custom_script,
        is_public: settings.value.is_public ? 'true' : 'false',
        show_price: settings.value.show_price ? 'true' : 'false',
        show_expire: settings.value.show_expire ? 'true' : 'false',
        show_bw: settings.value.show_bw ? 'true' : 'false',
        show_tf: settings.value.show_tf ? 'true' : 'false',
        tg_notify: settings.value.tg_notify,
        tg_bot_token: settings.value.tg_bot_token,
        tg_chat_id: settings.value.tg_chat_id
      }
    }

    try {
      const res = await adminApi(data)
      if (res.ok) {
        alert(trans.configSaved)
        location.reload()
      } else {
        const err = await res.json()
        alert(trans.saveFailed + (err.error || trans.saveFailedUnknown))
      }
    } catch (e) {
      alert(trans.saveFailed + e.message)
    }
  }

  const loadServers = async () => {
    try {
      const res = await adminApi({ action: 'list' })
      if (res.ok) {
        const data = await res.json()
        servers.value = data.servers || []
        
        const serverGroups = [...new Set(servers.value.map(s => s.server_group || trans.default))]
        groups.value = serverGroups
      }
    } catch (e) {
      console.error('[ERROR] Load servers failed:', e)
    }
  }

const refreshStats = async () => {
  try {
    const res = await adminApi({ action: 'get_stats' })
    if (res.ok) {
      const data = await res.json()
      stats.value = data.stats || { total: '-', online: 0, offline: 0, avg_cpu: 0 }
    }
  } catch (e) {
    console.error('[ERROR] Refresh stats failed:', e)
  }
}

const addServer = async () => {
    const name = newServerName.value.trim()
    if (!name) return alert(trans.enterServerName)

    try {
      const res = await adminApi({ action: 'add', name })
      if (res.ok) {
        const data = await res.json()
        alert('[OK] ' + (data.message || trans.serverAdded))
        location.reload()
      } else {
        alert(trans.addFailed)
      }
    } catch (e) {
      alert(trans.addFailed + ': ' + e.message)
    }
  }

const getInstallCommand = (serverId) => {
  const HOST = API_BASE
  return `curl -sL ${HOST}/install.sh | bash -s install ${serverId} ${apiSecret.value} ${HOST}/update 60`
}

const getUninstallCommand = () => {
  return `curl -sL ${API_BASE}/install.sh | bash -s uninstall`
}

const copyCmd = async (cmd) => {
  try {
    await navigator.clipboard.writeText(cmd)
  } catch (e) {
    document.execCommand('copy')
  }
  
  const btn = event.target
  const originalText = btn.innerText
  btn.innerText = '✓'
  btn.style.color = 'var(--accent-green)'
  setTimeout(() => {
    btn.innerText = originalText
    btn.style.color = ''
  }, 1500)
}

const copyUninstallCmd = async () => {
  const cmd = getUninstallCommand()
  try {
    await navigator.clipboard.writeText(cmd)
  } catch (e) {
    document.execCommand('copy')
  }
  
  const btn = event.target
  const originalText = btn.innerText
  btn.innerText = '✓'
  btn.style.color = 'var(--accent-green)'
  setTimeout(() => {
    btn.innerText = originalText
    btn.style.color = ''
  }, 1500)
}

const openEditModal = (server) => {
  editForm.value = {
    id: server.id,
    name: server.name || '',
    server_group: server.server_group || '',
    price: server.price || '',
    expire_date: server.expire_date || '',
    bandwidth: server.bandwidth || '',
    traffic_limit: server.traffic_limit || '',
    is_hidden: server.is_hidden === '1'
  }
  showEditModal.value = true
}

const closeEditModal = () => {
  showEditModal.value = false
}

const saveEdit = async () => {
    const data = {
      action: 'edit',
      id: editForm.value.id,
      name: editForm.value.name,
      server_group: editForm.value.server_group,
      price: editForm.value.price,
      expire_date: editForm.value.expire_date,
      bandwidth: editForm.value.bandwidth,
      traffic_limit: editForm.value.traffic_limit,
      is_hidden: editForm.value.is_hidden ? '1' : '0'
    }

    try {
      const res = await adminApi(data)
      if (res.ok) {
        alert(trans.serverUpdated)
        location.reload()
      } else {
        alert(trans.saveFailed)
      }
    } catch (e) {
      alert(trans.saveFailed + e.message)
    }
  }

  const openDeleteModal = (id) => {
    deleteServerId.value = id
    showDeleteModal.value = true
  }

  const closeDeleteModal = () => {
    showDeleteModal.value = false
  }

  const confirmDelete = async () => {
    try {
      const res = await adminApi({ action: 'delete', id: deleteServerId.value })
      if (res.ok) {
        location.reload()
      } else {
        alert(trans.deleteFailed)
      }
    } catch (e) {
      alert(trans.deleteFailed + ': ' + e.message)
    }
  }

  const batchDelete = async () => {
    if (selectedServers.value.length === 0) return alert(trans.selectServers)
    if (!confirm(trans.confirmDeleteServers + selectedServers.value.length + trans.irreversible)) return

    try {
      const res = await adminApi({ action: 'batch_delete', ids: selectedServers.value })
      if (res.ok) {
        location.reload()
      } else {
        alert(trans.deleteFailed)
      }
    } catch (e) {
      alert(trans.deleteFailed + ': ' + e.message)
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

const getStatusColor = (server) => {
  const lastUpdated = new Date(server.last_updated).getTime()
  return (Date.now() - lastUpdated) < 300000 ? 'var(--accent-green)' : 'var(--accent-red)'
}

const getStatusText = (server) => {
    const lastUpdated = new Date(server.last_updated).getTime()
    return (Date.now() - lastUpdated) < 300000 ? trans.onlineStatus : trans.offlineStatus
  }

  let draggedRow = null

  const handleDragStart = (e) => {
    draggedRow = e.target.dataset.serverId
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
      const res = await adminApi({ action: 'save_order', orders })
      if (res.ok) {
        loadServers()
      }
    } catch (e) {
      console.error('[ERROR] Save order failed:', e)
    }
    
    draggedRow = null
  }

  const uploadBg = (e) => {
    const file = e.target.files[0]
    if (!file) return
    if (file.size > 800 * 1024) {
      alert(trans.imageSizeWarning)
    }
    const reader = new FileReader()
    reader.onload = function(event) {
      settings.value.custom_bg = event.target.result
    }
    reader.readAsDataURL(file)
  }

onMounted(() => {
  initAdmin()
})
</script>