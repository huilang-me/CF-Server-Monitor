<script setup>
import { computed, nextTick, onMounted, onUnmounted, reactive, ref } from 'vue'
import { formatBytes, isOnline, metricLabel, metricText, normalizeGpu, validHistoryHours } from './utils.js'

const rawBase = document.querySelector('meta[name="apiBase"]')?.content || ''
const bases = [...new Set(rawBase.split(',').map(x => x.trim()).filter(x => x && !x.includes('%VITE_')).map(x => new URL(x, location.origin).origin))]
if (!bases.length) bases.push(location.origin)

const TURNSTILE_CACHE = 'cfsm_minimal_turnstile_verified'
const DEFAULT_OPTIONS = { compact: false, showNetwork: true }
const configs = reactive({})
const siteConfigs = reactive({})
const servers = reactive({})
const stats = reactive({})
const themeOptions = reactive({ ...DEFAULT_OPTIONS })
const wsStates = reactive({})
const errors = ref([])
const loading = ref(true)
const route = ref(readRoute())
const detail = ref(null)
const detailBase = ref('')
const historyRows = ref([])
const selectedHours = ref('0.167')
const showSettings = ref(false)
const savingOptions = ref(false)
const settingsMessage = ref('')
const turnstileTokens = new Map()
const turnstileWidgets = new Map()
const turnstileWaiters = new Map()
const pending = new Map()
const sockets = new Map()
const reconnectTimers = new Map()
const timeoutTimers = new Map()
const retries = new Map()
const pausedByUser = new Set()
const loadedHome = new Set()
let flushTimer = 0
let disposed = false
let routeListener
let visibilityListener
let mediaListener
let turnstileScriptPromise

function readRoute() {
  const match = location.hash.match(/^#\/server\/([^/?#]+)/)
  return match ? { name: 'detail', id: decodeURIComponent(match[1]) } : { name: 'home' }
}
function cacheKey(base) { return TURNSTILE_CACHE + ':' + new URL(base).origin }
function cachedVerified(base) { return localStorage.getItem(cacheKey(base)) || '' }
function saveVerified(base, value) {
  if (value) localStorage.setItem(cacheKey(base), value)
}
function clearVerified(base) { localStorage.removeItem(cacheKey(base)) }
function apiUrl(base, path) { return new URL(path, base + '/') }
function authHeaders(extra = {}) {
  const headers = { ...extra }
  const token = localStorage.getItem('jwt_token')
  if (token) headers.Authorization = 'Bearer ' + token
  return headers
}
function isTurnstileEnabled(base) { return configs[base]?.turnstile_enabled === true }
function loadTurnstileScript() {
  if (window.turnstile) return Promise.resolve()
  if (turnstileScriptPromise) return turnstileScriptPromise
  turnstileScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-cfsm-turnstile]')
    if (existing) {
      existing.addEventListener('load', resolve, { once: true })
      existing.addEventListener('error', reject, { once: true })
      return
    }
    const script = document.createElement('script')
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    script.async = true
    script.defer = true
    script.dataset.cfsmTurnstile = 'true'
    script.onload = resolve
    script.onerror = () => reject(new Error('Turnstile 脚本加载失败，请检查网络或 CSP 配置'))
    document.head.appendChild(script)
  })
  return turnstileScriptPromise
}
async function getTurnstileToken(base, reset = false) {
  if (!isTurnstileEnabled(base)) return ''
  if (turnstileTokens.has(base) && !reset) return turnstileTokens.get(base)
  const sitekey = configs[base]?.turnstile_site_key
  if (!sitekey) throw new Error('站点已启用 Turnstile，但未返回 turnstile_site_key')
  await loadTurnstileScript()
  await nextTick()
  const host = document.getElementById('turnstile-' + bases.indexOf(base))
  if (!host) throw new Error('Turnstile 验证区域尚未就绪，请重试')
  return new Promise((resolve, reject) => {
    const oldWaiter = turnstileWaiters.get(base)
    if (oldWaiter) oldWaiter.reject(new Error('Turnstile 验证已重置'))
    const waiter = { resolve, reject }
    turnstileWaiters.set(base, waiter)
    const callbacks = {
      sitekey,
      callback: token => {
        turnstileTokens.set(base, token)
        const current = turnstileWaiters.get(base)
        if (current) { turnstileWaiters.delete(base); current.resolve(token) }
      },
      'error-callback': () => {
        const current = turnstileWaiters.get(base)
        if (current) { turnstileWaiters.delete(base); current.reject(new Error('Turnstile 验证失败，请重试')) }
      },
      'expired-callback': () => {
        turnstileTokens.delete(base)
        const current = turnstileWaiters.get(base)
        if (current) { turnstileWaiters.delete(base); current.reject(new Error('Turnstile token 已过期，请重新验证')) }
      }
    }
    const widgetId = turnstileWidgets.get(base)
    if (widgetId !== undefined) {
      window.turnstile.reset(widgetId)
    } else {
      host.replaceChildren()
      turnstileWidgets.set(base, window.turnstile.render(host, callbacks))
    }
  })
}
async function ensureTurnstileVerified(base) {
  if (!isTurnstileEnabled(base) || cachedVerified(base)) return
  const token = await getTurnstileToken(base)
  // The documented verification exchange returns a reusable credential from /api/config.
  const response = await fetch(apiUrl(base, '/api/config'), {
    headers: { ...authHeaders(), 'X-Turnstile-Token': token }
  })
  turnstileTokens.delete(base)
  if (response.status === 401) {
    localStorage.removeItem('jwt_token')
    location.assign('/admin#/admin')
    throw new Error('登录已失效，正在跳转到管理后台')
  }
  if (!response.ok) throw new Error('Turnstile 验证失败：HTTP ' + response.status)
  const result = await response.json()
  if (typeof result.turnstile_verified !== 'string' || !result.turnstile_verified) {
    throw new Error('Turnstile 验证成功，但服务器没有返回可复用凭证')
  }
  saveVerified(base, result.turnstile_verified)
}
async function fetchJson(base, path, options = {}, allowTurnstileRetry = true) {
  await ensureTurnstileVerified(base)
  const headers = authHeaders(options.headers || {})
  if (isTurnstileEnabled(base)) headers['X-Turnstile-Verified'] = cachedVerified(base)
  const response = await fetch(apiUrl(base, path), { ...options, headers })
  if (response.status === 401) {
    localStorage.removeItem('jwt_token')
    if (!window.__cfsmRedirecting) {
      window.__cfsmRedirecting = true
      location.assign('/admin#/admin')
    }
    throw new Error('登录已失效，正在跳转到管理后台')
  }
  if (response.status === 403 && isTurnstileEnabled(base) && allowTurnstileRetry) {
    clearVerified(base)
    turnstileTokens.delete(base)
    const widgetId = turnstileWidgets.get(base)
    if (widgetId !== undefined) window.turnstile?.reset(widgetId)
    return fetchJson(base, path, options, false)
  }
  if (!response.ok) {
    let message = 'HTTP ' + response.status
    try { message = (await response.json()).error || message } catch {}
    const error = new Error(message)
    error.status = response.status
    throw error
  }
  return response.json()
}
async function requestConfig(base) {
  // /api/config is intentionally requested once without Turnstile so the site key can be discovered.
  const response = await fetch(apiUrl(base, '/api/config'), { headers: authHeaders() })
  if (response.status === 401) {
    localStorage.removeItem('jwt_token')
    location.assign('/admin#/admin')
    throw new Error('请先登录管理后台')
  }
  if (!response.ok) throw new Error('获取站点配置失败：HTTP ' + response.status)
  return response.json()
}
function applyTheme() {
  const preferred = configs[bases[0]]?.preferred_theme || 'auto'
  const theme = preferred === 'auto'
    ? (window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
    : preferred
  document.documentElement.dataset.theme = theme === 'light' ? 'light' : 'dark'
}
function applyLanguage() {
  const preferred = configs[bases[0]]?.default_language || 'auto'
  return preferred === 'en' ? 'en' : preferred === 'zh' ? 'zh' :
    ((navigator.language || '').toLowerCase().startsWith('zh') ? 'zh' : 'en')
}
const language = computed(applyLanguage)
function t(zh, en) { return language.value === 'zh' ? zh : en }
function applyThemeOptions() {
  const saved = configs[bases[0]]?.theme_options
  Object.assign(themeOptions, DEFAULT_OPTIONS, saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {})
}
function isPrivate(base) { return configs[base]?.is_public !== true }
function requireLogin() {
  if (bases.some(isPrivate) && !localStorage.getItem('jwt_token')) {
    location.assign('/admin#/admin')
    return true
  }
  return false
}
function setError(error) {
  errors.value = [error?.message || String(error)]
}
function online(server) { return isOnline(server?.last_updated) }
function mergePatch(base, id, patch, sampleTs) {
  const key = base + '::' + id
  const previous = pending.get(key) || {}
  const next = { ...previous, ...patch }
  if (patch.last_updated === undefined && sampleTs) next.last_updated = sampleTs
  pending.set(key, next)
  if (!flushTimer) flushTimer = window.setTimeout(flushPending, 1000)
}
function flushPending() {
  flushTimer = 0
  for (const [key, patch] of pending) {
    const split = key.indexOf('::')
    const base = key.slice(0, split)
    const id = key.slice(split + 2)
    const row = (servers[base] || []).find(item => item.id === id)
    if (row) Object.assign(row, patch)
    if (detailBase.value === base && detail.value?.id === id) Object.assign(detail.value, patch)
  }
  pending.clear()
}
function clearReconnect(base) {
  if (reconnectTimers.has(base)) clearTimeout(reconnectTimers.get(base))
  reconnectTimers.delete(base)
}
function closeSocket(base) {
  clearReconnect(base)
  if (timeoutTimers.has(base)) clearTimeout(timeoutTimers.get(base))
  timeoutTimers.delete(base)
  const socket = sockets.get(base)
  if (socket) {
    socket.onclose = null
    socket.close()
    sockets.delete(base)
  }
}
function scheduleReconnect(base, subscribe, ids) {
  if (disposed || document.hidden || pausedByUser.has(base) || reconnectTimers.has(base)) return
  const attempt = retries.get(base) || 0
  if (attempt >= 6) { wsStates[base] = '连接失败'; return }
  retries.set(base, attempt + 1)
  wsStates[base] = '重连中'
  const delay = Math.min(30000, 1000 * (2 ** attempt))
  reconnectTimers.set(base, setTimeout(() => {
    reconnectTimers.delete(base)
    if (!disposed && !document.hidden && !pausedByUser.has(base)) connect(base, subscribe, ids)
  }, delay))
}
function connect(base, subscribe, ids = []) {
  closeSocket(base)
  if (disposed || document.hidden || pausedByUser.has(base)) return
  const url = apiUrl(base, '/api/ws')
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.searchParams.set('subscribe', subscribe)
  if (isPrivate(base) && new URL(base).origin !== location.origin) {
    const token = localStorage.getItem('jwt_token')
    if (token) url.searchParams.set('token', token)
  }
  let socket
  try { socket = new WebSocket(url.toString()) }
  catch (error) { setError(error); scheduleReconnect(base, subscribe, ids); return }
  sockets.set(base, socket)
  wsStates[base] = '连接中'
  socket.onopen = () => {
    retries.set(base, 0)
    wsStates[base] = '实时'
    if (subscribe === 'all') socket.send(JSON.stringify({ type: 'subscribe', scope: 'all', ids }))
    const minutes = Number(configs[base]?.frontend_ws_timeout_minutes || 0)
    if (minutes > 0) {
      timeoutTimers.set(base, setTimeout(() => {
        const active = sockets.get(base)
        if (active !== socket) return
        closeSocket(base)
        wsStates[base] = '等待确认'
        const keep = window.confirm(t('实时连接已达到设置时长。是否继续监控？', 'The live connection reached its time limit. Continue monitoring?'))
        if (keep) {
          pausedByUser.delete(base)
          retries.set(base, 0)
          connect(base, subscribe, ids)
        } else {
          pausedByUser.add(base)
          wsStates[base] = '已暂停'
        }
      }, minutes * 60000))
    }
  }
  socket.onmessage = event => {
    let message
    try { message = JSON.parse(event.data) } catch { return }
    if (message.type !== 'batchUpdate') return
    for (const update of message.updates || []) {
      for (const sample of update.samples || []) {
        const patch = sample.data || sample.payload || sample.metrics || {}
        mergePatch(base, update.serverId, patch, sample.ts)
      }
    }
  }
  socket.onerror = () => { wsStates[base] = '连接异常' }
  socket.onclose = () => {
    if (sockets.get(base) === socket) sockets.delete(base)
    if (timeoutTimers.has(base)) { clearTimeout(timeoutTimers.get(base)); timeoutTimers.delete(base) }
    scheduleReconnect(base, subscribe, ids)
  }
}
function connectHome(base) {
  const ids = (servers[base] || []).map(server => server.id)
  connect(base, 'all', ids)
}
async function loadHome(base, force = false) {
  if (!loadedHome.has(base) || force) {
    const data = await fetchJson(base, '/api/servers')
    servers[base] = Array.isArray(data.servers) ? data.servers : []
    stats[base] = data.stats || {}
    siteConfigs[base] = data.sysConfig || {}
    loadedHome.add(base)
  }
  connectHome(base)
}
async function loadDetail(id) {
  closeAll()
  detail.value = null
  detailBase.value = ''
  let found = false
  let lastError
  for (const base of bases) {
    try {
      const server = await fetchJson(base, '/api/server?id=' + encodeURIComponent(id))
      detail.value = server
      detailBase.value = base
      found = true
      break
    } catch (error) {
      if (error.status !== 404) throw error
      lastError = error
    }
  }
  if (!found) throw lastError || new Error('找不到这台服务器')
  historyRows.value = await fetchJson(detailBase.value, '/api/history/all?id=' + encodeURIComponent(id) + '&hours=' + selectedHours.value)
  connect(detailBase.value, id)
}
function closeAll() { for (const base of bases) closeSocket(base) }
function goHome() { location.hash = '#/' }
function goDetail(id) { location.hash = '#/server/' + encodeURIComponent(id) }
const allServers = computed(() => bases.flatMap(base => (servers[base] || []).map(server => ({ ...server, __base: base }))))
const total = computed(() => bases.reduce((sum, base) => sum + Number(stats[base]?.total || 0), 0))
const onlineTotal = computed(() => bases.reduce((sum, base) => sum + Number(stats[base]?.online || 0), 0))
const offlineTotal = computed(() => bases.reduce((sum, base) => sum + Number(stats[base]?.offline || 0), 0))
const isDetail = computed(() => route.value.name === 'detail')
const history = computed(() => Array.isArray(historyRows.value) ? historyRows.value : [])
const gpuList = computed(() => normalizeGpu(detail.value?.gpu_info))
const diskHistory = computed(() => history.value.filter(row => row.disk && Object.values(row.disk).some(value => Number(value) > 0)))
function pingName(key, base) {
  const cfg = configs[base] || {}
  const names = { ct: cfg.custom_ct_name || 'CT', cu: cfg.custom_cu_name || 'CU', cm: cfg.custom_cm_name || 'CM', bd: cfg.custom_bd_name || 'BGP' }
  return names[key]
}
function nodeName(index, base) {
  return configs[base]?.['node_' + index + '_name'] || 'Node ' + index
}
function showMetric(value) { return value !== false && value !== undefined }
function metric(value, unit = '') { return metricText(value, unit, language.value) }
function latestValue(points, key) {
  for (let i = (points || []).length - 1; i >= 0; i--) {
    if (points[i]?.[key] !== undefined && points[i]?.[key] !== false) return points[i][key]
  }
  return undefined
}
function chartPoints(rows, key) {
  if (!rows.length) return ''
  const values = rows.map(row => Number(row?.[key])).filter(Number.isFinite)
  if (!values.length) return ''
  const min = Math.min(0, ...values)
  const max = Math.max(1, ...values)
  const range = max - min || 1
  const width = 600, height = 120, pad = 6
  return rows.map((row, index) => {
    const value = Number(row?.[key])
    if (!Number.isFinite(value)) return null
    const x = rows.length === 1 ? width / 2 : pad + index / (rows.length - 1) * (width - 2 * pad)
    const y = height - pad - ((value - min) / range) * (height - 2 * pad)
    return x.toFixed(1) + ',' + y.toFixed(1)
  }).filter(Boolean).join(' ')
}
function chartRows(key) { return history.value.filter(row => row[key] !== undefined && row[key] !== false && row[key] !== null) }
function miniPoints(points, key) {
  const valid = (points || []).filter(point => point?.[key] !== undefined && point?.[key] !== false && point?.[key] !== null)
  if (!valid.length) return ''
  const values = valid.map(point => Number(point[key])).filter(Number.isFinite)
  if (!values.length) return ''
  const max = Math.max(1, ...values), min = Math.min(0, ...values), range = max - min || 1
  return valid.map((point, index) => {
    const x = valid.length === 1 ? 30 : 2 + index / (valid.length - 1) * 56
    const y = 15 - ((Number(point[key]) - min) / range) * 12
    return x.toFixed(1) + ',' + y.toFixed(1)
  }).join(' ')
}
function resumeLive() {
  for (const base of [...pausedByUser]) {
    pausedByUser.delete(base)
    retries.set(base, 0)
    if (isDetail.value && detailBase.value === base && detail.value) connect(base, detail.value.id)
    else connectHome(base)
  }
}
function chartLabel(row) { return new Date(Number(row.timestamp)).toLocaleString(language.value === 'zh' ? 'zh-CN' : 'en-US') }
async function changeHours(value) {
  if (!validHistoryHours(value)) return
  selectedHours.value = value
  if (!detail.value || !detailBase.value) return
  try {
    historyRows.value = await fetchJson(detailBase.value, '/api/history/all?id=' + encodeURIComponent(detail.value.id) + '&hours=' + value)
  } catch (error) { setError(error) }
}
async function saveOptions() {
  if (!localStorage.getItem('jwt_token')) {
    settingsMessage.value = t('保存主题设置需要登录账号', 'Sign in to save theme settings')
    return
  }
  savingOptions.value = true
  settingsMessage.value = ''
  try {
    const current = configs[bases[0]]?.theme_options
    const payload = { ...(current && typeof current === 'object' && !Array.isArray(current) ? current : {}), compact: !!themeOptions.compact, showNetwork: !!themeOptions.showNetwork }
    await fetchJson(bases[0], '/api/theme_options', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ theme_options: payload }) })
    Object.assign(themeOptions, payload)
    settingsMessage.value = t('设置已保存', 'Settings saved')
  } catch (error) { setError(error); settingsMessage.value = error.message }
  finally { savingOptions.value = false }
}
async function refreshVisible() {
  if (document.hidden) { closeAll(); return }
  try {
    errors.value = []
    retries.clear()
    if (route.value.name === 'detail') await loadDetail(route.value.id)
    else {
      closeAll()
      for (const base of bases) await loadHome(base, true)
    }
  } catch (error) { setError(error) }
}
async function handleRouteChange() {
  route.value = readRoute()
  errors.value = []
  try {
    if (route.value.name === 'detail') await loadDetail(route.value.id)
    else {
      detail.value = null
      detailBase.value = ''
      historyRows.value = []
      closeAll()
      for (const base of bases) await loadHome(base)
    }
  } catch (error) { setError(error) }
}
onMounted(async () => {
  routeListener = () => handleRouteChange()
  visibilityListener = () => { if (document.hidden) closeAll(); else refreshVisible() }
  window.addEventListener('hashchange', routeListener)
  document.addEventListener('visibilitychange', visibilityListener)
  mediaListener = () => { if ((configs[bases[0]]?.preferred_theme || 'auto') === 'auto') applyTheme() }
  window.matchMedia?.('(prefers-color-scheme: light)').addEventListener?.('change', mediaListener)
  try {
    for (const base of bases) configs[base] = await requestConfig(base)
    if (requireLogin()) return
    applyTheme()
    applyThemeOptions()
    if (route.value.name === 'detail') await loadDetail(route.value.id)
    else for (const base of bases) await loadHome(base)
  } catch (error) { setError(error) }
  finally { loading.value = false }
})
onUnmounted(() => {
  disposed = true
  closeAll()
  if (flushTimer) clearTimeout(flushTimer)
  window.removeEventListener('hashchange', routeListener)
  document.removeEventListener('visibilitychange', visibilityListener)
  window.matchMedia?.('(prefers-color-scheme: light)').removeEventListener?.('change', mediaListener)
  for (const waiter of turnstileWaiters.values()) waiter.reject(new Error('页面已关闭'))
})
</script>

<template>
  <main class="app-shell" :class="{ compact: themeOptions.compact }">
    <header class="topbar">
      <a class="brand" href="#/" @click.prevent="goHome">
        <span class="brand-symbol">S</span>
        <span>{{ configs[bases[0]]?.site_title || 'Server Monitor' }}</span>
      </a>
      <div class="top-actions">
        <span class="connection"><i :class="{ offline: Object.values(wsStates).some(state => state !== '实时') }"></i>{{ isDetail ? t('单机实时', 'Single server') : t('实时监控', 'Live') }}</span>
        <button v-if="pausedByUser.size" class="resume-button" @click="resumeLive">{{ t('恢复实时', 'Resume live') }}</button>
        <button class="icon-button" :aria-label="t('主题设置', 'Theme settings')" @click="showSettings = !showSettings">⚙</button>
      </div>
    </header>

    <section v-if="Object.keys(configs).some(base => configs[base]?.turnstile_enabled === true && !cachedVerified(base))" class="verification">
      <strong>{{ t('请完成人机验证以加载监控数据', 'Complete the security check to load monitoring data') }}</strong>
      <div v-for="base in bases.filter(item => isTurnstileEnabled(item) && !cachedVerified(item))" :key="base" :id="'turnstile-' + bases.indexOf(base)" class="turnstile-host"></div>
    </section>

    <section v-if="showSettings" class="settings-panel">
      <div class="settings-row"><div><strong>{{ t('紧凑布局', 'Compact layout') }}</strong><small>{{ t('减少卡片间距', 'Reduce card spacing') }}</small></div><input v-model="themeOptions.compact" type="checkbox"></div>
      <div class="settings-row"><div><strong>{{ t('显示网络速度', 'Show network speed') }}</strong><small>{{ t('在服务器卡片中显示上下行', 'Show upload and download rates') }}</small></div><input v-model="themeOptions.showNetwork" type="checkbox"></div>
      <div class="settings-actions"><span>{{ settingsMessage }}</span><button :disabled="savingOptions" @click="saveOptions">{{ savingOptions ? t('保存中…', 'Saving…') : t('保存设置', 'Save settings') }}</button></div>
      <small class="settings-hint">{{ t('主题设置保存在服务器；保存需要已登录账号。', 'Theme options are stored on the server. Sign-in is required to save.') }}</small>
    </section>

    <div v-if="errors.length" class="error-panel">
      <strong>{{ t('加载遇到问题', 'Unable to load data') }}</strong>
      <p v-for="error in errors" :key="error">{{ error }}</p>
      <button @click="refreshVisible">{{ t('重试', 'Retry') }}</button>
    </div>
    <div v-if="loading" class="loading-state">{{ t('正在加载…', 'Loading…') }}</div>

    <template v-else-if="!isDetail">
      <section class="summary-grid">
        <div class="summary-card"><span>{{ t('服务器', 'Servers') }}</span><strong>{{ total }}</strong></div>
        <div class="summary-card"><span>{{ t('在线', 'Online') }}</span><strong class="good">{{ onlineTotal }}</strong></div>
        <div class="summary-card"><span>{{ t('离线', 'Offline') }}</span><strong class="bad">{{ offlineTotal }}</strong></div>
      </section>

      <div class="section-heading">
        <div><h1>{{ t('服务器列表', 'Servers') }}</h1><p>{{ t('实时状态与资源使用情况', 'Live status and resource usage') }}</p></div>
      </div>

      <section class="server-grid">
        <article v-for="server in allServers" :key="server.__base + ':' + server.id" class="server-card" @click="goDetail(server.id)">
          <div class="server-title">
            <div class="server-name"><i class="status-dot" :class="{ down: !online(server) }"></i><strong>{{ server.name || server.id }}</strong></div>
            <span class="server-arrow">↗</span>
          </div>
          <div class="server-subtitle">{{ [server.region, server.os].filter(Boolean).join(' · ') }}</div>
          <div class="resource-grid">
            <div><span>CPU</span><strong>{{ Number(server.cpu || 0).toFixed(1) }}%</strong></div>
            <div><span>{{ t('内存', 'Memory') }}</span><strong>{{ Number(server.ram_used || 0).toLocaleString() }} / {{ Number(server.ram_total || 0).toLocaleString() }} MB</strong></div>
            <div v-if="themeOptions.showNetwork"><span>{{ t('下载', 'Down') }}</span><strong>{{ formatBytes(server.net_in_speed) }}/s</strong></div>
            <div v-if="themeOptions.showNetwork"><span>{{ t('上传', 'Up') }}</span><strong>{{ formatBytes(server.net_out_speed) }}/s</strong></div>
          </div>
          <div class="usage-track"><i :style="{ width: (server.ram_total > 0 ? Math.min(100, server.ram_used / server.ram_total * 100) : 0) + '%' }"></i></div>
          <div v-if="siteConfigs[server.__base]?.show_three_net_details === true && (server.ping || []).length" class="latency-row">
            <span v-for="key in ['ct','cu','cm','bd']" :key="key" v-show="showMetric(latestValue(server.ping, key))" class="latency-item">
              {{ pingName(key, server.__base) }} <b>{{ metric(latestValue(server.ping, key), 'ms') }}</b>
              <svg v-if="miniPoints(server.ping, key)" viewBox="0 0 60 18" aria-hidden="true"><polyline class="mini-line" :points="miniPoints(server.ping, key)"/></svg>
            </span>
          </div>
          <div v-if="siteConfigs[server.__base]?.show_price === true || siteConfigs[server.__base]?.show_expire === true" class="server-meta">
            <span v-if="siteConfigs[server.__base]?.show_price === true && server.price !== '' && server.price !== undefined">{{ server.price === '0' || server.price === '-1' ? t('免费', 'Free') : (server.currency || '') + server.price }}</span>
            <span v-if="siteConfigs[server.__base]?.show_expire === true && server.expire_date">{{ t('到期', 'Expires') }} {{ server.expire_date }}</span>
          </div>
        </article>
        <div v-if="!allServers.length" class="empty-state">{{ t('暂无服务器', 'No servers found') }}</div>
      </section>
    </template>

    <template v-else-if="detail">
      <button class="back-link" @click="goHome">← {{ t('返回服务器列表', 'Back to servers') }}</button>
      <section class="detail-heading">
        <div><h1>{{ detail.name || detail.id }}</h1><p>{{ [detail.region, detail.os, detail.arch].filter(Boolean).join(' · ') }}</p></div>
        <span class="state-pill" :class="{ down: !online(detail) }">{{ online(detail) ? t('在线', 'Online') : t('离线', 'Offline') }}</span>
      </section>
      <section class="detail-metrics">
        <div class="metric-card"><span>CPU</span><strong>{{ Number(detail.cpu || 0).toFixed(1) }}%</strong><small>{{ detail.cpu_cores || '—' }} {{ t('核心', 'cores') }}</small></div>
        <div class="metric-card"><span>{{ t('内存', 'Memory') }}</span><strong>{{ Number(detail.ram_used || 0).toLocaleString() }} MB</strong><small>/ {{ Number(detail.ram_total || 0).toLocaleString() }} MB</small></div>
        <div class="metric-card"><span>Swap</span><strong>{{ Number(detail.swap_used || 0).toLocaleString() }} MB</strong><small>/ {{ Number(detail.swap_total || 0).toLocaleString() }} MB</small></div>
        <div class="metric-card"><span>{{ t('网络下载', 'Download') }}</span><strong>{{ formatBytes(detail.net_in_speed) }}/s</strong><small>{{ t('累计', 'Total') }} {{ formatBytes(detail.net_rx) }}</small></div>
        <div class="metric-card"><span>{{ t('网络上传', 'Upload') }}</span><strong>{{ formatBytes(detail.net_out_speed) }}/s</strong><small>{{ t('累计', 'Total') }} {{ formatBytes(detail.net_tx) }}</small></div>
        <div class="metric-card"><span>{{ t('磁盘', 'Disk') }}</span><strong>{{ Number(detail.disk_used || 0).toLocaleString() }} MB</strong><small>/ {{ Number(detail.disk_total || 0).toLocaleString() }} MB</small></div>
        <div class="metric-card"><span>{{ t('进程', 'Processes') }}</span><strong>{{ detail.processes ?? '—' }}</strong><small>{{ t('TCP', 'TCP') }} {{ detail.tcp_conn ?? '—' }} · UDP {{ detail.udp_conn ?? '—' }}</small></div>
        <div class="metric-card"><span>{{ t('运行时间', 'Uptime') }}</span><strong>{{ detail.boot_time ? Math.max(0, Math.floor((Date.now() - Number(detail.boot_time)) / 86400000)) + 'd' : '—' }}</strong><small>{{ detail.kernel_version || '' }}</small></div>
      </section>

      <section class="panel">
        <div class="panel-heading"><div><h2>{{ t('历史趋势', 'History') }}</h2><p>{{ t('所有曲线共用一次历史数据请求', 'All charts share one history request') }}</p></div>
          <select :value="selectedHours" @change="changeHours($event.target.value)">
            <option value="0.167">10 min</option><option value="0.5">30 min</option><option value="1">1 h</option><option value="6">6 h</option><option value="12">12 h</option><option value="24">24 h</option><option value="48">48 h</option><option value="96">4 d</option><option value="168">7 d</option>
          </select>
        </div>
        <div v-if="history.length" class="charts-grid">
          <div v-for="chart in [{title:'CPU %',key:'cpu'},{title:'RAM MB',key:'ram_used'},{title:'Swap MB',key:'swap_used'},{title:'Download B/s',key:'net_in_speed'},{title:'Upload B/s',key:'net_out_speed'},{title:'Ping CT ms',key:'ping_ct'},{title:'Loss CT %',key:'loss_ct'}]" :key="chart.key" v-show="chartRows(chart.key).length" class="chart-card">
            <div class="chart-title">{{ chart.title }} <b>{{ chartRows(chart.key).length ? metric(chartRows(chart.key).at(-1)[chart.key], chart.key.includes('ping') ? 'ms' : chart.key.includes('loss') ? '%' : chart.key.includes('speed') ? 'B/s' : chart.key === 'cpu' ? '%' : 'MB') : '' }}</b></div>
            <svg viewBox="0 0 600 120" preserveAspectRatio="none" role="img" :aria-label="chart.title"><polyline class="chart-line" :points="chartPoints(chartRows(chart.key), chart.key)"/></svg>
            <div class="chart-time"><span>{{ chartLabel(chartRows(chart.key)[0]) }}</span><span>{{ chartLabel(chartRows(chart.key).at(-1)) }}</span></div>
          </div>
          <div v-if="diskHistory.length" class="chart-card">
            <div class="chart-title">Disk read / write <b>{{ formatBytes(diskHistory.at(-1).disk?.read_bps) }}/s · {{ formatBytes(diskHistory.at(-1).disk?.write_bps) }}/s</b></div>
            <svg viewBox="0 0 600 120" preserveAspectRatio="none"><polyline class="chart-line" :points="chartPoints(diskHistory.map(row => ({ value: row.disk?.read_bps })), 'value')"/><polyline class="chart-line secondary" :points="chartPoints(diskHistory.map(row => ({ value: row.disk?.write_bps })), 'value')"/></svg>
            <div class="chart-legend"><span>Read</span><span>Write</span></div>
          </div>
        </div>
        <p v-else class="empty-state">{{ t('当前时间范围没有历史数据', 'No history data for this range') }}</p>
      </section>

      <section v-if="gpuList.length" class="panel">
        <div class="panel-heading"><div><h2>GPU</h2><p>{{ t('图形处理器状态', 'Graphics processor status') }}</p></div></div>
        <div class="gpu-list"><div v-for="gpu in gpuList" :key="gpu.id"><strong>{{ gpu.name || 'GPU ' + gpu.id }}</strong><span>{{ gpu.info == null ? '—' : gpu.info + '%' }}</span></div></div>
      </section>

      <section class="panel">
        <div class="panel-heading"><div><h2>{{ t('网络延迟', 'Network latency') }}</h2><p>{{ t('使用历史接口返回的数据', 'Values from the shared history response') }}</p></div></div>
        <div class="latency-detail">
          <div v-for="key in ['ct','cu','cm','bd','node_1','node_2','node_3','node_4']" :key="key" v-show="showMetric(detail['ping_' + key])">
            <span>{{ ['ct','cu','cm','bd'].includes(key) ? pingName(key, detailBase) : nodeName(Number(key.slice(-1)), detailBase) }} · Ping</span>
            <strong>{{ metric(detail['ping_' + key], 'ms') }}</strong>
          </div>
          <div v-for="key in ['ct','cu','cm','bd','node_1','node_2','node_3','node_4']" :key="'loss-' + key" v-show="showMetric(detail['loss_' + key])">
            <span>{{ ['ct','cu','cm','bd'].includes(key) ? pingName(key, detailBase) : nodeName(Number(key.slice(-1)), detailBase) }} · Loss</span>
            <strong>{{ metric(detail['loss_' + key], '%') }}</strong>
          </div>
        </div>
      </section>
    </template>
    <div v-else-if="!loading" class="empty-state">{{ t('服务器不存在或无权访问', 'Server not found or access denied') }}</div>

    <footer><a :title="'Worker version ' + (configs[bases[0]]?.version || '')" href="https://github.com/huilang-me/CF-Server-Monitor/" target="_blank" rel="noreferrer">Powered by CF Server Monitor</a></footer>
  </main>
</template>
