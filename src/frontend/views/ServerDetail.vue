<template>
  <div class="container">
    <TerminalHeader :title="server.name || 'Loading...'" />
    
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
        <div class="modal-footer">
          <button @click="showLoginModal = false" class="btn modal-btn-full">{{ trans.cancel }}</button>
          <button @click="goToLogin" class="btn btn-blue modal-btn-full">{{ trans.login }}</button>
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
import { fetchServerDetail, fetchAllHistory, formatBytes, isAdminLoggedIn, createLiveSocket, getFlagRegionCode, getApiBases } from '../utils/api.js'
import Chart from 'chart.js/auto'
import 'chartjs-adapter-date-fns'
import { t, currentLang, translations } from '../utils/i18n'
import { TIME, CHART, GAP_BREAK } from '../utils/constants'
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

const trans = computed(() => translations[currentLang.value] || translations.en)

const timeOptions = computed(() => {
  const options = [
    { hours: 0.167, label: '10m' },
    { hours: 0.5, label: '30m' },
    { hours: 1, label: '1h' },
    { hours: 6, label: '6h' },
    { hours: 12, label: '12h' },
    { hours: 24, label: '24h' },
  ]

  if (config.value?.show_long_history) {
    options.push(
      { hours: 48, label: '2d' },
      { hours: 96, label: '4d' },
      { hours: 168, label: '7d' },
    )
  }

  return options
})

const isOnline = computed(() => {
  const lastUpdated = new Date(server.value.last_updated).getTime()
  return (Date.now() - lastUpdated) < TIME.ONLINE_THRESHOLD_MS
})

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
    if (charts.cpu) { charts.cpu.destroy(); charts.cpu = null }
    if (charts.gpu) { charts.gpu.destroy(); charts.gpu = null }
    if (charts.ram) { charts.ram.destroy(); charts.ram = null }
    if (charts.disk) { charts.disk.destroy(); charts.disk = null }
    if (charts.net) { charts.net.destroy(); charts.net = null }
    if (charts.proc) { charts.proc.destroy(); charts.proc = null }
    if (charts.conn) { charts.conn.destroy(); charts.conn = null }
    if (charts.ping) { charts.ping.destroy(); charts.ping = null }
    if (charts.loss) { charts.loss.destroy(); charts.loss = null }
    if (charts.load) { charts.load.destroy(); charts.load = null }
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
  
  const date = new Date(bootTimeMs)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const seconds = String(date.getSeconds()).padStart(2, '0')
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`
}

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

  const createChartOptions = (unit = '', showLegend = false, yAxisLabel = '', formatCallback = null, yAxisTickCallback = null) => ({
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
        title: {
          display: !!yAxisLabel,
          text: yAxisLabel,
          color: axisLabelColor,
          font: { size: 10, family: "'JetBrains Mono', monospace" }
        },
        grid: { color: 'rgba(30, 42, 58, 0.5)', drawBorder: false, tickLength: 0 },
        ticks: {
          color: axisLabelColor,
          font: { size: 9, family: "'JetBrains Mono', monospace" },
          padding: 8,
          callback: yAxisTickCallback || function(value) { return value + unit; }
        }
      }
    },
    elements: {
      point: { radius: 0, hoverRadius: 5, hitRadius: 10, borderWidth: 0, hoverBorderWidth: 2, hoverBorderColor: '#fff' },
      line: { tension: 0.4, borderWidth: 1.5, fill: false, spanGaps: false }
    }
  })

  if (cpuChartRef.value) {
    charts.cpu = new Chart(cpuChartRef.value.getContext('2d'), {
      type: 'line',
      data: { datasets: [{ label: 'CPU', data: [], borderColor: '#00d4aa', backgroundColor: 'rgba(0, 212, 170, 0.05)', fill: true, borderWidth: 1.5, spanGaps: false }] },
      options: createChartOptions('%')
    })
  }

  if (gpuChartRef.value) {
    charts.gpu = new Chart(gpuChartRef.value.getContext('2d'), {
      type: 'line',
      data: { datasets: [{ label: 'GPU', data: [], borderColor: '#ff7b72', backgroundColor: 'rgba(255, 123, 114, 0.05)', fill: true, borderWidth: 1.5, spanGaps: false }] },
      options: createChartOptions('%')
    })
  }

  if (ramChartRef.value) {
    charts.ram = new Chart(ramChartRef.value.getContext('2d'), {
      type: 'line',
      data: {
        datasets: [
          { label: 'Memory', data: [], borderColor: '#b392f0', backgroundColor: 'rgba(179, 146, 240, 0.05)', fill: true, borderWidth: 1.5, spanGaps: false },
          { label: 'Swap', data: [], borderColor: '#ffb870', backgroundColor: 'rgba(255, 184, 112, 0.05)', fill: true, borderWidth: 1.5, spanGaps: false }
        ]
      },
      options: createChartOptions('%', true)
    })
  }

  if (diskChartRef.value) {
    charts.disk = new Chart(diskChartRef.value.getContext('2d'), {
      type: 'line',
      data: { datasets: [{ label: 'Disk', data: [], borderColor: '#39d2c0', backgroundColor: 'rgba(57, 210, 192, 0.05)', fill: true, borderWidth: 1.5, spanGaps: false }] },
      options: createChartOptions('%')
    })
  }

  if (procChartRef.value) {
    charts.proc = new Chart(procChartRef.value.getContext('2d'), {
      type: 'line',
      data: { datasets: [{ label: 'Processes', data: [], borderColor: '#f778ba', backgroundColor: 'rgba(247, 120, 186, 0.03)', fill: true, borderWidth: 1.5, spanGaps: false }] },
      options: createChartOptions('')
    })
  }

  if (netChartRef.value) {
    charts.net = new Chart(netChartRef.value.getContext('2d'), {
      type: 'line',
      data: {
        datasets: [
          { label: 'Download', data: [], borderColor: '#00d4aa', backgroundColor: 'rgba(0, 212, 170, 0.03)', fill: true, tension: 0.4, borderWidth: 1.5, pointRadius: 0, hoverRadius: 5, spanGaps: false },
          { label: 'Upload', data: [], borderColor: '#4da6ff', backgroundColor: 'rgba(77, 166, 255, 0.03)', fill: true, tension: 0.4, borderWidth: 1.5, pointRadius: 0, hoverRadius: 5, spanGaps: false }
        ]
      },
      options: createChartOptions('', true, '', (value) => formatBytes(value) + '/s', (value) => formatBytes(value))
    })
  }

  if (connChartRef.value) {
    charts.conn = new Chart(connChartRef.value.getContext('2d'), {
      type: 'line',
      data: {
        datasets: [
          { label: 'TCP', data: [], borderColor: '#b392f0', backgroundColor: 'transparent', tension: 0.4, borderWidth: 1.5, pointRadius: 0, hoverRadius: 5, spanGaps: false },
          { label: 'UDP', data: [], borderColor: '#f778ba', backgroundColor: 'transparent', tension: 0.4, borderWidth: 1.5, pointRadius: 0, hoverRadius: 5, spanGaps: false }
        ]
      },
      options: createChartOptions('', true)
    })
  }

  if (pingChartRef.value) {
    charts.ping = new Chart(pingChartRef.value.getContext('2d'), {
      type: 'line',
      data: {
        datasets: [
          { label: 'CT', data: [], borderColor: '#00d4aa', backgroundColor: 'transparent', tension: 0.3, borderWidth: 1.5, pointRadius: 0, hoverRadius: 5, spanGaps: false },
          { label: 'CU', data: [], borderColor: '#ffb870', backgroundColor: 'transparent', tension: 0.3, borderWidth: 1.5, pointRadius: 0, hoverRadius: 5, spanGaps: false },
          { label: 'CM', data: [], borderColor: '#4da6ff', backgroundColor: 'transparent', tension: 0.3, borderWidth: 1.5, pointRadius: 0, hoverRadius: 5, spanGaps: false },
          { label: 'BD', data: [], borderColor: '#b392f0', backgroundColor: 'transparent', tension: 0.3, borderWidth: 1.5, pointRadius: 0, hoverRadius: 5, spanGaps: false }
        ]
      },
      options: createChartOptions(' ms', true)
    })
  }

  if (lossChartRef.value) {
    charts.loss = new Chart(lossChartRef.value.getContext('2d'), {
      type: 'line',
      data: {
        datasets: [
          { label: 'CT', data: [], borderColor: '#00d4aa', backgroundColor: 'transparent', tension: 0.3, borderWidth: 1.5, pointRadius: 0, hoverRadius: 5, spanGaps: false },
          { label: 'CU', data: [], borderColor: '#ffb870', backgroundColor: 'transparent', tension: 0.3, borderWidth: 1.5, pointRadius: 0, hoverRadius: 5, spanGaps: false },
          { label: 'CM', data: [], borderColor: '#4da6ff', backgroundColor: 'transparent', tension: 0.3, borderWidth: 1.5, pointRadius: 0, hoverRadius: 5, spanGaps: false },
          { label: 'BD', data: [], borderColor: '#b392f0', backgroundColor: 'transparent', tension: 0.3, borderWidth: 1.5, pointRadius: 0, hoverRadius: 5, spanGaps: false }
        ]
      },
      options: createChartOptions('%', true)
    })
  }

  if (loadChartRef.value) {
    charts.load = new Chart(loadChartRef.value.getContext('2d'), {
      type: 'line',
      data: {
        datasets: [
          { label: trans.value.load1m || '1 Min', data: [], borderColor: '#00d4aa', backgroundColor: 'transparent', tension: 0.3, borderWidth: 1.5, pointRadius: 0, hoverRadius: 5 },
          { label: trans.value.load5m || '5 Min', data: [], borderColor: '#ffb870', backgroundColor: 'transparent', tension: 0.3, borderWidth: 1.5, pointRadius: 0, hoverRadius: 5 },
          { label: trans.value.load15m || '15 Min', data: [], borderColor: '#4da6ff', backgroundColor: 'transparent', tension: 0.3, borderWidth: 1.5, pointRadius: 0, hoverRadius: 5 }
        ]
      },
      options: createChartOptions('', true)
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

const getMaxGapMs = () => {
  if (currentHours.value <= 1) return GAP_BREAK.LESS_THAN_1_HOUR
  if (currentHours.value <= 6) return GAP_BREAK.LESS_THAN_6_HOURS
  if (currentHours.value <= 12) return GAP_BREAK.LESS_THAN_12_HOURS
  if (currentHours.value <= 24) return GAP_BREAK.LESS_THAN_24_HOURS
  return GAP_BREAK.MORE_THAN_24_HOURS
}

const applyGapBreak = (data) => {
  // 超过1小时的数据不使用断点，图表直接连续连接
  if (currentHours.value > 1) return data
  if (!data || data.length < 2) return data
  
  const maxGapMs = getMaxGapMs()
  
  const result = []
  for (let i = 0; i < data.length; i++) {
    result.push(data[i])
    if (i < data.length - 1) {
      const gap = data[i + 1].x - data[i].x
      if (gap > maxGapMs) {
        result.push({ x: data[i].x + gap / 2, y: null })
      }
    }
  }
  return result
}

const sampleData = (dataPoints) => {
  if (!dataPoints || dataPoints.length <= CHART.MAX_DATA_POINTS) return dataPoints
  const step = Math.ceil(dataPoints.length / CHART.MAX_DATA_POINTS)
  return dataPoints.filter((_, i) => i % step === 0)
}

const updateChartDataset = (chart, datasetIndex, dataPoints, xField = 'timestamp', yField, allowZero = false) => {
  if (!chart) return

  const dataset = chart.data.datasets[datasetIndex]
  if (!dataset) return
  
  const endTime = Date.now()
  const startTime = endTime - currentHours.value * 60 * 60 * 1000

  let processedData = []
  if (dataPoints && dataPoints.length > 0) {
    const sampledData = sampleData(dataPoints)

    processedData = sampledData.map(d => {
      const val = parseFloat(d[yField])
      return {
        x: new Date(d[xField]).getTime(),
        y: Number.isNaN(val) ? null : (allowZero ? val : ((val > 0) ? val : null))
      }
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

const updateChartDatasetWithSwap = (chart, datasetIndex, dataPoints) => {
  if (!chart) return

  const dataset = chart.data.datasets[datasetIndex]
  if (!dataset) return

  const endTime = Date.now()
  const startTime = endTime - currentHours.value * 60 * 60 * 1000

  let processedData = []
  if (dataPoints && dataPoints.length > 0) {
    const sampledData = sampleData(dataPoints)

    processedData = sampledData.map(d => {
      const swapTotal = parseFloat(d.swap_total) || 0
      const swapUsed = parseFloat(d.swap_used) || 0
      const percent = swapTotal === 0 ? 0 : (swapUsed / swapTotal) * 100
      return { x: new Date(d.timestamp).getTime(), y: percent }
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

const updateChartDatasetWithRam = (chart, datasetIndex, dataPoints) => {
  if (!chart) return

  const dataset = chart.data.datasets[datasetIndex]
  if (!dataset) return

  const endTime = Date.now()
  const startTime = endTime - currentHours.value * 60 * 60 * 1000

  let processedData = []
  if (dataPoints && dataPoints.length > 0) {
    const sampledData = sampleData(dataPoints)

    processedData = sampledData.map(d => {
      const ramTotal = parseFloat(d.ram_total) || 0
      const ramUsed = parseFloat(d.ram_used) || 0
      const percent = ramTotal === 0 ? 0 : (ramUsed / ramTotal) * 100
      return { x: new Date(d.timestamp).getTime(), y: percent }
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

const updateChartDatasetWithDisk = (chart, datasetIndex, dataPoints) => {
  if (!chart) return

  const dataset = chart.data.datasets[datasetIndex]
  if (!dataset) return

  const endTime = Date.now()
  const startTime = endTime - currentHours.value * 60 * 60 * 1000

  let processedData = []
  if (dataPoints && dataPoints.length > 0) {
    const sampledData = sampleData(dataPoints)

    processedData = sampledData.map(d => {
      const diskTotal = parseFloat(d.disk_total) || 0
      const diskUsed = parseFloat(d.disk_used) || 0
      const percent = diskTotal === 0 ? 0 : (diskUsed / diskTotal) * 100
      return { x: new Date(d.timestamp).getTime(), y: percent }
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
    const res = await fetchAllHistory(serverId, hours, apiIndex.value)
    if (!res) return
    const allData = res
    hasLossHistoryData.value = allData.some(item => ['loss_ct', 'loss_cu', 'loss_cm', 'loss_bd'].some(key => isLossValid(item[key])))

    updateChartDataset(charts.cpu, 0, allData, 'timestamp', 'cpu')
    updateChartDataset(charts.gpu, 0, allData, 'timestamp', 'gpu', true)
    updateChartDatasetWithRam(charts.ram, 0, allData)
    updateChartDatasetWithSwap(charts.ram, 1, allData)
    updateChartDatasetWithDisk(charts.disk, 0, allData)
    updateChartDataset(charts.proc, 0, allData, 'timestamp', 'processes')
    updateChartDataset(charts.net, 0, allData, 'timestamp', 'net_in_speed')
    updateChartDataset(charts.net, 1, allData, 'timestamp', 'net_out_speed')
    updateChartDataset(charts.conn, 0, allData, 'timestamp', 'tcp_conn')
    updateChartDataset(charts.conn, 1, allData, 'timestamp', 'udp_conn')
    updateChartDataset(charts.ping, 0, allData, 'timestamp', 'ping_ct')
    updateChartDataset(charts.ping, 1, allData, 'timestamp', 'ping_cu')
    updateChartDataset(charts.ping, 2, allData, 'timestamp', 'ping_cm')
    updateChartDataset(charts.ping, 3, allData, 'timestamp', 'ping_bd')
    updateChartDataset(charts.loss, 0, allData, 'timestamp', 'loss_ct', true)
    updateChartDataset(charts.loss, 1, allData, 'timestamp', 'loss_cu', true)
    updateChartDataset(charts.loss, 2, allData, 'timestamp', 'loss_cm', true)
    updateChartDataset(charts.loss, 3, allData, 'timestamp', 'loss_bd', true)
    updateLoadChart(charts.load, allData)

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
  })

  Object.values(charts).forEach(chart => {
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
  
  dataset.data.push({ x: time, y: yVal })
  
  if (dataset.data.length > CHART.MAX_DATA_POINTS) {
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

const fetchCurrentStatus = async (incomingData) => {
  try {
    let data = incomingData
    if (!data) {
      data = await fetchServerDetail(serverId, apiIndex.value)
      if (!data) return
    }
    if (!data || !data.last_updated) return

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
    }

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
    if (charts.load) {
      const loads = parseLoadAvg(data.load_avg)
      const time = new Date(dataTimestamp).getTime()
      const endTime = Date.now()
      const startTime = endTime - currentHours.value * 60 * 60 * 1000

      charts.load.data.datasets[0].data.push({ x: time, y: loads[0] })
      charts.load.data.datasets[1].data.push({ x: time, y: loads[1] })
      charts.load.data.datasets[2].data.push({ x: time, y: loads[2] })

      if (charts.load.data.datasets[0].data.length > CHART.MAX_DATA_POINTS) {
        charts.load.data.datasets[0].data.shift()
        charts.load.data.datasets[1].data.shift()
        charts.load.data.datasets[2].data.shift()
      }

      charts.load.data.datasets[0].data = charts.load.data.datasets[0].data.filter(d => d.x >= startTime)
      charts.load.data.datasets[1].data = charts.load.data.datasets[1].data.filter(d => d.x >= startTime)
      charts.load.data.datasets[2].data = charts.load.data.datasets[2].data.filter(d => d.x >= startTime)

      if (charts.load.options && charts.load.options.scales && charts.load.options.scales.x) {
        charts.load.options.scales.x.min = startTime
        charts.load.options.scales.x.max = endTime
      }

      charts.load.update('none')
    }

    lastUpdateText.value = formatTimestamp(data.last_updated)
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
  router.push('/admin')
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
  await initChartsOnMount()

  fetchCurrentStatus()
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