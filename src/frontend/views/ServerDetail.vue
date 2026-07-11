<template>
  <div class="container">
    <TerminalHeader :title="server.name || 'Loading...'" />
    
    <div v-if="loading" class="loading-state">
      <div class="loading-spinner"></div>
      <div class="loading-text">$ {{ trans.loading }}</div>
    </div>

    <template v-else>
    
    <div class="nav-bar">
      <router-link to="/" class="back-btn">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="15 18 9 12 15 6"></polyline>
        </svg>
        {{ trans.back }}
      </router-link>
      <div class="time-selector" v-show="historyLoaded" id="time-selector">
        <button 
          v-for="option in timeOptions" 
          :key="option.hours"
          class="time-btn"
          :class="{ active: currentHours === option.hours }"
          @click="setTimeRange(option.hours)"
        >{{ option.label }}</button>
      </div>
    </div>

    <div class="host-card">
      <div class="host-card-header">
        <div class="host-name">
          <span class="prompt">root@</span>
          <span v-if="server.region && server.region !== 'xx'">
          <img :src="'https://flagcdn.com/24x18/' + getFlagRegionCode(server.region) + '.png'" :alt="server.region" class="flag-img" style="margin-right:6px;">
        </span>
          <span v-else>🏳️</span>
          <span>{{ server.name || 'Loading...' }}</span>
          <span style="color: var(--text-muted);">:~#</span>
        </div>
        <span class="status-badge" :class="{ online: isOnline, offline: !isOnline }">
          <span class="pulse-dot" :class="{ online: isOnline, offline: !isOnline }"></span>
          <span>{{ isOnline ? trans.online : trans.offline }}</span>
        </span>
      </div>
      <div class="sysinfo-grid" id="info-panel">
        <div class="sysinfo-item">
          <span class="sysinfo-label">⏱ {{ trans.uptime }}</span>
          <span class="sysinfo-value">{{ formatUptime(server.boot_time) }}</span>
        </div>
        <div class="sysinfo-item" v-if="server.expire_date">
          <span class="sysinfo-label">📅 {{ trans.expire }}</span>
          <span class="sysinfo-value" :class="{ 'expired': isExpired }">{{ expireDaysText }}</span>
        </div>
        <div class="sysinfo-item">
          <span class="sysinfo-label">💻 {{ trans.os }} / {{ trans.architecture }}</span>
          <span class="sysinfo-value sysinfo-small">{{ server.os || 'N/A' }} / {{ server.arch || 'N/A' }}</span>
        </div>
        <div class="sysinfo-item">
          <span class="sysinfo-label">🔧 {{ trans.cpuInfo }}</span>
          <span class="sysinfo-value sysinfo-small">{{ server.cpu_info || 'N/A' }} x {{ server.cpu_cores || 'N/A' }}</span>
        </div>
        <div class="sysinfo-item" v-if="hasGpuData">
          <span class="sysinfo-label">🎮 {{ trans.gpuInfo || 'GPU Info' }}</span>
          <span class="sysinfo-value sysinfo-small">{{ server.gpu_info }}</span>
        </div>
        <div class="sysinfo-item">
          <span class="sysinfo-label">💾 {{ trans.totalDiskRam }}</span>
          <span class="sysinfo-value">{{ formatBytes(server.disk_total*1024*1024) }} / {{ formatBytes(server.ram_total*1024*1024) }}</span>
        </div>
        <div class="sysinfo-item">
          <span class="sysinfo-label">📊 {{ trans.loadAvg }}</span>
          <span class="sysinfo-value highlight">{{ server.load_avg || '0.00 0.00 0.00' }}</span>
        </div>
        <div class="sysinfo-item">
          <span class="sysinfo-label">🌐 {{ trans.totalTraffic }}</span>
          <span class="sysinfo-value sysinfo-small">↓ {{ formatBytes(server.net_rx) }} / ↑ {{ formatBytes(server.net_tx) }}</span>
        </div>
        <div class="sysinfo-item">
          <span class="sysinfo-label">⚡ {{ trans.realtimeSpeed }}</span>
          <span class="sysinfo-value sysinfo-small">↓ {{ formatBytes(server.net_in_speed) }}/s / ↑ {{ formatBytes(server.net_out_speed) }}/s</span>
        </div>
        <div class="sysinfo-item" v-if="server.net_rx_monthly">
          <span class="sysinfo-label">📊 {{ trans.monthlyTraffic }}</span>
          <span class="sysinfo-value sysinfo-small">↓ {{ formatBytes(server.net_rx_monthly) }} / ↑ {{ formatBytes(server.net_tx_monthly) }}</span>
        </div>
        <div class="sysinfo-item" v-if="server.net_rx_monthly">
          <span class="sysinfo-label">📦 {{ trans.monthlyTrafficLimit }}</span>
          <span class="sysinfo-value sysinfo-small">
            {{ server.traffic_calc_type === 'dl' ? formatBytes(server.net_rx_monthly) : (server.traffic_calc_type === 'ul' ? formatBytes(server.net_tx_monthly) : formatBytes(server.net_rx_monthly + server.net_tx_monthly)) }} 
            / 
            {{ server.traffic_limit ? formatBytes(server.traffic_limit * 1024 * 1024 * 1024) : 'Unlimited' }}
          </span>
        </div>
        <div class="sysinfo-item">
          <span class="sysinfo-label">🕐 {{ trans.bootTime }}</span>
          <span class="sysinfo-value sysinfo-small">{{ formatTimestamp(server.boot_time) }}</span>
        </div>
        <div class="sysinfo-item">
          <span class="sysinfo-label">⏰ {{ trans.lastUpdate }}</span>
          <span class="sysinfo-value sysinfo-small">{{ lastUpdateText }}</span>
        </div>
      </div>
    </div>

    <div class="charts-container">
      <div class="chart-card">
        <div class="chart-card-header">
          <span class="chart-title">
            <span class="chart-title-icon">▸</span>
            {{ trans.cpuUsage }}
          </span>
          <span class="chart-current-value">{{ cpuPercent }}%</span>
        </div>
        <div class="chart-body">
          <canvas ref="cpuChartRef"></canvas>
        </div>
      </div>

      <div class="chart-card">
        <div class="chart-card-header">
          <span class="chart-title">
            <span class="chart-title-icon">▸</span>
            {{ trans.loadAvgMonitor }}
          </span>
          <div class="load-avg-row">
            <span class="load-1m">{{ trans.load1m }} <b>{{ (parseLoadAvg(server.load_avg)[0] || 0).toFixed(2) }}</b></span>
            <span class="load-5m">{{ trans.load5m }} <b>{{ (parseLoadAvg(server.load_avg)[1] || 0).toFixed(2) }}</b></span>
            <span class="load-15m">{{ trans.load15m }} <b>{{ (parseLoadAvg(server.load_avg)[2] || 0).toFixed(2) }}</b></span>
          </div>
        </div>
        <div class="chart-body">
          <canvas ref="loadChartRef"></canvas>
        </div>
      </div>

      <div class="chart-card">
        <div class="chart-card-header">
          <span class="chart-title">
            <span class="chart-title-icon">▸</span>
            {{ trans.memoryUsage }}
          </span>
          <div class="chart-current-value-container">
            <span class="chart-current-value">{{ ramPercent }}%</span>
            <div class="chart-subtitle">{{ trans.swap }}: {{ server.swap_used || '0' }} / {{ server.swap_total || '0' }} MiB</div>
          </div>
        </div>
        <div class="chart-body">
          <canvas ref="ramChartRef"></canvas>
        </div>
      </div>

      <div class="chart-card">
        <div class="chart-card-header">
          <span class="chart-title">
            <span class="chart-title-icon">▸</span>
            {{ trans.diskUsage }}
          </span>
          <div class="chart-current-value-container">
            <span class="chart-current-value">{{ diskPercent }}%</span>
            <div class="chart-subtitle">{{ trans.used }} {{ formatBytes(server.disk_used*1024*1024) }} / {{ formatBytes(server.disk_total*1024*1024) }}</div>
          </div>
        </div>
        <div class="chart-body">
          <canvas ref="diskChartRef"></canvas>
        </div>
      </div>

      <div class="chart-card" v-show="hasGpuData">
        <div class="chart-card-header">
          <span class="chart-title">
            <span class="chart-title-icon">▸</span>
            {{ trans.gpuUsage || 'GPU Usage' }}
          </span>
          <span class="chart-current-value">{{ gpuPercent }}%</span>
        </div>
        <div class="chart-body">
          <canvas ref="gpuChartRef"></canvas>
        </div>
      </div>

      <div class="chart-card">
        <div class="chart-card-header">
          <span class="chart-title">
            <span class="chart-title-icon">▸</span>
            {{ trans.networkTraffic }}
          </span>
          <div class="net-indicator">
            <span class="net-down">▼ {{ formatBytes(server.net_in_speed) }}/s</span>
            <span class="net-up">▲ {{ formatBytes(server.net_out_speed) }}/s</span>
          </div>
        </div>
        <div class="chart-body">
          <canvas ref="netChartRef"></canvas>
        </div>
      </div>

      <div class="chart-card">
        <div class="chart-card-header">
          <span class="chart-title">
            <span class="chart-title-icon">▸</span>
            {{ trans.processes }}
          </span>
          <span class="chart-current-value">{{ server.processes || '0' }}</span>
        </div>
        <div class="chart-body">
          <canvas ref="procChartRef"></canvas>
        </div>
      </div>

      <div class="chart-card">
        <div class="chart-card-header">
          <span class="chart-title">
            <span class="chart-title-icon">▸</span>
            {{ trans.connections }}
          </span>
          <div class="net-indicator">
            <span class="conn-tcp">TCP <b>{{ server.tcp_conn || '0' }}</b></span>
            <span class="conn-udp">UDP <b>{{ server.udp_conn || '0' }}</b></span>
          </div>
        </div>
        <div class="chart-body">
          <canvas ref="connChartRef"></canvas>
        </div>
      </div>

      <div class="chart-card">
        <div class="chart-card-header">
          <span class="chart-title">
            <span class="chart-title-icon">▸</span>
            {{ trans.latencyMonitor }}
          </span>
          <div class="ping-indicator">
            <span class="ping-ct">{{ trans.pingCt }} <b>{{ formatPing(server.ping_ct) }}</b></span>
            <span class="ping-cu">{{ trans.pingCu }} <b>{{ formatPing(server.ping_cu) }}</b></span>
            <span class="ping-cm">{{ trans.pingCm }} <b>{{ formatPing(server.ping_cm) }}</b></span>
            <span class="ping-bd">{{ trans.pingBd }} <b>{{ formatPing(server.ping_bd) }}</b></span>
          </div>
        </div>
        <div class="chart-body">
          <canvas ref="pingChartRef"></canvas>
        </div>
      </div>

      <div class="chart-card" v-show="hasLossData">
        <div class="chart-card-header">
          <span class="chart-title">
            <span class="chart-title-icon">▸</span>
            {{ trans.packetLoss || 'Packet Loss' }}
          </span>
          <div class="ping-indicator">
            <span v-if="isLossValid(server.loss_ct)" class="ping-ct">{{ trans.pingCt }} <b>{{ formatLoss(server.loss_ct) }}</b></span>
            <span v-if="isLossValid(server.loss_cu)" class="ping-cu">{{ trans.pingCu }} <b>{{ formatLoss(server.loss_cu) }}</b></span>
            <span v-if="isLossValid(server.loss_cm)" class="ping-cm">{{ trans.pingCm }} <b>{{ formatLoss(server.loss_cm) }}</b></span>
            <span v-if="isLossValid(server.loss_bd)" class="ping-bd">{{ trans.pingBd }} <b>{{ formatLoss(server.loss_bd) }}</b></span>
          </div>
        </div>
        <div class="chart-body">
          <canvas ref="lossChartRef"></canvas>
        </div>
      </div>
    </div>
    </template>

    <Footer />

    <div id="loginRequiredModal" class="modal-overlay" :class="{ active: showLoginModal }">
      <div class="modal-dialog">
        <div class="modal-header">
          <div class="modal-title">$ sudo login</div>
          <button class="modal-close" @click="showLoginModal = false">✕</button>
        </div>
        <div class="modal-body-content">
          <p class="modal-body-text">{{ trans.loginRequired }}</p>
        </div>
        <div class="modal-footer flex-justify-between">
          <button @click="goToLogin" class="btn btn-primary">{{ trans.login }}</button>
          <button @click="showLoginModal = false" class="btn">{{ trans.cancel }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import TerminalHeader from '../components/TerminalHeader.vue'
import Footer from '../components/Footer.vue'
import { fetchServerDetail, fetchAllHistory, formatBytes, isAdminLoggedIn, createLiveSocket, getFlagRegionCode, isServerOnline } from '../utils/api.js'
import { hasMultipleApiBases } from '../utils/config.js'
import Chart from 'chart.js/auto'
import 'chartjs-adapter-date-fns'
import { t, currentLang, useTranslation } from '../utils/i18n'
import { CHART } from '../utils/constants'
import { formatDateTime } from '../utils/time.js'
import useTheme from '../composables/useTheme'

const route = useRoute()
const router = useRouter()

let serverId = route.params.id
if (!serverId) {
  const urlParams = new URLSearchParams(window.location.search)
  serverId = urlParams.get('id')
}

if (!serverId) {
  router.push('/')
}

const apiIndex = ref(0)
const indexParam = route.query.apiIndex
if (indexParam !== undefined && indexParam !== null && !isNaN(parseInt(indexParam))) {
  apiIndex.value = parseInt(indexParam)
}

const server = ref({})
const currentHours = ref(0.167)
const lastUpdateText = ref('')
const config = ref(null)
const showLoginModal = ref(false)
const loading = ref(true)

const trans = useTranslation()

const isMultipleMode = computed(() => hasMultipleApiBases())

const timeOptions = computed(() => {
  const options = [
    { hours: 0.167, label: '10m' },
    { hours: 0.5, label: '30m' },
    { hours: 1, label: '1h' },
    { hours: 6, label: '6h' },
    { hours: 12, label: '12h' },
    { hours: 24, label: '24h' },
  ]

  if (!isMultipleMode.value && config.value?.show_long_history) {
    options.push(
      { hours: 48, label: '2d' },
      { hours: 96, label: '4d' },
      { hours: 168, label: '7d' },
    )
  }

  return options
})

const isOnline = computed(() => isServerOnline(server.value))

const cpuPercent = computed(() => (parseFloat(server.value.cpu) || 0).toFixed(1))
const gpuPercent = computed(() => (parseFloat(server.value.gpu) || 0).toFixed(1))
const ramPercent = computed(() => {
  if (server.value.ram_total > 0) {
    return ((server.value.ram_used / server.value.ram_total) * 100).toFixed(2)
  }
  return '0.00'
})
const diskPercent = computed(() => {
  if (server.value.disk_total > 0) {
    return ((server.value.disk_used / server.value.disk_total) * 100).toFixed(2)
  }
  return '0.00'
})
const hasGpuData = computed(() => server.value.gpu !== null && server.value.gpu !== undefined && server.value.gpu !== '' && !!server.value.gpu_info)

const isExpired = computed(() => {
  if (!server.value.expire_date) return false
  const expTime = new Date(server.value.expire_date).getTime()
  return isNaN(expTime) ? false : expTime < Date.now()
})

const expireDaysText = computed(() => {
  if (!server.value.expire_date) return ''
  const expTime = new Date(server.value.expire_date).getTime()
  if (isNaN(expTime)) return ''
  const diff = expTime - Date.now()
  const days = Math.ceil(diff / (1000 * 3600 * 24))
  return days > 0 ? `${days}${days === 1 ? trans.value.day : trans.value.days}` : trans.value.expired
})

const cpuChartRef = ref(null)
const gpuChartRef = ref(null)
const ramChartRef = ref(null)
const diskChartRef = ref(null)
const netChartRef = ref(null)
const procChartRef = ref(null)
const connChartRef = ref(null)
const pingChartRef = ref(null)
const lossChartRef = ref(null)
const loadChartRef = ref(null)
const historyLoaded = ref(false)

const charts = {}
const chartsReady = ref(false)
const hasLossHistoryData = ref(false)
let isInitializingCharts = false
let databaseUpgradeAlertShown = false

const safeDestroyCharts = () => {
  try {
    for (const key of Object.keys(charts)) {
      if (charts[key]) { charts[key].destroy(); charts[key] = null }
    }
  } catch (e) { /* ignore */ }
}

const parseLoadAvg = (loadAvgStr) => {
  if (!loadAvgStr) return [0, 0, 0]
  const parts = String(loadAvgStr).trim().split(/\s+/)
  const load1 = parseFloat(parts[0]) || 0
  const load5 = parseFloat(parts[1]) || 0
  const load15 = parseFloat(parts[2]) || 0
  return [load1, load5, load15]
}

const isLossValid = (value) => value !== null && value !== undefined && value !== '' && !Number.isNaN(parseFloat(value))
const formatLoss = (value) => isLossValid(value) ? `${Math.max(0, Math.min(100, parseFloat(value))).toFixed(0)}%` : ''
const hasLossData = computed(() => hasLossHistoryData.value || ['loss_ct', 'loss_cu', 'loss_cm', 'loss_bd'].some(key => isLossValid(server.value[key])))
const formatPing = (value) => (value === null || value === undefined || value === '' || value === 'null') ? 'Timeout' : `${value}ms`

const parseBootTimeToMs = (bootTime) => {
  if (!bootTime) return null
  
  if (typeof bootTime === 'string' && !/^\d+$/.test(bootTime)) {
    const date = new Date(bootTime)
    if (isNaN(date.getTime())) return null
    return date.getTime()
  } else {
    let timestamp = parseInt(bootTime)
    if (isNaN(timestamp)) return null
    if (timestamp < 1000000000000) {
      timestamp *= 1000
    }
    return timestamp
  }
}

const formatUptime = (bootTime) => {
  const bootTimeMs = parseBootTimeToMs(bootTime)
  if (!bootTimeMs) return 'N/A'
  
  const diffMs = Date.now() - bootTimeMs
  
  if (diffMs < 0) return 'N/A'
  
  const seconds = Math.floor(diffMs / 1000)
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  
  const hoursStr = String(hours).padStart(2, '0')
  const minutesStr = String(minutes).padStart(2, '0')
  
  if (days > 0) {
    return `${days}${days === 1 ? trans.value.day : trans.value.days}, ${hoursStr}:${minutesStr}`
  } else {
    return `${hoursStr}:${minutesStr}`
  }
}

const formatTimestamp = (bootTime) => {
  const bootTimeMs = parseBootTimeToMs(bootTime)
  if (!bootTimeMs) return 'N/A'
  return formatDateTime(bootTimeMs)
}

const hexToRgba = (hex, alpha) => {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

const ds = (label, color, opts = {}) => ({
  label, data: [], borderColor: color,
  backgroundColor: opts.fill ? hexToRgba(color, 0.05) : 'transparent',
  fill: !!opts.fill, tension: opts.tension ?? 0.4, borderWidth: 1.5,
  pointRadius: 0, hoverRadius: 5, spanGaps: false, ...opts
})

const CHART_DEFS = [
  { key: 'cpu', ref: () => cpuChartRef.value, datasets: [ds('CPU', '#00d4aa', { fill: true })], unit: '%' },
  { key: 'gpu', ref: () => gpuChartRef.value, datasets: [ds('GPU', '#ff7b72', { fill: true })], unit: '%' },
  { key: 'ram', ref: () => ramChartRef.value, datasets: [ds('Memory', '#b392f0', { fill: true }), ds('Swap', '#ffb870', { fill: true })], unit: '%', legend: true },
  { key: 'disk', ref: () => diskChartRef.value, datasets: [ds('Disk', '#39d2c0', { fill: true })], unit: '%' },
  { key: 'proc', ref: () => procChartRef.value, datasets: [ds('Processes', '#f778ba', { fill: true })] },
  { key: 'net', ref: () => netChartRef.value, datasets: [ds('Download', '#00d4aa', { fill: true }), ds('Upload', '#4da6ff', { fill: true })], legend: true, formatValue: (v) => formatBytes(v) + '/s', tickFormat: (v) => formatBytes(v) },
  { key: 'conn', ref: () => connChartRef.value, datasets: [ds('TCP', '#b392f0'), ds('UDP', '#f778ba')], legend: true },
  { key: 'ping', ref: () => pingChartRef.value, datasets: [ds('CT', '#00d4aa', { tension: 0.3 }), ds('CU', '#ffb870', { tension: 0.3 }), ds('CM', '#4da6ff', { tension: 0.3 }), ds('BD', '#b392f0', { tension: 0.3 })], unit: ' ms', legend: true },
  { key: 'loss', ref: () => lossChartRef.value, datasets: [ds('CT', '#00d4aa', { tension: 0.3 }), ds('CU', '#ffb870', { tension: 0.3 }), ds('CM', '#4da6ff', { tension: 0.3 }), ds('BD', '#b392f0', { tension: 0.3 })], unit: '%', legend: true },
  { key: 'load', ref: () => loadChartRef.value, datasets: [ds(trans.value.load1m || '1 Min', '#00d4aa', { tension: 0.3 }), ds(trans.value.load5m || '5 Min', '#ffb870', { tension: 0.3 }), ds(trans.value.load15m || '15 Min', '#4da6ff', { tension: 0.3 })], legend: true }
]

const initCharts = () => {
  safeDestroyCharts()

  const isLight = document.body.classList.contains('light')
  const axisLabelColor = isLight ? '#2c2c2c' : '#d3dae3'

  Chart.defaults.font.family = "'JetBrains Mono', 'Courier New', monospace"
  Chart.defaults.font.size = 10
  Chart.defaults.color = '#8999af'
  Chart.defaults.plugins.tooltip.backgroundColor = 'rgba(10, 14, 20, 0.95)'
  Chart.defaults.plugins.tooltip.titleColor = '#00d4aa'
  Chart.defaults.plugins.tooltip.bodyColor = '#d3dae3'
  Chart.defaults.plugins.tooltip.borderColor = '#1e2a3a'
  Chart.defaults.plugins.tooltip.borderWidth = 1
  Chart.defaults.plugins.tooltip.titleFont = { size: 12, weight: 'bold', family: "'JetBrains Mono', monospace" }
  Chart.defaults.plugins.tooltip.bodyFont = { size: 11, family: "'JetBrains Mono', monospace" }
  Chart.defaults.plugins.tooltip.padding = 12
  Chart.defaults.plugins.tooltip.cornerRadius = 2

  const createChartOptions = (unit = '', showLegend = false, formatCallback = null, tickFormat = null) => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: CHART.ANIMATION_DURATION, easing: 'easeOutCubic' },
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: {
        display: showLegend,
        position: 'top',
        labels: {
          boxWidth: 10,
          padding: 12,
          font: { size: 10, family: "'JetBrains Mono', monospace" },
          usePointStyle: true,
          color: axisLabelColor
        }
      },
      tooltip: {
        callbacks: {
          title: function(items) {
            if (items.length > 0 && items[0].raw) {
              const date = new Date(items[0].raw.x)
              return '> ' + date.toLocaleString(undefined, {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false
              })
            }
            return ''
          },
          label: function(context) {
            let label = context.dataset.label || ''
            if (label) label += ': '
            const value = context.parsed.y
            if (value === null || value === undefined) {
              label += trans.value.timeout
            } else if (formatCallback) {
              label += formatCallback(value)
            } else {
              label += typeof value === 'number' ? value.toFixed(2) : value
              label += unit
            }
            return '$ ' + label
          }
        }
      }
    },
    scales: {
      x: {
        type: 'time',
        time: {
          unit: currentHours.value <= 3 ? 'minute' : 'hour',
          displayFormats: { minute: 'HH:mm', hour: 'MM-dd HH:mm' },
          tooltipFormat: 'yyyy-MM-dd HH:mm:ss'
        },
        title: {
          display: false,
          text: '',
          color: axisLabelColor,
          font: { size: 10, family: "'JetBrains Mono', monospace" }
        },
        ticks: {
          maxTicksLimit: CHART.MAX_TICKS,
          color: axisLabelColor,
          font: { size: 9, family: "'JetBrains Mono', monospace" },
          maxRotation: 0,
          padding: 8
        },
        grid: { color: 'rgba(30, 42, 58, 0.5)', drawBorder: false, tickLength: 0 }
      },
      y: {
        beginAtZero: true,
        grid: { color: 'rgba(30, 42, 58, 0.5)', drawBorder: false, tickLength: 0 },
        ticks: {
          color: axisLabelColor,
          font: { size: 9, family: "'JetBrains Mono', monospace" },
          padding: 8,
          callback: tickFormat || function(value) { return value + unit; }
        }
      }
    },
    elements: {
      point: { radius: 0, hoverRadius: 5, hitRadius: 10, borderWidth: 0, hoverBorderWidth: 2, hoverBorderColor: '#fff' },
      line: { tension: 0.4, borderWidth: 1.5, fill: false, spanGaps: false }
    }
  })

  for (const def of CHART_DEFS) {
    const ref = def.ref()
    if (!ref) continue
    charts[def.key] = new Chart(ref.getContext('2d'), {
      type: 'line',
      data: { datasets: def.datasets.map(d => ({ ...d })) },
      options: createChartOptions(def.unit || '', def.legend, def.formatValue, def.tickFormat)
    })
  }
}

const updateChartsTheme = (theme) => {
  const axisLabelColor = theme === 'light' ? 'rgba(10, 14, 20, 0.8)' : 'rgba(211, 218, 227, 0.8)'

  Object.values(charts).forEach(chart => {
    if (!chart) return

    if (chart.options.plugins.legend.labels) {
      chart.options.plugins.legend.labels.color = axisLabelColor
    }

    if (chart.options.scales.x) {
      if (chart.options.scales.x.title) {
        chart.options.scales.x.title.color = axisLabelColor
      }
      chart.options.scales.x.ticks.color = axisLabelColor
    }

    if (chart.options.scales.y) {
      if (chart.options.scales.y.title) {
        chart.options.scales.y.title.color = axisLabelColor
      }
      chart.options.scales.y.ticks.color = axisLabelColor
    }

    chart.update('none')
  })
}

// ≤1h: 5分钟阈值; >1h: 总时长/80 * 1.1
const getHistoryGapBreakMs = (hours = currentHours.value) => {
  if (hours <= 1) return 5 * 60 * 1000
  return Math.ceil(hours * 60 * 60 * 1000 / 80) * 1.1
}

const shouldBreakGap = (prevPoint, nextPoint) => {
  if (!prevPoint || !nextPoint) return false
  const prevTime = Number(prevPoint.x)
  const nextTime = Number(nextPoint.x)
  if (!Number.isFinite(prevTime) || !Number.isFinite(nextTime)) return false
  const gap = nextTime - prevTime
  const breakThreshold = getHistoryGapBreakMs()
  if (breakThreshold < 5 * 60 * 1000) return false
  return gap > breakThreshold * 2
}

const applyGapBreak = (data) => {
  if (!data || data.length < 2) return data
  
  const result = []
  for (let i = 0; i < data.length; i++) {
    result.push(data[i])
    if (i < data.length - 1) {
      if (shouldBreakGap(data[i], data[i + 1])) {
        const gap = data[i + 1].x - data[i].x
        result.push({ x: data[i].x + gap / 2, y: null })
      }
    }
  }
  return result
}

const appendPointWithGapBreak = (data, point) => {
  if (!Array.isArray(data)) return [point]
  let lastPoint = null
  for (let i = data.length - 1; i >= 0; i--) {
    const item = data[i]
    if (item && item.y !== null && item.y !== undefined) {
      lastPoint = item
      break
    }
  }
  if (lastPoint && shouldBreakGap(lastPoint, point)) {
    data.push({ x: lastPoint.x + (point.x - lastPoint.x) / 2, y: null })
  }
  data.push(point)
  return data
}

const sampleData = (dataPoints) => {
  if (!dataPoints || dataPoints.length <= CHART.MAX_DATA_POINTS) return dataPoints
  const step = Math.ceil(dataPoints.length / CHART.MAX_DATA_POINTS)
  return dataPoints.filter((_, i) => i % step === 0)
}

const updateChartDataset = (chart, datasetIndex, dataPoints, yAccessor) => {
  if (!chart) return

  const dataset = chart.data.datasets[datasetIndex]
  if (!dataset) return

  const endTime = Date.now()
  const startTime = endTime - currentHours.value * 60 * 60 * 1000

  let processedData = []
  if (dataPoints && dataPoints.length > 0) {
    const sampledData = sampleData(dataPoints)

    processedData = sampledData.map(d => {
      return { x: new Date(d.timestamp).getTime(), y: yAccessor(d) }
    })

    processedData.sort((a, b) => a.x - b.x)
    processedData = applyGapBreak(processedData)
  }

  if (chart.options && chart.options.scales && chart.options.scales.x) {
    chart.options.scales.x.min = startTime
    chart.options.scales.x.max = endTime
  }

  dataset.data = processedData
  chart.update('none')
}

const percentAccessor = (usedField, totalField) => (d) => {
  const total = parseFloat(d[totalField]) || 0
  return total === 0 ? 0 : (parseFloat(d[usedField]) / total) * 100
}

const fieldAccessor = (field, allowZero = false) => (d) => {
  const val = parseFloat(d[field])
  if (Number.isNaN(val)) return null
  return allowZero ? val : (val > 0 ? val : null)
}

const updateLoadChart = (chart, dataPoints) => {
  if (!chart) return

  const endTime = Date.now()
  const startTime = endTime - currentHours.value * 60 * 60 * 1000

  let processedData = []
  if (dataPoints && dataPoints.length > 0) {
    const sampledData = sampleData(dataPoints)

    processedData = sampledData.map(d => {
      const loadVal = d.load_avg || '0 0 0'
      const loads = parseLoadAvg(loadVal)
      return { 
        x: new Date(d.timestamp).getTime(), 
        load1: loads[0],
        load5: loads[1],
        load15: loads[2]
      }
    })

    processedData.sort((a, b) => a.x - b.x)
  }

  if (chart.options && chart.options.scales && chart.options.scales.x) {
    chart.options.scales.x.min = startTime
    chart.options.scales.x.max = endTime
  }

  const load1Data = processedData.map(d => ({ x: d.x, y: d.load1 }))
  const load5Data = processedData.map(d => ({ x: d.x, y: d.load5 }))
  const load15Data = processedData.map(d => ({ x: d.x, y: d.load15 }))
  
  chart.data.datasets[0].data = applyGapBreak(load1Data)
  chart.data.datasets[1].data = applyGapBreak(load5Data)
  chart.data.datasets[2].data = applyGapBreak(load15Data)
  chart.update('none')
}

const loadAllHistory = async (hours) => {
  try {
    const allData = await fetchAllHistory(serverId, hours, apiIndex.value)

    if (allData.length > 0) {
      hasLossHistoryData.value = allData.some(item => ['loss_ct', 'loss_cu', 'loss_cm', 'loss_bd'].some(key => isLossValid(item[key])))

      updateChartDataset(charts.cpu, 0, allData, fieldAccessor('cpu'))
      updateChartDataset(charts.gpu, 0, allData, fieldAccessor('gpu', true))
      updateChartDataset(charts.ram, 0, allData, percentAccessor('ram_used', 'ram_total'))
      updateChartDataset(charts.ram, 1, allData, percentAccessor('swap_used', 'swap_total'))
      updateChartDataset(charts.disk, 0, allData, percentAccessor('disk_used', 'disk_total'))
      updateChartDataset(charts.proc, 0, allData, fieldAccessor('processes'))
      updateChartDataset(charts.net, 0, allData, fieldAccessor('net_in_speed', true))
      updateChartDataset(charts.net, 1, allData, fieldAccessor('net_out_speed', true))
      updateChartDataset(charts.conn, 0, allData, fieldAccessor('tcp_conn', true))
      updateChartDataset(charts.conn, 1, allData, fieldAccessor('udp_conn', true))
      updateChartDataset(charts.ping, 0, allData, fieldAccessor('ping_ct', true))
      updateChartDataset(charts.ping, 1, allData, fieldAccessor('ping_cu', true))
      updateChartDataset(charts.ping, 2, allData, fieldAccessor('ping_cm', true))
      updateChartDataset(charts.ping, 3, allData, fieldAccessor('ping_bd', true))
      updateChartDataset(charts.loss, 0, allData, fieldAccessor('loss_ct', true))
      updateChartDataset(charts.loss, 1, allData, fieldAccessor('loss_cu', true))
      updateChartDataset(charts.loss, 2, allData, fieldAccessor('loss_cm', true))
      updateChartDataset(charts.loss, 3, allData, fieldAccessor('loss_bd', true))
      updateLoadChart(charts.load, allData)
    }

    updateAllChartTimeUnits(hours)
    historyLoaded.value = true

    await nextTick()

    requestAnimationFrame(() => {
      Object.values(charts).forEach(chart => {
        chart.resize()
        chart.update('none')
      })
    })
  } catch (e) {
    if (e && e.message === 'databaseUpgradeRequired') {
      if (!databaseUpgradeAlertShown) {
        databaseUpgradeAlertShown = true
        alert(t(e.message))
      }
      return
    }
    historyLoaded.value = true
    console.error('[ERROR] Load history failed:', e)
  }
}

const updateAllChartTimeUnits = (hours) => {
  const unit = hours <= 3 ? 'minute' : 'hour'
  const maxTicks = hours <= 3 ? CHART.MAX_TICKS : CHART.MAX_TICKS_HOUR
  const endTime = Date.now()
  const startTime = endTime - hours * 60 * 60 * 1000

  Object.values(charts).forEach(chart => {
    if (chart && chart.options && chart.options.scales && chart.options.scales.x && chart.options.scales.x.time) {
      chart.options.scales.x.time.unit = unit
      chart.options.scales.x.ticks.maxTicksLimit = maxTicks
      chart.options.scales.x.min = startTime
      chart.options.scales.x.max = endTime
    }
    if (chart) chart.update('none')
  })
}

const appendDataToChart = (chart, datasetIndex, timestamp, value, isPing = false, emptyAsNull = false) => {
  if (!chart) return
  
  const dataset = chart.data.datasets[datasetIndex]
  if (!dataset) return
  
  const time = new Date(timestamp).getTime()
  const endTime = Date.now()
  const startTime = endTime - currentHours.value * 60 * 60 * 1000

  let yVal
  if (isPing) {
    const val = parseFloat(value)
    yVal = (val > 0) ? val : null
  } else if (emptyAsNull && !isLossValid(value)) {
    yVal = null
  } else {
    yVal = parseFloat(value) || 0
  }
  
  dataset.data = appendPointWithGapBreak(dataset.data, { x: time, y: yVal })
  
  while (dataset.data.length > CHART.MAX_DATA_POINTS) {
    dataset.data.shift()
  }
  
  dataset.data = dataset.data.filter(d => d.x >= startTime)
  
  if (chart.options && chart.options.scales && chart.options.scales.x) {
    chart.options.scales.x.min = startTime
    chart.options.scales.x.max = endTime
  }
  
  chart.update('none')
}

const STATIC_FIELDS = ['id', 'name', 'region', 'arch', 'os', 'cpu_info', 'cpu_cores', 'gpu_info', 'expire_date', 'server_group', 'traffic_limit', 'net_rx_monthly', 'net_tx_monthly', 'boot_time', 'timestamp', 'ip_v4', 'ip_v6']

const appendLoadChartData = (timestamp, loadAvg) => {
  const chart = charts.load
  if (!chart) return

  const loads = parseLoadAvg(loadAvg)
  const time = new Date(timestamp).getTime()
  const endTime = Date.now()
  const startTime = endTime - currentHours.value * 60 * 60 * 1000

  for (let i = 0; i < 3; i++) {
    chart.data.datasets[i].data = appendPointWithGapBreak(chart.data.datasets[i].data, { x: time, y: loads[i] })
    while (chart.data.datasets[i].data.length > CHART.MAX_DATA_POINTS) {
      chart.data.datasets[i].data.shift()
    }
    chart.data.datasets[i].data = chart.data.datasets[i].data.filter(d => d.x >= startTime)
  }

  if (chart.options?.scales?.x) {
    chart.options.scales.x.min = startTime
    chart.options.scales.x.max = endTime
  }

  chart.update('none')
}

const fetchCurrentStatus = async (incomingData) => {
  try {
    let data = incomingData
    if (!data) {
      data = await fetchServerDetail(serverId, apiIndex.value)
      if (!data) return
    }
    if (!data) return

    if (incomingData) {
      const newServer = { ...server.value }
      for (const key of Object.keys(data)) {
        if (STATIC_FIELDS.includes(key)) {
          continue
        }
        newServer[key] = data[key]
      }
      server.value = newServer
    } else {
      config.value = data.sysConfig || null
      server.value = data
      loading.value = false
    }

    if (data.last_updated) {
      const dataTimestamp = new Date(data.last_updated).getTime()
      appendDataToChart(charts.cpu, 0, dataTimestamp, data.cpu)
      appendDataToChart(charts.gpu, 0, dataTimestamp, data.gpu)
      const ramPercent = (parseFloat(data.ram_total) > 0) ? (parseFloat(data.ram_used) / parseFloat(data.ram_total)) * 100 : 0
      appendDataToChart(charts.ram, 0, dataTimestamp, ramPercent)
      const swapPercent = (parseFloat(data.swap_total) > 0) ? (parseFloat(data.swap_used) / parseFloat(data.swap_total)) * 100 : 0
      appendDataToChart(charts.ram, 1, dataTimestamp, swapPercent)
      const diskPercent = (parseFloat(data.disk_total) > 0) ? (parseFloat(data.disk_used) / parseFloat(data.disk_total)) * 100 : 0
      appendDataToChart(charts.disk, 0, dataTimestamp, diskPercent)
      appendDataToChart(charts.proc, 0, dataTimestamp, data.processes)
      appendDataToChart(charts.net, 0, dataTimestamp, data.net_in_speed)
      appendDataToChart(charts.net, 1, dataTimestamp, data.net_out_speed)
      appendDataToChart(charts.conn, 0, dataTimestamp, data.tcp_conn)
      appendDataToChart(charts.conn, 1, dataTimestamp, data.udp_conn)
      appendDataToChart(charts.ping, 0, dataTimestamp, data.ping_ct, true)
      appendDataToChart(charts.ping, 1, dataTimestamp, data.ping_cu, true)
      appendDataToChart(charts.ping, 2, dataTimestamp, data.ping_cm, true)
      appendDataToChart(charts.ping, 3, dataTimestamp, data.ping_bd, true)
      appendDataToChart(charts.loss, 0, dataTimestamp, data.loss_ct, false, true)
      appendDataToChart(charts.loss, 1, dataTimestamp, data.loss_cu, false, true)
      appendDataToChart(charts.loss, 2, dataTimestamp, data.loss_cm, false, true)
      appendDataToChart(charts.loss, 3, dataTimestamp, data.loss_bd, false, true)
      appendLoadChartData(dataTimestamp, data.load_avg)

      lastUpdateText.value = formatTimestamp(data.last_updated)
    }
  } catch (e) {
    console.error('[ERROR] Update status failed:', e)
  }
}

const setTimeRange = (hours) => {
  if (hours > 1 && !isAdminLoggedIn()) {
    showLoginModal.value = true
    return
  }
  currentHours.value = hours
  loadAllHistory(hours)
}

const goToLogin = () => {
  showLoginModal.value = false
  router.push({
    path: '/admin',
    query: { apiIndex: String(apiIndex.value) }
  })
}

let liveSocket = null

const initChartsOnMount = async () => {
  if (isInitializingCharts || chartsReady.value) return
  isInitializingCharts = true

  await nextTick()
  
  const allRefsReady = cpuChartRef.value && gpuChartRef.value && ramChartRef.value && diskChartRef.value &&
    netChartRef.value && procChartRef.value && connChartRef.value && pingChartRef.value && lossChartRef.value && loadChartRef.value
  
  if (allRefsReady) {
    try {
      initCharts()
      chartsReady.value = true
    } finally {
      isInitializingCharts = false
    }
  } else {
    isInitializingCharts = false
    setTimeout(initChartsOnMount, 30)
  }
}

const handleVisibility = () => {
  if (!liveSocket) return
  if (document.hidden) {
    liveSocket.close()
  } else {
    liveSocket.reconnect()
  }
}

const init = async () => {
  await fetchCurrentStatus()
  await initChartsOnMount()

  loadAllHistory(currentHours.value)

  const { onThemeChange } = useTheme()
  onThemeChange(updateChartsTheme)

  liveSocket = createLiveSocket(String(serverId), {
    onUpdate: ({ serverId: sid, data }) => {
      if (String(sid) !== String(serverId)) return
      fetchCurrentStatus(data)
    },
    onStatus: ({ connected }) => {}
  }, apiIndex.value)

  document.addEventListener('visibilitychange', handleVisibility)
}

watch([cpuChartRef, gpuChartRef, ramChartRef, diskChartRef, netChartRef, procChartRef, connChartRef, pingChartRef, lossChartRef, loadChartRef], () => {
  if (!chartsReady.value) {
    initChartsOnMount()
  }
})

onMounted(() => {
  init()
})

onUnmounted(() => {
  document.removeEventListener('visibilitychange', handleVisibility)
  if (liveSocket) liveSocket.close()
  safeDestroyCharts()
})
</script>
