import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import { ADMIN_ENTRY_URL, isAdminPath } from './router/adminEntryUrl'
import './styles/main.css'
import './styles/light.css'
import { STORAGE } from './utils/constants'
import { applyDefaultLanguage, currentLang, resolveLanguagePreference, translations } from './utils/i18n'
import { http, DEFAULT_REQUEST_TIMEOUT_MS } from './utils/http'
import { initConfig, hasMultipleApiBases } from './utils/config'
import { LAST_AGENT_VERSION, LAST_WORKERS_VERSION, VERSION, normalizeLiveSocketTimeoutMinutes } from './utils/api'
import { resolveDisplayMode } from './utils/displayMode'
import { getMikusAssetUrl, isMikusThemeEnabled, normalizeThemeOptions, setMikusThemeClass } from './utils/themeOptions'
import { applyDefaultTheme } from './composables/useTheme'
import {
  clearTurnstileToken,
  fetchAllTurnstileConfigs,
  getTurnstileEnabledSites,
  hasTurnstileSiteKeyMismatch,
  isTurnstileValueEnabled,
  loadTurnstileScript,
  setTurnstileToken
} from './utils/turnstile'

const getTranslation = () => {
  const lang = currentLang.value || resolveLanguagePreference(localStorage.getItem(STORAGE.LANGUAGE_PREFERENCE) || 'auto')
  return translations[lang] || translations.en
}

const trans = () => getTranslation()

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}[char]))

const renderMikusStartupLoading = (siteTitle) => {
  const loading = document.getElementById('loading')
  if (!loading || loading.dataset.mikusRendered === '1') return

  const title = escapeHtml(String(siteTitle || 'Komari').trim() || 'Komari')
  const loliUrl = getMikusAssetUrl('loli.gif')
  const logoUrl = getMikusAssetUrl('miku.png')
  loading.dataset.mikusRendered = '1'
  loading.classList.add('mikus-startup')
  loading.innerHTML = `
    <div class="mikus-startup-loading">
      <img class="mikus-startup-gif" src="${loliUrl}" alt="Loading">
      <div class="mikus-startup-brand">
        <img class="mikus-startup-logo" src="${logoUrl}" alt="">
        <span>${title}</span>
      </div>
      <div class="mikus-startup-progress" aria-hidden="true">
        <div class="mikus-startup-progress-fill"></div>
      </div>
      <div class="mikus-startup-status">$ Initializing...</div>
    </div>
  `
}

const applyStartupThemeOptions = (config) => {
  const enabled = isMikusThemeEnabled(config?.theme_options)
  setMikusThemeClass(enabled)
  if (enabled) {
    renderMikusStartupLoading(config?.site_title)
  }
}

async function fetchConfig() {
  try {
    let result = await http.get('/api/config', { includeAuth: true, includeTurnstile: true, autoRedirect: false, timeoutMs: DEFAULT_REQUEST_TIMEOUT_MS })

    // 超时或 403：清掉可疑的 Turnstile 缓存，不带 header 重试走 bypass 路径
    if (result.error && (result.timeout || result.status === 403)) {
      localStorage.removeItem(STORAGE.TURNSTILE_TOKEN)
      localStorage.removeItem(STORAGE.TURNSTILE_VERIFIED)
      result = await http.get('/api/config', { includeAuth: true, includeTurnstile: false, includeTurnstileVerified: false, autoRedirect: false, timeoutMs: DEFAULT_REQUEST_TIMEOUT_MS })
    }

    if (result.error) {
      return {
        turnstile_enabled: false,
        turnstile_login_enabled: false,
        turnstile_site_key: '',
        display_mode: 'bar',
        preferred_theme: 'auto',
        default_language: 'auto',
        version: '',
        last_workers_version: '',
        last_agent_version: '',
        frontend_ws_timeout_minutes: 0,
        theme_options: {},
        verified: false
      }
    }

    const data = result.data
    if (!data) {
      return {
        turnstile_enabled: false,
        turnstile_login_enabled: false,
        turnstile_site_key: '',
        display_mode: 'bar',
        preferred_theme: 'auto',
        default_language: 'auto',
        version: '',
        last_workers_version: '',
        last_agent_version: '',
        frontend_ws_timeout_minutes: 0,
        theme_options: {},
        verified: false
      }
    }

    const turnstileEnabled = isTurnstileValueEnabled(data.turnstile_enabled)
    const turnstileLoginEnabled = isTurnstileValueEnabled(data.turnstile_login_enabled)
    const turnstileSiteKey = data.turnstile_site_key || ''
    const version = data.version || ''
    const lastWorkersVersion = data.last_workers_version || ''
    const lastAgentVersion = data.last_agent_version || ''
    const verified = data.verified === true
    const isPublic = data.is_public !== false
    const authorization = data.authorization === true
    const siteTitle = data.site_title || ''
    const displayMode = resolveDisplayMode(data)
    const preferredTheme = ['dark', 'light', 'auto'].includes(String(data.preferred_theme || '').toLowerCase()) ? String(data.preferred_theme).toLowerCase() : 'auto'
    const defaultLanguage = ['zh', 'en', 'es', 'auto'].includes(String(data.default_language || '').toLowerCase()) ? String(data.default_language).toLowerCase() : 'auto'
    const themeOptions = normalizeThemeOptions(data.theme_options)
    const frontendWsTimeoutMinutes = normalizeLiveSocketTimeoutMinutes(data.frontend_ws_timeout_minutes)

    if (version) {
      VERSION.value = version
    }
    LAST_WORKERS_VERSION.value = lastWorkersVersion
    LAST_AGENT_VERSION.value = lastAgentVersion

    return {
      turnstile_enabled: turnstileEnabled,
      turnstile_login_enabled: turnstileLoginEnabled,
      turnstile_site_key: turnstileSiteKey,
      custom_ct_name: data.custom_ct_name || '电信',
      custom_cu_name: data.custom_cu_name || '联通',
      custom_cm_name: data.custom_cm_name || '移动',
      custom_bd_name: data.custom_bd_name || 'BGP',
      node_1_name: data.node_1_name || 'Node 1',
      node_2_name: data.node_2_name || 'Node 2',
      node_3_name: data.node_3_name || 'Node 3',
      node_4_name: data.node_4_name || 'Node 4',
      version,
      last_workers_version: lastWorkersVersion,
      last_agent_version: lastAgentVersion,
      verified,
      is_public: isPublic,
      authorization,
      site_title: siteTitle,
      display_mode: displayMode,
      preferred_theme: preferredTheme,
      default_language: defaultLanguage,
      frontend_ws_timeout_minutes: frontendWsTimeoutMinutes,
      theme_options: themeOptions
    }
  } catch (e) {
    console.error('Failed to fetch config:', e)
  }
  return {
    turnstile_enabled: false,
    turnstile_login_enabled: false,
    turnstile_site_key: '',
    custom_ct_name: '电信', custom_cu_name: '联通', custom_cm_name: '移动', custom_bd_name: 'BGP',
    node_1_name: 'Node 1', node_2_name: 'Node 2', node_3_name: 'Node 3', node_4_name: 'Node 4',
    display_mode: 'bar',
    preferred_theme: 'auto',
    default_language: 'auto',
    version: '',
    last_workers_version: '',
    last_agent_version: '',
    frontend_ws_timeout_minutes: 0,
    theme_options: {},
    verified: false
  }
}

async function verifyTurnstileByIndex(siteKey, apiIndex = 0) {
  return new Promise((resolve) => {
    window.turnstile.render('#turnstile-container', {
      sitekey: siteKey,
      callback: async (token) => {
        setTurnstileToken(token)
        try {
          const result = await http.getByIndex('/api/config', apiIndex, { includeAuth: false, includeTurnstile: true, autoRedirect: false, timeoutMs: DEFAULT_REQUEST_TIMEOUT_MS })
          if (!result.error) {
            resolve(result.data && result.data.verified === true)
          } else {
            resolve(false)
          }
        } catch (e) {
          console.error('Failed to verify token:', e)
          resolve(false)
        }
      },
      errorCallback: (error) => {
        console.error('Turnstile error:', error)
        resolve(false)
      },
      expiredCallback: () => {
        clearTurnstileToken()
        resolve(false)
      }
    })
  })
}

const getPrivateAccessState = (results) => {
  const privateSites = results.filter(result => !result.error && result.data && result.data.is_public === false)
  return {
    hasPrivateSite: privateSites.length > 0,
    hasUnauthorizedPrivateSite: privateSites.some(result => result.data.authorization !== true)
  }
}

const showTurnstileError = (title, desc) => {
  const loading = document.getElementById('loading')
  if (loading) {
    loading.innerHTML = `
      <div class="loading-content">
        <div style="font-size: 48px; margin-bottom: 16px;">⚠️</div>
        <div class="loading-text" style="color: #f85149;">${title}</div>
        <div style="font-size: 12px; color: #6b7280; margin-top: 12px; max-width: 480px; text-align: center; line-height: 1.6;">${desc}</div>
      </div>
    `
  }
}

const showTurnstileUnsupported = () => {
  showTurnstileError(trans().turnstileNotSupported, trans().turnstileNotSupportedDesc)
}

const showTurnstileSiteKeyMismatch = () => {
  showTurnstileError(trans().turnstileSiteKeyMismatch, trans().turnstileSiteKeyMismatchDesc)
}

const renderStartupTurnstile = async (siteKey, apiIndex) => {
  const loading = document.getElementById('loading')
  if (loading) {
    loading.innerHTML = `
      <div class="loading-content">
        <div class="loading-spinner"></div>
        <div class="loading-text">$ Verifying...</div>
        <div id="turnstile-container" style="margin-top: 20px;"></div>
      </div>
    `
  }

  try {
    await loadTurnstileScript()
    const verified = await verifyTurnstileByIndex(siteKey, apiIndex)

    if (!verified) {
      if (loading) {
        loading.innerHTML = `
          <div class="loading-content">
            <div style="font-size: 48px; margin-bottom: 16px;">❌</div>
            <div class="loading-text" style="color: #f85149;">${trans().verificationFailed}</div>
            <div style="font-size: 12px; color: #6b7280; margin-top: 8px;">${trans().refreshToRetry}</div>
          </div>
        `
      }
      return false
    }
    return true
  } catch (e) {
    console.error('Turnstile error:', e)
    if (loading) {
      loading.innerHTML = `
        <div class="loading-content">
          <div style="font-size: 48px; margin-bottom: 16px;">❌</div>
          <div class="loading-text" style="color: #f85149;">${trans().verificationError}</div>
          <div style="font-size: 12px; color: #6b7280; margin-top: 8px;">${trans().refreshToRetry}</div>
        </div>
      `
    }
    return false
  }
}

async function initApp() {
  // 后台入口 URL 的归一化在 router 模块内、createWebHashHistory() 之前完成，
  // 这里只读取归一化后的 URL 做分支判断，不能再改写地址栏。

  // Load frontend runtime config (apiBase) first so all subsequent
  // HTTP / WebSocket requests go through the configured origin.
  await initConfig()

  const isMultipleMode = hasMultipleApiBases()
  const currentHash = window.location.hash || ''
  const isAdmin = isAdminPath() || currentHash.startsWith('#admin') || currentHash.startsWith('#/admin')

  // 多站模式公开页面：一次 getAll 获取所有站点配置，检查 Turnstile key 是否可共享。
  let config
  if (isMultipleMode && !isAdmin) {
    try {
      const results = await fetchAllTurnstileConfigs()
      const enabledTurnstileSites = getTurnstileEnabledSites(results, 'global')
      const first = results.find(r => !r.error && r.data)
      const sharedTurnstileSite = enabledTurnstileSites[0] || null
      const privateAccess = getPrivateAccessState(results)
      if (!privateAccess.hasPrivateSite && hasTurnstileSiteKeyMismatch(enabledTurnstileSites)) {
        showTurnstileSiteKeyMismatch()
        return
      }
      config = first ? {
        turnstile_enabled: isTurnstileValueEnabled(first.data.turnstile_enabled),
        turnstile_login_enabled: isTurnstileValueEnabled(first.data.turnstile_login_enabled),
        turnstile_site_key: sharedTurnstileSite?.siteKey || first.data.turnstile_site_key || '',
        turnstile_api_index: sharedTurnstileSite?.index || 0,
        site_configs: results.map(result => (!result.error && result.data) ? result.data : null),
        version: first.data.version || '',
        last_workers_version: first.data.last_workers_version || '',
        last_agent_version: first.data.last_agent_version || '',
        verified: sharedTurnstileSite ? enabledTurnstileSites.every(site => site.verified) : first.data.verified === true,
        is_public: !privateAccess.hasPrivateSite,
        authorization: !privateAccess.hasUnauthorizedPrivateSite,
        site_title: first.data.site_title || '',
        display_mode: resolveDisplayMode(first.data),
        preferred_theme: ['dark', 'light', 'auto'].includes(String(first.data.preferred_theme || '').toLowerCase()) ? String(first.data.preferred_theme).toLowerCase() : 'auto',
        default_language: ['zh', 'en', 'es', 'auto'].includes(String(first.data.default_language || '').toLowerCase()) ? String(first.data.default_language).toLowerCase() : 'auto',
        frontend_ws_timeout_minutes: normalizeLiveSocketTimeoutMinutes(first.data.frontend_ws_timeout_minutes),
        theme_options: normalizeThemeOptions(first.data.theme_options)
      } : { turnstile_enabled: false, turnstile_login_enabled: false, turnstile_site_key: '', turnstile_api_index: 0, version: '', last_workers_version: '', last_agent_version: '', verified: false, is_public: true, authorization: false, site_title: '', display_mode: 'bar', preferred_theme: 'auto', default_language: 'auto', frontend_ws_timeout_minutes: 0, theme_options: {} }
      if (sharedTurnstileSite) {
        config.turnstile_enabled = true
        config.turnstile_site_key = sharedTurnstileSite.siteKey
        config.turnstile_api_index = sharedTurnstileSite.index
      }
      if (config.version) VERSION.value = config.version
      LAST_WORKERS_VERSION.value = config.last_workers_version || ''
      LAST_AGENT_VERSION.value = config.last_agent_version || ''
    } catch (_) {
      config = { turnstile_enabled: false, turnstile_login_enabled: false, turnstile_site_key: '', turnstile_api_index: 0, version: '', last_workers_version: '', last_agent_version: '', verified: false, is_public: true, authorization: false, site_title: '', display_mode: 'bar', preferred_theme: 'auto', default_language: 'auto', frontend_ws_timeout_minutes: 0, theme_options: {} }
    }
  } else {
    config = await fetchConfig()
  }

  applyDefaultTheme(config?.preferred_theme)
  applyDefaultLanguage(config?.default_language)
  applyStartupThemeOptions(config)

  // 仅全局模式需要在启动时验证 Turnstile；登录模式在 Admin 页面的登录表单中验证
  if (config.turnstile_enabled) {
    if (isMultipleMode) {
      if (!config.verified && config.turnstile_site_key) {
        const verified = await renderStartupTurnstile(config.turnstile_site_key, config.turnstile_api_index || 0)
        if (!verified) return
      }
    } else if (config.turnstile_site_key && !config.verified) {
      const verified = await renderStartupTurnstile(config.turnstile_site_key, 0)
      if (!verified) return
    }
  }

  const app = createApp(App)
  app.provide('appConfig', config || {})
  app.use(router)
  app.mount('#app').$nextTick(() => {
    if (!isAdmin && !config.is_public && !config.authorization) {
      window.location.replace(ADMIN_ENTRY_URL)
    }
    const loading = document.getElementById('loading')
    if (loading) {
      setTimeout(() => {
        loading.remove()
      }, 1000)
    }
  })
}

initApp()
