<script setup>
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'

const bases = (document.querySelector('meta[name="apiBase"]')?.content || location.origin)
  .split(',').map(x => x.trim()).filter(Boolean)
const jwt = () => localStorage.getItem('jwt_token') || ''
const turnstileCacheKey = 'cfsm_turnstile_verified'
const configs = reactive({})
const sites = reactive({})
const servers = reactive({})
const stats = reactive({})
const errors = ref([])
const loading = ref(true)
const route = ref(readRoute())
const selectedHours = ref('0.167')
const detail = ref(null)
const history = ref([])
const wsStates = reactive({})
const pending = new Map()
const sockets = new Map()
const timers = new Map()
const retries = new Map()
const loadedHome = new Set()
const wsStarted = new Map()
let flushTimer = 0
let disposed = false
let visibilityHandler

function readRoute() {
  const m = location.hash.match(/^#\/server\/([^/?#]+)/)
  return m ? { name: 'detail', id: decodeURIComponent(m[1]) } : { name: 'home' }
}
function apiUrl(base, path) { return new URL(path, base.endsWith('/') ? base : base + '/') }
function headers(base, extra = {}) {
  const h = { ...extra }
  if (jwt()) h.Authorization = 'Bearer ' + jwt()
  const v = localStorage.getItem(turnstileCacheKey)
  if (v) h['X-Turnstile-Verified'] = v
  return h
}
async function request(base, path, options = {}) {
  const res = await fetch(apiUrl(base, path), { ...options, headers: headers(base, options.headers || {}) })
  if (res.status === 401) {
    localStorage.removeItem('jwt_token')
    location.href = '/admin#/admin'
    throw new Error('登录已失效，请重新登录')
  }
  if (res.status === 403) {
    localStorage.removeItem(turnstileCacheKey)
    throw new Error('Turnstile 验证已过期，请重新验证后再试')
  }
  if (!res.ok) throw new Error((await res.text()) || ('HTTP ' + res.status))
  const data = await res.json()
  if (data.turnstile_verified) localStorage.setItem(turnstileCacheKey, data.turnstile_verified)
  return data
}
function isOnline(s) { return Number(s.last_updated) > 0 && Date.now() - Number(s.last_updated) < 300000 }
function mergeSample(id, patch) {
  const old = pending.get(id) || {}
  pending.set(id, { ...old, ...patch })
  if (!flushTimer) flushTimer = window.setTimeout(flushSamples, 1000)
}
function flushSamples() {
  flushTimer = 0
  for (const [id, patch] of pending) {
    for (const base of bases) {
      const item = (servers[base] || []).find(s => s.id === id)
      if (item) Object.assign(item, patch)
    }
    if (detail.value?.id === id) Object.assign(detail.value, patch)
  }
  pending.clear()
}
function closeSocket(base) {
  const ws = sockets.get(base)
  if (ws) { ws.onclose = null; ws.close(); sockets.delete(base) }
  if (timers.has(base)) clearTimeout(timers.get(base))
  timers.delete(base)
}
function connect(base, ids, singleId = '') {
  closeSocket(base)
  const u = apiUrl(base, '/api/ws')
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:'
  u.searchParams.set('subscribe', singleId || 'all')
  if (new URL(base).origin !== location.origin && jwt()) u.searchParams.set('token', jwt())
  const ws = new WebSocket(u)
  sockets.set(base, ws)
  wsStates[base] = '连接中'
  ws.onopen = () => {
    retries.set(base, 0); wsStates[base] = '实时'
    if (!singleId) ws.send(JSON.stringify({ type: 'subscribe', scope: 'all', ids }))
    const minutes = Number(configs[base]?.frontend_ws_timeout_minutes || 0)
    if (minutes > 0) timers.set(base, setTimeout(() => {
      closeSocket(base)
      if (confirm('实时连接已达到 ' + minutes + ' 分钟。是否继续监控？')) connect(base, ids, singleId)
      else wsStates[base] = '已暂停'
    }, minutes * 60000))
  }
  ws.onmessage = ev => {
    let msg
    try { msg = JSON.parse(ev.data) } catch { return }
    if (msg.type !== 'batchUpdate') return
    for (const u of msg.updates || []) for (const sample of u.samples || []) {
      const patch = sample.data || sample.payload || sample.metrics || {}
      mergeSample(u.serverId, patch)
    }
  }
  ws.onerror = () => { wsStates[base] = '连接异常' }
  ws.onclose = () => {
    sockets.delete(base)
    if (disposed || document.hidden) return
    const n = retries.get(base) || 0
    if (n >= 6) { wsStates[base] = '连接失败'; return }
    retries.set(base, n + 1); wsStates[base] = '重连中'
    const delay = Math.min(30000, 1000 * (2 ** n))
    setTimeout(() => {
      if (!disposed && !document.hidden) connect(base, ids, singleId)
    }, delay)
  }
}
async function loadHome(base) {
  if (!loadedHome.has(base)) {
    const data = await request(base, '/api/servers')
    servers[base] = data.servers || []
    stats[base] = data.stats || {}
    sites[base] = data.sysConfig || {}
    loadedHome.add(base)
  }
  connect(base, (servers[base] || []).map(s => s.id))
}
async function loadDetail(id, hours = '0.167') {
  const base = bases.find(b => (servers[b] || []).some(s => s.id === id)) || bases[0]
  closeAll()
  detail.value = await request(base, '/api/server?id=' + encodeURIComponent(id))
  history.value = await request(base, '/api/history/all?id=' + encodeURIComponent(id) + '&hours=' + hours)
  connect(base, [], id)
}
function closeAll() { for (const b of bases) closeSocket(b) }
function goHome() { location.hash = '#/' }
function goDetail(id) { location.hash = '#/server/' + encodeURIComponent(id) }
function fmtBytes(v) {
  let n = Number(v || 0), u = ['B','KB','MB','GB','TB'], i = 0
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++ }
  return n.toFixed(i ? 1 : 0) + ' ' + u[i]
}
function pct(a,b) { return b > 0 ? Math.min(100, Math.max(0, Number(a || 0) / b * 100)) : 0 }
function pingValue(v) { return v === false || v === undefined ? '—' : v === null ? '超时' : v + ' ms' }
const allServers = computed(() => bases.flatMap(b => servers[b] || []))
const total = computed(() => bases.reduce((n,b) => n + Number(stats[b]?.total || 0), 0))
const online = computed(() => bases.reduce((n,b) => n + Number(stats[b]?.online || 0), 0))
const offline = computed(() => bases.reduce((n,b) => n + Number(stats[b]?.offline || 0), 0))
const isDetail = computed(() => route.value.name === 'detail')
async function changeHours(v) {
  selectedHours.value = v
  if (detail.value) {
    const base = bases.find(b => (servers[b] || []).some(s => s.id === detail.value.id)) || bases[0]
    history.value = await request(base, '/api/history/all?id=' + encodeURIComponent(detail.value.id) + '&hours=' + v)
  }
}
async function refreshVisible() {
  if (document.hidden) { closeAll(); return }
  try {
    if (route.value.name === 'detail') await loadDetail(route.value.id, selectedHours.value)
    else {
      closeAll()
      for (const b of bases) await loadHome(b)
    }
  } catch (e) { errors.value = [e.message] }
}
onMounted(async () => {
  window.addEventListener('hashchange', async () => {
    route.value = readRoute()
    try {
      if (route.value.name === 'detail') await loadDetail(route.value.id)
      else { detail.value = null; history.value = []; closeAll(); for (const b of bases) await loadHome(b) }
    } catch (e) { errors.value = [e.message] }
  })
  visibilityHandler = () => { if (document.hidden) closeAll(); else refreshVisible() }
  document.addEventListener('visibilitychange', visibilityHandler)
  try {
    for (const base of bases) configs[base] = await request(base, '/api/config')
    const privateSite = bases.some(b => configs[b]?.is_public !== true)
    if (privateSite && !jwt()) { location.href = '/admin#/admin'; return }
    if (route.value.name === 'detail') await loadDetail(route.value.id)
    else for (const base of bases) await loadHome(base)
  } catch (e) { errors.value = [e.message] }
  finally { loading.value = false }
})
onUnmounted(() => {
  disposed = true; closeAll(); clearTimeout(flushTimer)
  document.removeEventListener('visibilitychange', visibilityHandler)
})
</script>

<template>
  <main class="shell">
    <header class="topbar">
      <a class="brand" href="#/" @click.prevent="goHome"><span class="brand-mark">S</span><span>{{ configs[bases[0]]?.site_title || 'Server Monitor' }}</span></a>
      <span class="live"><i></i>{{ isDetail ? '单机监控' : '实时监控' }}</span>
    </header>

    <div v-if="errors.length" class="error"><strong>加载失败</strong><p v-for="e in errors" :key="e">{{ e }}</p><button @click="refreshVisible">重试</button></div>
    <section v-if="loading" class="loading">正在加载监控数据…</section>

    <template v-else-if="!isDetail">
      <section class="summary">
        <div><small>服务器总数</small><strong>{{ total }}</strong></div>
        <div><small>在线</small><strong class="green">{{ online }}</strong></div>
        <div><small>离线</small><strong class="red">{{ offline }}</strong></div>
      </section>
      <div class="section-head"><div><h1>服务器</h1><p>共 {{ allServers.length }} 台 · 实时状态</p></div><span class="muted">{{ Object.values(wsStates).every(x => x === '实时') ? '连接正常' : '连接中' }}</span></div>
      <section class="server-list">
        <article v-for="s in allServers" :key="s.id" class="server" @click="goDetail(s.id)">
          <div class="server-head"><div><span class="status-dot" :class="{ down: !isOnline(s) }"></span><strong>{{ s.name || s.id }}</strong><small>{{ [s.region, s.os].filter(Boolean).join(' · ') }}</small></div><span class="arrow">↗</span></div>
          <div class="metrics">
            <div><small>CPU</small><b>{{ Number(s.cpu || 0).toFixed(1) }}%</b></div>
            <div><small>内存</small><b>{{ fmtBytes(Number(s.ram_used || 0) * 1024 * 1024) }}</b></div>
            <div><small>下载</small><b>{{ fmtBytes(s.net_in_speed) }}/s</b></div>
            <div><small>上传</small><b>{{ fmtBytes(s.net_out_speed) }}/s</b></div>
          </div>
          <div class="bar"><span :style="{width: pct(s.ram_used,s.ram_total) + '%'}"></span></div>
          <div v-if="sites[bases.find(b => (servers[b] || []).some(x => x.id === s.id))]?.show_three_net_details && (s.ping || []).length" class="latency">
            <span v-for="k in ['ct','cu','cm','bd']" :key="k">{{ k.toUpperCase() }} <b>{{ pingValue(s.ping?.at(-1)?.[k]) }}</b></span>
          </div>
        </article>
        <div v-if="!allServers.length" class="empty">暂无服务器数据</div>
      </section>
    </template>

    <template v-else-if="detail">
      <button class="back" @click="goHome">← 返回服务器列表</button>
      <section class="detail-head"><div><h1>{{ detail.name || detail.id }}</h1><p>{{ detail.region || '' }} · {{ detail.os || '' }}</p></div><span class="status-dot" :class="{down: !isOnline(detail)}"></span></section>
      <section class="detail-grid">
        <div class="metric-card"><small>CPU 使用率</small><strong>{{ Number(detail.cpu || 0).toFixed(1) }}%</strong></div>
        <div class="metric-card"><small>内存</small><strong>{{ detail.ram_used || 0 }} / {{ detail.ram_total || 0 }} MB</strong></div>
        <div class="metric-card"><small>下载速度</small><strong>{{ fmtBytes(detail.net_in_speed) }}/s</strong></div>
        <div class="metric-card"><small>上传速度</small><strong>{{ fmtBytes(detail.net_out_speed) }}/s</strong></div>
      </section>
      <section class="panel">
        <div class="section-head"><div><h2>历史趋势</h2><p>使用同一历史接口加载全部指标</p></div>
          <select :value="selectedHours" @change="changeHours($event.target.value)">
            <option value="0.167">10 分钟</option><option value="0.5">30 分钟</option><option value="1">1 小时</option><option value="6">6 小时</option><option value="12">12 小时</option><option value="24">24 小时</option><option value="48">48 小时</option><option value="96">4 天</option><option value="168">7 天</option>
          </select>
        </div>
        <div class="history-list"><div v-for="(p,i) in (Array.isArray(history) ? history : history.history || [])" :key="p.timestamp || i"><span>{{ new Date(p.timestamp).toLocaleTimeString() }}</span><b>CPU {{ Number(p.cpu || 0).toFixed(1) }}%</b><b>RAM {{ p.ram_used || 0 }} MB</b><b>CT {{ pingValue(p.ping_ct) }}</b></div></div>
        <p v-if="!history.length && !(history.history || []).length" class="empty">暂无历史数据</p>
      </section>
    </template>

    <footer><a :title="'Worker version ' + (configs[bases[0]]?.version || '')" href="https://github.com/huilang-me/CF-Server-Monitor/" target="_blank" rel="noreferrer">Powered by CF Server Monitor</a></footer>
  </main>
</template>
