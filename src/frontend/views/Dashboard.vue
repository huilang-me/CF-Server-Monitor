<template>
  <div class="container">
    <TerminalHeader :title="sysConfig.site_title || 'Server Monitor'" />
    
    <div class="nav-area">
      <div class="header-row">
        <div class="site-title">$ ./{{ sysConfig.site_title || 'Server Monitor' }}</div>
        <div class="controls-group">
          <div class="view-toggle">
            <button 
              class="toggle-btn" 
              :class="{ active: currentView === 'card' }"
              @click="switchView('card')"
            >▣ {{ trans.cards }}</button>
            <button 
              class="toggle-btn" 
              :class="{ active: currentView === 'table' }"
              @click="switchView('table')"
            >≡ {{ trans.table }}</button>
            <button 
              class="toggle-btn" 
              :class="{ active: currentView === 'map' }"
              @click="switchView('map')"
            >◉ {{ trans.map }}</button>
          </div>
        </div>
      </div>
      <div class="filter-bar" id="ajax-filters">
        <span
          v-for="(count, code) in filterOptions"
          :key="code"
          class="filter-tag"
          :class="{ active: currentFilter === code, 'filter-tag-unknown': code === 'unknown' }"
          :data-filter="code"
          @click="setFilter(code)"
        >
          <span v-if="code === 'unknown'" class="filter-tag-icon">🏳️</span>
          <img v-else-if="code !== 'all'" :src="'https://flagcdn.com/16x12/' + getFlagRegionCode(code) + '.png'" :alt="code">
          {{ code === 'all' ? '[' + trans.all + ']' : code === 'unknown' ? 'UNKNOWN' : code.toUpperCase() }} {{ count }}
        </span>
      </div>
    </div>

    <div class="global-stats">
      <div class="stat-item">
        <div class="stat-label">{{ trans.totalServers }}</div>
        <div class="stat-main-value stat-main-value-sm stat-sub-info">
          <span class="stat-online-color">{{ trans.online }}:{{ stats.online }}</span> |
          <span class="stat-offline-color">{{ trans.offline }}:{{ stats.offline }}</span>
        </div>
      </div>
      <div class="stat-item">
        <div class="stat-label">{{ trans.totalTraffic }}</div>
        <div class="stat-main-value stat-main-value-sm">{{ formatBytes(stats.globalNetRx) }} ↓ | ↑ {{ formatBytes(stats.globalNetTx) }}</div>
      </div>
      <div class="stat-item">
        <div class="stat-label">{{ trans.realtimeSpeed }}</div>
        <div class="stat-main-value stat-main-value-sm">
          <span class="stat-net-down-color">↓ {{ formatBytes(stats.globalSpeedIn) }}/s</span> |
          <span class="stat-net-up-color">↑ {{ formatBytes(stats.globalSpeedOut) }}/s</span>
        </div>
      </div>
    </div>

    <div id="view-card" class="view-panel" :class="{ active: currentView === 'card' }">
      <div v-if="isLoading" class="loading-state">
        <div class="loading-spinner"></div>
        <div class="loading-text">$ {{ trans.loading }}</div>
      </div>
      <div v-else-if="groupedServers.length === 0" class="empty-state">
        [!] {{ trans.noServer }}，请在 <router-link to="/admin" class="admin-link-color">{{ trans.backToAdmin }}</router-link> 中添加
      </div>
      <div v-else>
        <div v-for="group in groupedServers" :key="group.name" class="group-section">
          <div class="group-header" :data-group="group.name">
            <span class="prompt-sign">#</span> {{ group.name }} <span class="group-count">[{{ group.servers.length }}]</span>
          </div>
          <div class="servers-grid">
            <ServerCard 
              v-for="server in group.servers" 
              :key="server.id" 
              :server="server"
              :sys-config="sysConfig"
              :to="getServerLink(server)"
            />
          </div>
        </div>
      </div>
    </div>

    <div id="view-table" class="view-panel" :class="{ active: currentView === 'table' }">
      <div class="table-container">
        <table class="terminal-table">
          <thead>
            <tr>
              <th>{{ trans.hostname.substring(0, 4) }}</th>
              <th>{{ trans.hostname }}</th>
              <th>{{ trans.region }}</th>
              <th>{{ trans.osArch }}</th>
              <th>{{ trans.cpu }}</th>
              <th>{{ trans.ram }}</th>
              <th>{{ trans.disk }}</th>
              <th>{{ trans.use }}</th>
              <th>{{ trans.dl }}</th>
              <th>{{ trans.ul }}</th>
              <th>{{ trans.update }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="isLoading">
              <td class="table-empty-state">
                <div class="loading-spinner-small"></div>
                <span>$ {{ trans.loading }}</span>
              </td>
            </tr>
            <tr v-else-if="filteredServers.length === 0">
              <td class="table-empty-state">[*] {{ trans.noData }}</td>
            </tr>
            <tr 
              v-for="server in filteredServers" 
              :key="server.id"
              @click="goToServer(server)"
              class="table-cursor-pointer"
              :data-region="(server.region || 'xx').toLowerCase()"
            >
              <td class="table-center-cell">
                <div class="status-indicator table-status-indicator-inline" :style="{ background: getStatusColor(server) }"></div>
              </td>
              <td><b>{{ server.name }}</b></td>
              <td>
                <span v-if="server.region && server.region !== 'xx'">
                  <img :src="'https://flagcdn.com/24x18/' + getFlagRegionCode(server.region) + '.png'" :alt="server.region" class="flag-img">
                </span>
                <span v-else>🏳️</span>
                {{ (server.region || 'XX').toUpperCase() }}
              </td>
              <td><span class="os-label">{{ server.os || 'N/A' }} / {{ server.arch || 'N/A' }} </span></td>
              <td>
                <div class="table-stat">
                  <div class="stat-bar-container stat-bar-small">
                  <div class="stat-bar-fill" :style="{ width: (parseFloat(server.cpu) || 0) + '%', background: 'var(--accent-cyan)' }"></div>
                </div>
                  <span>{{ (parseFloat(server.cpu) || 0).toFixed(1) }}%</span>
                </div>
              </td>
              <td>
                <div class="table-stat">
                  <div class="stat-bar-container" style="width:60px;">
                    <div class="stat-bar-fill" :style="{ width: (server.ram_total > 0 ? ((server.ram_used / server.ram_total) * 100).toFixed(2) : 0) + '%', background: 'var(--accent-purple)' }"></div>
                  </div>
                  <span>{{ server.ram_total > 0 ? ((server.ram_used / server.ram_total) * 100).toFixed(2) : '0.00' }}%</span>
                </div>
              </td>
              <td>
                <div class="table-stat">
                  <div class="stat-bar-container" style="width:60px;">
                    <div class="stat-bar-fill" :style="{ width: (server.disk_total > 0 ? ((server.disk_used / server.disk_total) * 100).toFixed(2) : 0) + '%', background: 'var(--accent-green)' }"></div>
                  </div>
                  <span>{{ server.disk_total > 0 ? ((server.disk_used / server.disk_total) * 100).toFixed(2) : '0.00' }}%</span>
                </div>
              </td>
              <td v-if="sysConfig.show_tf && server.traffic_limit">
                <div class="table-stat">
                  <div class="stat-bar-container stat-bar-small">
                    <div class="stat-bar-fill" :style="{ width: Math.min(100, parseFloat(getTrafficUsagePercent(server))) + '%', background: 'var(--accent-blue)' }"></div>
                  </div>
                  <span>{{ getTrafficUsagePercent(server) }}%</span>
                </div>
              </td>
              <td v-else>-</td>
              <td>{{ formatBytes(server.net_in_speed) }}/s</td>
              <td>{{ formatBytes(server.net_out_speed) }}/s</td>
              <td class="update-time label-small">{{ getUpdateTime(server.last_updated) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div id="view-map" class="view-panel" :class="{ active: currentView === 'map' }">
      <div class="map-wrapper">
        <div ref="mapContainer" id="map-container"></div>
      </div>
    </div>

    <Footer />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import TerminalHeader from '../components/TerminalHeader.vue'
import ServerCard from '../components/ServerCard.vue'
import Footer from '../components/Footer.vue'
import { fetchServers, fetchServersAll, formatBytes, createLiveSocket, getFlagRegionCode, getApiBases } from '../utils/api.js'
import { t, currentLang } from '../utils/i18n.js'
import { translations } from '../utils/i18n.js'
import { TIME } from '../utils/constants'

const servers = ref([])
const stats = ref({ total: '-', online: 0, offline: 0, globalNetRx: 0, globalNetTx: 0, globalSpeedIn: 0, globalSpeedOut: 0 })
const unknownStats = ref(0)
const sysConfig = ref({
  show_price: true,
  show_expire: true,
  show_bw: true,
  show_tf: true,
  site_title: 'Server Monitor'
})
const regionStats = ref({})
const currentView = ref('card')
const currentFilter = ref('all')
const mapInitialized = ref(false)
const liveConnected = ref(false)
const isLoading = ref(true)
const now = ref(Date.now())
const router = useRouter()

const trans = computed(() => translations[currentLang.value] || translations.en)

const filterOptions = computed(() => {
  const normalizedStats = {}
  for (const code in regionStats.value) {
    const lower = code.toLowerCase()
    if (lower === 'xx') continue
    normalizedStats[lower] = regionStats.value[code]
  }
  const opts = { all: stats.value.total, ...normalizedStats }
  if (unknownStats.value > 0) opts.unknown = unknownStats.value
  return opts
})

const filteredServers = computed(() => {
  if (currentFilter.value === 'all') return servers.value
  if (currentFilter.value === 'unknown') return servers.value.filter(s => !s.region)
  return servers.value.filter(s => (s.region || 'xx').toLowerCase() === currentFilter.value)
})

const groupedServers = computed(() => {
  const groups = {}
  const order = []
  filteredServers.value.forEach(server => {
    const groupName = server.server_group || 'Default'
    if (!groups[groupName]) {
      groups[groupName] = []
      order.push(groupName)
    }
    groups[groupName].push(server)
  })
  return order.map(name => ({ name, servers: groups[name] }))
})

const switchView = (viewName) => {
  currentView.value = viewName
  localStorage.setItem('monitor_preferred_view', viewName)
  if (viewName === 'map' && !mapInitialized.value) {
    initMap()
    mapInitialized.value = true
  } else if (viewName === 'map' && window.myMap) {
    setTimeout(() => window.myMap.invalidateSize(), 100)
  }
}

const setFilter = (code) => {
  currentFilter.value = code.toLowerCase()
}

const getStatusColor = (server) => {
  const lastUpdated = new Date(server.last_updated).getTime()
  return (Date.now() - lastUpdated) < TIME.ONLINE_THRESHOLD_MS ? 'var(--accent-green)' : 'var(--accent-red)'
}

const getUpdateTime = (lastUpdated) => {
  if (!lastUpdated) return '-'
  const date = new Date(lastUpdated)
  const diff = now.value - date.getTime()

  const lang = currentLang.value
  // 时间差为负或小于1秒时，显示0秒前
  if (diff < 1000) {
    return lang === 'zh' ? `0${trans.value.secondsAgo}` : `0 ${trans.value.secondsAgo}`
  }

  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (seconds < 60) {
    return lang === 'zh' ? `${seconds}${trans.value.secondsAgo}` : `${seconds} ${trans.value.secondsAgo}`
  } else if (minutes < 60) {
    return lang === 'zh' ? `${minutes}${trans.value.minutesAgo}` : `${minutes} ${trans.value.minutesAgo}`
  } else if (hours < 24) {
    return lang === 'zh' ? `${hours}${trans.value.hoursAgo}` : `${hours} ${trans.value.hoursAgo}`
  } else if (days < 30) {
    return lang === 'zh' ? `${days}${trans.value.daysAgo}` : `${days} ${trans.value.daysAgo}`
  } else {
    return date.toLocaleString(undefined, { hour12: false })
  }
}

const getTrafficUsagePercent = (server) => {
  const limit = parseFloat(server.traffic_limit) || 0
  if (limit <= 0) return '0'

  const limitBytes = limit * 1024 * 1024 * 1024
  let usedBytes = 0

  const calcType = server.traffic_calc_type || 'total'
  if (calcType === 'dl') {
    usedBytes = parseFloat(server.net_rx_monthly) || 0
  } else if (calcType === 'ul') {
    usedBytes = parseFloat(server.net_tx_monthly) || 0
  } else {
    usedBytes = (parseFloat(server.net_rx_monthly) || 0) + (parseFloat(server.net_tx_monthly) || 0)
  }

  const percent = (usedBytes / limitBytes) * 100
  return percent.toFixed(1)
}

const PLAYBACK_TICK_MS = 1000
const MAX_BUFFER_SAMPLES_PER_SERVER = 600
const playbackBuffers = new Map()

const normalizeMetricTimestamp = (value, fallback = null) => {
  const ts = Number(value)
  if (Number.isFinite(ts) && ts > 0) {
    return ts < 10000000000 ? ts * 1000 : ts
  }
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

const getServerReportTimestamp = (server, fallback = null) => {
  return normalizeMetricTimestamp(server?.report_timestamp ?? server?.last_updated, fallback)
}

const getServerSampleTimestamp = (server) => {
  return normalizeMetricTimestamp(server?.sample_timestamp ?? server?.timestamp ?? server?.last_updated, null)
}

const getServerDisplayTimestamp = (server) => {
  return normalizeMetricTimestamp(server?.display_timestamp, null)
}

const withDisplayTiming = (server, displayTs = null, currentTs = Date.now()) => {
  const reportTs = getServerReportTimestamp(server, null)
  const sampleTs = getServerSampleTimestamp(server) || displayTs || reportTs
  const ownTs = normalizeMetricTimestamp(displayTs, getServerDisplayTimestamp(server) || sampleTs || reportTs)
  const timed = {
    ...server,
    current_timestamp: currentTs
  }
  if (reportTs) {
    timed.report_timestamp = reportTs
    timed.last_updated = reportTs
  }
  if (!sampleTs || !ownTs) return timed
  return {
    ...timed,
    sample_timestamp: sampleTs,
    display_timestamp: ownTs,
    sample_lag_seconds: Math.max(0, Math.floor((ownTs - sampleTs) / 1000))
  }
}

const toLiveSample = (serverId, data, timestamp, reportTs) => {
  if (!serverId || !data) return
  const ts = normalizeMetricTimestamp(timestamp ?? data.sample_timestamp ?? data.last_updated ?? data.timestamp, null)
  if (!ts) return null
  return {
    serverId,
    ts,
    data,
    reportTs
  }
}

const queueLiveSamples = (serverId, samples, reportTs) => {
  if (!serverId || !Array.isArray(samples) || samples.length === 0) return

  const normalized = samples
    .map(sample => toLiveSample(serverId, sample.data, sample.ts, reportTs))
    .filter(Boolean)
    .sort((a, b) => a.ts - b.ts)

  if (normalized.length === 0) return

  const current = servers.value.find(s => s.id === serverId)
  const currentTs = getServerSampleTimestamp(current)
  const incoming = normalized.filter(sample => !currentTs || sample.ts > currentTs)
  if (incoming.length === 0) return

  if (incoming.length === 1) {
    playbackBuffers.delete(serverId)
    const sample = incoming[0]
    applyServerSample(serverId, sample.data, sample.ts, sample.ts, reportTs)
    return
  }

  const firstTs = incoming[0].ts
  const unique = []
  const seen = new Set()
  for (const sample of incoming) {
    if (seen.has(sample.ts)) continue
    seen.add(sample.ts)
    unique.push(sample)
  }
  playbackBuffers.set(serverId, unique.slice(-MAX_BUFFER_SAMPLES_PER_SERVER))
  applyPlaybackSamplesForServer(serverId, firstTs)
}

const queueLiveMessage = (msg) => {
  if (!msg || (msg.type !== 'update' && msg.type !== 'batchUpdate')) return

  const reportTs = normalizeMetricTimestamp(msg.ts, Date.now())

  const updates = Array.isArray(msg.updates)
    ? msg.updates
    : (msg.serverId ? [{ serverId: msg.serverId, samples: msg.samples, data: msg.data, payload: msg.payload, ts: msg.ts }] : [])

  for (const update of updates) {
    if (!update || !update.serverId) continue
    const samples = Array.isArray(update.samples)
      ? update.samples
      : (update.payload || update.data
          ? [{
              ts: (update.data || update.payload).sample_timestamp || (update.data || update.payload).last_updated || (update.data || update.payload).timestamp || update.ts || msg.ts,
              data: update.data || update.payload
            }]
          : [])

    const liveSamples = []
    for (const sample of samples) {
      if (!sample || typeof sample !== 'object') continue
      const data = sample.data || sample.payload || sample.metrics
      if (!data) continue
      liveSamples.push({
        ts: sample.ts ?? sample.timestamp ?? data.sample_timestamp ?? data.last_updated ?? data.timestamp ?? update.ts ?? msg.ts,
        data
      })
    }
    queueLiveSamples(update.serverId, liveSamples, reportTs)
  }
}

const applyServerSample = (serverId, data, sampleTs, displayTs, reportTs = null) => {
  if (!serverId || !data) return
  const idx = servers.value.findIndex(s => s.id === serverId)
  const existing = idx >= 0 ? servers.value[idx] : null
  const currentReportTs = getServerReportTimestamp(existing, null)
  const nextReportTs = normalizeMetricTimestamp(reportTs, currentReportTs || now.value)
  const merged = withDisplayTiming({
    ...data,
    id: serverId,
    report_timestamp: nextReportTs,
    last_updated: nextReportTs,
    sample_timestamp: sampleTs,
    timestamp: sampleTs
  }, displayTs, now.value)

  if (idx >= 0) {
    servers.value[idx] = { ...servers.value[idx], ...merged }
  } else {
    servers.value.push({ ...merged, name: serverId })
  }
}

const applyPlaybackSamplesForServer = (serverId, displayTs = null) => {
  const samples = playbackBuffers.get(serverId)
  if (!samples || samples.length === 0) return
  const server = servers.value.find(s => s.id === serverId)
  const ownTs = normalizeMetricTimestamp(displayTs, getServerDisplayTimestamp(server))
  if (!ownTs) return

  let selected = null
  while (samples.length > 0 && samples[0].ts <= ownTs) {
    selected = samples.shift()
  }
  if (selected) {
    applyServerSample(serverId, selected.data, selected.ts, ownTs, selected.reportTs)
  }
  if (samples.length === 0) playbackBuffers.delete(serverId)
}

const applyPlaybackSamples = () => {
  for (const serverId of Array.from(playbackBuffers.keys())) {
    applyPlaybackSamplesForServer(serverId)
  }
}

const advanceServerClocks = () => {
  const currentTs = now.value
  servers.value = servers.value.map(server => {
    const reportTs = getServerReportTimestamp(server, null)
    const isOnline = reportTs && (currentTs - reportTs) < TIME.ONLINE_THRESHOLD_MS
    const currentDisplayTs = getServerDisplayTimestamp(server) || getServerSampleTimestamp(server) || reportTs
    const nextDisplayTs = isOnline && currentDisplayTs ? currentDisplayTs + PLAYBACK_TICK_MS : currentDisplayTs
    return withDisplayTiming(server, nextDisplayTs, currentTs)
  })
  applyPlaybackSamples()
}

const recomputeStats = (currentTs = Date.now()) => {
  const list = servers.value || []
  let online = 0
  let speedIn = 0, speedOut = 0, netRx = 0, netTx = 0
  const regionCounts = {}
  let unknownCount = 0
  for (const s of list) {
    const ts = new Date(s.last_updated || 0).getTime()
    const isOnline = ts && (currentTs - ts) < TIME.ONLINE_THRESHOLD_MS
    if (isOnline) {
      online++
      speedIn += parseFloat(s.net_in_speed) || 0
      speedOut += parseFloat(s.net_out_speed) || 0
    }
    netRx += parseFloat(s.net_rx) || 0
    netTx += parseFloat(s.net_tx) || 0
    if (s.region) {
      const key = String(s.region).toUpperCase()
      regionCounts[key] = (regionCounts[key] || 0) + 1
    } else {
      unknownCount++
    }
  }
  stats.value = {
    total: list.length,
    online,
    offline: list.length - online,
    globalNetRx: netRx,
    globalNetTx: netTx,
    globalSpeedIn: speedIn,
    globalSpeedOut: speedOut
  }
  regionStats.value = regionCounts
  unknownStats.value = unknownCount
}

const runDashboardTick = () => {
  now.value = Date.now()
  advanceServerClocks()
  recomputeStats(now.value)
  if (currentView.value === 'map') drawMarkers()
}

const refreshData = async () => {
  try {
    const bases = getApiBases()
    const data = bases.length > 0 ? await fetchServersAll() : await fetchServers()
    if (!data) return

    const rawServers = Array.isArray(data.servers)
      ? data.servers
      : Object.entries(data.latestMetricsMap || {}).map(([id, metrics]) => ({ id, ...metrics }))

    const existingById = new Map(servers.value.map(s => [s.id, s]))
    const nextList = rawServers.map(s => {
      const prev = existingById.get(s.id)
      const sampleTs = normalizeMetricTimestamp(s.sample_timestamp ?? s.timestamp ?? s.last_updated, getServerSampleTimestamp(prev))
      const reportTs = normalizeMetricTimestamp(s.report_timestamp ?? s.last_updated, getServerReportTimestamp(prev, null))
      return withDisplayTiming({ ...prev, ...s, sample_timestamp: sampleTs, report_timestamp: reportTs }, sampleTs, now.value)
    })
    servers.value = nextList

    recomputeStats(now.value)

    sysConfig.value = {
      show_price: data.sysConfig?.show_price ?? true,
      show_expire: data.sysConfig?.show_expire ?? true,
      show_bw: data.sysConfig?.show_bw ?? true,
      show_tf: data.sysConfig?.show_tf ?? true,
      site_title: data.sysConfig?.site_title || 'Server Monitor'
    }

    drawMarkers()
    isLoading.value = false
  } catch (e) {
    console.log('[INFO] Full refresh pending...', e)
    isLoading.value = false
  }
}

// -------------------------------------------------------------------------
// 实时推送：
//   - 订阅 "all"，收到任何服务器的更新都会合并对应 server 的指标
//   - WS 连上后关闭 60s 兜底轮询；断开后临时开启作为降级（WS 重连成功后再次清除）
// -------------------------------------------------------------------------
let liveSockets = []
let refreshInterval = null
let themeObserver = null
let timeUpdateInterval = null

const startLiveSocket = () => {
  const bases = getApiBases()

  // 如果没有配置多个 API bases，使用原来的单连接方式
  if (bases.length === 0) {
    liveSockets = [createLiveSocket('all', {
      replay: false,
      onMessage: queueLiveMessage,
      onStatus: ({ connected }) => {
        liveConnected.value = !!connected
        if (connected) {
          if (refreshInterval) { clearInterval(refreshInterval); refreshInterval = null }
        } else if (!refreshInterval) {
          refreshInterval = setInterval(refreshData, 60000)
        }
      }
    })]
    return
  }

  // 为每个 API base 创建独立的 WebSocket 连接
  liveSockets = bases.map((_, index) => {
    return createLiveSocket('all', {
      replay: false,
      onMessage: queueLiveMessage,
      onStatus: ({ connected }) => {
        // 只要有一个连接成功，就认为实时推送可用
        const anyConnected = liveSockets.some(s => s && s.isConnected)
        liveConnected.value = anyConnected

        if (anyConnected) {
          if (refreshInterval) { clearInterval(refreshInterval); refreshInterval = null }
        } else if (!refreshInterval) {
          // 所有连接都断开时，启用降级轮询
          refreshInterval = setInterval(refreshData, 60000)
        }
      }
    }, index)
  })
}

const initMap = () => {
  if (!window.L) {
    const script = document.createElement('script')
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
    script.onload = () => {
      loadLeafletCSS()
    }
    document.head.appendChild(script)
  } else {
    loadLeafletCSS()
  }
}

const loadLeafletCSS = () => {
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
  document.head.appendChild(link)
  link.onload = () => {
    createMap()
  }
}

const isMobile = () => /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth < 768

const createMap = () => {
  const mobileView = isMobile()
  window.myMap = window.L.map('map-container', {
    zoomControl: false,
    attributionControl: false,
    minZoom: mobileView ? 1 : 1
  }).setView(mobileView ? [35, 105] : [30, 10], mobileView ? 1 : 2)

  window.L.control.zoom({ position: 'bottomright' }).addTo(window.myMap)

  fetch('https://cdn.jsdelivr.net/npm/@surbowl/world-geo-json-zh@2.1.5/world.zh.json')
    .then(res => res.json())
    .then(worldGeoJson => {
      window.worldGeoJson = worldGeoJson
      drawMarkers()
    })
    .catch(e => console.error('[ERROR] Map load failed', e))
}

const regionCoords = {
  'US': [37.09, -95.71], 'CN': [35.86, 104.19], 'JP': [36.20, 138.25], 'HK': [22.31, 114.16],
  'SG': [1.35, 103.81], 'KR': [35.90, 127.76], 'DE': [51.16, 10.45], 'GB': [55.37, -3.43],
  'NL': [52.13, 5.29], 'FR': [46.22, 2.21], 'CA': [56.13, -106.34], 'AU': [-25.27, 133.77],
  'IN': [20.59, 78.96], 'BR': [-14.23, -51.92], 'RU': [61.52, 105.31], 'ZA': [-30.55, 22.93],
  'TW': [23.69, 120.96], 'IT': [41.87, 12.56], 'SE': [60.12, 18.64], 'CH': [46.81, 8.22],
  'ES': [40.46, -3.74], 'PL': [51.91, 19.14], 'FI': [61.92, 25.74], 'NO': [60.47, 8.46],
  'DK': [56.26, 9.50], 'IE': [53.14, -7.69], 'AT': [47.51, 14.55], 'TR': [38.96, 35.24],
  'AE': [23.42, 53.84], 'MY': [4.21, 101.97], 'TH': [15.87, 100.99], 'VN': [14.05, 108.27],
  'PH': [12.87, 121.77], 'ID': [-0.78, 113.92]
}

let markersLayer, geoJsonLayer, currentMapDataStr = ""

const getThemeColors = () => {
  const isLight = document.body.classList.contains('light')
  return {
    bgPrimary: isLight ? '#0a0e14' : '#0a0e14',
    bgSecondary: isLight ? '#e8e8e0' : '#12171f',
    borderColor: isLight ? '#1e2a3a' : '#1e2a3a',
    accentGreen: isLight ? '#00d4aa' : '#00d4aa',
    colorBlack: isLight ? '#000' : '#000',
    colorWhite: isLight ? '#fff' : '#fff'
  }
}

const drawMarkers = () => {
  if (!window.myMap || !window.worldGeoJson) return

  const newDataStr = JSON.stringify(regionStats.value)
  if (currentMapDataStr === newDataStr) return
  currentMapDataStr = newDataStr

  if (geoJsonLayer) window.myMap.removeLayer(geoJsonLayer)
  if (markersLayer) markersLayer.clearLayers()
  else markersLayer = window.L.layerGroup().addTo(window.myMap)

  const colors = getThemeColors()
  const activeIso2 = {}
  for (const code in regionStats.value) {
    const upperCode = code.toUpperCase()
    activeIso2[upperCode] = true
    if (upperCode === 'HK' || upperCode === 'TW' || upperCode === 'MO') {
      activeIso2['CN'] = true
    }
  }

  geoJsonLayer = window.L.geoJSON(window.worldGeoJson, {
    style: function(feature) {
      const isActive = activeIso2[feature.properties.iso_a2]
      return {
        fillColor: isActive ? colors.accentGreen : colors.borderColor,
        weight: 1,
        opacity: 0.8,
        color: colors.bgPrimary,
        fillOpacity: isActive ? 0.4 : 0.2
      }
    }
  }).addTo(window.myMap)

  for (const [code, count] of Object.entries(regionStats.value)) {
    const upperCode = code.toUpperCase()
    if (regionCoords[upperCode]) {
      const icon = window.L.divIcon({
        className: 'custom-map-marker',
        html: `<div style="background:${colors.accentGreen}; color:${colors.colorBlack}; border-radius:50%; width:22px; height:22px; display:flex; align-items:center; justify-content:center; font-size:10px; font-weight:bold; border:2px solid ${colors.bgPrimary}; box-shadow:0 0 10px ${colors.accentGreen}80; font-family:JetBrains Mono,monospace;">${count}</div>`,
        iconSize: [22,22]
      })
      window.L.marker(regionCoords[upperCode], {icon: icon}).addTo(markersLayer)
    }
  }
}

const getServerLink = (server) => {
  const bases = getApiBases()
  if (bases.length === 0) return `/server/${server.id}`
  
  const apiIndex = bases.indexOf(server.source)
  if (apiIndex === -1 || apiIndex === 0) return `/server/${server.id}`
  
  return `/server/${server.id}?apiIndex=${apiIndex}`
}

const goToServer = (server) => {
  router.push(getServerLink(server))
}

onMounted(() => {
  const savedView = localStorage.getItem('monitor_preferred_view') || 'card'
  currentView.value = savedView
  refreshData()
  startLiveSocket()

  // 每秒更新 now 变量，使相对时间实时刷新
  runDashboardTick()
  timeUpdateInterval = setInterval(runDashboardTick, 1000)

  if (savedView === 'map') {
    switchView('map')
  }

  themeObserver = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.attributeName === 'class' && currentView.value === 'map') {
        currentMapDataStr = ''
        drawMarkers()
      }
    })
  })
  themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] })
})

onUnmounted(() => {
  if (refreshInterval) clearInterval(refreshInterval)
  if (timeUpdateInterval) clearInterval(timeUpdateInterval)
  if (liveSockets.length > 0) {
    liveSockets.forEach(socket => {
      if (socket) socket.close()
    })
  }
  if (themeObserver) themeObserver.disconnect()
})
</script>
