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
          <span v-if="server.region && server.region !== 'xx'" class="country-os-icons">
            <img :src="getPublicAssetUrl('flags/' + getFlagRegionCode(server.region) + '.svg')" :alt="server.region" class="flag-img">
            <OsIcon :os="server.os" />
          </span>
          <span v-else class="country-os-icons">
            <span class="flag-fallback">🏳️</span>
            <OsIcon :os="server.os" />
          </span>
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
        <div class="sysinfo-item" v-if="server.kernel_version">
          <span class="sysinfo-label">🧩 {{ trans.kernelVersion || 'Kernel' }}</span>
          <span class="sysinfo-value sysinfo-small">{{ server.kernel_version }}</span>
        </div>
        <div class="sysinfo-item">
          <span class="sysinfo-label">🔧 {{ trans.cpuInfo }}</span>
          <span class="sysinfo-value sysinfo-small">{{ server.cpu_info || 'N/A' }} x {{ server.cpu_cores || 'N/A' }}</span>
        </div>
        <div class="sysinfo-item" v-if="hasGpuData">
          <span class="sysinfo-label">🎮 {{ trans.gpuInfo || 'GPU Info' }}</span>
          <span class="sysinfo-value sysinfo-small">{{ gpuInfoText }}</span>
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
            {{ formatBytes(trafficUsageBytes) }}
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
      <div class="chart-card" :class="{ 'full-width': isChartExpanded('cpu') }">
        <div class="chart-card-header">
          <span class="chart-title">
            <span class="chart-title-icon">▸</span>
            {{ trans.cpuUsage }}
          </span>
          <div class="chart-header-actions">
            <span class="chart-current-value">{{ cpuPercent }}%</span>
            <ChartExpandButton :expanded="isChartExpanded('cpu')" @toggle="toggleChartExpanded('cpu')" />
          </div>
        </div>
        <div class="chart-body">
          <canvas ref="cpuChartRef"></canvas>
        </div>
      </div>

      <div class="chart-card" :class="{ 'full-width': isChartExpanded('ram') }">
        <div class="chart-card-header">
          <span class="chart-title">
            <span class="chart-title-icon">▸</span>
            {{ trans.memoryUsage }}
          </span>
          <div class="chart-header-actions">
            <div class="chart-current-value-container">
              <span class="chart-current-value">{{ ramPercent }}%</span>
              <div class="chart-subtitle">{{ trans.swap }}: {{ server.swap_used || '0' }} / {{ server.swap_total || '0' }} MiB</div>
            </div>
            <ChartExpandButton :expanded="isChartExpanded('ram')" @toggle="toggleChartExpanded('ram')" />
          </div>
        </div>
        <div class="chart-body">
          <canvas ref="ramChartRef"></canvas>
        </div>
      </div>

      <div class="chart-card" :class="{ 'full-width': isChartExpanded('net') }">
        <div class="chart-card-header">
          <span class="chart-title">
            <span class="chart-title-icon">▸</span>
            {{ trans.networkTraffic }}
          </span>
          <div class="chart-header-actions">
            <div class="net-indicator">
              <span class="net-down">▼ {{ formatBytes(server.net_in_speed) }}/s</span>
              <span class="net-up">▲ {{ formatBytes(server.net_out_speed) }}/s</span>
            </div>
            <ChartExpandButton :expanded="isChartExpanded('net')" @toggle="toggleChartExpanded('net')" />
          </div>
        </div>
        <div class="chart-body">
          <canvas ref="netChartRef"></canvas>
        </div>
      </div>

      <div class="chart-card" :class="{ 'full-width': isChartExpanded('load') }">
        <div class="chart-card-header">
          <span class="chart-title">
            <span class="chart-title-icon">▸</span>
            {{ trans.loadAvgMonitor }}
          </span>
          <div class="chart-header-actions">
            <div class="load-avg-row">
              <span class="load-1m">{{ trans.load1m }} <b>{{ (parseLoadAvg(server.load_avg)[0] || 0).toFixed(2) }}</b></span>
              <span class="load-5m">{{ trans.load5m }} <b>{{ (parseLoadAvg(server.load_avg)[1] || 0).toFixed(2) }}</b></span>
              <span class="load-15m">{{ trans.load15m }} <b>{{ (parseLoadAvg(server.load_avg)[2] || 0).toFixed(2) }}</b></span>
            </div>
            <ChartExpandButton :expanded="isChartExpanded('load')" @toggle="toggleChartExpanded('load')" />
          </div>
        </div>
        <div class="chart-body">
          <canvas ref="loadChartRef"></canvas>
        </div>
      </div>

      <div class="chart-card" :class="{ 'full-width': isChartExpanded('disk') }">
        <div class="chart-card-header">
          <span class="chart-title">
            <span class="chart-title-icon">▸</span>
            {{ trans.diskUsage }}
          </span>
          <div class="chart-header-actions">
            <div class="chart-current-value-container">
              <span class="chart-current-value">{{ diskPercent }}%</span>
              <div class="chart-subtitle">{{ trans.used }} {{ formatBytes(server.disk_used*1024*1024) }} / {{ formatBytes(server.disk_total*1024*1024) }}</div>
            </div>
            <ChartExpandButton :expanded="isChartExpanded('disk')" @toggle="toggleChartExpanded('disk')" />
          </div>
        </div>
        <div class="chart-body">
          <canvas ref="diskChartRef"></canvas>
        </div>
      </div>

      <div class="chart-card" :class="{ 'full-width': isChartExpanded('diskIo') }" v-show="hasDiskIoData">
        <div class="chart-card-header disk-io-header">
          <span class="chart-title">
            <span class="chart-title-icon">▸</span>
            {{ trans.diskIo || 'Disk IO' }}
          </span>
          <div class="chart-header-actions">
            <div class="ping-indicator">
              <span class="net-down">R <b>{{ formatBytes(diskIo.read_bps) }}/s</b></span>
              <span class="net-up">W <b>{{ formatBytes(diskIo.write_bps) }}/s</b></span>
              <span class="conn-tcp">IOPS <b>{{ formatDiskIoNumber(diskIo.read_iops) }}/{{ formatDiskIoNumber(diskIo.write_iops) }}</b></span>
              <span class="conn-udp">await <b>{{ formatDiskIoNumber(diskIo.await_ms) }}ms</b></span>
              <span>util <b>{{ formatDiskIoNumber(diskIo.util) }}%</b></span>
            </div>
            <ChartExpandButton :expanded="isChartExpanded('diskIo')" @toggle="toggleChartExpanded('diskIo')" />
          </div>
        </div>
        <div class="chart-body">
          <canvas ref="diskIoChartRef"></canvas>
        </div>
      </div>

      <div class="chart-card" :class="{ 'full-width': isChartExpanded('gpu') }" v-show="hasGpuData">
        <div class="chart-card-header">
          <span class="chart-title">
            <span class="chart-title-icon">▸</span>
            {{ trans.gpuUsage || 'GPU Usage' }}
          </span>
          <div class="chart-header-actions">
            <span class="chart-current-value">{{ gpuPercentText }}</span>
            <ChartExpandButton :expanded="isChartExpanded('gpu')" @toggle="toggleChartExpanded('gpu')" />
          </div>
        </div>
        <div class="chart-body">
          <canvas ref="gpuChartRef"></canvas>
        </div>
      </div>

      <div class="chart-card" :class="{ 'full-width': isChartExpanded('proc') }">
        <div class="chart-card-header">
          <span class="chart-title">
            <span class="chart-title-icon">▸</span>
            {{ trans.processes }}
          </span>
          <div class="chart-header-actions">
            <span class="chart-current-value">{{ server.processes || '0' }}</span>
            <ChartExpandButton :expanded="isChartExpanded('proc')" @toggle="toggleChartExpanded('proc')" />
          </div>
        </div>
        <div class="chart-body">
          <canvas ref="procChartRef"></canvas>
        </div>
      </div>

      <div class="chart-card" :class="{ 'full-width': isChartExpanded('conn') }">
        <div class="chart-card-header">
          <span class="chart-title">
            <span class="chart-title-icon">▸</span>
            {{ trans.connections }}
          </span>
          <div class="chart-header-actions">
            <div class="net-indicator">
              <span class="conn-tcp">TCP <b>{{ server.tcp_conn || '0' }}</b></span>
              <span class="conn-udp">UDP <b>{{ server.udp_conn || '0' }}</b></span>
            </div>
            <ChartExpandButton :expanded="isChartExpanded('conn')" @toggle="toggleChartExpanded('conn')" />
          </div>
        </div>
        <div class="chart-body">
          <canvas ref="connChartRef"></canvas>
        </div>
      </div>

      <div class="chart-card" :class="{ 'full-width': isChartExpanded('ping') }" v-show="hasPingData">
        <div class="chart-card-header">
          <span class="chart-title">
            <span class="chart-title-icon">▸</span>
            {{ trans.latencyMonitor }}
          </span>
          <div class="chart-header-actions">
            <div class="ping-indicator">
              <span v-for="item in visiblePingStats" :key="item.field" :class="item.className">
                {{ item.label }} <b>{{ item.value !== null ? item.value + 'ms' : 'Timeout' }}</b>
              </span>
            </div>
            <ChartExpandButton :expanded="isChartExpanded('ping')" @toggle="toggleChartExpanded('ping')" />
          </div>
        </div>
        <div class="chart-body">
          <canvas ref="pingChartRef"></canvas>
        </div>
      </div>

      <div class="chart-card" :class="{ 'full-width': isChartExpanded('loss') }" v-show="hasLossData">
        <div class="chart-card-header">
          <span class="chart-title">
            <span class="chart-title-icon">▸</span>
            {{ trans.packetLoss || 'Packet Loss' }}
          </span>
          <div class="chart-header-actions">
            <div class="ping-indicator">
              <span v-if="avgLossCt !== null" class="ping-ct">{{ trans.pingCt }} <b>{{ avgLossCt }}%</b></span>
              <span v-if="avgLossCu !== null" class="ping-cu">{{ trans.pingCu }} <b>{{ avgLossCu }}%</b></span>
              <span v-if="avgLossCm !== null" class="ping-cm">{{ trans.pingCm }} <b>{{ avgLossCm }}%</b></span>
              <span v-if="avgLossBd !== null" class="ping-bd">{{ trans.pingBd }} <b>{{ avgLossBd }}%</b></span>
            </div>
            <ChartExpandButton :expanded="isChartExpanded('loss')" @toggle="toggleChartExpanded('loss')" />
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

    <LiveConnectionTimeoutModal
      :show="showLiveTimeoutModal"
      :trans="trans"
      @close="closeLiveConnection"
      @continue="continueLiveConnection"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch, nextTick, h } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import TerminalHeader from '../components/TerminalHeader.vue'
import Footer from '../components/Footer.vue'
import OsIcon from '../components/OsIcon.vue'
import LiveConnectionTimeoutModal from '../components/LiveConnectionTimeoutModal.vue'
import { fetchServerDetail, fetchAllHistory, fetchConfig, formatBytes, isAdminLoggedIn, createLiveSocket, getFlagRegionCode, isServerOnline, normalizeLiveSocketTimeoutMinutes } from '../utils/api.js'
import { getTrafficUsageBytes } from '../composables/useServerCardData'
import { getPublicAssetUrl } from '../utils/config.js'
import Chart from 'chart.js/auto'
import 'chartjs-adapter-date-fns'
import { t, currentLang, useTranslation } from '../utils/i18n'
import { CHART, HISTORY } from '../utils/constants'
import { formatDateTime, normalizeTimestamp as normalizeMetricTimestamp } from '../utils/time.js'
import useTheme from '../composables/useTheme'
import { isDisabledProbeMetric } from '../utils/server.js'
import { resolvePlaybackCursor } from '../utils/playback.js'
import { applyMikusThemeOptions } from '../utils/themeOptions.js'

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
const REALTIME_HISTORY_HOURS = 0.167
const LATEST_REPORT_MAX_REPLAY_DELAY = 120000
const currentHours = ref(REALTIME_HISTORY_HOURS)
const lastUpdateText = ref('')
const config = ref(null)
const showLoginModal = ref(false)
const showLiveTimeoutModal = ref(false)
const frontendWsTimeoutMinutes = ref(0)
const loading = ref(true)

const trans = useTranslation()

const ChartExpandButton = {
  props: {
    expanded: { type: Boolean, default: false }
  },
  emits: ['toggle'],
  setup(props, { emit }) {
    const getLabel = () => props.expanded
      ? (currentLang.value === 'en' ? 'Collapse chart' : '收起图表')
      : (currentLang.value === 'en' ? 'Expand chart' : '放大图表')

    return () => h('button', {
      type: 'button',
      class: ['chart-expand-btn', { active: props.expanded }],
      title: getLabel(),
      'aria-label': getLabel(),
      'aria-pressed': props.expanded ? 'true' : 'false',
      onClick: () => emit('toggle')
    }, [
      h('svg', {
        viewBox: '0 0 24 24',
        width: '16',
        height: '16',
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': '2',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        'aria-hidden': 'true'
      }, props.expanded
        ? [
            h('polyline', { points: '4 14 10 14 10 20' }),
            h('polyline', { points: '20 10 14 10 14 4' })
          ]
        : [
            h('polyline', { points: '15 3 21 3 21 9' }),
            h('polyline', { points: '9 21 3 21 3 15' }),
            h('line', { x1: '21', y1: '3', x2: '14', y2: '10' }),
            h('line', { x1: '3', y1: '21', x2: '10', y2: '14' })
          ])
    ])
  }
}

const PING_FIELD_DEFS = [
  { field: 'ping_ct', lossField: 'loss_ct', labelKey: 'pingCt', className: 'ping-ct', datasetIndex: 0 },
  { field: 'ping_cu', lossField: 'loss_cu', labelKey: 'pingCu', className: 'ping-cu', datasetIndex: 1 },
  { field: 'ping_cm', lossField: 'loss_cm', labelKey: 'pingCm', className: 'ping-cm', datasetIndex: 2 },
  { field: 'ping_bd', lossField: 'loss_bd', labelKey: 'pingBd', className: 'ping-bd', datasetIndex: 3 }
]

const DISK_IO_FIELDS = ['read_bps', 'write_bps', 'read_iops', 'write_iops', 'await_ms', 'util']
const EMPTY_DISK_IO = Object.freeze(Object.fromEntries(DISK_IO_FIELDS.map(field => [field, 0])))
const hasOwn = (source, key) => Object.prototype.hasOwnProperty.call(source, key)
const isPlainObject = (value) => value && typeof value === 'object' && !Array.isArray(value)
const parseDiskIoValue = (value) => {
  if (value === null || value === undefined || value === '') return null
  const number = Number.parseFloat(value)
  return Number.isFinite(number) ? number : null
}

const isValidDiskIoObject = (disk) => {
  if (!isPlainObject(disk)) return false
  return DISK_IO_FIELDS.some(field => hasOwn(disk, field) && parseDiskIoValue(disk[field]) !== null)
}

const hasValidDiskIoPayload = (source) => {
  if (!isPlainObject(source)) return false
  return isValidDiskIoObject(source.disk)
}

const isDiskIoField = (key) => key === 'disk'

const getDiskIoNumber = (source, field) => {
  if (!source || typeof source !== 'object' || !isValidDiskIoObject(source.disk)) return 0
  const raw = hasOwn(source.disk, field) ? source.disk[field] : null
  return parseDiskIoValue(raw) ?? 0
}

const normalizeDiskIo = (source) => Object.fromEntries(
  DISK_IO_FIELDS.map(field => [field, getDiskIoNumber(source, field)])
)

const diskIoAccessor = (field) => (row) => getDiskIoNumber(row, field)
const formatDiskIoNumber = (value) => {
  const number = Number.parseFloat(value)
  return Number.isFinite(number) ? number.toFixed(1) : '0.0'
}
const formatDiskIoAxisTick = (value) => {
  const number = Number.parseFloat(value)
  if (!Number.isFinite(number)) return '0'
  const abs = Math.abs(number)
  if (abs >= 10000) return `${(number / 1000).toFixed(0)}k`
  if (abs >= 1000) return `${(number / 1000).toFixed(1)}k`
  if (abs >= 100) return number.toFixed(0)
  return number.toFixed(1)
}

const timeOptions = computed(() => {
  return [
    { hours: REALTIME_HISTORY_HOURS, label: '10m' },
    { hours: 0.5, label: '30m' },
    { hours: 1, label: '1h' },
    { hours: 6, label: '6h' },
    { hours: 12, label: '12h' },
    { hours: 24, label: '24h' },
    { hours: 48, label: '2d' },
    { hours: 96, label: '4d' },
    { hours: 168, label: '7d' },
  ]
})

const isOnline = computed(() => isServerOnline(server.value))

const cpuPercent = computed(() => (parseFloat(server.value.cpu) || 0).toFixed(1))

const parseGpuInfo = (raw) => {
  if (!raw) return []
  if (Array.isArray(raw)) return raw
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed : []
    } catch { return [] }
  }
  return []
}

const gpuInfoList = computed(() => parseGpuInfo(server.value.gpu_info))

const gpuInfoText = computed(() => {
  const list = gpuInfoList.value
  if (list.length === 0) return server.value.gpu_info || 'N/A'
  return list.map(g => g.name || g.id || 'GPU').join(' / ')
})

const gpuPercentText = computed(() => {
  const list = gpuInfoList.value
  if (list.length === 0) return '0.0%'
  const formatUtil = (info) => {
    if (info === null || info === undefined) return 'N/A'
    const v = parseFloat(info)
    return Number.isNaN(v) ? 'N/A' : `${v.toFixed(1)}%`
  }
  if (list.length === 1) return formatUtil(list[0].info)
  return list.map(g => formatUtil(g.info)).join(' / ')
})

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
const diskIo = computed(() => hasValidDiskIoPayload(server.value) ? normalizeDiskIo(server.value) : EMPTY_DISK_IO)
const hasGpuData = computed(() => gpuInfoList.value.length > 0)

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
const diskIoChartRef = ref(null)
const netChartRef = ref(null)
const procChartRef = ref(null)
const connChartRef = ref(null)
const pingChartRef = ref(null)
const lossChartRef = ref(null)
const loadChartRef = ref(null)
const historyLoaded = ref(false)
const hasDiskIoData = ref(false)

const charts = {}
const chartsReady = ref(false)
const expandedCharts = ref({})
const lossHistoryFields = ref({})
const avgPingCt = ref(null)
const avgPingCu = ref(null)
const avgPingCm = ref(null)
const avgPingBd = ref(null)
const avgLossCt = ref(null)
const avgLossCu = ref(null)
const avgLossCm = ref(null)
const avgLossBd = ref(null)
let isInitializingCharts = false
let databaseUpgradeAlertShown = false

const isChartExpanded = (key) => !!expandedCharts.value[key]

const resizeChartAfterLayout = (key) => {
  nextTick(() => {
    requestAnimationFrame(() => {
      const chart = charts[key]
      if (!chart) return
      if (typeof chart.resize === 'function') chart.resize()
      chart.update('none')
    })
  })
}

const toggleChartExpanded = (key) => {
  expandedCharts.value = {
    ...expandedCharts.value,
    [key]: !expandedCharts.value[key]
  }
  resizeChartAfterLayout(key)
}

const showDiskIoChart = () => {
  if (hasDiskIoData.value) return
  hasDiskIoData.value = true
  nextTick(() => {
    if (!charts.diskIo) return
    if (typeof charts.diskIo.resize === 'function') charts.diskIo.resize()
    charts.diskIo.update('none')
  })
}

const markDiskIoDataAvailable = (source) => {
  const hasReadableData = hasValidDiskIoPayload(source)
  if (hasReadableData) showDiskIoChart()
  return hasReadableData
}

const avgPingRefs = {
  ping_ct: avgPingCt,
  ping_cu: avgPingCu,
  ping_cm: avgPingCm,
  ping_bd: avgPingBd
}

const visiblePingFields = computed(() => PING_FIELD_DEFS.filter(item => !isDisabledProbeMetric(server.value[item.field])))
const hasPingData = computed(() => visiblePingFields.value.length > 0)
const visiblePingStats = computed(() => visiblePingFields.value.map(item => ({
  ...item,
  label: trans.value[item.labelKey],
  value: avgPingRefs[item.field].value
})))

const trafficUsageBytes = computed(() => getTrafficUsageBytes(server.value))

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

const isLossValid = (value) => !isDisabledProbeMetric(value) && value !== null && value !== undefined && value !== '' && !Number.isNaN(parseFloat(value))
const formatLoss = (value) => isLossValid(value) ? `${Math.max(0, Math.min(100, parseFloat(value))).toFixed(0)}%` : ''
const hasLossData = computed(() => visiblePingFields.value.some(item => lossHistoryFields.value[item.lossField] || isLossValid(server.value[item.lossField])))
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

const getChartTimestamp = (point) => {
  const ts = Number(point?.x ?? point)
  return Number.isFinite(ts) ? ts : 0
}

const createChartPoint = (timestamp, y) => ({
  x: String(timestamp),
  y
})

const formatChartAxisTime = (value) => {
  const ts = Number(value)
  if (!Number.isFinite(ts)) return String(value || '')
  const date = new Date(ts)
  const pad = (num) => String(num).padStart(2, '0')
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  if (currentHours.value <= 1) return `${time}:${pad(date.getSeconds())}`
  if (currentHours.value <= 3) return time
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${time}`
}

const syncChartLabels = (chart) => {
  if (!chart) return
  const seen = new Set()
  const labels = []
  for (const dataset of chart.data.datasets || []) {
    for (const point of dataset.data || []) {
      const ts = getChartTimestamp(point)
      if (!ts) continue
      const label = String(ts)
      if (!seen.has(label)) {
        seen.add(label)
        labels.push(label)
      }
    }
  }
  labels.sort((a, b) => Number(a) - Number(b))
  chart.data.labels = labels
}

const ds = (label, color, opts = {}) => ({
  label, data: [], borderColor: color,
  backgroundColor: opts.fill ? hexToRgba(color, 0.05) : 'transparent',
  fill: !!opts.fill, tension: opts.tension ?? 0.4, borderWidth: 1.5,
  pointRadius: 0, hoverRadius: 5, spanGaps: false, ...opts
})

const GPU_COLORS = ['#ff7b72', '#79c0ff', '#d2a8ff', '#7ee787', '#ffa657', '#ff7b72', '#56d4dd', '#e3b341']

const CHART_DEFS = [
  { key: 'cpu', ref: () => cpuChartRef.value, datasets: [ds('CPU', '#00d4aa', { fill: true })], unit: '%' },
  { key: 'gpu', ref: () => gpuChartRef.value, datasets: [], unit: '%', legend: true },
  { key: 'ram', ref: () => ramChartRef.value, datasets: [ds('Memory', '#b392f0', { fill: true }), ds('Swap', '#ffb870', { fill: true })], unit: '%', legend: true },
  { key: 'disk', ref: () => diskChartRef.value, datasets: [ds('Disk', '#39d2c0', { fill: true })], unit: '%' },
  {
    key: 'diskIo',
    ref: () => diskIoChartRef.value,
    datasets: [
      ds('Read', '#00d4aa', { fill: true, yAxisID: 'y', formatValue: (v) => formatBytes(v) + '/s' }),
      ds('Write', '#ffb870', { fill: true, yAxisID: 'y', formatValue: (v) => formatBytes(v) + '/s' }),
      ds('Read IOPS', '#4da6ff', { yAxisID: 'y1', borderDash: [5, 4], formatValue: (v) => `${formatDiskIoNumber(v)} ops/s` }),
      ds('Write IOPS', '#b392f0', { yAxisID: 'y1', borderDash: [5, 4], formatValue: (v) => `${formatDiskIoNumber(v)} ops/s` }),
      ds('await', '#f778ba', { yAxisID: 'y1', borderDash: [2, 4], formatValue: (v) => `${formatDiskIoNumber(v)} ms` }),
      ds('util', '#ff7b72', { yAxisID: 'y1', borderDash: [8, 4], formatValue: (v) => `${formatDiskIoNumber(v)}%` })
    ],
    legend: true,
    tickFormat: (v) => formatBytes(v),
    extraScales: (chartTheme) => ({
      y1: {
        beginAtZero: true,
        position: 'right',
        grid: { color: chartTheme.grid, drawBorder: false, drawOnChartArea: false, tickLength: 0 },
        ticks: {
          color: chartTheme.axis,
          font: { size: 9, family: "'JetBrains Mono', monospace" },
          padding: 8,
          callback: formatDiskIoAxisTick
        }
      }
    })
  },
  { key: 'proc', ref: () => procChartRef.value, datasets: [ds('Processes', '#f778ba', { fill: true })] },
  { key: 'net', ref: () => netChartRef.value, datasets: [ds('Download', '#00d4aa', { fill: true }), ds('Upload', '#4da6ff', { fill: true })], legend: true, formatValue: (v) => formatBytes(v) + '/s', tickFormat: (v) => formatBytes(v) },
  { key: 'conn', ref: () => connChartRef.value, datasets: [ds('TCP', '#b392f0'), ds('UDP', '#f778ba')], legend: true },
  { key: 'ping', ref: () => pingChartRef.value, datasets: [ds('CT', '#00d4aa', { tension: 0.3 }), ds('CU', '#ffb870', { tension: 0.3 }), ds('CM', '#4da6ff', { tension: 0.3 }), ds('BGP', '#b392f0', { tension: 0.3 })], unit: ' ms', legend: true },
  { key: 'loss', ref: () => lossChartRef.value, datasets: [ds('CT', '#00d4aa', { tension: 0.3 }), ds('CU', '#ffb870', { tension: 0.3 }), ds('CM', '#4da6ff', { tension: 0.3 }), ds('BGP', '#b392f0', { tension: 0.3 })], unit: '%', legend: true },
  { key: 'load', ref: () => loadChartRef.value, datasets: [ds(trans.value.load1m || '1 Min', '#00d4aa', { tension: 0.3 }), ds(trans.value.load5m || '5 Min', '#ffb870', { tension: 0.3 }), ds(trans.value.load15m || '15 Min', '#4da6ff', { tension: 0.3 })], legend: true }
]

const syncProbeChartVisibility = () => {
  for (const chartKey of ['ping', 'loss']) {
    const chart = charts[chartKey]
    if (!chart) continue

    for (const item of PING_FIELD_DEFS) {
      const dataset = chart.data.datasets[item.datasetIndex]
      if (!dataset) continue
      const disabled = isDisabledProbeMetric(server.value[item.field])
      dataset.disabledProbe = disabled
      // Only force hide if disabled by config; otherwise preserve user's legend toggle
      if (disabled) {
        dataset.hidden = true
        if (typeof chart.setDatasetVisibility === 'function') {
          chart.setDatasetVisibility(item.datasetIndex, false)
        }
      }
    }
    chart.update('none')
  }
}

let lastGpuSignature = ''

const rebuildGpuChartDatasets = () => {
  const chart = charts.gpu
  if (!chart) return
  const list = gpuInfoList.value
  const signature = list.map(g => String(g.id ?? '')).join(',')
  if (signature === lastGpuSignature) return
  lastGpuSignature = signature

  const newDatasets = list.map((g, i) => {
    const dataset = ds(g.name || `GPU ${i}`, GPU_COLORS[i % GPU_COLORS.length], { fill: true })
    dataset.gpuId = String(g.id ?? i)
    return dataset
  })
  if (newDatasets.length === 0) {
    newDatasets.push(ds('GPU', '#ff7b72', { fill: true }))
  }
  chart.data.datasets = newDatasets
  chart.update('none')
}

const getCssVar = (name, fallback) => {
  if (typeof window === 'undefined') return fallback
  const value = window.getComputedStyle(document.body).getPropertyValue(name).trim()
  return value || fallback
}

const isLightBodyTheme = () => typeof document !== 'undefined' && document.body.classList.contains('light')

const getChartThemeColors = () => ({
  axis: getCssVar('--text-muted', isLightBodyTheme() ? 'rgba(10, 14, 20, 0.8)' : 'rgba(211, 218, 227, 0.8)'),
  grid: getCssVar('--border-color', 'rgba(30, 42, 58, 0.5)'),
  tooltipBg: getCssVar('--bg-primary', 'rgba(10, 14, 20, 0.95)'),
  tooltipTitle: getCssVar('--accent-green', '#00d4aa'),
  tooltipBody: getCssVar('--text-primary', '#d3dae3'),
  tooltipBorder: getCssVar('--border-color', '#1e2a3a')
})

const initCharts = () => {
  safeDestroyCharts()

  const chartTheme = getChartThemeColors()

  Chart.defaults.font.family = "'JetBrains Mono', 'Courier New', monospace"
  Chart.defaults.font.size = 10
  Chart.defaults.color = chartTheme.axis
  Chart.defaults.plugins.tooltip.backgroundColor = chartTheme.tooltipBg
  Chart.defaults.plugins.tooltip.titleColor = chartTheme.tooltipTitle
  Chart.defaults.plugins.tooltip.bodyColor = chartTheme.tooltipBody
  Chart.defaults.plugins.tooltip.borderColor = chartTheme.tooltipBorder
  Chart.defaults.plugins.tooltip.borderWidth = 1
  Chart.defaults.plugins.tooltip.titleFont = { size: 12, weight: 'bold', family: "'JetBrains Mono', monospace" }
  Chart.defaults.plugins.tooltip.bodyFont = { size: 11, family: "'JetBrains Mono', monospace" }
  Chart.defaults.plugins.tooltip.padding = 12
  Chart.defaults.plugins.tooltip.cornerRadius = 2

  const createChartOptions = (unit = '', showLegend = false, formatCallback = null, tickFormat = null, extraScales = null) => {
    const resolvedExtraScales = typeof extraScales === 'function'
      ? extraScales(chartTheme)
      : (extraScales || {})

    return {
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
            color: chartTheme.axis,
            filter: (legendItem, chartData) => !chartData.datasets[legendItem.datasetIndex]?.disabledProbe
          }
        },
        tooltip: {
          callbacks: {
            title: function(items) {
              if (items.length > 0 && items[0].raw) {
                const label = items[0].raw.x ?? items[0].chart?.data?.labels?.[items[0].dataIndex]
                const date = new Date(Number(label))
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
              const datasetFormatter = context.dataset.formatValue
              if (value === null || value === undefined) {
                label += trans.value.timeout
              } else if (typeof datasetFormatter === 'function') {
                label += datasetFormatter(value)
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
          type: 'category',
          title: {
            display: false,
            text: '',
            color: chartTheme.axis,
            font: { size: 10, family: "'JetBrains Mono', monospace" }
          },
          ticks: {
            maxTicksLimit: CHART.MAX_TICKS,
            color: chartTheme.axis,
            font: { size: 9, family: "'JetBrains Mono', monospace" },
            maxRotation: 0,
            padding: 8,
            callback: function(value) {
              return formatChartAxisTime(this.getLabelForValue(value))
            }
          },
          grid: { color: chartTheme.grid, drawBorder: false, tickLength: 0 }
        },
        y: {
          beginAtZero: true,
          grid: { color: chartTheme.grid, drawBorder: false, tickLength: 0 },
          ticks: {
            color: chartTheme.axis,
            font: { size: 9, family: "'JetBrains Mono', monospace" },
            padding: 8,
            callback: tickFormat || function(value) { return value + unit; }
          }
        },
        ...resolvedExtraScales
      },
      elements: {
        point: { radius: 0, hoverRadius: 5, hitRadius: 10, borderWidth: 0, hoverBorderWidth: 2, hoverBorderColor: '#fff' },
        line: { tension: 0.4, borderWidth: 1.5, fill: false, spanGaps: false }
      }
    }
  }

  for (const def of CHART_DEFS) {
    const ref = def.ref()
    if (!ref) continue
    charts[def.key] = new Chart(ref.getContext('2d'), {
      type: 'line',
      data: { labels: [], datasets: def.datasets.map(d => ({ ...d })) },
      options: createChartOptions(def.unit || '', def.legend, def.formatValue, def.tickFormat, def.extraScales)
    })
  }

  rebuildGpuChartDatasets()
  syncProbeChartVisibility()
}

const updateChartsTheme = () => {
  const chartTheme = getChartThemeColors()

  Chart.defaults.color = chartTheme.axis
  Chart.defaults.plugins.tooltip.backgroundColor = chartTheme.tooltipBg
  Chart.defaults.plugins.tooltip.titleColor = chartTheme.tooltipTitle
  Chart.defaults.plugins.tooltip.bodyColor = chartTheme.tooltipBody
  Chart.defaults.plugins.tooltip.borderColor = chartTheme.tooltipBorder

  Object.values(charts).forEach(chart => {
    if (!chart) return

    if (chart.options.plugins.legend.labels) {
      chart.options.plugins.legend.labels.color = chartTheme.axis
    }

    for (const scale of Object.values(chart.options.scales || {})) {
      if (scale.title) {
        scale.title.color = chartTheme.axis
      }
      if (scale.ticks) {
        scale.ticks.color = chartTheme.axis
      }
      if (scale.grid) {
        scale.grid.color = chartTheme.grid
      }
    }

    chart.update('none')
  })
}

const { onThemeChange } = useTheme()
onThemeChange(updateChartsTheme)

// ≤1h: gap超过5分钟断线; >1h: 按后端采样点数计算，最低5分钟基础阈值
const getHistoryGapBreakMs = (hours = currentHours.value) => {
  if (hours <= 1) return 5 * 60 * 1000
  const configuredPoints = Number(config.value?.long_history_points)
  const samplePoints = HISTORY.LONG_RANGE_POINT_OPTIONS.includes(configuredPoints)
    ? configuredPoints
    : HISTORY.DEFAULT_LONG_RANGE_POINTS
  return Math.max(5 * 60 * 1000, Math.ceil(hours * 60 * 60 * 1000 / samplePoints))
}

const shouldBreakGap = (prevPoint, nextPoint) => {
  if (!prevPoint || !nextPoint) return false
  const prevTime = Number(prevPoint.x)
  const nextTime = Number(nextPoint.x)
  if (!Number.isFinite(prevTime) || !Number.isFinite(nextTime)) return false
  const gap = nextTime - prevTime
  const breakThreshold = getHistoryGapBreakMs()
  if (currentHours.value <= 1) return gap > breakThreshold
  return gap > breakThreshold * 1.1
}

const applyGapBreak = (data) => {
  if (!data || data.length < 2) return data
  
  const result = []
  for (let i = 0; i < data.length; i++) {
    result.push(data[i])
    if (i < data.length - 1) {
      if (shouldBreakGap(data[i], data[i + 1])) {
        const currentTime = getChartTimestamp(data[i])
        const nextTime = getChartTimestamp(data[i + 1])
        const gap = nextTime - currentTime
        result.push(createChartPoint(currentTime + gap / 2, null))
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
    const lastTime = getChartTimestamp(lastPoint)
    const pointTime = getChartTimestamp(point)
    data.push(createChartPoint(lastTime + (pointTime - lastTime) / 2, null))
  }
  data.push(point)
  return data
}

const getLastDatasetTimestamp = (data) => {
  if (!Array.isArray(data)) return 0
  for (let i = data.length - 1; i >= 0; i--) {
    const x = getChartTimestamp(data[i])
    if (Number.isFinite(x)) return x
  }
  return 0
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

  let processedData = []
  if (dataPoints && dataPoints.length > 0) {
    const sampledData = sampleData(dataPoints)

    processedData = sampledData.map(d => {
      return createChartPoint(new Date(d.timestamp).getTime(), yAccessor(d))
    })

    processedData.sort((a, b) => getChartTimestamp(a) - getChartTimestamp(b))
    processedData = applyGapBreak(processedData)
  }

  dataset.data = processedData
  syncChartLabels(chart)
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

  const load1Data = processedData.map(d => createChartPoint(d.x, d.load1))
  const load5Data = processedData.map(d => createChartPoint(d.x, d.load5))
  const load15Data = processedData.map(d => createChartPoint(d.x, d.load15))
  
  chart.data.datasets[0].data = applyGapBreak(load1Data)
  chart.data.datasets[1].data = applyGapBreak(load5Data)
  chart.data.datasets[2].data = applyGapBreak(load15Data)
  syncChartLabels(chart)
  chart.update('none')
}

const clearDiskIoChart = () => {
  const chart = charts.diskIo
  if (!chart) return
  for (const dataset of chart.data.datasets || []) {
    dataset.data = []
  }
  chart.data.labels = []
  chart.update('none')
}

const loadAllHistory = async (hours) => {
  try {
    const allData = await fetchAllHistory(serverId, hours, apiIndex.value)
    lossHistoryFields.value = Object.fromEntries(PING_FIELD_DEFS.map(item => [
      item.lossField,
      allData.some(row => isLossValid(row[item.lossField]))
    ]))

    if (allData.length > 0) {
      updateChartDataset(charts.cpu, 0, allData, fieldAccessor('cpu', true))
      rebuildGpuChartDatasets()
      for (let i = 0; i < charts.gpu.data.datasets.length; i++) {
        const dataset = charts.gpu.data.datasets[i]
        const gpuId = dataset.gpuId
        const accessor = gpuId
          ? (d) => {
              const list = parseGpuInfo(d.gpu_info)
              const found = list.find(g => String(g.id) === String(gpuId))
              if (!found) return null
              const val = parseFloat(found.info)
              return Number.isNaN(val) ? null : val
            }
          : () => null
        updateChartDataset(charts.gpu, i, allData, accessor)
      }
      updateChartDataset(charts.ram, 0, allData, percentAccessor('ram_used', 'ram_total'))
      updateChartDataset(charts.ram, 1, allData, percentAccessor('swap_used', 'swap_total'))
      updateChartDataset(charts.disk, 0, allData, percentAccessor('disk_used', 'disk_total'))
      const diskIoRows = allData.filter(hasValidDiskIoPayload)
      if (diskIoRows.length > 0) {
        markDiskIoDataAvailable(diskIoRows[0])
        DISK_IO_FIELDS.forEach((field, index) => {
          updateChartDataset(charts.diskIo, index, diskIoRows, diskIoAccessor(field))
        })
      } else {
        clearDiskIoChart()
        hasDiskIoData.value = false
        if (hasValidDiskIoPayload(server.value) && server.value.last_updated) {
          appendDiskIoChart(server.value, new Date(server.value.last_updated).getTime())
        }
      }
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

      const avg = (arr, field, skipZero = true) => {
        const vals = arr.map(d => parseFloat(d[field])).filter(v => !isNaN(v) && (skipZero ? v !== 0 : true))
        return vals.length ? Math.round(vals.reduce((s, v) => s + v, 0) / vals.length) : null
      }
      avgPingCt.value = avg(allData, 'ping_ct')
      avgPingCu.value = avg(allData, 'ping_cu')
      avgPingCm.value = avg(allData, 'ping_cm')
      avgPingBd.value = avg(allData, 'ping_bd')
      avgLossCt.value = avg(allData, 'loss_ct', false)
      avgLossCu.value = avg(allData, 'loss_cu', false)
      avgLossCm.value = avg(allData, 'loss_cm', false)
      avgLossBd.value = avg(allData, 'loss_bd', false)
      syncProbeChartVisibility()
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
    if (e && e.status === 401) {
      showLoginModal.value = true
      currentHours.value = REALTIME_HISTORY_HOURS
      historyLoaded.value = true
      return
    }

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
  const maxTicks = hours <= 3 ? CHART.MAX_TICKS : CHART.MAX_TICKS_HOUR

  Object.values(charts).forEach(chart => {
    if (chart?.options?.scales?.x) {
      chart.options.scales.x.ticks.maxTicksLimit = maxTicks
      delete chart.options.scales.x.min
      delete chart.options.scales.x.max
    }
    if (chart) {
      syncChartLabels(chart)
      chart.update('none')
    }
  })
}

const appendDataToChart = (chart, datasetIndex, timestamp, value, isPing = false, emptyAsNull = false) => {
  if (!chart) return
  
  const dataset = chart.data.datasets[datasetIndex]
  if (!dataset) return
  
  const time = new Date(timestamp).getTime()
  const lastTime = getLastDatasetTimestamp(dataset.data)
  if (lastTime && time <= lastTime) return

  const startTime = Date.now() - currentHours.value * 60 * 60 * 1000

  let yVal
  if (isPing) {
    const val = parseFloat(value)
    yVal = (val > 0) ? val : null
  } else if (emptyAsNull && !isLossValid(value)) {
    yVal = null
  } else {
    yVal = parseFloat(value) || 0
  }
  
  dataset.data = appendPointWithGapBreak(dataset.data, createChartPoint(time, yVal))
  
  while (dataset.data.length > CHART.MAX_DATA_POINTS) {
    dataset.data.shift()
  }
  
  dataset.data = dataset.data.filter(d => getChartTimestamp(d) >= startTime)
  syncChartLabels(chart)
  
  chart.update('none')
}

const STATIC_FIELDS = ['id', 'name', 'region', 'arch', 'os', 'kernel_version', 'cpu_info', 'cpu_cores', 'gpu_info', 'expire_date', 'server_group', 'traffic_limit', 'net_rx_monthly', 'net_tx_monthly', 'boot_time', 'timestamp', 'ip_v4', 'ip_v6']
const REALTIME_SAMPLE_FIELDS = new Set([
  'cpu', 'ram_total', 'ram_used', 'swap_total', 'swap_used',
  'net_in_speed', 'net_out_speed', 'disk'
])
const TIMING_FIELDS = new Set(['last_updated', 'sample_timestamp'])

const appendLoadChartData = (timestamp, loadAvg) => {
  const chart = charts.load
  if (!chart) return

  const loads = parseLoadAvg(loadAvg)
  const time = new Date(timestamp).getTime()
  const lastTime = getLastDatasetTimestamp(chart.data.datasets[0]?.data)
  if (lastTime && time <= lastTime) return

  const startTime = Date.now() - currentHours.value * 60 * 60 * 1000

  for (let i = 0; i < 3; i++) {
    chart.data.datasets[i].data = appendPointWithGapBreak(chart.data.datasets[i].data, createChartPoint(time, loads[i]))
    while (chart.data.datasets[i].data.length > CHART.MAX_DATA_POINTS) {
      chart.data.datasets[i].data.shift()
    }
    chart.data.datasets[i].data = chart.data.datasets[i].data.filter(d => getChartTimestamp(d) >= startTime)
  }

  syncChartLabels(chart)
  chart.update('none')
}

const isRealtimeHistoryRange = () => Math.abs(Number(currentHours.value) - REALTIME_HISTORY_HOURS) < 0.001

let latestReportReplayTimers = new Set()

const clearLatestReportReplayTimers = () => {
  latestReportReplayTimers.forEach(timer => clearTimeout(timer))
  latestReportReplayTimers.clear()
}

const getReplaySampleData = (sample) => {
  if (!sample || typeof sample !== 'object') return null
  return sample.data || sample.payload || sample.metrics || null
}

const buildLiveStatusData = (event) => {
  const receiveTs = Date.now()
  return {
    ...event.data,
    sample_timestamp: event.ts,
    last_updated: receiveTs,
    timestamp: receiveTs
  }
}

const scheduleLatestReportReplay = (event, delay) => {
  const timer = setTimeout(() => {
    latestReportReplayTimers.delete(timer)
    fetchCurrentStatus(buildLiveStatusData(event), {
      mergeMode: 'sample',
      chartMode: 'sample'
    })
  }, delay)
  latestReportReplayTimers.add(timer)
}

const toReplayEvents = (update, messageTs = Date.now()) => {
  if (!update || String(update.serverId) !== String(serverId)) return []
  const samples = Array.isArray(update.samples) ? update.samples : []
  return samples
    .map(sample => {
      const data = getReplaySampleData(sample)
      if (!data) return null
      const ts = normalizeMetricTimestamp(
        sample.ts ?? sample.timestamp ?? data.sample_timestamp ?? data.last_updated ?? data.timestamp ?? update.ts ?? messageTs,
        null
      )
      return ts ? { ts, data } : null
    })
    .filter(Boolean)
    .sort((a, b) => a.ts - b.ts)
}

const replayReportUpdate = (update, { messageTs = Date.now(), replayCachedReport = false, includeReportUpdate = true } = {}) => {
  const events = toReplayEvents(update, messageTs)
  if (events.length === 0) return

  const shouldReplaySamples = isRealtimeHistoryRange()
  if (includeReportUpdate) {
    const latestEvent = events[events.length - 1]
    fetchCurrentStatus(buildLiveStatusData(latestEvent), {
      mergeMode: shouldReplaySamples ? 'report' : 'all',
      chartMode: 'report'
    })
  }
  if (!shouldReplaySamples) return

  const reportTs = normalizeMetricTimestamp(update.reportTs ?? update.report_timestamp, messageTs)
  const reportAge = Number(update.reportAgeMs)
  const reportAgeMs = Math.max(0, Number.isFinite(reportAge)
    ? reportAge
    : (reportTs ? Date.now() - reportTs : 0))
  const playbackStartTs = replayCachedReport
    ? resolvePlaybackCursor(events[0].ts, null, { replayCachedReport: true, reportAgeMs })
    : events[0].ts
  if (playbackStartTs === null) return

  let immediateEvent = null
  const futureEvents = []
  for (const event of events) {
    if (event.ts <= playbackStartTs) {
      immediateEvent = event
    } else {
      futureEvents.push(event)
    }
  }

  if (immediateEvent) {
    scheduleLatestReportReplay(immediateEvent, 0)
  }

  for (const event of futureEvents) {
    const delay = Math.max(0, Math.min(event.ts - playbackStartTs, LATEST_REPORT_MAX_REPLAY_DELAY))
    scheduleLatestReportReplay(event, delay)
  }
}

const replayLatestReportUpdates = (detailData) => {
  clearLatestReportReplayTimers()
  const updates = Array.isArray(detailData?.latestReportUpdates) ? detailData.latestReportUpdates : []
  for (const update of updates) {
    replayReportUpdate(update, {
      messageTs: Date.now(),
      replayCachedReport: true,
      includeReportUpdate: false
    })
  }
}

const appendRealtimeSampleCharts = (data, dataTimestamp) => {
  appendDataToChart(charts.cpu, 0, dataTimestamp, data.cpu)
  const ramPercent = (parseFloat(data.ram_total) > 0) ? (parseFloat(data.ram_used) / parseFloat(data.ram_total)) * 100 : 0
  appendDataToChart(charts.ram, 0, dataTimestamp, ramPercent)
  const swapPercent = (parseFloat(data.swap_total) > 0) ? (parseFloat(data.swap_used) / parseFloat(data.swap_total)) * 100 : 0
  appendDataToChart(charts.ram, 1, dataTimestamp, swapPercent)
  appendDataToChart(charts.net, 0, dataTimestamp, data.net_in_speed)
  appendDataToChart(charts.net, 1, dataTimestamp, data.net_out_speed)
  appendDiskIoChart(data, dataTimestamp)
}

const appendDiskIoChart = (data, dataTimestamp) => {
  if (!markDiskIoDataAvailable(data)) return
  const io = normalizeDiskIo(data)
  DISK_IO_FIELDS.forEach((field, index) => {
    appendDataToChart(charts.diskIo, index, dataTimestamp, io[field])
  })
}

const appendReportCharts = (data, dataTimestamp) => {
  rebuildGpuChartDatasets()
  const latestGpuList = parseGpuInfo(data.gpu_info)
  for (let i = 0; i < charts.gpu.data.datasets.length; i++) {
    const dataset = charts.gpu.data.datasets[i]
    const gpuId = dataset.gpuId
    const found = latestGpuList.find(g => String(g.id) === String(gpuId))
    const gpuVal = found ? found.info : null
    if (gpuVal === null || gpuVal === undefined) {
      appendDataToChart(charts.gpu, i, dataTimestamp, null, false, true)
    } else {
      appendDataToChart(charts.gpu, i, dataTimestamp, gpuVal)
    }
  }
  const diskPercent = (parseFloat(data.disk_total) > 0) ? (parseFloat(data.disk_used) / parseFloat(data.disk_total)) * 100 : 0
  appendDataToChart(charts.disk, 0, dataTimestamp, diskPercent)
  appendDiskIoChart(data, dataTimestamp)
  appendDataToChart(charts.proc, 0, dataTimestamp, data.processes)
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
}

const shouldMergeIncomingField = (key, mergeMode) => {
  if (STATIC_FIELDS.includes(key)) return false
  if (mergeMode === 'sample') return REALTIME_SAMPLE_FIELDS.has(key) || TIMING_FIELDS.has(key)
  if (mergeMode === 'report') return isDiskIoField(key) || !REALTIME_SAMPLE_FIELDS.has(key)
  return true
}

const fetchCurrentStatus = async (incomingData, options = {}) => {
  try {
    const {
      mergeMode = 'all',
      chartMode = 'all'
    } = options
    let data = incomingData
    if (!data) {
      data = await fetchServerDetail(serverId, apiIndex.value)
      if (!data) return
    }
    if (!data) return

    if (incomingData) {
      const newServer = { ...server.value }
      const hasValidIncomingDiskIo = markDiskIoDataAvailable(data)
      for (const key of Object.keys(data)) {
        if (!shouldMergeIncomingField(key, mergeMode)) {
          continue
        }
        if (isDiskIoField(key) && !hasValidIncomingDiskIo) {
          continue
        }
        newServer[key] = data[key]
      }
      server.value = newServer
    } else {
      config.value = data.sysConfig || null
      server.value = data
      markDiskIoDataAvailable(data)
      loading.value = false
    }
    syncProbeChartVisibility()

    if (data.last_updated && chartsReady.value && isRealtimeHistoryRange()) {
      const dataTimestamp = new Date(data.last_updated).getTime()
      if (chartMode === 'sample' || chartMode === 'all') appendRealtimeSampleCharts(data, dataTimestamp)
      if (chartMode === 'report' || chartMode === 'all') appendReportCharts(data, dataTimestamp)
    }

    if (data.last_updated) {
      lastUpdateText.value = formatTimestamp(data.last_updated)
    }
    return data
  } catch (e) {
    console.error('[ERROR] Update status failed:', e)
    return null
  }
}

const setTimeRange = (hours) => {
  clearLatestReportReplayTimers()
  if (hours > 24 && !isAdminLoggedIn()) {
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
let liveConnectionClosedByUser = false

const initChartsOnMount = async () => {
  if (isInitializingCharts || chartsReady.value) return
  isInitializingCharts = true

  await nextTick()
  
  const allRefsReady = cpuChartRef.value && gpuChartRef.value && ramChartRef.value && diskChartRef.value && diskIoChartRef.value &&
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
    clearLatestReportReplayTimers()
    liveSocket.close()
  } else if (showLiveTimeoutModal.value || liveConnectionClosedByUser) {
    return
  } else {
    liveSocket.reconnect()
  }
}

const closeLiveConnection = () => {
  showLiveTimeoutModal.value = false
  liveConnectionClosedByUser = true
  liveSocket?.close()
}

const continueLiveConnection = () => {
  showLiveTimeoutModal.value = false
  liveConnectionClosedByUser = false
  liveSocket?.reconnect()
}

const handleLiveMessage = (msg) => {
  if (!msg || msg.type !== 'batchUpdate') return
  const updates = Array.isArray(msg.updates) ? msg.updates : []
  const matchedUpdates = updates.filter(update => update && String(update.serverId) === String(serverId))
  if (matchedUpdates.length === 0) return

  clearLatestReportReplayTimers()
  const messageTs = normalizeMetricTimestamp(msg.ts, Date.now())
  for (const update of matchedUpdates) {
    replayReportUpdate(update, { messageTs })
  }
}

const loadThemeOptionsFromConfig = async () => {
  try {
    const runtimeConfig = await fetchConfig(apiIndex.value)
    frontendWsTimeoutMinutes.value = normalizeLiveSocketTimeoutMinutes(runtimeConfig?.frontend_ws_timeout_minutes)
    if (runtimeConfig && Object.prototype.hasOwnProperty.call(runtimeConfig, 'theme_options')) {
      applyMikusThemeOptions(runtimeConfig.theme_options)
    }
  } catch (e) {
    console.log('[INFO] Detail theme config pending...', e)
  }
}

const init = async () => {
  const [initialData] = await Promise.all([
    fetchCurrentStatus(),
    loadThemeOptionsFromConfig()
  ])
  await initChartsOnMount()

  await loadAllHistory(currentHours.value)
  replayLatestReportUpdates(initialData)

  liveSocket = createLiveSocket(String(serverId), {
    replay: false,
    timeoutMinutes: frontendWsTimeoutMinutes.value,
    onMessage: handleLiveMessage,
    onTimeout: () => {
      showLiveTimeoutModal.value = true
    },
    onStatus: ({ connected }) => {}
  }, apiIndex.value)

  document.addEventListener('visibilitychange', handleVisibility)
}

watch([cpuChartRef, gpuChartRef, ramChartRef, diskChartRef, diskIoChartRef, netChartRef, procChartRef, connChartRef, pingChartRef, lossChartRef, loadChartRef], () => {
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
  clearLatestReportReplayTimers()
  lastGpuSignature = ''
  safeDestroyCharts()
})
</script>
