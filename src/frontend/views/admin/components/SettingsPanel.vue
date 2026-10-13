<template>
  <div id="tab-settings" class="tab-content" :class="{ active: activeTab === 'settings' }">
    <div class="settings-grid">
      <div class="settings-section" v-if="currentOrigin === selectedApiBase">
        <div class="section-title"><span>▸</span> {{ trans.appearance }} 1</div>

        <div class="form-row">
          <div class="form-group flex-1">
            <label class="form-label">{{ trans.siteTitle }}</label>
            <input type="text" v-model="settings.site_title" class="form-input" :placeholder="'Cloudflare Server Monitor'">
          </div>

          <div class="form-group flex-1">
            <label class="form-label">{{ trans.displayMode }}</label>
            <select v-model="settings.display_mode" class="form-select">
              <option value="bar">{{ trans.displayModeBar }}</option>
              <option value="ring">{{ trans.displayModeRing }}</option>
              <option value="table">{{ trans.displayModeTable }}</option>
            </select>
          </div>
        </div>

        <div class="form-row">
          <div class="form-group flex-1">
            <label class="form-label">{{ trans.defaultTheme }}</label>
            <select v-model="settings.preferred_theme" class="form-select">
              <option value="auto">{{ trans.themeAuto }}</option>
              <option value="dark">{{ trans.themeDark }}</option>
              <option value="light">{{ trans.themeLight }}</option>
            </select>
          </div>

          <div class="form-group flex-1">
            <label class="form-label">{{ trans.defaultLanguage }}</label>
            <select v-model="settings.default_language" class="form-select">
              <option value="auto">{{ trans.languageAuto }}</option>
              <option value="zh">{{ trans.languageChinese }}</option>
              <option value="en">{{ trans.languageEnglish }}</option>
              <option value="es">{{ trans.languageSpanish }}</option>
            </select>
          </div>
        </div>

        <div class="form-row">
          <div class="form-group ">
            <label class="form-label">
              {{ trans.bgImage }}
              <HelpTooltip :text="trans.remoteImageTip" />
            </label>
            <div class="flex" style="gap:8px;">
              <input type="text" v-model="settings.custom_bg" class="form-input flex-1" placeholder="https://...">
              <div class="upload-btn-wrapper">
                <button class="btn btn-margin-0">📁 {{ trans.upload }}</button>
                <input type="file" accept="image/*" @change="$emit('upload-bg', $event)">
              </div>
            </div>
            <img v-if="settings.custom_bg" :src="settings.custom_bg" class="bg-preview">
          </div>

          <div class="form-group">
            <label class="form-label">
              {{ trans.mobileBgImage }}
              <HelpTooltip :text="trans.remoteImageTip" />
            </label>
            <div class="flex" style="gap:8px;">
              <input type="text" v-model="settings.custom_bg_mobile" class="form-input flex-1" placeholder="https://...">
              <div class="upload-btn-wrapper">
                <button class="btn btn-margin-0">📁 {{ trans.upload }}</button>
                <input type="file" accept="image/*" @change="$emit('upload-bg-mobile', $event)">
              </div>
            </div>
            <img v-if="settings.custom_bg_mobile" :src="settings.custom_bg_mobile" class="bg-preview">
          </div>

          <div class="form-group">
            <label class="form-label">
              {{ trans.favicon }}
              <HelpTooltip :text="trans.remoteImageTip" />
            </label>
            <div class="flex" style="gap:8px;">
              <input type="text" v-model="settings.favicon" class="form-input flex-1" placeholder="https://...">
              <div class="upload-btn-wrapper">
                <button class="btn btn-margin-0">📁 {{ trans.upload }}</button>
                <input type="file" accept="image/*,.ico" @change="$emit('upload-favicon', $event)">
              </div>
            </div>
            <img v-if="settings.favicon" :src="settings.favicon" class="bg-preview">
          </div>
        </div>

        <div class="form-row">
          <div class="form-group flex-1">
            <label class="form-label">
              {{ trans.cspStatic }}
              <HelpTooltip :text="trans.cspStaticTip" />
            </label>
            <input type="text" v-model="settings.csp_static" class="form-input" placeholder="https://unpkg.com,https://cdn.jsdelivr.net" @blur="validateCspField('csp_static')">
            <p v-if="cspErrors.csp_static" class="text-danger text-sm">{{ cspErrors.csp_static }}</p>
          </div>

          <div class="form-group flex-1">
            <label class="form-label">
              {{ trans.cspApi }}
              <HelpTooltip :text="trans.cspApiTip" />
            </label>
            <input type="text" v-model="settings.csp_api" class="form-input" placeholder="https://api.example.com" @blur="validateCspField('csp_api')">
            <p v-if="cspErrors.csp_api" class="text-danger text-sm">{{ cspErrors.csp_api }}</p>
          </div>
        </div>
      </div>

      <div class="settings-section" v-if="currentOrigin === selectedApiBase">
        <div class="section-title"><span>▸</span> {{ trans.appearance }} 2</div>

        <div class="form-row">
          <div class="form-group flex-1">
            <label class="form-label">
              {{ trans.customHead }}
              <HelpTooltip :text="trans.cspWarning" />
            </label>
            <textarea v-model="settings.custom_head" class="form-textarea" rows="3" placeholder="<link rel='stylesheet' href='...'">
            </textarea>
          </div>

          <div class="form-group flex-1">
            <label class="form-label">{{ trans.customScript }}</label>
            <textarea v-model="settings.custom_script" class="form-textarea" rows="3" placeholder="console.log('Hello');">
            </textarea>
          </div>
        </div>

        <div class="form-row">
          <div class="form-group flex-1">
            <label class="form-label">
              {{ trans.themeOptions }}
              <HelpTooltip :text="trans.themeOptionsTip" />
            </label>
            <textarea v-model="settings.theme_options" class="form-textarea" rows="5" placeholder='{"mikus":1}'></textarea>
          </div>
        </div>

      </div>

      <div class="settings-section">
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
            <input type="checkbox" id="cfg_wss_report_enabled" v-model="settings.wss_report_enabled">
            <label><b>{{ trans.wssReportEnabled }}</b></label>
            <HelpTooltip :text="trans.wssReportTip" />
          </div>
          <div class="form-group flex-1 checkbox-item">
            <input type="checkbox" id="cfg_show_tf" v-model="settings.show_tf">
            <label>{{ trans.showTf }}</label>
          </div>
          <div class="form-group flex-1 checkbox-item">
            <input type="checkbox" id="cfg_show_three_net_details" v-model="settings.show_three_net_details">
            <label>{{ trans.showThreeNetDetails }}</label>
          </div>
        </div>

        <div v-if="settings.wss_report_enabled" class="wss-schedule">
          <div class="wss-schedule-header">
            <div>
              <div class="form-label wss-schedule-title">
                {{ trans.wssReportHours }}
                <HelpTooltip :text="trans.wssReportHoursTip" />
              </div>
              <div class="wss-schedule-meta">
                {{ localTimezoneLabel }} · {{ wssReportHours.length }}/24 {{ trans.hoursSelected }} · {{ trans.agentWssMinVersion }}
              </div>
            </div>
            <div class="wss-schedule-actions">
              <button type="button" class="btn btn-sm" @click="selectAllWssReportHours">{{ trans.selectAll }}</button>
              <button type="button" class="btn btn-sm" @click="clearWssReportHours">{{ trans.clear }}</button>
            </div>
          </div>
          <div class="wss-hour-grid" role="group" :aria-label="trans.wssReportHours">
            <label v-for="hour in 24" :key="hour - 1" class="wss-hour-option" :title="formatWssHourRange(hour - 1)">
              <input
                type="checkbox"
                :checked="isLocalWssReportHourSelected(hour - 1)"
                @change="toggleLocalWssReportHour(hour - 1, $event.target.checked)"
              >
              <span>{{ String(hour - 1).padStart(2, '0') }}</span>
            </label>
          </div>
        </div>

        <div class="form-row">
          <div class="form-group flex-1">
            <label class="form-label">
              {{ trans.frontendWsTimeoutMinutes }}
              <HelpTooltip :text="trans.frontendWsTimeoutMinutesTip" />
            </label>
            <input
              v-model.number="settings.frontend_ws_timeout_minutes"
              type="number"
              min="0"
              :max="FRONTEND_WS_TIMEOUT_MINUTES_MAX"
              step="1"
              class="form-input"
            >
          </div>

          <div class="form-group flex-1">
            <label class="form-label">
              {{ trans.longHistoryPoints }}
              <HelpTooltip :text="trans.longHistoryPointsTip" />
            </label>
            <select v-model="settings.long_history_points" class="form-select">
              <option v-for="option in longHistoryPointOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
            </select>
          </div>
        </div>
      </div>

      <div class="settings-section">
        <div class="section-title"><span>▸</span> {{ trans.notifications }}</div>
        <div class="form-row">
          <div class="form-group flex-1">
            <label class="form-label">{{ trans.offlineAlert }}</label>
            <select v-model="settings.tg_notify" class="form-select">
              <option v-for="option in offlineNotifyOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
            </select>
          </div>

          <div class="form-group flex-1">
            <label class="form-label">{{ trans.expireReminder }}</label>
            <select v-model="selectedExpireReminder" class="form-select">
              <option v-for="option in expireReminderOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
              <option :value="CUSTOM_EXPIRE_REMINDER_VALUE">{{ trans.custom || 'Custom' }}</option>
            </select>
            <input
              v-if="showCustomExpireReminder"
              type="number"
              v-model.number="settings.expire_reminder"
              @focus="markCustomExpireReminder"
              class="form-input mt-2"
              min="1"
              :max="EXPIRE_REMINDER_DAYS_MAX"
              step="1"
              :placeholder="trans.expireReminderCustomPlaceholder || 'Days before expiration'"
            >
          </div>

          <div class="form-group flex-1">
            <label class="form-label">{{ trans.notificationChannel || 'Notification Channel' }}</label>
            <select v-model="notificationChannel" class="form-select">
              <option value="builtin">{{ trans.builtinNotification || 'Built-in' }}</option>
              <option value="smtp">{{ trans.smtpNotification || 'SMTP Email' }}</option>
              <option value="webhook">{{ trans.customWebhook || 'Custom Webhook' }}</option>
            </select>
          </div>
        </div>

        <div v-if="notificationChannel === 'builtin'" class="form-row">
          <div class="form-group flex-1">
            <label class="form-label">{{ trans.telegramToken }}</label>
            <div class="password-input-wrapper">
              <input type="text" name="tg_bot_token" autocomplete="off" data-lpignore="true" data-1p-ignore="true" data-bwignore="true" data-form-type="other" v-model="settings.tg_bot_token" :class="['form-input', { 'secret-input-masked': !passwordVisible.tgBotToken }]" placeholder="Bot Token or Webhook URL">
              <button type="button" class="password-toggle" @click="$emit('toggle-password', 'tgBotToken')">
                {{ passwordVisible.tgBotToken ? '🙈' : '👁️' }}
              </button>
            </div>
          </div>

          <div class="form-group flex-1">
            <label class="form-label">{{ trans.chatId }}</label>
            <div class="password-input-wrapper">
              <input type="text" name="tg_chat_id" autocomplete="off" data-lpignore="true" data-1p-ignore="true" data-bwignore="true" data-form-type="other" v-model="settings.tg_chat_id" :class="['form-input', { 'secret-input-masked': !passwordVisible.tgChatId }]" placeholder="Optional Chat ID">
              <button type="button" class="password-toggle" @click="$emit('toggle-password', 'tgChatId')">
                {{ passwordVisible.tgChatId ? '🙈' : '👁️' }}
              </button>
            </div>
          </div>
        </div>

        <div v-else-if="notificationChannel === 'smtp'" class="resource-alert-rule">
          <div class="resource-alert-rule-title">
            <span>{{ trans.smtpNotification || 'SMTP Email' }}</span>
            <HelpTooltip :text="trans.smtpTip || 'Sends plain-text email via cloudflare:sockets (25 port is blocked by Cloudflare Workers). QQ / 163 require an SMTP authorization code, not the login password.'" />
          </div>

          <div class="form-row">
            <div class="form-group flex-1">
              <label class="form-label">{{ trans.smtpHost || 'SMTP Host' }}</label>
              <input type="text" name="smtp_host" autocomplete="off" data-lpignore="true" data-1p-ignore="true" data-bwignore="true" data-form-type="other" v-model.trim="smtpConfig.host" @blur="validateSmtpField('host')" class="form-input" placeholder="smtp.example.com">
              <p v-if="smtpErrors.host" class="text-danger text-sm">{{ smtpErrors.host }}</p>
            </div>

            <div class="form-group flex-1">
              <label class="form-label">
                {{ trans.smtpPort || 'Port' }}
                <HelpTooltip :text="trans.smtpPortTip || 'Cloudflare Workers blocks port 25. Use 465 (implicit TLS) or 587 (STARTTLS).'" />
              </label>
              <input type="number" name="smtp_port" autocomplete="off" data-lpignore="true" data-1p-ignore="true" data-bwignore="true" data-form-type="other" v-model.trim="smtpConfig.port" @blur="validateSmtpField('port')" class="form-input" list="smtp-port-presets" placeholder="465">
              <datalist id="smtp-port-presets">
                <option v-for="port in smtpPortPresets" :key="port" :value="port"></option>
              </datalist>
              <p v-if="smtpErrors.port" class="text-danger text-sm">{{ smtpErrors.port }}</p>
            </div>

            <div class="form-group flex-1">
              <label class="form-label">{{ trans.smtpSecure || 'Encryption' }}</label>
              <select v-model="smtpConfig.secure" @change="validateSmtpField('port')" class="form-select">
                <option value="auto">{{ trans.smtpSecureAuto || 'Auto (by port)' }}</option>
                <option value="tls">{{ trans.smtpSecureTls || 'Implicit TLS (465)' }}</option>
                <option value="starttls">{{ trans.smtpSecureStarttls || 'STARTTLS (587)' }}</option>
              </select>
            </div>
          </div>

          <div class="form-row">
            <div class="form-group flex-1">
              <label class="form-label">{{ trans.smtpUser || 'Username' }}</label>
              <input type="text" name="smtp_user" autocomplete="off" data-lpignore="true" data-1p-ignore="true" data-bwignore="true" data-form-type="other" v-model.trim="smtpConfig.username" @blur="validateSmtpField('username')" class="form-input" placeholder="you@example.com">
              <p v-if="smtpErrors.username" class="text-danger text-sm">{{ smtpErrors.username }}</p>
            </div>

            <div class="form-group flex-1">
              <label class="form-label">{{ trans.smtpPassword || 'Password' }}</label>
              <div class="password-input-wrapper">
                <input type="text" name="smtp_password" autocomplete="new-password" data-lpignore="true" data-1p-ignore="true" data-bwignore="true" data-form-type="other" v-model="smtpConfig.password" @blur="validateSmtpField('password')" :class="['form-input', { 'secret-input-masked': !passwordVisible.smtpPassword }]" placeholder="SMTP password / app password">
                <button type="button" class="password-toggle" @click="$emit('toggle-password', 'smtpPassword')">
                  {{ passwordVisible.smtpPassword ? '🙈' : '👁️' }}
                </button>
              </div>
              <p v-if="smtpErrors.password" class="text-danger text-sm">{{ smtpErrors.password }}</p>
            </div>
          </div>

          <div class="form-row">
            <div class="form-group flex-1">
              <label class="form-label">{{ trans.smtpFrom || 'From' }}</label>
              <input type="text" name="smtp_from" autocomplete="off" data-lpignore="true" data-1p-ignore="true" data-bwignore="true" data-form-type="other" v-model.trim="smtpConfig.from" @blur="validateSmtpField('from')" class="form-input" placeholder="optional, defaults to username">
              <p v-if="smtpErrors.from" class="text-danger text-sm">{{ smtpErrors.from }}</p>
            </div>

            <div class="form-group flex-1">
              <label class="form-label">{{ trans.smtpTo || 'Recipients' }}</label>
              <input type="text" name="smtp_to" autocomplete="off" data-lpignore="true" data-1p-ignore="true" data-bwignore="true" data-form-type="other" v-model.trim="smtpConfig.to" @blur="validateSmtpField('to')" class="form-input" placeholder="a@example.com,b@example.com">
              <p v-if="smtpErrors.to" class="text-danger text-sm">{{ smtpErrors.to }}</p>
            </div>
          </div>
        </div>

        <div v-else class="resource-alert-rule">
          <div class="resource-alert-rule-title">
            <span>{{ trans.customWebhook || 'Custom Webhook' }}</span>
          </div>

          <div class="form-row">
            <div class="form-group flex-1">
              <label class="form-label">{{ trans.webhookUrl || 'Webhook URL' }}</label>
              <div class="password-input-wrapper">
                <input
                  type="text"
                  name="notification_webhook_url"
                  autocomplete="off"
                  data-lpignore="true"
                  data-1p-ignore="true"
                  data-bwignore="true"
                  data-form-type="other"
                  v-model="settings.notification_webhook_url"
                  :class="['form-input', { 'secret-input-masked': !passwordVisible.notificationWebhookUrl }]"
                  placeholder="https://example.com/webhook"
                >
                <button type="button" class="password-toggle" @click="$emit('toggle-password', 'notificationWebhookUrl')">
                  {{ passwordVisible.notificationWebhookUrl ? '🙈' : '👁️' }}
                </button>
              </div>
            </div>

            <div class="form-group flex-1">
              <label class="form-label">{{ trans.webhookMethod || 'Method' }}</label>
              <select v-model="settings.notification_webhook_method" class="form-select">
                <option value="POST">POST</option>
                <option value="GET">GET</option>
              </select>
            </div>

            <div v-if="settings.notification_webhook_method !== 'GET'" class="form-group flex-1">
              <label class="form-label">{{ trans.webhookFormat || 'Body Format' }}</label>
              <select v-model="settings.notification_webhook_format" class="form-select">
                <option value="json">JSON</option>
                <option value="form">x-www-form-urlencoded</option>
                <option value="text">Text</option>
              </select>
            </div>
          </div>

          <div class="form-row">
            <div class="form-group flex-1">
              <label class="form-label">{{ trans.webhookHeaders || 'Headers' }}</label>
              <textarea
                v-model="settings.notification_webhook_headers"
                class="form-textarea"
                rows="4"
                placeholder='{"Authorization":"Bearer your-token"}'
              ></textarea>
            </div>

            <div class="form-group flex-1">
              <label class="form-label">
                {{ settings.notification_webhook_method === 'GET' ? (trans.webhookParams || 'Query Params') : (trans.webhookBody || 'Body') }}
              </label>
              <textarea
                v-model="settings.notification_webhook_body"
                class="form-textarea"
                rows="6"
                placeholder='{"title":"{{emoji}} {{event}}","content":"{{notification}}"}'
              ></textarea>
            </div>
          </div>
        </div>

        <div class="form-row">
          <div class="form-group flex-1">
            <label class="form-label">
              {{ trans.notificationTimezone || 'Notification Timezone' }}
              <HelpTooltip :text="trans.notificationTimezoneTip || 'Used only for notification output times and expiration reminder schedule.'" />
            </label>
            <select v-model="selectedNotificationTimezone" class="form-select">
              <option v-for="timezone in commonNotificationTimezones" :key="timezone" :value="timezone">{{ timezone }}</option>
              <option :value="CUSTOM_NOTIFICATION_TIMEZONE_VALUE">{{ trans.custom || 'Custom' }}</option>
            </select>
            <input
              v-if="showCustomNotificationTimezone"
              type="text"
              v-model.trim="settings.notification_timezone"
              class="form-input mt-2"
              placeholder="Asia/Shanghai"
            >
          </div>

          <div class="form-group flex-1">
            <label class="form-label">
              {{ trans.notificationLanguage }}
              <HelpTooltip :text="trans.notificationLanguageTip" />
            </label>
            <select v-model="settings.notification_language" class="form-select">
              <option value="zh">{{ trans.languageChinese }}</option>
              <option value="en">{{ trans.languageEnglish }}</option>
              <option value="es">{{ trans.languageSpanish }}</option>
            </select>
          </div>

          <div class="form-group flex-1">
            <label class="form-label">
              {{ trans.expireNotificationTime || 'Expiration Notification Time' }}
              <HelpTooltip :text="trans.expireNotificationTimeTip || 'Check expiration and send reminders daily at this hour in the notification timezone. Use 0-23.'" />
            </label>
            <select v-model="settings.expire_notification_time" class="form-select">
              <option v-for="hour in expireNotificationHourOptions" :key="hour" :value="hour">{{ hour }}</option>
            </select>
          </div>

          <div class="form-group flex-1">
            <label class="form-label">
              {{ trans.trafficAlertThreshold }} (%)
              <HelpTooltip :text="trans.trafficAlertThresholdTip" />
            </label>
            <input type="number" v-model.number="settings.traffic_alert_threshold" class="form-input" min="0" max="100" step="1" placeholder="0">
          </div>
        </div>

        <div class="form-row">
          <div class="form-group flex-1">
            <label class="form-label">{{ trans.notificationTemplate || 'Notification Template' }}</label>
            <textarea
              v-model="settings.notification_template"
              class="form-textarea"
              rows="5"
              placeholder="{{emoji}}【CF Server Monitor】{{event}}\n\n{{message}}\n\n{{time}}"
            ></textarea>
          </div>
        </div>

        <div class="form-row">
          <div class="form-group flex-1">
            <button type="button" @click="$emit('send-test-notification')" class="btn btn-primary" :disabled="testNotificationLoading">{{ testNotificationLoading ? '⏳' : '📨' }} {{ trans.sendTestNotification }}</button>
          </div>
        </div>

        <div class="resource-alert-header">
          <button
            type="button"
            class="resource-alert-toggle"
            :aria-expanded="resourceAlertExpanded"
            @click="toggleResourceAlertExpanded"
          >
            <span class="resource-alert-caret" :class="{ expanded: resourceAlertExpanded }">▸</span>
            <span class="section-subtitle">{{ trans.resourceAlert }}</span>
            <span class="resource-alert-count">[{{ resourceAlertRules.length }}]</span>
            <span class="resource-alert-toggle-text">{{ resourceAlertToggleText }}</span>
          </button>
          <HelpTooltip :text="trans.resourceAlertTip" />
          <button type="button" class="btn btn-primary btn-sm" @click="addResourceAlertRule">+ {{ trans.resourceAlertAddRule }}</button>
        </div>

        <div v-if="resourceAlertExpanded" class="resource-alert-body">
          <div v-if="resourceAlertRules.length === 0" class="resource-alert-empty text-muted text-sm">
            {{ trans.resourceAlertEmpty }}
          </div>

          <div v-for="(rule, index) in resourceAlertRules" :key="rule.id || index" class="resource-alert-rule">
            <div class="resource-alert-rule-title">
              <span>{{ trans.resourceAlertRule }} #{{ index + 1 }}</span>
              <button type="button" class="btn btn-red btn-sm" @click="removeResourceAlertRule(index)">{{ trans.delete }}</button>
            </div>

            <div class="form-row">
              <div class="form-group flex-1">
                <label class="form-label">{{ trans.resourceAlertRuleName }}</label>
                <input
                  :ref="el => setResourceAlertRuleNameInput(rule.id, el)"
                  type="text"
                  v-model="rule.name"
                  class="form-input"
                  :placeholder="trans.resourceAlertRuleNamePlaceholder"
                >
              </div>

              <div class="form-group flex-1">
                <label class="form-label">{{ trans.resourceAlertMetric }}</label>
                <select v-model="rule.metric" class="form-select" @change="normalizeRuleThreshold(rule)">
                  <option v-for="option in resourceAlertMetricOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
                </select>
              </div>

              <div class="form-group flex-1">
                <label class="form-label">{{ trans.resourceAlertThreshold }}</label>
                <input type="number" min="0" :max="resourceAlertThresholdMax(rule.metric)" step="1" v-model="rule.threshold" class="form-input" :placeholder="resourceAlertThresholdPlaceholder(rule.metric)">
              </div>
            </div>

            <div class="form-row">
              <div class="form-group flex-1">
                <label class="form-label">{{ trans.resourceAlertServers }}</label>
                <details class="resource-alert-server-dropdown">
                  <summary class="form-select resource-alert-server-summary">
                    {{ resourceAlertServerSelectLabel(rule) }}
                  </summary>
                  <div class="resource-alert-server-menu">
                    <label v-for="server in resourceAlertServerOptions" :key="server.id" class="resource-alert-server-option">
                      <input
                        type="checkbox"
                        :checked="resourceAlertRuleHasServer(rule, server.id)"
                        :disabled="isLastResourceAlertRuleServer(rule, server.id)"
                        @change="toggleResourceAlertRuleServer(rule, server.id, $event.target.checked)"
                      >
                      <span>{{ server.name }}</span>
                    </label>
                  </div>
                </details>
              </div>

              <div class="form-group flex-1">
                <label class="form-label">{{ trans.resourceAlertInterval }}</label>
                <select v-model="rule.intervalMinutes" class="form-select">
                  <option v-for="option in resourceAlertIntervalOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
                </select>
              </div>

              <div class="form-group flex-1">
                <label class="form-label">{{ trans.resourceAlertMode }}</label>
                <select v-model="rule.mode" class="form-select">
                  <option value="average">{{ trans.resourceAlertModeAverage }}</option>
                  <option value="continuous">{{ trans.resourceAlertModeContinuous }}</option>
                </select>
              </div>
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
              <HelpTooltip :text="trans.turnstileLoginTip" />
            </div>
          </div>
        </div>

        <div class="form-row">
          <div class="form-group flex-1">
            <label class="form-label">
              {{ trans.turnstileSiteKey }}
              <HelpTooltip :text="trans.turnstileTip" />
            </label>
            <input type="text" name="turnstile_site_key" autocomplete="off" v-model="settings.turnstile_site_key" class="form-input" :placeholder="trans.turnstileSiteKeyPlaceholder">
          </div>

          <div class="form-group flex-1">
            <label class="form-label">{{ trans.turnstileSecretKey }}</label>
            <div class="password-input-wrapper">
              <input type="text" name="turnstile_secret_key" autocomplete="off" data-lpignore="true" data-1p-ignore="true" data-bwignore="true" data-form-type="other" v-model="settings.turnstile_secret_key" :class="['form-input', { 'secret-input-masked': !passwordVisible.turnstileSecret }]" :placeholder="trans.turnstileSecretKeyPlaceholder">
              <button type="button" class="password-toggle" @click="$emit('toggle-password', 'turnstileSecret')">
                {{ passwordVisible.turnstileSecret ? '🙈' : '👁️' }}
              </button>
            </div>
          </div>
        </div>

        <div class="form-group mt-4">
          <label class="form-label">
            {{ trans.jwtSecret }}
            <HelpTooltip :text="trans.jwtSecretTip" />
          </label>
          <div class="password-input-wrapper">
            <input type="text" name="jwt_secret" autocomplete="off" data-lpignore="true" data-1p-ignore="true" data-bwignore="true" data-form-type="other" v-model="settings.jwt_secret" :class="['form-input', { 'secret-input-masked': !passwordVisible.jwtSecret }]" placeholder="••••••••••••••••••••••••••••••••">
            <button type="button" class="password-toggle" @click="$emit('toggle-password', 'jwtSecret')">
              {{ passwordVisible.jwtSecret ? '🙈' : '👁️' }}
            </button>
          </div>
        </div>

      </div>

      <div class="settings-section">
        <div class="section-title"><span>▸</span> {{ trans.cloudflareSettings }}</div>

        <div class="form-row">
          <div class="form-group flex-1">
            <label class="form-label">{{ trans.cloudflareAccountId }}</label>
            <input type="text" name="cloudflare_account_id" autocomplete="off" v-model="settings.cloudflare_account_id" class="form-input" :placeholder="trans.cloudflareAccountIdPlaceholder">
          </div>

          <div class="form-group flex-1">
            <label class="form-label">
              Cloudflare API Token
              <HelpTooltip :text="trans.cloudflareTokenTip" />
            </label>
            <div class="password-input-wrapper">
              <input type="text" name="cloudflare_token" autocomplete="off" data-lpignore="true" data-1p-ignore="true" data-bwignore="true" data-form-type="other" v-model="settings.cloudflare_token" :class="['form-input', { 'secret-input-masked': !passwordVisible.cloudflareToken }]" :placeholder="trans.cloudflareTokenPlaceholder">
              <button type="button" class="password-toggle" @click="$emit('toggle-password', 'cloudflareToken')">
                {{ passwordVisible.cloudflareToken ? '🙈' : '👁️' }}
              </button>
            </div>
          </div>
        </div>

        <div class="form-row">
          <div class="form-group  flex-1">
            <button type="button" @click="$emit('query-d1-usage')" class="btn btn-primary btn-lg" :disabled="d1UsageLoading">{{ d1UsageLoading ? '⏳' : '🔍' }} {{ trans.queryD1Quota }}</button>
          </div>
        </div>

      </div>

      <div class="settings-section">
        <div class="section-title"><span>▸</span> {{ trans.adminLoginSettings }}</div>

        <div class="form-group">
          <label class="form-label">{{ trans.username }}</label>
          <input
            type="text"
            name="settings_admin_user"
            autocomplete="off"
            data-lpignore="true"
            data-1p-ignore="true"
            data-bwignore="true"
            data-form-type="other"
            v-model="settings.username"
            class="form-input"
            :placeholder="trans.usernamePlaceholder"
          >
        </div>

        <div class="inline-help-action mb-3">
          <button type="button" class="btn btn-sm" @click="$emit('toggle-admin-password-change')">
            {{ changeAdminPassword ? trans.cancelPasswordChange : trans.changePassword }}
          </button>
          <HelpTooltip :text="trans.apiSecretTip" />
        </div>

        <div v-if="changeAdminPassword" class="form-row">
          <div class="form-group flex-1">
            <label class="form-label">{{ trans.password }}</label>
            <div class="password-input-wrapper">
              <input
                :type="passwordVisible.password ? 'text' : 'password'"
                name="settings_admin_passphrase"
                autocomplete="off"
                data-lpignore="true"
                data-1p-ignore="true"
                data-bwignore="true"
                data-form-type="other"
                v-model="settings.password"
                class="form-input"
                :placeholder="settings.password_configured ? '••••••••' : ''"
              >
              <button type="button" class="password-toggle" @click="$emit('toggle-password', 'password')">
                {{ passwordVisible.password ? '🙈' : '👁️' }}
              </button>
            </div>
          </div>

          <div class="form-group flex-1">
            <label class="form-label">{{ trans.confirmPassword }}</label>
            <div class="password-input-wrapper">
              <input
                :type="passwordVisible.confirmPassword ? 'text' : 'password'"
                name="settings_admin_passphrase_confirm"
                autocomplete="off"
                data-lpignore="true"
                data-1p-ignore="true"
                data-bwignore="true"
                data-form-type="other"
                v-model="settings.confirm_password"
                class="form-input"
                :placeholder="settings.password_configured ? '••••••••' : ''"
              >
              <button type="button" class="password-toggle" @click="$emit('toggle-password', 'confirmPassword')">
                {{ passwordVisible.confirmPassword ? '🙈' : '👁️' }}
              </button>
            </div>
          </div>
        </div>

      </div>

      <div class="settings-section">
        <div class="section-title"><span>▸</span> {{ trans.pingNodes }}</div>

        <div class="ping-node-grid">
          <div class="ping-node-item">
            <div class="ping-node-fields"><input type="text" v-model.trim="settings.custom_ct_name" class="form-input ping-node-name"><span class="ping-node-arrow">→</span>
            <input type="text" v-model.trim="settings.custom_ct" :class="['form-input', { 'input-invalid': pingNodeErrors.custom_ct }]" placeholder="gd-ct-dualstack.ip.zstaticcdn.com">
            </div><p v-if="pingNodeErrors.custom_ct" class="text-red text-sm mt-1">{{ pingNodeErrors.custom_ct }}</p>
          </div>

          <div class="ping-node-item">
            <div class="ping-node-fields"><input type="text" v-model.trim="settings.custom_cu_name" class="form-input ping-node-name"><span class="ping-node-arrow">→</span>
            <input type="text" v-model.trim="settings.custom_cu" :class="['form-input', { 'input-invalid': pingNodeErrors.custom_cu }]" placeholder="gd-cu-dualstack.ip.zstaticcdn.com">
            </div><p v-if="pingNodeErrors.custom_cu" class="text-red text-sm mt-1">{{ pingNodeErrors.custom_cu }}</p>
          </div>
        </div>
        <div class="ping-node-grid">
          <div class="ping-node-item">
            <div class="ping-node-fields"><input type="text" v-model.trim="settings.custom_cm_name" class="form-input ping-node-name"><span class="ping-node-arrow">→</span>
            <input type="text" v-model.trim="settings.custom_cm" :class="['form-input', { 'input-invalid': pingNodeErrors.custom_cm }]" placeholder="gd-cm-dualstack.ip.zstaticcdn.com">
            </div><p v-if="pingNodeErrors.custom_cm" class="text-red text-sm mt-1">{{ pingNodeErrors.custom_cm }}</p>
          </div>

          <div class="ping-node-item">
            <div class="ping-node-fields"><input type="text" v-model.trim="settings.custom_bd_name" class="form-input ping-node-name"><span class="ping-node-arrow">→</span>
            <input type="text" v-model.trim="settings.custom_bd" :class="['form-input', { 'input-invalid': pingNodeErrors.custom_bd }]" placeholder="ip.zstaticcdn.com">
            </div><p v-if="pingNodeErrors.custom_bd" class="text-red text-sm mt-1">{{ pingNodeErrors.custom_bd }}</p>
          </div>
        </div>
        <div class="ping-node-grid">
          <div v-for="field in ['node_1', 'node_2']" :key="field" class="ping-node-item">
            <div class="ping-node-fields"><input type="text" v-model.trim="settings[`${field}_name`]" class="form-input ping-node-name"><span class="ping-node-arrow">→</span><input type="text" v-model.trim="settings[field]" :class="['form-input', { 'input-invalid': pingNodeErrors[field] }]" placeholder="host[:port] / [IPv6]:port"></div>
            <p v-if="pingNodeErrors[field]" class="text-red text-sm mt-1">{{ pingNodeErrors[field] }}</p>
          </div>
        </div>
        <div class="ping-node-grid">
          <div v-for="field in ['node_3', 'node_4']" :key="field" class="ping-node-item">
            <div class="ping-node-fields"><input type="text" v-model.trim="settings[`${field}_name`]" class="form-input ping-node-name"><span class="ping-node-arrow">→</span><input type="text" v-model.trim="settings[field]" :class="['form-input', { 'input-invalid': pingNodeErrors[field] }]" placeholder="host[:port] / [IPv6]:port"></div>
            <p v-if="pingNodeErrors[field]" class="text-red text-sm mt-1">{{ pingNodeErrors[field] }}</p>
          </div>
        </div>
      </div>
    </div>

    <div class="text-right mt-5">
      <button @click="$emit('save-settings')" class="btn btn-primary btn-lg" :disabled="saving || hasPingNodeErrors">{{ saving ? '⏳' : '💾' }} {{ saving ? trans.saving : trans.saveConfig }}</button>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import HelpTooltip from '../../../components/HelpTooltip.vue'
import { FRONTEND_WS_TIMEOUT_MINUTES_MAX, HISTORY } from '../../../utils/constants.js'
import { PING_NODE_FIELDS, validatePingNode } from '../../../utils/pingNode.js'

const props = defineProps({
  trans: { type: Object, required: true },
  settings: { type: Object, required: true },
  servers: { type: Array, default: () => [] },
  passwordVisible: { type: Object, required: true },
  activeTab: { type: String, default: 'settings' },
  selectedApiBase: { type: String, default: '' },
  currentOrigin: { type: String, default: '' },
  saving: { type: Boolean, default: false },
  changeAdminPassword: { type: Boolean, default: false },
  testNotificationLoading: { type: Boolean, default: false },
  d1UsageLoading: { type: Boolean, default: false }
})

const emit = defineEmits([
  'toggle-password', 'toggle-admin-password-change',
  'save-settings', 'upload-bg', 'upload-bg-mobile', 'upload-favicon',
  'send-test-notification', 'query-d1-usage',
  'alert-message'
])

const commonNotificationTimezones = [
  'UTC',
  'Asia/Shanghai',
  'Asia/Hong_Kong',
  'Asia/Tokyo',
  'Asia/Singapore',
  'Europe/London',
  'Europe/Berlin',
  'America/New_York',
  'America/Los_Angeles'
]
const EXPIRE_REMINDER_DAYS_MAX = 365
const CUSTOM_EXPIRE_REMINDER_VALUE = '__custom__'
const CUSTOM_NOTIFICATION_TIMEZONE_VALUE = '__custom__'
const manualCustomExpireReminder = ref(false)
const manualCustomNotificationTimezone = ref(false)
const isCommonNotificationTimezone = (value) => commonNotificationTimezones.includes(String(value || '').trim())

const isPresetExpireReminder = (value) => {
  const reminder = String(value ?? '').trim()
  return reminder === '0' || (Number.isInteger(Number(reminder)) && Number(reminder) >= 1 && Number(reminder) <= 7)
}

const selectedExpireReminder = computed({
  get: () => {
    const currentReminder = String(props.settings.expire_reminder ?? '').trim()
    if (manualCustomExpireReminder.value || !isPresetExpireReminder(currentReminder)) {
      return CUSTOM_EXPIRE_REMINDER_VALUE
    }
    return currentReminder || '0'
  },
  set: (value) => {
    if (value === CUSTOM_EXPIRE_REMINDER_VALUE) {
      manualCustomExpireReminder.value = true
      const currentReminder = Number(props.settings.expire_reminder)
      if (!Number.isInteger(currentReminder) || currentReminder < 1 || currentReminder > EXPIRE_REMINDER_DAYS_MAX) {
        props.settings.expire_reminder = '8'
      }
      return
    }
    manualCustomExpireReminder.value = false
    props.settings.expire_reminder = value
  }
})

const showCustomExpireReminder = computed(() => selectedExpireReminder.value === CUSTOM_EXPIRE_REMINDER_VALUE)

const markCustomExpireReminder = () => {
  manualCustomExpireReminder.value = true
}

// Reset the local custom-mode flag only when switching to a different settings
// object. Changes made while typing must not collapse the input after the
// first digit (for example, typing "12" briefly produces "1").
watch(
  () => props.settings,
  () => {
    manualCustomExpireReminder.value = false
  }
)

const selectedNotificationTimezone = computed({
  get: () => {
    const currentTimezone = String(props.settings.notification_timezone || '').trim()
    if (manualCustomNotificationTimezone.value || (currentTimezone && !isCommonNotificationTimezone(currentTimezone))) {
      return CUSTOM_NOTIFICATION_TIMEZONE_VALUE
    }
    return currentTimezone || 'UTC'
  },
  set: (value) => {
    if (value === CUSTOM_NOTIFICATION_TIMEZONE_VALUE) {
      manualCustomNotificationTimezone.value = true
      return
    }
    manualCustomNotificationTimezone.value = false
    props.settings.notification_timezone = value
  }
})

const showCustomNotificationTimezone = computed(() => selectedNotificationTimezone.value === CUSTOM_NOTIFICATION_TIMEZONE_VALUE)

watch(
  () => props.settings.notification_timezone,
  (value) => {
    if (!String(value || '').trim() || isCommonNotificationTimezone(value)) {
      manualCustomNotificationTimezone.value = false
    }
  }
)

const expireNotificationHourOptions = Array.from({ length: 24 }, (_, hour) => String(hour))

const cspErrors = reactive({
  csp_static: '',
  csp_api: ''
})

const offlineNotifyOptions = computed(() => [
  { value: '0', label: `${props.trans.disabled}` },
  ...[5, 6, 7, 8, 9, 10, 15, 20, 30].map(minutes => {
    const label = props.trans.notifyOfflineMinutes
      ? props.trans.notifyOfflineMinutes.replace('{minutes}', minutes)
      : `${minutes} min`

    return {
      value: String(minutes),
      label: `${label}`
    }
  })
])

const expireReminderOptions = computed(() => [
  { value: '0', label: `${props.trans.disabled}` },
  ...Array.from({ length: 7 }, (_, index) => {
    const days = index + 1
    const label = props.trans.notifyExpireDays
      ? props.trans.notifyExpireDays.replace('{days}', days)
      : `Notify within ${days} days before expiration`

    return {
      value: String(days),
      label: `${label}`
    }
  })
])

const longHistoryPointOptions = computed(() => (
  HISTORY.LONG_RANGE_POINT_OPTIONS.map(points => ({
    value: String(points),
    label: props.trans.historyPointCount
      ? props.trans.historyPointCount.replace('{points}', points)
      : `${points} points`
  }))
))

const wssReportHours = computed(() => {
  const source = Array.isArray(props.settings.wss_report_hours)
    ? props.settings.wss_report_hours
    : Array.from({ length: 24 }, (_, hour) => hour)
  return source
    .map(hour => Number(hour))
    .filter(hour => Number.isInteger(hour) && hour >= 0 && hour <= 23)
    .filter((hour, index, hours) => hours.indexOf(hour) === index)
    .sort((a, b) => a - b)
})

const localHourToUtcHour = hour => new Date(2000, 0, 1, hour, 0, 0, 0).getUTCHours()

const localTimezoneLabel = computed(() => {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const localTime = props.trans.localTime || 'Local time'
  return timezone ? `${localTime} · ${timezone}` : localTime
})

const isLocalWssReportHourSelected = hour => wssReportHours.value.includes(localHourToUtcHour(hour))

const toggleLocalWssReportHour = (hour, checked) => {
  const utcHour = localHourToUtcHour(hour)
  const selected = new Set(wssReportHours.value)
  if (checked) selected.add(utcHour)
  else selected.delete(utcHour)
  props.settings.wss_report_hours = Array.from(selected).sort((a, b) => a - b)
}

const selectAllWssReportHours = () => {
  props.settings.wss_report_hours = Array.from({ length: 24 }, (_, hour) => hour)
}

const clearWssReportHours = () => {
  props.settings.wss_report_hours = []
}

const formatWssHourRange = hour => {
  const utcHour = localHourToUtcHour(hour)
  const localHourText = String(hour).padStart(2, '0')
  const utcHourText = String(utcHour).padStart(2, '0')
  return `${localHourText}:00-${localHourText}:59 ${props.trans.localTime} (${utcHourText}:00-${utcHourText}:59 UTC)`
}

// SMTP 通知复用后端 tg_bot_token 字段，采用前缀协议存储（方案 A）：
// smtp://<user>:<pass>@<host>:<port>?from=<from>&to=<a,b>&secure=<auto|tls|starttls>
const SMTP_PORT_PRESETS = ['465', '587']
const smtpPortPresets = SMTP_PORT_PRESETS
const defaultSmtpConfig = () => ({
  host: '',
  port: '465',
  username: '',
  password: '',
  from: '',
  to: '',
  secure: 'auto'
})
const smtpConfig = reactive(defaultSmtpConfig())
const smtpChannelActive = ref(false)
// SMTP 序列化结果是否已覆写共享的 tg_bot_token 字段；
// 在 SMTP 配置成形（host/用户名/密码齐全）之前不覆写，避免清空 Telegram/飞书等已有渠道配置
const smtpTokenApplied = ref(false)
const smtpErrors = reactive({ host: '', username: '', password: '', port: '', from: '', to: '' })
const SMTP_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const isSmtpToken = token => String(token || '').trim().toLowerCase().indexOf('smtp:') === 0

const safeDecode = value => {
  try {
    return decodeURIComponent(value)
  } catch (_) {
    return value
  }
}

const buildSmtpToken = cfg => {
  const host = String(cfg.host || '').trim()
  if (!host) return ''
  const userinfo = `${encodeURIComponent(cfg.username || '')}:${encodeURIComponent(cfg.password || '')}`
  const params = new URLSearchParams()
  if (String(cfg.from || '').trim()) params.set('from', String(cfg.from).trim())
  if (String(cfg.to || '').trim()) params.set('to', String(cfg.to).trim())
  if (cfg.secure && cfg.secure !== 'auto') params.set('secure', cfg.secure)
  const query = params.toString()
  const port = String(cfg.port || '').trim()
  return `smtp://${userinfo}@${host}${port ? `:${port}` : ''}${query ? `?${query}` : ''}`
}

const parseSmtpToken = token => {
  try {
    const url = new URL(String(token).trim())
    return {
      host: url.hostname || '',
      port: url.port || '',
      username: safeDecode(url.username || ''),
      password: safeDecode(url.password || ''),
      from: url.searchParams.get('from') || '',
      to: url.searchParams.get('to') || '',
      secure: url.searchParams.get('secure') || 'auto'
    }
  } catch (_) {
    return defaultSmtpConfig()
  }
}

const applySmtpToken = token => {
  Object.assign(smtpConfig, parseSmtpToken(token))
}

// 将 SMTP 表单序列化写入共享的 tg_bot_token；配置未成形时保留原有渠道值
const syncSmtpToken = () => {
  const token = buildSmtpToken(smtpConfig)
  if (!smtpTokenApplied.value) {
    if (!token || !smtpConfig.username || !smtpConfig.password) return
    smtpTokenApplied.value = true
  }
  props.settings.tg_bot_token = token
}

const smtpRequiredMessage = () => props.trans.smtpFieldRequired || 'This field is required'

const validateSmtpField = (field) => {
  if (field === 'host' || field === 'username' || field === 'password') {
    const valid = Boolean(String(smtpConfig[field] || '').trim())
    smtpErrors[field] = valid ? '' : smtpRequiredMessage()
    return valid
  }
  if (field === 'port') {
    const port = Number(String(smtpConfig.port || '').trim())
    if (!Number.isInteger(port) || port <= 0 || port > 65535 || port === 25) {
      smtpErrors.port = props.trans.smtpPortInvalid || 'Invalid port (1-65535, port 25 is blocked by Cloudflare Workers)'
      return false
    }
    // auto 模式下仅 465/587 可保证加密连接，其他端口必须显式选择加密方式，避免凭据明文传输
    if (smtpConfig.secure === 'auto' && port !== 465 && port !== 587) {
      smtpErrors.port = props.trans.smtpSecureRequired || 'Ports other than 465/587 require an explicit encryption method'
      return false
    }
    smtpErrors.port = ''
    return true
  }
  if (field === 'from') {
    const value = String(smtpConfig.from || '').trim()
    // 发件人可留空（默认使用用户名），填写时必须是合法邮箱地址
    if (!value) {
      smtpErrors.from = ''
      return true
    }
    if (!SMTP_EMAIL_PATTERN.test(value)) {
      smtpErrors.from = props.trans.smtpInvalidEmail || 'Enter a valid email address, e.g. user@example.com'
      return false
    }
    smtpErrors.from = ''
    return true
  }
  if (field === 'to') {
    const list = String(smtpConfig.to || '')
      .split(',')
      .map(address => address.trim())
      .filter(Boolean)
    if (list.length === 0) {
      smtpErrors.to = props.trans.smtpToRequired || 'At least one recipient email is required'
      return false
    }
    if (list.some(address => !SMTP_EMAIL_PATTERN.test(address))) {
      smtpErrors.to = props.trans.smtpInvalidEmail || 'Enter a valid email address, e.g. user@example.com'
      return false
    }
    smtpErrors.to = ''
    return true
  }
  return true
}

// 当前渠道为 SMTP 时校验全部必填项；供保存与测试通知前调用
const validateSmtpFields = () => {
  if (notificationChannel.value !== 'smtp') {
    Object.keys(smtpErrors).forEach(key => { smtpErrors[key] = '' })
    return true
  }
  return ['host', 'username', 'password', 'port', 'from', 'to']
    .map(field => validateSmtpField(field))
    .every(Boolean)
}

const notificationChannel = computed({
  get: () => {
    if (props.settings.notification_webhook_enabled) return 'webhook'
    if (smtpChannelActive.value || isSmtpToken(props.settings.tg_bot_token)) return 'smtp'
    return 'builtin'
  },
  set: (value) => {
    if (value === 'webhook') {
      smtpChannelActive.value = false
      props.settings.notification_webhook_enabled = true
      return
    }
    props.settings.notification_webhook_enabled = false
    if (value === 'smtp') {
      if (isSmtpToken(props.settings.tg_bot_token)) {
        applySmtpToken(props.settings.tg_bot_token)
        smtpTokenApplied.value = true
      } else {
        Object.assign(smtpConfig, defaultSmtpConfig())
        smtpTokenApplied.value = false
      }
      smtpChannelActive.value = true
      syncSmtpToken()
      return
    }
    // builtin：仅当共享字段确实被 SMTP 覆写时才清理，保留尚未被覆盖的原渠道配置
    if (isSmtpToken(props.settings.tg_bot_token)) {
      props.settings.tg_bot_token = ''
      props.settings.tg_chat_id = ''
    }
    smtpChannelActive.value = false
    smtpTokenApplied.value = false
  }
})

// smtpConfig 变化实时序列化到 tg_bot_token（仅 SMTP 渠道激活且配置成形后）
watch(smtpConfig, () => {
  if (smtpChannelActive.value) {
    syncSmtpToken()
  }
}, { deep: true })

// 外部（如设置加载）写入 smtp token 时反向解析到表单
watch(() => props.settings.tg_bot_token, (token) => {
  if (isSmtpToken(token)) {
    smtpChannelActive.value = true
    smtpTokenApplied.value = true
    if (buildSmtpToken(smtpConfig) !== String(token).trim()) {
      applySmtpToken(token)
    }
  }
}, { immediate: true })

const ensureResourceAlertRules = () => {
  if (!Array.isArray(props.settings.resource_alert_rules)) {
    props.settings.resource_alert_rules = []
  }
  const serverIds = props.servers.map(server => String(server.id || '').trim()).filter(Boolean)
  if (serverIds.length > 0) {
    for (const rule of props.settings.resource_alert_rules) {
      if (!Array.isArray(rule.servers) || rule.servers.length === 0) {
        rule.servers = [...serverIds]
      }
    }
  }
  return props.settings.resource_alert_rules
}

const resourceAlertRules = computed(() => ensureResourceAlertRules())
const resourceAlertExpanded = ref(false)
const resourceAlertRuleNameInputs = new Map()
const resourceAlertToggleText = computed(() => resourceAlertExpanded.value ? props.trans.collapse : props.trans.expand)

const toggleResourceAlertExpanded = () => {
  resourceAlertExpanded.value = !resourceAlertExpanded.value
}

const setResourceAlertRuleNameInput = (ruleId, input) => {
  if (!ruleId) return
  if (input) {
    resourceAlertRuleNameInputs.set(ruleId, input)
  } else {
    resourceAlertRuleNameInputs.delete(ruleId)
  }
}

const resourceAlertMetricOptions = computed(() => [
  { value: 'cpu', label: props.trans.resourceAlertMetricCpu || 'CPU (%)' },
  { value: 'ram', label: props.trans.resourceAlertMetricRam || 'RAM (%)' },
  { value: 'disk', label: props.trans.resourceAlertMetricDisk || 'DISK (%)' },
  { value: 'netIn', label: props.trans.resourceAlertMetricNetIn || 'NET In (Mbps)' },
  { value: 'netOut', label: props.trans.resourceAlertMetricNetOut || 'NET Out (Mbps)' }
])

const resourceAlertIntervalOptions = computed(() => (
  Array.from({ length: 6 }, (_, index) => {
    const minutes = index + 5
    const label = props.trans.resourceAlertIntervalMinutes
      ? props.trans.resourceAlertIntervalMinutes.replace('{minutes}', minutes)
      : `${minutes} min`

    return {
      value: String(minutes),
      label
    }
  })
))

const resourceAlertServerOptions = computed(() => (
  props.servers
    .map(server => ({
      id: String(server.id || '').trim(),
      name: server.name || server.id
    }))
    .filter(server => server.id)
))

const getResourceAlertRuleServerIds = (rule) => (
  Array.isArray(rule.servers)
    ? rule.servers.map(item => String(item || '').trim()).filter(Boolean)
    : []
)

const resourceAlertRuleHasServer = (rule, serverId) => (
  getResourceAlertRuleServerIds(rule).includes(String(serverId))
)

const isLastResourceAlertRuleServer = (rule, serverId) => {
  const selected = getResourceAlertRuleServerIds(rule)
  return selected.length === 1 && selected[0] === String(serverId)
}

const toggleResourceAlertRuleServer = (rule, serverId, checked) => {
  const id = String(serverId || '').trim()
  if (!id) return

  const selected = getResourceAlertRuleServerIds(rule)
  const selectedSet = new Set(selected)
  if (checked) {
    selectedSet.add(id)
  } else if (selectedSet.size > 1) {
    selectedSet.delete(id)
  }
  rule.servers = Array.from(selectedSet)
}

const closeResourceAlertServerDropdowns = (event) => {
  const target = event?.target
  if (!(target instanceof Element)) return
  const currentDropdown = target.closest('.resource-alert-server-dropdown')

  document.querySelectorAll('.resource-alert-server-dropdown[open]').forEach(dropdown => {
    if (dropdown === currentDropdown) return
    dropdown.removeAttribute('open')
  })
}

const resourceAlertServerSelectLabel = (rule) => {
  const options = resourceAlertServerOptions.value
  const total = options.length
  if (total === 0) return props.trans.noServers || 'No servers'

  const optionMap = new Map(options.map(server => [server.id, server.name]))
  const selected = getResourceAlertRuleServerIds(rule).filter(id => optionMap.has(id))
  if (selected.length === total) return `${props.trans.all || 'All'} (${total})`
  if (selected.length === 1) return optionMap.get(selected[0])
  return `${selected.length}/${total} ${props.trans.servers || 'Servers'}`
}

const createRuleId = () => `rule_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
const isNetworkAlertMetric = metric => metric === 'netIn' || metric === 'netOut'
const resourceAlertThresholdPlaceholder = metric => isNetworkAlertMetric(metric) ? '100' : '80'
const resourceAlertThresholdMax = metric => isNetworkAlertMetric(metric) ? 100000 : 100

const normalizeRuleThreshold = (rule) => {
  const threshold = Number(rule.threshold)
  const max = resourceAlertThresholdMax(rule.metric)
  if (!Number.isFinite(threshold) || threshold <= 0 || threshold > max) {
    rule.threshold = resourceAlertThresholdPlaceholder(rule.metric)
  }
}

const addResourceAlertRule = () => {
  resourceAlertExpanded.value = true
  const rules = ensureResourceAlertRules()
  const metric = 'cpu'
  const rule = {
    id: createRuleId(),
    name: `${props.trans.resourceAlertRule || 'Resource Alert'} ${rules.length + 1}`,
    metric,
    threshold: resourceAlertThresholdPlaceholder(metric),
    servers: resourceAlertServerOptions.value.map(server => server.id),
    intervalMinutes: '5',
    mode: 'average'
  }
  rules.push(rule)
  nextTick(() => {
    const input = resourceAlertRuleNameInputs.get(rule.id)
    input?.focus()
    input?.select()
  })
}

const removeResourceAlertRule = (index) => {
  ensureResourceAlertRules().splice(index, 1)
}

const pingNodeErrorMessage = computed(() => (
  props.trans.invalidPingNodeFormat || 'Use domain, IPv4, or host:port. Port must be 1-65535.'
))

const pingNodeErrors = computed(() => Object.fromEntries(
  PING_NODE_FIELDS.map(field => [
    field,
    validatePingNode(props.settings[field]).valid ? '' : pingNodeErrorMessage.value
  ])
))

const hasPingNodeErrors = computed(() => Object.values(pingNodeErrors.value).some(Boolean))

const validatePingNodes = () => !hasPingNodeErrors.value

const isValidCspOrigin = (value) => {
  const raw = String(value || '').trim()
  if (!raw || /[\s;"']/.test(raw)) return false
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:') return false
    if (url.username || url.password || url.search || url.hash) return false
    if (url.pathname && url.pathname !== '/') return false
    return true
  } catch (_) {
    return false
  }
}

const validateCspField = (field) => {
  const value = props.settings[field] || ''
  if (!value) {
    cspErrors[field] = ''
    return true
  }
  const domains = value.split(',').map(s => s.trim()).filter(Boolean)
  for (const domain of domains) {
    if (!isValidCspOrigin(domain)) {
      cspErrors[field] = props.trans.cspInvalidDomain || 'Each domain must start with https://'
      return false
    }
  }
  cspErrors[field] = ''
  return true
}

onMounted(() => {
  document.addEventListener('click', closeResourceAlertServerDropdowns)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', closeResourceAlertServerDropdowns)
})

defineExpose({ validateCspField, cspErrors, validatePingNodes, pingNodeErrors, validateSmtpFields, smtpErrors })
</script>
