import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import './styles/main.css'
import './styles/light.css'
import { currentLang, translations } from './utils/i18n'
import { http } from './utils/http'
import { initConfig, getTitle, getBackgroundImage, hasMultipleApiBases } from './utils/config'
import { VERSION } from './utils/api'

const getTranslation = () => {
  const lang = localStorage.getItem('language_preference') || 'zh'
  return translations[lang] || translations.en
}

const trans = () => getTranslation()

async function fetchConfig() {
  try {
    const result = await http.get('/api/config', { includeAuth: true, includeTurnstile: true })
    if (result.error) {
      return { turnstile_enabled: false, turnstile_login_enabled: false, turnstile_site_key: '', version: '', verified: false }
    }

    const data = result.data
    if (!data) {
      return { turnstile_enabled: false, turnstile_login_enabled: false, turnstile_site_key: '', version: '', verified: false }
    }

    const turnstileEnabled = data.turnstile_enabled === true
    const turnstileLoginEnabled = data.turnstile_login_enabled === true
    const turnstileSiteKey = data.turnstile_site_key || ''
    const version = data.version || ''
    const verified = data.verified === true
    const isPublic = data.is_public !== false
    const authorization = data.authorization === true
    const siteTitle = data.site_title || ''

    if (version) {
      VERSION.value = version
    }

    return {
      turnstile_enabled: turnstileEnabled,
      turnstile_login_enabled: turnstileLoginEnabled,
      turnstile_site_key: turnstileSiteKey,
      version,
      verified,
      is_public: isPublic,
      authorization,
      site_title: siteTitle
    }
  } catch (e) {
    console.error('Failed to fetch config:', e)
  }
  return { turnstile_enabled: false, turnstile_login_enabled: false, turnstile_site_key: '', verified: false }
}

async function loadTurnstileScript() {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js'
    script.async = true
    script.onload = resolve
    script.onerror = reject
    document.head.appendChild(script)
  })
}

async function verifyTurnstileByIndex(siteKey, apiIndex = 0) {
  return new Promise((resolve) => {
    turnstile.render('#turnstile-container', {
      sitekey: siteKey,
      callback: async (token) => {
        localStorage.setItem('turnstile_token', token)
        try {
          const result = await http.getByIndex('/api/config', apiIndex, { includeAuth: false, includeTurnstile: true, autoRedirect: false })
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
        localStorage.removeItem('turnstile_token')
        resolve(false)
      }
    })
  })
}

const isEnabled = (value) => value === true || value === 'true'
const normalizeSiteKey = (value) => String(value || '').trim()

const getEnabledTurnstileSites = (results, mode = 'global') => {
  return results
    .map((result, index) => ({ result, index }))
    .filter(({ result }) => {
      if (result.error || !result.data) return false
      if (mode === 'login') {
        return isEnabled(result.data.turnstile_enabled) || isEnabled(result.data.turnstile_login_enabled)
      }
      return isEnabled(result.data.turnstile_enabled)
    })
    .map(({ result, index }) => ({
      index,
      data: result.data,
      siteKey: normalizeSiteKey(result.data.turnstile_site_key),
      verified: result.data.verified === true
    }))
}

const hasTurnstileSiteKeyMismatch = (sites) => {
  const keys = [...new Set(sites.map(site => site.siteKey).filter(Boolean))]
  return sites.some(site => !site.siteKey) || keys.length > 1
}

const getPrivateAccessState = (results) => {
  const privateSites = results.filter(result => !result.error && result.data && result.data.is_public === false)
  return {
    hasPrivateSite: privateSites.length > 0,
    hasUnauthorizedPrivateSite: privateSites.some(result => result.data.authorization !== true)
  }
}

const fetchAllConfigs = async () => {
  let results = await http.getAll('/api/config', { includeAuth: true, includeTurnstile: true, autoRedirect: false })
  if (results.some(result => result.status === 403)) {
    results = await http.getAll('/api/config', { includeAuth: true, includeTurnstile: false, autoRedirect: false })
  }
  return results
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
  // Load frontend runtime config (apiBase) first so all subsequent
  // HTTP / WebSocket requests go through the configured origin.
  await initConfig()

  const appTitle = getTitle()
  const bgImage = getBackgroundImage()

  if (appTitle) {
    document.title = appTitle
  }

  if (bgImage) {
    document.body.style.backgroundImage = `url(${bgImage})`
    document.body.style.backgroundSize = 'cover'
    document.body.style.backgroundPosition = 'center'
    document.body.style.backgroundRepeat = 'no-repeat'
    document.body.style.backgroundAttachment = 'fixed'
  }

  const isMultipleMode = hasMultipleApiBases()
  const currentHash = window.location.hash
  const isAdmin = currentHash.startsWith('#/admin')

  // 多站模式公开页面：一次 getAll 获取所有站点配置，检查 Turnstile key 是否可共享。
  let config
  if (isMultipleMode && !isAdmin) {
    try {
      const results = await fetchAllConfigs()
      const enabledTurnstileSites = getEnabledTurnstileSites(results, 'global')
      if (hasTurnstileSiteKeyMismatch(enabledTurnstileSites)) {
        showTurnstileSiteKeyMismatch()
        return
      }
      const first = results.find(r => !r.error && r.data)
      const sharedTurnstileSite = enabledTurnstileSites[0] || null
      const privateAccess = getPrivateAccessState(results)
      config = first ? {
        turnstile_enabled: isEnabled(first.data.turnstile_enabled),
        turnstile_login_enabled: isEnabled(first.data.turnstile_login_enabled),
        turnstile_site_key: sharedTurnstileSite?.siteKey || first.data.turnstile_site_key || '',
        turnstile_api_index: sharedTurnstileSite?.index || 0,
        version: first.data.version || '',
        verified: sharedTurnstileSite ? enabledTurnstileSites.every(site => site.verified) : first.data.verified === true,
        is_public: !privateAccess.hasPrivateSite,
        authorization: !privateAccess.hasUnauthorizedPrivateSite,
        site_title: getTitle() || first.data.site_title || ''
      } : { turnstile_enabled: false, turnstile_login_enabled: false, turnstile_site_key: '', turnstile_api_index: 0, version: '', verified: false, is_public: true, authorization: false, site_title: getTitle() || '' }
      if (sharedTurnstileSite) {
        config.turnstile_enabled = true
        config.turnstile_site_key = sharedTurnstileSite.siteKey
        config.turnstile_api_index = sharedTurnstileSite.index
      }
      if (config.version) VERSION.value = config.version
    } catch (_) {
      config = { turnstile_enabled: false, turnstile_login_enabled: false, turnstile_site_key: '', turnstile_api_index: 0, version: '', verified: false, is_public: true, authorization: false }
    }
  } else {
    config = await fetchConfig()
  }

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
      router.push('/admin')
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
