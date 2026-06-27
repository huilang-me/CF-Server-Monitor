<template>
  <router-link :to="to" class="server-card" :data-region="regionCode">
    <div class="server-card-header">
      <div class="server-identity">
        <div class="status-indicator" :style="{ background: statusColor, boxShadow: '0 0 8px ' + statusColor }"></div>
        <span v-if="regionCode !== 'xx'">
          <img :src="'https://flagcdn.com/24x18/' + regionCode + '.png'" :alt="regionCode" style="vertical-align: middle; margin-right: 5px; border-radius: 2px; filter: brightness(0.9);">
        </span>
        <span v-else>🏳️</span>
        <span class="server-name">{{ server.name }}</span>
      </div>
      <span class="status-label" :style="{ color: statusColor, borderColor: statusColor }">{{ statusText }}</span>
    </div>
    <div class="server-meta">
      <div class="card-meta">
        <div v-if="sysConfig.show_price && server.price" class="card-meta-item">💰 {{ server.price }}</div>
        <div v-if="sysConfig.show_expire && server.expire_date" class="card-meta-item">📅 <span :class="{ 'expired': isExpired }">{{ expireText }}</span></div>
      </div>
      <div class="card-badges">
        <span v-if="sysConfig.show_bw && server.bandwidth" class="badge badge-bw">{{ server.bandwidth }}</span>
        <span v-if="sysConfig.show_tf && server.traffic_limit" class="badge badge-tf">{{ formatBytes(server.traffic_limit * 1024 * 1024 * 1024) }}</span>
        <span v-if="server.ip_v4 === '1'" class="badge badge-v4">IPv4</span>
        <span v-if="server.ip_v6 === '1'" class="badge badge-v6">IPv6</span>
      </div>
    </div>
    <div class="server-stats">
      <div class="stat-row">
        <span class="stat-key">CPU</span>
        <div class="stat-bar-container">
          <div class="stat-bar-fill" :style="{ width: cpuPercent + '%', background: 'var(--accent-cyan)' }"></div>
        </div>
        <span class="stat-value">{{ cpuPercent }}%</span>
      </div>
      <div class="stat-row">
        <span class="stat-key">RAM</span>
        <div class="stat-bar-container">
          <div class="stat-bar-fill" :style="{ width: ramPercent + '%', background: 'var(--accent-purple)' }"></div>
        </div>
        <span class="stat-value">{{ ramPercent }}%</span>
      </div>
      <div class="stat-row">
        <span class="stat-key">DISK</span>
        <div class="stat-bar-container">
          <div class="stat-bar-fill" :style="{ width: diskPercent + '%', background: 'var(--accent-green)' }"></div>
        </div>
        <span class="stat-value">{{ diskPercent }}%</span>
      </div>
      <div class="stat-row" v-if="sysConfig.show_tf && server.traffic_limit">
        <span class="stat-key">USE</span>
        <div class="stat-bar-container">
          <div class="stat-bar-fill" :style="{ width: Math.min(100, parseFloat(trafficUsagePercent)) + '%', background: 'var(--accent-blue)' }"></div>
        </div>
        <span class="stat-value">{{ trafficUsagePercent }}%</span>
      </div>
      <div class="stat-row">
        <span class="stat-key">NET</span>
        <span class="net-down">▼ {{ netInSpeed }}/s</span>
        <span class="net-up">▲ {{ netOutSpeed }}/s</span>
      </div>
      <div class="stat-row">
        <span class="stat-key">TRF</span>
        <span class="net-down">▼ {{ totalRx }}</span>
        <span class="net-up">▲ {{ totalTx }}</span>
      </div>
      <div class="stat-row stat-time-row">
        <span class="stat-key">TIME</span>
        <span class="stat-time-value">{{ dataTimeText }}</span>
      </div>
    </div>
    <div class="ping-panel">
      <div class="ping-item">
        <span class="ping-label">CT</span>
        <span class="ping-value" :style="{ color: getPingColor(server.ping_ct) }">{{ !isPingValid(server.ping_ct) ? trans.timeout : server.ping_ct + 'ms' }}</span>
      </div>
      <div class="ping-item">
        <span class="ping-label">CU</span>
        <span class="ping-value" :style="{ color: getPingColor(server.ping_cu) }">{{ !isPingValid(server.ping_cu) ? trans.timeout : server.ping_cu + 'ms' }}</span>
      </div>
      <div class="ping-item">
        <span class="ping-label">CM</span>
        <span class="ping-value" :style="{ color: getPingColor(server.ping_cm) }">{{ !isPingValid(server.ping_cm) ? trans.timeout : server.ping_cm + 'ms' }}</span>
      </div>
      <div class="ping-item">
        <span class="ping-label">BD</span>
        <span class="ping-value" :style="{ color: getPingColor(server.ping_bd) }">{{ !isPingValid(server.ping_bd) ? trans.timeout : server.ping_bd + 'ms' }}</span>
      </div>
    </div>
  </router-link>
</template>

<script setup>
import { computed } from 'vue'
import { formatBytes, getFlagRegionCode } from '../utils/api'
import { t, currentLang } from '../utils/i18n'
import { translations } from '../utils/i18n'
import { TIME, PING } from '../utils/constants'

const props = defineProps({
  server: {
    type: Object,
    required: true
  },
  sysConfig: {
    type: Object,
    default: () => ({
      show_price: true,
      show_expire: true,
      show_bw: true,
      show_tf: true
    })
  },
  to: {
    type: String,
    default: ''
  }
})

const trans = computed(() => translations[currentLang.value] || translations.en)

const currentTime = computed(() => {
  const ts = Number(props.server.current_timestamp)
  if (Number.isFinite(ts) && ts > 0) {
    return ts < 10000000000 ? ts * 1000 : ts
  }
  return Date.now()
})

const regionCode = computed(() => getFlagRegionCode(props.server.region))

const isOnline = computed(() => {
  const lastUpdated = normalizeTimestamp(props.server.report_timestamp ?? props.server.last_updated)
  if (!lastUpdated) return false
  return (currentTime.value - lastUpdated) < TIME.ONLINE_THRESHOLD_MS
})

const statusColor = computed(() => isOnline.value ? 'var(--accent-green)' : 'var(--accent-red)')
const statusText = computed(() => isOnline.value ? trans.value.online : trans.value.offline)

const cpuPercent = computed(() => parseFloat(props.server.cpu || 0).toFixed(1))
const ramPercent = computed(() => {
  if (props.server.ram_total > 0) {
    return ((props.server.ram_used / props.server.ram_total) * 100).toFixed(2)
  }
  return '0.00'
})
const diskPercent = computed(() => {
  if (props.server.disk_total > 0) {
    return ((props.server.disk_used / props.server.disk_total) * 100).toFixed(2)
  }
  return '0.00'
})

const trafficUsagePercent = computed(() => {
  const limit = parseFloat(props.server.traffic_limit) || 0
  if (limit <= 0) return '0'
  
  const limitBytes = limit * 1024 * 1024 * 1024
  let usedBytes = 0
  
  const calcType = props.server.traffic_calc_type || 'total'
  if (calcType === 'dl') {
    usedBytes = parseFloat(props.server.net_rx_monthly) || 0
  } else if (calcType === 'ul') {
    usedBytes = parseFloat(props.server.net_tx_monthly) || 0
  } else {
    usedBytes = (parseFloat(props.server.net_rx_monthly) || 0) + (parseFloat(props.server.net_tx_monthly) || 0)
  }
  
  const percent = (usedBytes / limitBytes) * 100
  return percent.toFixed(1)
})

const netInSpeed = computed(() => formatBytes(props.server.net_in_speed))
const netOutSpeed = computed(() => formatBytes(props.server.net_out_speed))
const totalRx = computed(() => formatBytes(props.server.net_rx))
const totalTx = computed(() => formatBytes(props.server.net_tx))

const normalizeTimestamp = (value) => {
  if (value === null || value === undefined || value === '') return null
  const numeric = Number(value)
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric < 10000000000 ? numeric * 1000 : numeric
  }
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

const formatDateTime = (timestamp) => {
  if (!timestamp) return '-'
  const date = new Date(timestamp)
  const pad = (num) => String(num).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

const dataTimeText = computed(() => {
  const reportTimestamp = normalizeTimestamp(props.server.report_timestamp ?? props.server.last_updated)
  if (!isOnline.value) return formatDateTime(reportTimestamp)

  const displayTimestamp = normalizeTimestamp(
    props.server.display_timestamp ?? props.server.sample_timestamp ?? props.server.timestamp ?? reportTimestamp
  )
  const sampleTimestamp = normalizeTimestamp(
    props.server.sample_timestamp ?? props.server.timestamp ?? displayTimestamp
  )
  const lagSeconds = displayTimestamp && sampleTimestamp
    ? Math.max(0, Math.floor((displayTimestamp - sampleTimestamp) / 1000))
    : 0
  return `${formatDateTime(sampleTimestamp)}${lagSeconds > 0 ? ` (+${lagSeconds}s)` : ''}`
})

const isExpired = computed(() => {
  const expTime = new Date(props.server.expire_date).getTime()
  return !isNaN(expTime) && expTime < currentTime.value
})

const expireText = computed(() => {
  const expTime = new Date(props.server.expire_date).getTime()
  if (isNaN(expTime)) return ''
  const diff = expTime - currentTime.value
  const days = Math.ceil(diff / (1000 * 3600 * 24))
  return days > 0 ? `${days}${trans.value.expireDays}` : trans.value.expired
})

const isPingValid = (ping) => {
  if (ping === null || ping === undefined || ping === '' || ping === '0') {
    return false
  }
  const val = parseInt(ping)
  return val > 0
}

const getPingColor = (ping) => {
  if (!isPingValid(ping)) return 'var(--accent-red)'
  const val = parseInt(ping)
  if (val < PING.GOOD_THRESHOLD) return 'var(--accent-green)'
  if (val < PING.WARNING_THRESHOLD) return 'var(--accent-yellow)'
  return 'var(--accent-red)'
}
</script>
