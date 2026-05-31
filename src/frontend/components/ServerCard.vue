<template>
  <a :href="'/server/' + server.id" class="server-card" :data-country="countryCode">
    <div class="server-card-header">
      <div class="server-identity">
        <div class="status-indicator" :style="{ background: statusColor, boxShadow: '0 0 8px ' + statusColor }"></div>
        <span v-if="countryCode !== 'xx'">
          <img :src="'https://flagcdn.com/24x18/' + countryCode + '.png'" :alt="countryCode" style="vertical-align: middle; margin-right: 5px; border-radius: 2px; filter: brightness(0.9);">
        </span>
        <span v-else>🏳️</span>
        <span class="server-name">{{ server.name }}</span>
      </div>
      <span class="status-label" :style="{ color: statusColor, borderColor: statusColor }">{{ statusText }}</span>
    </div>
    <div class="server-meta">
      <div class="card-meta">
        <div v-if="sysConfig.show_price && server.price" class="card-meta-item">💰 {{ server.price }}</div>
        <div v-if="sysConfig.show_expire && server.expire_date" class="card-meta-item">📅 {{ expireText }}</div>
      </div>
      <div class="card-badges">
        <span v-if="sysConfig.show_bw && server.bandwidth" class="badge badge-bw">{{ server.bandwidth }}</span>
        <span v-if="sysConfig.show_tf && server.traffic_limit" class="badge badge-tf">{{ server.traffic_limit }}</span>
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
    </div>
    <div class="ping-panel">
      <div class="ping-item">
        <span class="ping-label">CT</span>
        <span class="ping-value" :style="{ color: getPingColor(server.ping_ct) }">{{ server.ping_ct === '0' ? trans.timeout : server.ping_ct + 'ms' }}</span>
      </div>
      <div class="ping-item">
        <span class="ping-label">CU</span>
        <span class="ping-value" :style="{ color: getPingColor(server.ping_cu) }">{{ server.ping_cu === '0' ? trans.timeout : server.ping_cu + 'ms' }}</span>
      </div>
      <div class="ping-item">
        <span class="ping-label">CM</span>
        <span class="ping-value" :style="{ color: getPingColor(server.ping_cm) }">{{ server.ping_cm === '0' ? trans.timeout : server.ping_cm + 'ms' }}</span>
      </div>
      <div class="ping-item">
        <span class="ping-label">BD</span>
        <span class="ping-value" :style="{ color: getPingColor(server.ping_bd) }">{{ server.ping_bd === '0' ? trans.timeout : server.ping_bd + 'ms' }}</span>
      </div>
    </div>
  </a>
</template>

<script setup>
import { computed } from 'vue'
import { formatBytes } from '../utils/api'
import { t, currentLang } from '../utils/i18n'
import { translations } from '../utils/i18n'

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
  }
})

const trans = computed(() => translations[currentLang.value] || translations.en)

const now = Date.now()

const countryCode = computed(() => (props.server.country || 'xx').toLowerCase())

const isOnline = computed(() => {
  const lastUpdated = new Date(props.server.last_updated).getTime()
  return (now - lastUpdated) < 300000
})

const statusColor = computed(() => isOnline.value ? 'var(--accent-green)' : 'var(--accent-red)')
const statusText = computed(() => isOnline.value ? trans.value.online : trans.value.offline)

const cpuPercent = computed(() => parseFloat(props.server.cpu || 0).toFixed(1))
const ramPercent = computed(() => parseFloat(props.server.ram || 0).toFixed(1))
const diskPercent = computed(() => parseFloat(props.server.disk || 0).toFixed(1))

const netInSpeed = computed(() => formatBytes(props.server.net_in_speed))
const netOutSpeed = computed(() => formatBytes(props.server.net_out_speed))
const totalRx = computed(() => formatBytes(props.server.net_rx))
const totalTx = computed(() => formatBytes(props.server.net_tx))

const expireText = computed(() => {
  const expTime = new Date(props.server.expire_date).getTime()
  if (isNaN(expTime)) return ''
  const diff = expTime - now
  return diff > 0 ? Math.ceil(diff / (1000 * 3600 * 24)) + 'd' : '<span style="color:var(--accent-red);">EXPIRED</span>'
})

const getPingColor = (ping) => {
  ping = parseInt(ping) || 0
  if (ping === 0) return 'var(--accent-red)'
  if (ping < 100) return 'var(--accent-green)'
  if (ping < 200) return 'var(--accent-yellow)'
  return 'var(--accent-red)'
}
</script>