<template>
  <div>
    <div v-if="!isLoggedIn" id="login-overlay" class="login-overlay">
      <div class="login-container">
        <div class="login-header">
          <div class="login-icon">🔐</div>
          <h2 class="login-title">{{ trans.adminLogin }}</h2>
          <p class="login-subtitle">{{ trans.enterCredentials }}</p>
        </div>
        <form @submit.prevent="handleLogin">
          <div v-if="isMultipleMode" class="login-form-group">
            <label class="login-label">{{ trans.apiEndpoint }}</label>
            <select v-model.number="selectedApiIndex" class="login-input" @change="handleApiIndexChange">
              <option
                v-for="(base, index) in apiBases"
                :key="index"
                :value="index"
              >
                [{{ index }}] {{ base }}
              </option>
            </select>
          </div>
          <div class="login-form-group">
            <label class="login-label">{{ trans.username }}</label>
            <input type="text" name="username" autocomplete="username" v-model="loginForm.username" required class="login-input" placeholder="admin">
          </div>
          <div class="login-form-group last">
            <label class="login-label">{{ trans.password }}</label>
            <div class="password-input-wrapper">
              <input :type="passwordVisible.login ? 'text' : 'password'" name="password" autocomplete="current-password" v-model="loginForm.password" required class="login-input" placeholder="••••••••">
              <button type="button" class="password-toggle" @click="togglePassword('login')">
                {{ passwordVisible.login ? '🙈' : '👁️' }}
              </button>
            </div>
          </div>
          <div v-if="turnstileSiteKey && (turnstileLoginEnabled || (turnstileEnabled && !turnstileVerified))" class="login-form-group">
            <div id="admin-turnstile-container"></div>
          </div>
          <div v-if="loginError" id="login-error" class="login-error">{{ loginError }}</div>
          <button type="submit" class="login-btn">{{ loginLoading ? '⏳' : trans.login }}</button>
        </form>
      </div>
      <Footer />
    </div>

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
            <button @click="loadServers" class="btn" :disabled="adminSiteLoading">↻ {{ trans.refresh }}</button>
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
        </div>

        <div id="tab-servers" class="tab-content" :class="{ active: activeTab === 'servers' }">
          <div class="alert alert-info alert-stack">
            <div class="alert-line">
              <span class="alert-icon">[i]</span>
              <span>{{ trans.clickToCopy }} <strong>📋</strong> {{ trans.installCommand }}</span>
            </div>
          </div>

          <div class="toolbar">
            <input type="text" v-model="newServerName" class="toolbar-input" :placeholder="'> ' + trans.serverName + '...'">
            <div class="toolbar-select-wrapper">
              <input type="text" v-model="newServerGroup" list="group-list" class="toolbar-select" :placeholder="trans.default || 'Default'">
              <datalist id="group-list">
                <option v-for="group in groups" :key="group" :value="group"></option>
              </datalist>
              <button v-if="newServerGroup" @click="newServerGroup = ''" class="toolbar-select-clear" title="Clear">✕</button>
            </div>
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
                  <th class="table-center-cell col-width-35">↕️</th>
                  <th class="col-width-30"><input type="checkbox" id="select-all" @change="handleSelectAll" class="checkbox-accent-green"></th>
                  <th>{{ trans.hostname.toUpperCase() }}</th>
                  <th>{{ trans.group.toUpperCase() }}</th>
                  <th>{{ trans.price.toUpperCase() }}</th>
                  <th>{{ trans.expirationDate.toUpperCase() }}</th>
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
                >
                  <td class="drag-handle table-center-cell" :title="trans.dragSort" draggable="true" @dragstart="handleDragStart" @dragover.prevent @drop="handleDrop($event, server.id)">⋮⋮</td>
                  <td class="table-center-cell"><input type="checkbox" class="server-checkbox" :value="server.id" v-model="selectedServers"></td>
                  <td>
                    <div class="server-info">
                      <span v-if="server.region && server.region !== 'xx'">
                        <img :src="'https://flagcdn.com/24x18/' + getFlagRegionCode(server.region) + '.png'" :alt="server.region" class="flag-img">
                      </span>
                      <span v-else>🏳️</span>
                      <router-link :to="'/server/' + server.id + (selectedApiIndex ? '?apiIndex=' + selectedApiIndex : '')" class="server-name-link">{{ server.name }}</router-link>
                    </div>
                  </td>
                  <td><span class="group-tag">{{ server.server_group || trans.default }}</span></td>
                  <td><span class="price-tag">{{ server.price || '-' }}</span></td>
                  <td><span class="date-text">{{ server.expire_date || '-' }}</span></td>
                  <td><span class="spec-text">{{ server.bandwidth || '-' }}</span></td>
                  <td><span class="spec-text">{{ server.traffic_limit ? formatBytes(server.traffic_limit * 1024 * 1024 * 1024) : '-' }}</span></td>
                  <td>
                    <span :style="{ color: getStatusColor(server) }" class="font-bold">{{ getStatusText(server) }}</span>
                  </td>
                  <td>
                    <div class="action-group">
                      <div class="action-btns">
                        <button @click="copyCmd(server.id)" class="btn btn-icon btn-green" :title="trans.copy">{{ copiedServerId === server.id ? '✅' : '📋' }}</button>
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
            <div class="settings-section" v-if="currentOrigin === selectedApiBase">
              <div class="section-title"><span>▸</span> {{ trans.appearance }}</div>

              <div class="form-row">
                <div class="form-group flex-1">
                  <label class="form-label">{{ trans.siteTitle }}</label>
                  <input type="text" v-model="settings.site_title" class="form-input" :placeholder="'Cloudflare Server Monitor'">
                </div>

                <div class="form-group  ">
                  <label class="form-label">{{ trans.bgImage }}</label>
                  <div class="flex" style="gap:8px;">
                    <input type="text" v-model="settings.custom_bg" class="form-input flex-1" placeholder="https://...">
                    <div class="upload-btn-wrapper">
                      <button class="btn btn-margin-0">📁 {{ trans.upload }}</button>
                      <input type="file" accept="image/*" @change="uploadBg">
                    </div>
                  </div>
                  <img v-if="settings.custom_bg" :src="settings.custom_bg" class="bg-preview">
                </div>
              </div>

              <div class="form-row">
                <div class="form-group flex-1">
                  <label class="form-label">{{ trans.customHead }}</label>
                  <textarea v-model="settings.custom_head" class="form-textarea" rows="3" placeholder="<link rel='stylesheet' href='...'">
                  </textarea>
                </div>

                <div class="form-group flex-1">
                  <label class="form-label">{{ trans.customScript }}</label>
                  <textarea v-model="settings.custom_script" class="form-textarea" rows="4" placeholder="console.log('Hello');">
                  </textarea>
                </div>
              </div>
            </div>

            <div>
              <div class="settings-section mb-5">
                <div class="section-title"><span>▸</span> {{ trans.displayOptions }}</div>

                <div class="form-row">
                  <div class="form-group flex-1 checkbox-item">
                    <input type="checkbox" id="cfg_is_public" v-model="settings.is_public">
                    <label><b>{{ trans.publicAccess }}</b></label>
                  </div>

                  <div class="form-group flex-1 checkbox-item">
                    <input type="checkbox" id="cfg_show_price" v-model="settings.show_price">
                    <label>{{ trans.showPrice }}</label>
                  </div>

                  <div class="form-group flex-1 checkbox-item">
                    <input type="checkbox" id="cfg_show_expire" v-model="settings.show_expire">
                    <label>{{ trans.showExpire }}</label>
                  </div>
                </div>


                <div class="form-row">
                  <div class="form-group flex-1 checkbox-item">
                    <input type="checkbox" id="cfg_show_bw" v-model="settings.show_bw">
                    <label>{{ trans.showBw }}</label>
                  </div>

                  <div class="form-group flex-1 checkbox-item">
                    <input type="checkbox" id="cfg_show_tf" v-model="settings.show_tf">
                    <label>{{ trans.showTf }}</label>
                  </div>

                  <div class="form-group flex-1 checkbox-item">
                    <input type="checkbox" id="cfg_show_time" v-model="settings.show_time">
                    <label>{{ trans.showTime }}</label>
                  </div>
                </div>

                <div class="form-group checkbox-item">
                  <input type="checkbox" id="cfg_show_long_history" v-model="settings.show_long_history">
                  <label>{{ trans.showLongHistory }} <span class="text-muted text-sm">{{ trans.showLongHistoryTip }}</span></label>
                </div>
              </div>

              <div class="settings-section">
                <div class="section-title"><span>▸</span> {{ trans.notifications }}</div>
                <div class="form-row">
                  <div class="form-group flex-1">
                    <label class="form-label">{{ trans.offlineAlert }}</label>
                    <select v-model="settings.tg_notify" class="form-select">
                      <option value="false">[OFF] {{ trans.disabled }}</option>
                      <option value="true">[ON] {{ trans.notifyOffline }}</option>
                    </select>
                  </div>

                  <div class="form-group flex-1">
                    <label class="form-label">{{ trans.expireReminder }}</label>
                    <select v-model="settings.expire_reminder" class="form-select">
                      <option value="false">[OFF] {{ trans.disabled }}</option>
                      <option value="true">[ON] {{ trans.notifyExpire }}</option>
                    </select>
                  </div>
                </div>
                <div class="form-row">
                  <div class="form-group flex-1">
                    <label class="form-label">{{ trans.telegramToken }}</label>
                    <div class="password-input-wrapper">
                      <input :type="passwordVisible.tgBotToken ? 'text' : 'password'" name="tg_bot_token" v-model="settings.tg_bot_token" class="form-input" placeholder="Bot Token or Webhook URL">
                      <button type="button" class="password-toggle" @click="togglePassword('tgBotToken')">
                        {{ passwordVisible.tgBotToken ? '🙈' : '👁️' }}
                      </button>
                    </div>
                  </div>

                  <div class="form-group flex-1">
                    <label class="form-label">{{ trans.chatId }}</label>
                    <div class="password-input-wrapper">
                      <input :type="passwordVisible.tgChatId ? 'text' : 'password'" name="tg_chat_id" autocomplete="off" v-model="settings.tg_chat_id" class="form-input" placeholder="Optional Chat ID">
                      <button type="button" class="password-toggle" @click="togglePassword('tgChatId')">
                        {{ passwordVisible.tgChatId ? '🙈' : '👁️' }}
                      </button>
                    </div>
                  </div>
                </div>
                <div class="form-row">
                  <div class="form-group flex-1">
                    <button @click="sendTestNotification" class="btn btn-primary" :disabled="testNotificationLoading">{{ testNotificationLoading ? '⏳' : '📨' }} {{ trans.sendTestNotification }}</button>
                  </div>
                </div>
              </div>
            </div>

            <div class="settings-section">
              <div class="section-title"><span>▸</span> {{ trans.securitySettings }}</div>

              <div class="form-row">
                <div class="form-group flex-1">
                  <div class="checkbox-item">
                    <input type="checkbox" id="cfg_turnstile_enabled" v-model="settings.turnstile_enabled">
                    <label><b>{{ trans.enableTurnstile }}</b></label>
                  </div>
                  </div>
                <div class="form-group flex-1">
                  <div class="checkbox-item">
                    <input type="checkbox" id="cfg_turnstile_login_enabled" v-model="settings.turnstile_login_enabled">
                    <label>{{ trans.enableTurnstileLogin }}</label>
                  </div>
                  <p class="text-muted text-sm mt-1 mb-3">
                    <span class="warning-icon">[i]</span>
                    {{ trans.turnstileLoginTip }}
                  </p>
                </div>
              </div>
              
              <div class="form-row">
                <div class="form-group flex-1">
                  <label class="form-label">{{ trans.turnstileSiteKey }}</label>
                  <input type="text" name="turnstile_site_key" autocomplete="off" v-model="settings.turnstile_site_key" class="form-input" :placeholder="trans.turnstileSiteKeyPlaceholder">
                </div>

                <div class="form-group flex-1">
                  <label class="form-label">{{ trans.turnstileSecretKey }}</label>
                  <div class="password-input-wrapper">
                    <input :type="passwordVisible.turnstileSecret ? 'text' : 'password'" name="turnstile_secret_key" autocomplete="off" v-model="settings.turnstile_secret_key" class="form-input" :placeholder="trans.turnstileSecretKeyPlaceholder">
                    <button type="button" class="password-toggle" @click="togglePassword('turnstileSecret')">
                      {{ passwordVisible.turnstileSecret ? '🙈' : '👁️' }}
                    </button>
                  </div>
                </div>
              </div>

              <p class="text-muted text-sm mt-2">
                <span class="warning-icon">[i]</span> 
                {{ trans.turnstileTip }}
              </p>

              <div class="form-group mt-4">
                <label class="form-label">{{ trans.jwtSecret }}</label>
                <div class="password-input-wrapper">
                  <input :type="passwordVisible.jwtSecret ? 'text' : 'password'" name="jwt_secret" autocomplete="off" v-model="settings.jwt_secret" class="form-input" :placeholder="trans.jwtSecretPlaceholder">
                  <button type="button" class="password-toggle" @click="togglePassword('jwtSecret')">
                    {{ passwordVisible.jwtSecret ? '🙈' : '👁️' }}
                  </button>
                </div>
              </div>

              <p class="text-muted text-sm mt-2">
                <span class="warning-icon">[i]</span> 
                {{ trans.jwtSecretTip }}
              </p>
            </div>

            <div class="settings-section">
              <div class="section-title"><span>▸</span> {{ trans.cloudflareSettings }}</div>
              
              <div class="form-row">
                <div class="form-group flex-1">
                  <label class="form-label">{{ trans.cloudflareAccountId }}</label>
                  <input type="text" name="cloudflare_account_id" autocomplete="off" v-model="settings.cloudflare_account_id" class="form-input" :placeholder="trans.cloudflareAccountIdPlaceholder">
                </div>

                <div class="form-group flex-1">
                  <label class="form-label">Cloudflare API Token</label>
                  <div class="password-input-wrapper">
                    <input :type="passwordVisible.cloudflareToken ? 'text' : 'password'" name="cloudflare_token" autocomplete="off" v-model="settings.cloudflare_token" class="form-input" :placeholder="trans.cloudflareTokenPlaceholder">
                    <button type="button" class="password-toggle" @click="togglePassword('cloudflareToken')">
                      {{ passwordVisible.cloudflareToken ? '🙈' : '👁️' }}
                    </button>
                  </div>
                </div>
              </div>

              <div class="form-row">
                <div class="form-group  flex-1">
                  <button @click="queryD1Usage" class="btn btn-primary btn-lg" :disabled="d1UsageLoading">{{ d1UsageLoading ? '⏳' : '🔍' }} {{ trans.queryD1Quota }}</button>
                </div>
                <div class="form-group  flex-1">
                  <p class="text-muted text-sm mt-2">
                    <span class="warning-icon">[i]</span> 
                    {{ trans.cloudflareTokenTip }}
                  </p>
                </div>
              </div>

            </div>

            <div class="settings-section">
              <div class="section-title"><span>▸</span> {{ trans.adminLoginSettings }}</div>

              <div class="form-group">
                <label class="form-label">{{ trans.username }}</label>
                <input type="text" name="admin_username" autocomplete="username" v-model="settings.username" class="form-input" :placeholder="trans.usernamePlaceholder">
              </div>

              <div class="form-row">
                <div class="form-group flex-1">
                  <label class="form-label">{{ trans.password }}</label>
                  <div class="password-input-wrapper">
                    <input :type="passwordVisible.password ? 'text' : 'password'" name="admin_password" autocomplete="new-password" v-model="settings.password" class="form-input" placeholder="••••••••">
                    <button type="button" class="password-toggle" @click="togglePassword('password')">
                      {{ passwordVisible.password ? '🙈' : '👁️' }}
                    </button>
                  </div>
                </div>

                <div class="form-group flex-1">
                  <label class="form-label">{{ trans.confirmPassword }}</label>
                  <div class="password-input-wrapper">
                    <input :type="passwordVisible.confirmPassword ? 'text' : 'password'" name="admin_confirm_password" autocomplete="new-password" v-model="settings.confirm_password" class="form-input" placeholder="••••••••">
                    <button type="button" class="password-toggle" @click="togglePassword('confirmPassword')">
                      {{ passwordVisible.confirmPassword ? '🙈' : '👁️' }}
                    </button>
                  </div>
                </div>
              </div>

              <p class="text-muted text-sm mt-2">
                <span class="warning-icon">[i]</span>
                {{ trans.apiSecretTip }}
              </p>
            </div>

            <div class="settings-section">
              <div class="section-title"><span>▸</span> {{ trans.pingNodes }}</div>
              
              <div class="form-row">
                <div class="form-group flex-1">
                  <label class="form-label">{{ trans.customCt }}</label>
                  <input type="text" v-model="settings.custom_ct" class="form-input" placeholder="gd-ct-dualstack.ip.zstaticcdn.com">
                </div>

                <div class="form-group flex-1">
                  <label class="form-label">{{ trans.customCu }}</label>
                  <input type="text" v-model="settings.custom_cu" class="form-input" placeholder="gd-cu-dualstack.ip.zstaticcdn.com">
                </div>
              </div>
              <div class="form-row">
                <div class="form-group flex-1">
                  <label class="form-label">{{ trans.customCm }}</label>
                  <input type="text" v-model="settings.custom_cm" class="form-input" placeholder="gd-cm-dualstack.ip.zstaticcdn.com">
                </div>

                <div class="form-group flex-1">
                  <label class="form-label">{{ trans.customBd }}</label>
                  <input type="text" v-model="settings.custom_bd" class="form-input" placeholder="lf3-ips.zstaticcdn.com">
                </div>
              </div>
            </div>
          </div>

          <div class="text-right mt-5">
            <button @click="saveSettings" class="btn btn-primary btn-lg" :disabled="saving">{{ saving ? '⏳' : '💾' }} {{ saving ? trans.saving : trans.saveConfig }}</button>
          </div>
        </div>

        <div id="tab-database" class="tab-content" :class="{ active: activeTab === 'database' }">
          <div class="settings-section">
            <div class="section-title"><span>▸</span> {{ trans.dbManagement }}</div>
            
            <div class="settings-grid">
              <div class="form-group">
                <label class="form-label">{{ trans.upgradeDatabase }}</label>
                <p class="text-muted mb-2">{{ trans.upgradeDesc }}</p>
                <button @click="openDbModal('upgrade')" class="btn btn-primary btn-lg" :disabled="dbLoading">⬆️ {{ trans.upgradeDatabase }}</button>
              </div>

              <div class="form-group">
                <label class="form-label danger-label">⚠️ {{ trans.clearHistory }}</label>
                <p class="text-muted mb-2">{{ trans.clearHistoryDesc }}</p>
                <button @click="openDbModal('clearHistory')" class="btn btn-red btn-lg" :disabled="dbLoading">🗑️ {{ trans.clearHistory }}</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div id="editModal" class="modal-overlay" :class="{ active: showEditModal }">
        <div class="modal-dialog">
          <div class="modal-header">
            <div class="modal-title">{{ currentServerName }}</div>
            <button class="modal-close" @click="closeEditModal">✕</button>
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
              <label class="form-label">{{ trans.price }}</label>
              <input type="text" name="edit_price" autocomplete="off" v-model="editForm.price" class="form-input" placeholder="e.g. $40/Y">
            </div>

            <div class="form-group flex-1">
              <label class="form-label">{{ trans.expirationDate }}</label>
              <input type="date" name="edit_expire_date" autocomplete="off" v-model="editForm.expire_date" class="form-input">
            </div>

            <div class="form-group flex-1">
              <label class="form-label">{{ trans.bandwidth }}</label>
              <input type="text" name="edit_bandwidth" autocomplete="off" v-model="editForm.bandwidth" class="form-input" placeholder="e.g. 1Gbps">
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
            <div class="form-group flex-1">
              <label class="form-label">{{ trans.pingMode }}</label>
              <select v-model="editForm.ping_mode" class="form-select">
                <option value="http">HTTP</option>
                <option value="tcp">TCP</option>
              </select>
            </div>
          </div>
          <div class="text-muted text-sm mb-3">
            <span class="warning-icon">[i]</span> {{ trans.collectIntervalHint }}<br>
            <span class="warning-icon">[i]</span> {{ trans.trafficResetDayTip }}
          </div>
          <div class="form-row">
            <div class="form-group">
              <div class="checkbox-item no-margin">
                <input type="checkbox" v-model="editForm.is_hidden">
                <label>
                  <b>{{ trans.hideFromPublic }}</b><br>
                  <span class="text-xs text-muted">{{ trans.hideDesc }}</span>
                </label>
              </div>
            </div>

            <div v-if="settings.tg_notify === 'true' && settings.tg_bot_token" class="form-group">
              <div class="checkbox-item no-margin">
                <input type="checkbox" v-model="editForm.offline_notify_disabled">
                <label>
                  <b>{{ trans.disableOfflineNotify }}</b><br>
                  <span class="text-xs text-muted">{{ trans.disableOfflineNotifyDesc }}</span>
                </label>
              </div>
            </div>
          </div>

          <div class="modal-footer flex-justify-between">
            <button @click="saveEdit" class="btn btn-primary">{{ trans.save }}</button>
            <button @click="closeEditModal" class="btn">{{ trans.cancel }}</button>
          </div>
        </div>
      </div>

      <div id="deleteModal" class="modal-overlay" :class="{ active: showDeleteModal }">
        <div class="modal-dialog">
          <div class="modal-header">
            <div class="modal-title">{{ currentServerName }}</div>
            <button class="modal-close" @click="closeDeleteModal">✕</button>
          </div>
          <input type="hidden" v-model="deleteServerId">

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

          <div class="form-group mb-3">
            <label class="form-label">{{ trans.targetOs }}</label>
            <select v-model="deleteTargetOs" class="form-select">
              <option value="linux">Linux (Ubuntu/Debian/CentOS)</option>
              <option value="alpine">Alpine Linux</option>
              <option value="openwrt">OpenWrt / LEDE / ImmortalWrt</option>
              <option value="mac">macOS (Intel / Apple Silicon)</option>
              <option value="windows">Windows</option>
            </select>
          </div>

          <div class="cmd-input-wrapper mb-3" :class="{ copied: uninstallCopied }">
            <span class="cmd-prompt">{{ deleteTargetOs === 'windows' ? 'PS' : '$' }}</span>
            <input type="text" readonly :value="getUninstallCommand()" class="cmd-input flex-1">
            <button @click="copyUninstallCmd" class="btn btn-icon btn-green ml-2" :title="trans.copy">{{ uninstallCopied ? '✅' : '📋' }}</button>
          </div>

          <p class="text-muted mb-4">
            <span class="warning-icon">[i]</span> {{ trans.clickToCopyCmd }}
          </p>

          <div class="modal-footer flex-justify-between">
            <button @click="confirmDelete" class="btn btn-red">{{ trans.confirmDelete }}</button>
            <button @click="closeDeleteModal" class="btn">{{ trans.cancelAction }}</button>
          </div>
        </div>
      </div>

      <div id="copyModal" class="modal-overlay" :class="{ active: showCopyModal }">
        <div class="modal-dialog">
          <div class="modal-header">
            <div class="modal-title">{{ currentServerName }}</div>
            <button class="modal-close" @click="closeCopyModal">✕</button>
          </div>

          <div class="form-group">
            <label class="form-label">{{ trans.targetOs }}</label>
            <select v-model="targetOs" class="form-select">
              <option value="linux">Linux (Ubuntu/Debian/CentOS)</option>
              <option value="alpine">Alpine Linux</option>
              <option value="openwrt">OpenWrt / LEDE / ImmortalWrt</option>
              <option value="mac">macOS (Intel / Apple Silicon)</option>
              <option value="windows">Windows</option>
            </select>
          </div>

          <div class="form-row">
            <div class="form-group flex-1">
              <label class="form-label">{{ trans.customCt }}</label>
              <input type="text" name="custom_ct" autocomplete="off" v-model="customCt" class="form-input" placeholder="gd-ct-dualstack.ip.zstaticcdn.com">
            </div>
            <div class="form-group flex-1">
              <label class="form-label">{{ trans.customCu }}</label>
              <input type="text" name="custom_cu" autocomplete="off" v-model="customCu" class="form-input" placeholder="gd-cu-dualstack.ip.zstaticcdn.com">
            </div>
          </div>

          <div class="form-row">
            <div class="form-group flex-1">
              <label class="form-label">{{ trans.customCm }}</label>
              <input type="text" name="custom_cm" autocomplete="off" v-model="customCm" class="form-input" placeholder="gd-cm-dualstack.ip.zstaticcdn.com">
            </div>
            <div class="form-group flex-1">
              <label class="form-label">{{ trans.customBd }}</label>
              <input type="text" name="custom_bd" autocomplete="off" v-model="customBd" class="form-input" placeholder="lf3-ips.zstaticcdn.com">
            </div>
          </div>

          <div class="form-row">
            <div class="form-group flex-1">
              <label class="form-label">{{ trans.collectInterval }}</label>
              <div class="flex items-center gap-2">
                <input type="text" readonly :value="collectInterval" class="form-input">
              </div>
            </div>
            <div class="form-group flex-1">
              <label class="form-label">{{ trans.reportInterval }}</label>
              <div class="flex items-center gap-2">
                <input type="text" readonly :value="reportInterval" class="form-input">
              </div>
            </div>
            <div class="form-group flex-1">
              <label class="form-label">{{ trans.pingMode }}</label>
              <div class="flex items-center gap-2">
                <input type="text" readonly :value="pingMode.toUpperCase()" class="form-input">
              </div>
            </div>
            <div class="form-group flex-1">
              <label class="form-label">{{ trans.trafficResetDay }}</label>
              <div class="flex items-center gap-2">
                <input type="text" readonly :value="resetDay" class="form-input">
                <button @click="openEditModalFromCopy" class="btn btn-icon btn-blue" :title="trans.edit">✏️</button>
              </div>
            </div>
          </div>

          <div class="form-row">
            <div class="form-group flex-1">
              <label class="form-label">{{ trans.rxCorrection }} (GB)</label>
              <input type="number" name="rx_correction" autocomplete="off" v-model="rxCorrection" class="form-input" placeholder="0" min="0" step="1">
            </div>
            <div class="form-group flex-1">
              <label class="form-label">{{ trans.txCorrection }} (GB)</label>
              <input type="number" name="tx_correction" autocomplete="off" v-model="txCorrection" class="form-input" placeholder="0" min="0" step="1">
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">{{ trans.installCommand }}</label>
            <div class="cmd-input-wrapper" :class="{ copied: copiedCmd }">
              <span class="cmd-prompt">{{ targetOs === 'windows' ? 'PS' : '$' }}</span>
              <input type="text" readonly :value="getCustomInstallCommand()" class="cmd-input flex-1">
            </div>
          </div>

          <div class="modal-footer flex-justify-between">
            <button @click="copyCustomCmd" class="btn btn-primary">{{ copiedCmd ? '✅ ' + trans.copied : '📋 ' + trans.copy }}</button>
            <button @click="closeCopyModal" class="btn">{{ trans.cancel }}</button>
          </div>
        </div>
      </div>

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
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import TerminalHeader from '../components/TerminalHeader.vue'
import Footer from '../components/Footer.vue'
import { adminApi, login, logout as apiLogout, formatBytes, upgradeDatabase, clearHistory, getFlagRegionCode, getApiBases } from '../utils/api'
import { hasMultipleApiBases } from '../utils/config.js'
import { t, currentLang, useTranslation } from '../utils/i18n'
import { http } from '../utils/http'
import { usePasswordVisibility } from '../composables/usePasswordVisibility'

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

const formatNumber = (value) => Number(value || 0).toLocaleString()
const formatUtcDateTime = (value) => value ? new Date(value).toISOString().replace('T', ' ').slice(0, 19) : '-'
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
const turnstileEnabled = ref(false)
const turnstileLoginEnabled = ref(false)
const turnstileSiteKey = ref('')
const turnstileToken = ref('')
const turnstileVerified = ref(false)
const turnstileBlocked = ref(false)
const activeTab = ref('servers')
const servers = ref([])
const selectedServers = ref([])
const stats = ref({ total: '-', online: 0, offline: 0, avg_cpu: 0 })
const groups = ref(['Default'])
const newServerName = ref('')
const newServerGroup = ref('')

const settings = ref({
  site_title: '',
  custom_bg: '',
  custom_head: '',
  custom_script: '',
  is_public: false,
  show_price: true,
  show_expire: true,
  show_bw: true,
  show_tf: true,
  show_time: true,
  show_long_history: false,
  tg_notify: 'false',
  expire_reminder: 'false',
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
  custom_bd: ''
})
const apiSecret = ref('')

const { visibility: passwordVisible, toggle: togglePassword } = usePasswordVisibility([
  'login', 'tgBotToken', 'tgChatId', 'turnstileSecret', 'cloudflareToken', 'jwtSecret', 'password', 'confirmPassword'
])

const showEditModal = ref(false)
const editResetDayRef = ref(null)
const editForm = ref({
  id: '',
  name: '',
  server_group: '',
  price: '',
  expire_date: '',
  bandwidth: '',
  traffic_limit: '',
  traffic_calc_type: 'total',
  reset_day: 1,
  collect_interval: 0,
  report_interval: 60,
  ping_mode: 'http',
  is_hidden: false,
  offline_notify_disabled: false
})

const showDeleteModal = ref(false)
const deleteServerId = ref('')

const copiedServerId = ref(null)
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

const testNotificationLoading = ref(false)

const saveResult = ref(null)

const showCopyModal = ref(false)
const copyServerId = ref('')
const currentServerName = ref('')
const targetOs = ref('linux')
const collectInterval = ref(0)
const reportInterval = ref(60)
const pingMode = ref('http')
const customCt = ref('')
const customCu = ref('')
const customCm = ref('')
const customBd = ref('')
const resetDay = ref(1)
const rxCorrection = ref('')
const txCorrection = ref('')
const trafficCalcType = ref('total')
const copiedCmd = ref(false)

const handleLogin = async () => {
    loginError.value = ''
    loginLoading.value = true
    
    if (turnstileBlocked.value) {
      loginError.value = trans.value.turnstileSiteKeyMismatchDesc
      loginLoading.value = false
      return
    }

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
      turnstileToken.value = ''
      turnstileVerified.value = hasSharedTurnstileVerified()
      localStorage.removeItem('turnstile_token')
      loadSettings()
      loadServers()
    } else {
      loginError.value = trans.value.errorInvalidUsername
      loginForm.value.password = ''
      turnstileToken.value = ''
      localStorage.removeItem('turnstile_token')
      if (window.turnstile) {
        window.turnstile.reset('#admin-turnstile-container')
      }
    }
    loginLoading.value = false
  }

const logout = async () => {
  apiLogout()
  isLoggedIn.value = false
  localStorage.removeItem('turnstile_token')
  turnstileToken.value = ''
  
  await loadTurnstileConfig()
}

const checkLoginStatus = () => {
  const token = localStorage.getItem('jwt_token')
  return !!token
}

const isTurnstileValueEnabled = (value) => value === true || value === 'true'
const normalizeTurnstileSiteKey = (value) => String(value || '').trim()
const hasSharedTurnstileVerified = () => !!localStorage.getItem('turnstile_verified')

const getTurnstileEnabledSites = (results) => {
  return results
    .map((result, index) => ({ result, index }))
    .filter(({ result }) => {
      if (result.error || !result.data) return false
      return isTurnstileValueEnabled(result.data.turnstile_enabled) || isTurnstileValueEnabled(result.data.turnstile_login_enabled)
    })
    .map(({ result, index }) => ({
      index,
      data: result.data,
      siteKey: normalizeTurnstileSiteKey(result.data.turnstile_site_key)
    }))
}

const hasTurnstileSiteKeyMismatch = (sites) => {
  const keys = [...new Set(sites.map(site => site.siteKey).filter(Boolean))]
  return sites.some(site => !site.siteKey) || keys.length > 1
}

const fetchAllTurnstileConfigs = async () => {
  let results = await http.getAll('/api/config', { includeAuth: true, includeTurnstile: true, autoRedirect: false })
  if (results.some(result => result.status === 403)) {
    results = await http.getAll('/api/config', { includeAuth: true, includeTurnstile: false, autoRedirect: false })
  }
  return results
}

const applyTurnstileConfig = async (config, sharedSiteKey = '') => {
  if (!config) return

  turnstileEnabled.value = isTurnstileValueEnabled(config.turnstile_enabled)
  turnstileLoginEnabled.value = isTurnstileValueEnabled(config.turnstile_login_enabled)

  const requiresTurnstile = turnstileEnabled.value || turnstileLoginEnabled.value
  turnstileSiteKey.value = requiresTurnstile ? (sharedSiteKey || config.turnstile_site_key || '') : ''
  turnstileVerified.value = turnstileEnabled.value && (config.verified === true || hasSharedTurnstileVerified())

  if (turnstileSiteKey.value && (turnstileLoginEnabled.value || (turnstileEnabled.value && !turnstileVerified.value))) {
    await loadTurnstileScript()
    await nextTick()
    renderTurnstile()
  }
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
    loadSettings()
    loadServers()
  } else {
    await loadTurnstileConfig()
  }
}

const loadTurnstileConfig = async () => {
  try {
    turnstileEnabled.value = false
    turnstileLoginEnabled.value = false
    turnstileSiteKey.value = ''
    turnstileToken.value = ''
    turnstileVerified.value = false
    turnstileBlocked.value = false
    loginError.value = ''
    localStorage.removeItem('turnstile_token')

    if (isMultipleMode.value) {
      const results = await fetchAllTurnstileConfigs()
      const enabledSites = getTurnstileEnabledSites(results)

      if (hasTurnstileSiteKeyMismatch(enabledSites)) {
        turnstileBlocked.value = true
        loginError.value = trans.value.turnstileSiteKeyMismatchDesc
        return
      }

      const selectedResult = results[selectedApiIndex.value]
      const selectedConfig = selectedResult && !selectedResult.error ? selectedResult.data : null
      await applyTurnstileConfig(selectedConfig, enabledSites[0]?.siteKey || '')
      return
    }

    const result = await http.getByIndex('/api/config', selectedApiIndex.value, { includeAuth: true, includeTurnstile: true })
    if (!result.error) {
      await applyTurnstileConfig(result.data)
    }
  } catch (e) {
    console.error('Failed to load Turnstile config:', e)
  }
}

const handleApiIndexChange = async () => {
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
      loadServers()
    ])
  } finally {
    adminSiteLoading.value = false
  }
}

const handleAdminApiIndexChange = async () => {
  syncApiIndexQuery()
  await switchAdminSite()
}

const loadTurnstileScript = () => {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js'
    script.async = true
    script.onload = resolve
    script.onerror = reject
    document.head.appendChild(script)
  })
}

const renderTurnstile = () => {
  if (window.turnstile) {
    window.turnstile.render('#admin-turnstile-container', {
      sitekey: turnstileSiteKey.value,
      callback: (token) => {
        turnstileToken.value = token
        localStorage.setItem('turnstile_token', token)
      },
      errorCallback: () => {
        turnstileToken.value = ''
        localStorage.removeItem('turnstile_token')
      },
      expiredCallback: () => {
        turnstileToken.value = ''
        localStorage.removeItem('turnstile_token')
      }
    })
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
        custom_head: settingsData.custom_head || '',
        custom_script: settingsData.custom_script || '',
        is_public: settingsData.is_public === 'true',
        show_price: settingsData.show_price === 'true',
        show_expire: settingsData.show_expire === 'true',
        show_bw: settingsData.show_bw === 'true',
        show_tf: settingsData.show_tf === 'true',
        show_time: settingsData.show_time === 'true',
        show_long_history: settingsData.show_long_history === 'true',
        tg_notify: settingsData.tg_notify || 'false',
        expire_reminder: settingsData.expire_reminder || 'false',
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
        password: '',  // 不显示加密后的密码
        custom_ct: settingsData.custom_ct || '',
        custom_cu: settingsData.custom_cu || '',
        custom_cm: settingsData.custom_cm || '',
        custom_bd: settingsData.custom_bd || ''
      }
      apiSecret.value = data.api_secret || ''
    }
  } catch (e) {
    console.error('[ERROR] Load settings failed:', e)
  }
}

const saveSettings = async () => {
    if (saving.value) return

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

    // 只有当用户输入了新密码时才验证密码确认
    if (settings.value.password && settings.value.password.length > 0) {
      if (settings.value.password !== settings.value.confirm_password) {
        validationError.value = trans.value.passwordMismatch
        return
      }
    }

    // 如果 turnstile_enabled 或 turnstile_login_enabled 开启，验证 turnstile_site_key 和 turnstile_secret_key 都不为空
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

    // 如果 tg_notify 或 expire_reminder 开启，验证 tg_bot_token 不为空
    if (settings.value.tg_notify === 'true' || settings.value.expire_reminder === 'true') {
      if (!settings.value.tg_bot_token || settings.value.tg_bot_token.trim().length === 0) {
        validationError.value = trans.value.tgBotTokenRequired
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
        custom_head: settings.value.custom_head,
        custom_script: settings.value.custom_script,
        is_public: settings.value.is_public ? 'true' : 'false',
        show_price: settings.value.show_price ? 'true' : 'false',
        show_expire: settings.value.show_expire ? 'true' : 'false',
        show_bw: settings.value.show_bw ? 'true' : 'false',
        show_tf: settings.value.show_tf ? 'true' : 'false',
        show_time: settings.value.show_time ? 'true' : 'false',
        show_long_history: settings.value.show_long_history ? 'true' : 'false',
        tg_notify: settings.value.tg_notify,
        expire_reminder: settings.value.expire_reminder,
        tg_bot_token: settings.value.tg_bot_token,
        tg_chat_id: settings.value.tg_chat_id,
        turnstile_enabled: settings.value.turnstile_enabled ? 'true' : 'false',
        turnstile_login_enabled: settings.value.turnstile_login_enabled ? 'true' : 'false',
        turnstile_site_key: settings.value.turnstile_site_key,
        turnstile_secret_key: settings.value.turnstile_secret_key,
        cloudflare_account_id: settings.value.cloudflare_account_id,
        cloudflare_token: settings.value.cloudflare_token,
        username: settings.value.username,
        custom_ct: settings.value.custom_ct,
        custom_cu: settings.value.custom_cu,
        custom_cm: settings.value.custom_cm,
        custom_bd: settings.value.custom_bd
      }
    }

    // 只有当用户输入了新密码时才保存密码
    if (settings.value.password && settings.value.password.length > 0) {
      data.settings.password = settings.value.password
    }

    // JWT secret is write-only: only submit it when the user enters a new key.
    if (jwtSecret && jwtSecret.length > 0) {
      data.settings.jwt_secret = jwtSecret
    }

    try {
      const result = await adminApiForSite(data)
      if (!result.error) {
        saveResult.value = { success: true }
        settings.value.password = ''
        settings.value.confirm_password = ''
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
  pingMode.value = server?.ping_mode || 'http'
  customCt.value = settings.value.custom_ct
  customCu.value = settings.value.custom_cu
  customCm.value = settings.value.custom_cm
  customBd.value = settings.value.custom_bd
  resetDay.value = server?.reset_day ?? 1
  rxCorrection.value = ''
  txCorrection.value = ''
  trafficCalcType.value = server?.traffic_calc_type || 'total'
  copiedCmd.value = false
  showCopyModal.value = true
}

const getCustomInstallCommand = () => {
  const HOST = selectedApiBase.value
  if (targetOs.value === 'windows') {
    const params = [
      'install',
      `-Id '${copyServerId.value}'`,
      `-Secret '${apiSecret.value}'`,
      `-Url '${HOST}/update'`,
      `-CollectInterval ${collectInterval.value}`,
      `-ReportInterval ${reportInterval.value}`,
      `-PingType ${pingMode.value}`,
      `-ResetDay ${resetDay.value ?? 1}`
    ]
    if (customCt.value) params.push(`-CtNode '${customCt.value}'`)
    if (customCu.value) params.push(`-CuNode '${customCu.value}'`)
    if (customCm.value) params.push(`-CmNode '${customCm.value}'`)
    if (customBd.value) params.push(`-BdNode '${customBd.value}'`)
    if (rxCorrection.value && rxCorrection.value !== '') params.push(`-RxCorrection ${rxCorrection.value}`)
    if (txCorrection.value && txCorrection.value !== '') params.push(`-TxCorrection ${txCorrection.value}`)
    return `irm ${HOST}/cf-server-monitor.ps1 -OutFile cf-server-monitor.ps1; powershell -ExecutionPolicy Bypass -File .\\cf-server-monitor.ps1 ${params.join(' ')}`
  }
  const shell = targetOs.value === 'alpine' || targetOs.value === 'openwrt' ? 'sh' : 'bash'
  const sudoPrefix = targetOs.value === 'mac' ? 'sudo ' : ''
  const script = targetOs.value === 'alpine' ? 'install-alpine.sh'
    : targetOs.value === 'openwrt' ? 'install-openwrt.sh'
    : targetOs.value === 'mac' ? 'install-mac.sh'
    : 'install.sh'
  let cmd = `curl -sL ${HOST}/${script} | ${sudoPrefix}${shell} -s install -id=${copyServerId.value} -secret='${apiSecret.value}' -url=${HOST}/update -collect_interval=${collectInterval.value} -interval=${reportInterval.value} -ping=${pingMode.value} -reset_day=${resetDay.value ?? 1}`
  if (customCt.value) cmd += ` -ct=${customCt.value}`
  if (customCu.value) cmd += ` -cu=${customCu.value}`
  if (customCm.value) cmd += ` -cm=${customCm.value}`
  if (customBd.value) cmd += ` -bd=${customBd.value}`
  if (rxCorrection.value && rxCorrection.value !== '') cmd += ` -rx_correction=${rxCorrection.value}`
  if (txCorrection.value && txCorrection.value !== '') cmd += ` -tx_correction=${txCorrection.value}`
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
    nextTick(() => {
      editResetDayRef.value?.focus()
    })
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
    price: server.price || '',
    expire_date: server.expire_date || '',
    bandwidth: server.bandwidth || '',
    traffic_limit: server.traffic_limit || '',
    traffic_calc_type: server.traffic_calc_type || 'total',
    reset_day: server.reset_day ?? 1,
    collect_interval: server.collect_interval ?? 0,
    report_interval: server.report_interval || 60,
    ping_mode: server.ping_mode || 'http',
    is_hidden: server.is_hidden === '1',
    offline_notify_disabled: server.offline_notify_disabled === '1'
  }
  currentServerName.value = server.name || ''
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
      traffic_calc_type: editForm.value.traffic_calc_type,
      reset_day: editForm.value.reset_day,
      collect_interval: editForm.value.collect_interval,
      report_interval: editForm.value.report_interval,
      ping_mode: editForm.value.ping_mode,
      is_hidden: editForm.value.is_hidden ? '1' : '0',
      offline_notify_disabled: editForm.value.offline_notify_disabled ? '1' : '0'
    }

    try {
      const result = await adminApiForSite(data)
      if (!result.error) {
        saveResult.value = { success: true, message: getMessage(result.data.message) || trans.value.serverEdited }
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

const getStatusColor = (server) => {
  return server.is_online ? 'var(--accent-green)' : 'var(--accent-red)'
}

const getStatusText = (server) => {
  let status = server.is_online ? '● ' + trans.value.online : '● ' + trans.value.offline
  return status.toUpperCase()
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

  const uploadBg = (e) => {
    const file = e.target.files[0]
    if (!file) return
    if (file.size > 800 * 1024) {
      alertMessage.value = trans.value.imageSizeWarning
      return
    }
    const reader = new FileReader()
    reader.onload = function(event) {
      settings.value.custom_bg = event.target.result
    }
    reader.readAsDataURL(file)
  }

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

  try {
    const result = await adminApiForSite({ action: 'd1_usage' })
    if (!result.error) {
      d1UsageResult.value = result.data
    } else {
      d1UsageResult.value = { success: false, error: result.error || 'Fail' }
    }
  } catch (e) {
    d1UsageResult.value = { success: false, error: e.message }
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
