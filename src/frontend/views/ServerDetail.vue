<template>
  <div class="container">
    <TerminalHeader :title="server.name || 'Loading...'" />
    
    <div class="nav-bar">
      <a href="/" class="back-btn">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="15 18 9 12 15 6"></polyline>
        </svg>
        {{ trans.back }}
      </a>
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
          <span v-if="server.country">
            <img :src="'https://flagcdn.com/24x18/' + (server.country || 'xx').toLowerCase() + '.png'" :alt="server.country" style="vertical-align: middle; margin-right: 6px; border-radius: 2px; filter: brightness(0.9);">
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
          <span class="sysinfo-value">{{ server.uptime || 'N/A' }}</span>
        </div>
        <div class="sysinfo-item">
          <span class="sysinfo-label">🏗 {{ trans.architecture }}</span>
          <span class="sysinfo-value">{{ server.arch || 'N/A' }}</span>
        </div>
        <div class="sysinfo-item">
          <span class="sysinfo-label">💻 {{ trans.os }}</span>
          <span class="sysinfo-value">{{ server.os || 'N/A' }}</span>
        </div>
        <div class="sysinfo-item">
          <span class="sysinfo-label">🔧 {{ trans.cpuModel }}</span>
          <span class="sysinfo-value" style="font-size:11px;">{{ server.cpu_model || 'N/A' }}</span>
        </div>
        <div class="sysinfo-item">
          <span class="sysinfo-label">⚙️ {{ trans.cpuCores }}</span>
          <span class="sysinfo-value">{{ server.cpu_cores || 'N/A' }}</span>
        </div>
        <div class="sysinfo-item">
          <span class="sysinfo-label">📊 {{ trans.loadAvg }}</span>
          <span class="sysinfo-value highlight">{{ server.load_avg || '0.00' }}</span>
        </div>
        <div class="sysinfo-item">
          <span class="sysinfo-label">🕐 {{ trans.bootTime }}</span>
          <span class="sysinfo-value" style="font-size:11px;">{{ server.boot_time || 'N/A' }}</span>
        </div>
        <div class="sysinfo-item">
          <span class="sysinfo-label">💾 {{ trans.totalRam }}</span>
          <span class="sysinfo-value">{{ formatBytes(server.ram_total) }}</span>
        </div>
        <div class="sysinfo-item">
          <span class="sysinfo-label">💿 {{ trans.totalDisk }}</span>
          <span class="sysinfo-value">{{ formatBytes(server.disk_total) }}</span>
        </div>
        <div class="sysinfo-item">
          <span class="sysinfo-label">🔽 {{ trans.trafficIn }}</span>
          <span class="sysinfo-value">{{ formatBytes(server.net_rx) }}</span>
        </div>
        <div class="sysinfo-item">
          <span class="sysinfo-label">🔼 {{ trans.trafficOut }}</span>
          <span class="sysinfo-value">{{ formatBytes(server.net_tx) }}</span>
        </div>
        <div class="sysinfo-item">
          <span class="sysinfo-label">⏰ {{ trans.lastReport }}</span>
          <span class="sysinfo-value">{{ lastReportTime }}</span>
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
            {{ trans.memoryUsage }}
          </span>
          <div>
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
          <div>
            <span class="chart-current-value">{{ diskPercent }}%</span>
            <div class="chart-subtitle">{{ trans.used }} {{ formatBytes(server.disk_used) }} / {{ formatBytes(server.disk_total) }}</div>
          </div>
        </div>
        <div class="chart-body">
          <canvas ref="diskChartRef"></canvas>
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
            <span style="color: var(--accent-purple);">TCP <b>{{ server.tcp_conn || '0' }}</b></span>
            <span style="color: var(--accent-pink);">UDP <b>{{ server.udp_conn || '0' }}</b></span>
          </div>
        </div>
        <div class="chart-body">
          <canvas ref="connChartRef"></canvas>
        </div>
      </div>

      <div class="chart-card full-width">
        <div class="chart-card-header">
          <span class="chart-title">
            <span class="chart-title-icon">▸</span>
            {{ trans.latencyMonitor }}
          </span>
          <div style="display: flex; gap: 20px; font-size: 11px; font-weight: 500;">
            <span style="color: var(--accent-green);">{{ trans.pingCt }} <b>{{ server.ping_ct || '0' }}ms</b></span>
            <span style="color: var(--accent-yellow);">{{ trans.pingCu }} <b>{{ server.ping_cu || '0' }}ms</b></span>
            <span style="color: var(--accent-blue);">{{ trans.pingCm }} <b>{{ server.ping_cm || '0' }}ms</b></span>
            <span style="color: var(--accent-purple);">{{ trans.pingBd }} <b>{{ server.ping_bd || '0' }}ms</b></span>
          </div>
        </div>
        <div class="chart-body">
          <canvas ref="pingChartRef"></canvas>
        </div>
      </div>
    </div>

    <div class="status-bar">
      <div class="status-bar-item">
        <span class="status-bar-dot"></span>
        <span>{{ trans.lastUpdate }}: <span>{{ lastUpdateText }}</span></span>
      </div>
      <div class="status-bar-item">
        <span>{{ trans.autoRefresh }}: 60{{ trans.seconds }}</span>
      </div>
    </div>

    <Footer />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import TerminalHeader from '../components/TerminalHeader.vue'
import Footer from '../components/Footer.vue'
import { fetchServerDetail, fetchAllHistory, fetchAggHistory, formatBytes, fetchConfig } from '../utils/api'
import Chart from 'chart.js/auto'
import 'chartjs-adapter-date-fns'
import { t, currentLang } from '../utils/i18n'
import { translations } from '../utils/i18n'

const route = useRoute()

let serverId = route.params.id
if (!serverId) {
  const urlParams = new URLSearchParams(window.location.search)
  serverId = urlParams.get('id')
}

if (!serverId) {
  window.location.href = '/'
}

const server = ref({})
const currentHours = ref(1)
const lastUpdateText = ref('just now')
const oneHourDataCache = ref(null)
const config = ref(null)

const trans = computed(() => translations[currentLang.value] || translations.en)

const timeOptions = computed(() => {
  const allOptions = [
    { hours: 0.167, label: '10m' },
    { hours: 0.5, label: '30m' },
    { hours: 1, label: '1h' },
    { hours: 6, label: '6h' },
    { hours: 12, label: '12h' },
    { hours: 24, label: '24h' }
  ]
  
  if (config.value && !config.value.enableLongRetention) {
    return allOptions.filter(opt => opt.hours <= 1)
  }
  
  return allOptions
})

const isOnline = computed(() => {
  const lastUpdated = new Date(server.value.last_updated).getTime()
  return (Date.now() - lastUpdated) < 300000
})

const cpuPercent = computed(() => (parseFloat(server.value.cpu) || 0).toFixed(1))
const ramPercent = computed(() => (parseFloat(server.value.ram) || 0).toFixed(1))
const diskPercent = computed(() => (parseFloat(server.value.disk) || 0).toFixed(1))

const lastReportTime = computed(() => {
  const lastUpdated = new Date(server.value.last_updated).getTime()
  return new Date(lastUpdated).toLocaleString(undefined, { hour12: false })
})

const cpuChartRef = ref(null)
const ramChartRef = ref(null)
const diskChartRef = ref(null)
const netChartRef = ref(null)
const procChartRef = ref(null)
const connChartRef = ref(null)
const pingChartRef = ref(null)
const historyLoaded = ref(false)

const charts = {}

const initCharts = () => {
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

  const createChartOptions = (unit = '', showLegend = false, yAxisLabel = '') => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 300, easing: 'easeOutCubic' },
    interaction: { mode: 'nearest', intersect: false },
    plugins: {
      legend: {
        display: showLegend,
        position: 'top',
        labels: {
          boxWidth: 10,
          padding: 12,
          font: { size: 10, family: "'JetBrains Mono', monospace" },
          usePointStyle: true,
          color: '#8999af'
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
            if (value !== null && value !== undefined) {
              label += typeof value === 'number' ? value.toFixed(2) : value
            }
            return '$ ' + label + unit
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
        min: 'dataMin',
        max: 'dataMax',
        ticks: {
          maxTicksLimit: 8,
          color: '#5c6d82',
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
          color: '#5c6d82',
          font: { size: 10, family: "'JetBrains Mono', monospace" }
        },
        grid: { color: 'rgba(30, 42, 58, 0.5)', drawBorder: false, tickLength: 0 },
        ticks: {
          color: '#5c6d82',
          font: { size: 9, family: "'JetBrains Mono', monospace" },
          padding: 8,
          callback: function(value) { return value + unit; }
        }
      }
    },
    elements: {
      point: { radius: 0, hoverRadius: 5, hitRadius: 10, borderWidth: 0, hoverBorderWidth: 2, hoverBorderColor: '#fff' },
      line: { tension: 0.4, borderWidth: 1.5, fill: false, spanGaps: true }
    }
  })

  if (cpuChartRef.value) {
    charts.cpu = new Chart(cpuChartRef.value.getContext('2d'), {
      type: 'line',
      data: { datasets: [{ label: 'CPU', data: [], borderColor: '#00d4aa', backgroundColor: 'rgba(0, 212, 170, 0.05)', fill: true, borderWidth: 1.5 }] },
      options: createChartOptions('%')
    })
  }

  if (ramChartRef.value) {
    charts.ram = new Chart(ramChartRef.value.getContext('2d'), {
      type: 'line',
      data: {
        datasets: [
          { label: 'Memory', data: [], borderColor: '#b392f0', backgroundColor: 'rgba(179, 146, 240, 0.05)', fill: true, borderWidth: 1.5 },
          { label: 'Swap', data: [], borderColor: '#ffb870', backgroundColor: 'rgba(255, 184, 112, 0.05)', fill: true, borderWidth: 1.5 }
        ]
      },
      options: createChartOptions('%', true)
    })
  }

  if (diskChartRef.value) {
    charts.disk = new Chart(diskChartRef.value.getContext('2d'), {
      type: 'line',
      data: { datasets: [{ label: 'Disk', data: [], borderColor: '#39d2c0', backgroundColor: 'rgba(57, 210, 192, 0.05)', fill: true, borderWidth: 1.5 }] },
      options: createChartOptions('%')
    })
  }

  if (procChartRef.value) {
    charts.proc = new Chart(procChartRef.value.getContext('2d'), {
      type: 'line',
      data: { datasets: [{ label: 'Processes', data: [], borderColor: '#f778ba', backgroundColor: 'rgba(247, 120, 186, 0.03)', fill: true, borderWidth: 1.5 }] },
      options: createChartOptions('', false, 'Count')
    })
  }

  if (netChartRef.value) {
    charts.net = new Chart(netChartRef.value.getContext('2d'), {
      type: 'line',
      data: {
        datasets: [
          { label: 'Download', data: [], borderColor: '#00d4aa', backgroundColor: 'rgba(0, 212, 170, 0.03)', fill: true, tension: 0.4, borderWidth: 1.5, pointRadius: 0, hoverRadius: 5 },
          { label: 'Upload', data: [], borderColor: '#4da6ff', backgroundColor: 'rgba(77, 166, 255, 0.03)', fill: true, tension: 0.4, borderWidth: 1.5, pointRadius: 0, hoverRadius: 5 }
        ]
      },
      options: createChartOptions(' B/s', true)
    })
  }

  if (connChartRef.value) {
    charts.conn = new Chart(connChartRef.value.getContext('2d'), {
      type: 'line',
      data: {
        datasets: [
          { label: 'TCP', data: [], borderColor: '#b392f0', backgroundColor: 'transparent', tension: 0.4, borderWidth: 1.5, pointRadius: 0, hoverRadius: 5 },
          { label: 'UDP', data: [], borderColor: '#f778ba', backgroundColor: 'transparent', tension: 0.4, borderWidth: 1.5, pointRadius: 0, hoverRadius: 5 }
        ]
      },
      options: createChartOptions('', true, 'Connections')
    })
  }

  if (pingChartRef.value) {
    charts.ping = new Chart(pingChartRef.value.getContext('2d'), {
      type: 'line',
      data: {
        datasets: [
          { label: 'CT', data: [], borderColor: '#00d4aa', backgroundColor: 'transparent', tension: 0.3, borderWidth: 1.5, pointRadius: 0, hoverRadius: 5 },
          { label: 'CU', data: [], borderColor: '#ffb870', backgroundColor: 'transparent', tension: 0.3, borderWidth: 1.5, pointRadius: 0, hoverRadius: 5 },
          { label: 'CM', data: [], borderColor: '#4da6ff', backgroundColor: 'transparent', tension: 0.3, borderWidth: 1.5, pointRadius: 0, hoverRadius: 5 },
          { label: 'BD', data: [], borderColor: '#b392f0', backgroundColor: 'transparent', tension: 0.3, borderWidth: 1.5, pointRadius: 0, hoverRadius: 5 }
        ]
      },
      options: createChartOptions(' ms', true, 'Latency')
    })
  }
}

const updateChartDataset = (chart, datasetIndex, dataPoints, xField = 'timestamp', yField) => {
  if (!chart || !dataPoints || dataPoints.length === 0) return

  const dataset = chart.data.datasets[datasetIndex]
  if (!dataset) return
  
  const startTime = Date.now() - currentHours.value * 60 * 60 * 1000

  let sampledData = dataPoints
  if (dataPoints.length > 500) {
    const step = Math.ceil(dataPoints.length / 500)
    sampledData = dataPoints.filter((_, i) => i % step === 0)
  }

  const processedData = sampledData.map(d => ({
    x: new Date(d[xField]).getTime(),
    y: parseFloat(d[yField]) || 0
  }))

  processedData.sort((a, b) => a.x - b.x)

  const completeData = []
  if (processedData.length > 0 && processedData[0].x > startTime) {
    completeData.push({ x: startTime, y: null })
  }
  completeData.push(...processedData)
  if (processedData.length > 0) {
    const lastTimestamp = processedData[processedData.length - 1].x
    const now = Date.now()
    if (lastTimestamp < now) {
      completeData.push({ x: now, y: null })
    }
  }

  dataset.data = completeData
  chart.update('none')
}

const updateChartDatasetWithSwap = (chart, datasetIndex, dataPoints) => {
  if (!chart || !dataPoints || dataPoints.length === 0) return

  const dataset = chart.data.datasets[datasetIndex]
  if (!dataset) return
  
  const startTime = Date.now() - currentHours.value * 60 * 60 * 1000

  let sampledData = dataPoints
  if (dataPoints.length > 500) {
    const step = Math.ceil(dataPoints.length / 500)
    sampledData = dataPoints.filter((_, i) => i % step === 0)
  }

  const processedData = sampledData.map(d => {
    const swapTotal = parseFloat(d.swap_total) || 0
    const swapUsed = parseFloat(d.swap_used) || 0
    const percent = swapTotal === 0 ? 0 : (swapUsed / swapTotal) * 100
    return { x: new Date(d.timestamp).getTime(), y: percent }
  })

  processedData.sort((a, b) => a.x - b.x)

  const completeData = []
  if (processedData.length > 0 && processedData[0].x > startTime) {
    completeData.push({ x: startTime, y: null })
  }
  completeData.push(...processedData)

  dataset.data = completeData.filter(d => d.x >= startTime)
}

const mergeDataSets = (rawData, aggData) => {
  if (!rawData || rawData.length === 0) return aggData || []
  if (!aggData || aggData.length === 0) return rawData

  const ONE_HOUR_MS = 60 * 60 * 1000
  const oneHourAgo = Date.now() - ONE_HOUR_MS
  const sortedRaw = [...rawData].sort((a, b) => Number(a.timestamp) - Number(b.timestamp))
  const sortedAgg = [...aggData].sort((a, b) => Number(a.timestamp) - Number(b.timestamp))

  const recentRaw = sortedRaw.filter(d => Number(d.timestamp) >= oneHourAgo)
  const olderRaw = sortedRaw.filter(d => Number(d.timestamp) < oneHourAgo)

  const aggInterval = calculateAvgInterval(sortedAgg)
  const rawInterval = calculateAvgInterval(recentRaw)

  let processedRaw = recentRaw
  if (aggInterval > rawInterval * 1.5 && recentRaw.length > 10) {
    const targetInterval = Math.max(aggInterval * 0.8, rawInterval * 2)
    processedRaw = sampleDataByInterval(recentRaw, targetInterval)
  }

  const map = new Map()
  for (const item of olderRaw) map.set(Number(item.timestamp), item)
  for (const item of sortedAgg) map.set(Number(item.timestamp), item)
  for (const item of processedRaw) map.set(Number(item.timestamp), item)

  const result = Array.from(map.values())
  result.sort((a, b) => Number(a.timestamp) - Number(b.timestamp))
  return result
}

const calculateAvgInterval = (data) => {
  if (!data || data.length < 2) return 60000
  let total = 0, count = 0
  for (let i = 1; i < data.length; i++) {
    const diff = Number(data[i].timestamp) - Number(data[i - 1].timestamp)
    if (diff > 0) { total += diff; count++; }
  }
  return count > 0 ? total / count : 60000
}

const sampleDataByInterval = (data, targetInterval) => {
  if (!data || data.length <= 1) return data
  const result = []
  let lastTs = -Infinity
  for (const item of data) {
    const ts = Number(item.timestamp)
    if (ts - lastTs >= targetInterval) {
      result.push(item)
      lastTs = ts
    }
  }
  return result
}

const loadAllHistory = async (hours) => {
  try {
    let allData

    if (hours <= 1) {
      const res = await fetchAllHistory(serverId, hours)
      if (!res) return
      allData = res
      oneHourDataCache.value = allData
    } else {
      if (!oneHourDataCache.value) {
        const oneHourRes = await fetchAllHistory(serverId, 1)
        if (oneHourRes) {
          oneHourDataCache.value = oneHourRes
        }
      }

      const aggRes = await fetchAggHistory(serverId, hours)
      if (!aggRes) return

      allData = mergeDataSets(oneHourDataCache.value, aggRes)
    }

    updateChartDataset(charts.cpu, 0, allData, 'timestamp', 'cpu')
    updateChartDataset(charts.ram, 0, allData, 'timestamp', 'ram')
    updateChartDatasetWithSwap(charts.ram, 1, allData)
    updateChartDataset(charts.disk, 0, allData, 'timestamp', 'disk')
    updateChartDataset(charts.proc, 0, allData, 'timestamp', 'processes')
    updateChartDataset(charts.net, 0, allData, 'timestamp', 'net_in_speed')
    updateChartDataset(charts.net, 1, allData, 'timestamp', 'net_out_speed')
    updateChartDataset(charts.conn, 0, allData, 'timestamp', 'tcp_conn')
    updateChartDataset(charts.conn, 1, allData, 'timestamp', 'udp_conn')
    updateChartDataset(charts.ping, 0, allData, 'timestamp', 'ping_ct')
    updateChartDataset(charts.ping, 1, allData, 'timestamp', 'ping_cu')
    updateChartDataset(charts.ping, 2, allData, 'timestamp', 'ping_cm')
    updateChartDataset(charts.ping, 3, allData, 'timestamp', 'ping_bd')

    updateAllChartTimeUnits(hours)
    historyLoaded.value = true

    await nextTick()

    requestAnimationFrame(() => {
      Object.values(charts).forEach(chart => {
        chart.resize()
        chart.update('none')
      })
    })
    lastUpdateText.value = new Date().toLocaleTimeString()
  } catch (e) {
    console.error('[ERROR] 加载历史数据失败:', e)
  }
}

const updateAllChartTimeUnits = (hours) => {
  const unit = hours <= 3 ? 'minute' : 'hour'
  const maxTicks = hours <= 3 ? 8 : 12

  Object.values(charts).forEach(chart => {
    if (chart && chart.options && chart.options.scales && chart.options.scales.x && chart.options.scales.x.time) {
      chart.options.scales.x.time.unit = unit
      chart.options.scales.x.ticks.maxTicksLimit = maxTicks
    }
  })

  Object.values(charts).forEach(chart => {
    if (chart) chart.update('none')
  })
}

const appendDataToChart = (chart, datasetIndex, timestamp, value) => {
  if (!chart) return
  
  const dataset = chart.data.datasets[datasetIndex]
  if (!dataset) return
  
  const time = new Date(timestamp).getTime()
  const cutoffTime = Date.now() - currentHours.value * 60 * 60 * 1000

  dataset.data.push({ x: time, y: parseFloat(value) || 0 })
  dataset.data = dataset.data.filter(d => d.x >= cutoffTime)
  chart.update('none')
}

const fetchCurrentStatus = async () => {
  try {
    const data = await fetchServerDetail(serverId)
    if (!data) return

    server.value = data

    const dataTimestamp = new Date(data.last_updated).getTime()
    appendDataToChart(charts.cpu, 0, dataTimestamp, data.cpu)
    appendDataToChart(charts.ram, 0, dataTimestamp, data.ram)
    const swapPercent = (parseFloat(data.swap_total) > 0) ? (parseFloat(data.swap_used) / parseFloat(data.swap_total)) * 100 : 0
    appendDataToChart(charts.ram, 1, dataTimestamp, swapPercent)
    appendDataToChart(charts.disk, 0, dataTimestamp, data.disk)
    appendDataToChart(charts.proc, 0, dataTimestamp, data.processes)
    appendDataToChart(charts.net, 0, dataTimestamp, data.net_in_speed)
    appendDataToChart(charts.net, 1, dataTimestamp, data.net_out_speed)
    appendDataToChart(charts.conn, 0, dataTimestamp, data.tcp_conn)
    appendDataToChart(charts.conn, 1, dataTimestamp, data.udp_conn)
    appendDataToChart(charts.ping, 0, dataTimestamp, data.ping_ct)
    appendDataToChart(charts.ping, 1, dataTimestamp, data.ping_cu)
    appendDataToChart(charts.ping, 2, dataTimestamp, data.ping_cm)
    appendDataToChart(charts.ping, 3, dataTimestamp, data.ping_bd)

    lastUpdateText.value = new Date().toLocaleTimeString()
  } catch (e) {
    console.error('[ERROR] 获取状态失败:', e)
  }
}

const setTimeRange = (hours) => {
  currentHours.value = hours
  loadAllHistory(hours)
}

let statusTimer = null

const init = async () => {
  // 首先加载配置
  try {
    const fetchedConfig = await fetchConfig()
    if (fetchedConfig) {
      config.value = fetchedConfig
      // 如果启用了短数据保留，默认设置为 0.5 小时
      if (!fetchedConfig.enableLongRetention) {
        currentHours.value = 0.5
      }
    }
  } catch (e) {
    console.error('[ERROR] 加载配置失败:', e)
  }

  // 确保所有 canvas 元素都已挂载
  await nextTick()
  await new Promise(resolve => setTimeout(resolve, 50))

  // 检查所有 canvas ref 是否存在
  if (cpuChartRef.value && ramChartRef.value && diskChartRef.value &&
      netChartRef.value && procChartRef.value && connChartRef.value && pingChartRef.value) {
    initCharts()
  }
  fetchCurrentStatus()
  loadAllHistory(currentHours.value)
  statusTimer = setInterval(fetchCurrentStatus, 60000)
}

onMounted(() => {
  init()
})

onUnmounted(() => {
  if (statusTimer) clearInterval(statusTimer)
  Object.values(charts).forEach(chart => chart.destroy())
})
</script>