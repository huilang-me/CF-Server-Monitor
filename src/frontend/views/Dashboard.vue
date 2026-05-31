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
          <a href="/admin" class="admin-link">⚙ {{ sysConfig.admin_title || 'Admin' }}</a>
        </div>
      </div>
      <div class="filter-bar" id="ajax-filters">
        <span 
          v-for="(count, code) in filterOptions" 
          :key="code"
          class="filter-tag"
          :class="{ active: currentFilter === code }"
          :data-filter="code"
          @click="setFilter(code)"
        >
          <span v-if="code !== 'all'">
            <img v-if="code !== 'all'" :src="'https://flagcdn.com/16x12/' + (code || 'xx').toLowerCase() + '.png'" :alt="code">
          </span>
          {{ code === 'all' ? '[' + trans.all + ']' : code.toUpperCase() }} {{ count }}
        </span>
      </div>
    </div>

    <div class="global-stats">
      <div class="stat-item">
        <div class="stat-label">{{ trans.totalServers }}</div>
        <div class="stat-main-value">{{ stats.total }}</div>
        <div class="stat-sub-info">
          <span style="color:var(--accent-green);">{{ trans.online }}:{{ stats.online }}</span> |
          <span style="color:var(--accent-red);">{{ trans.offline }}:{{ stats.offline }}</span>
        </div>
      </div>
      <div class="stat-item">
        <div class="stat-label">{{ trans.totalTraffic }}</div>
        <div class="stat-main-value" style="font-size:16px;">{{ formatBytes(stats.globalNetRx) }} ↓ | ↑ {{ formatBytes(stats.globalNetTx) }}</div>
      </div>
      <div class="stat-item">
        <div class="stat-label">{{ trans.realtimeSpeed }}</div>
        <div class="stat-main-value" style="font-size:16px;">
          <span style="color:var(--accent-green);">↓ {{ formatBytes(stats.globalSpeedIn) }}/s</span> |
          <span style="color:var(--accent-blue);">↑ {{ formatBytes(stats.globalSpeedOut) }}/s</span>
        </div>
      </div>
    </div>

    <div id="view-card" class="view-panel" :class="{ active: currentView === 'card' }">
      <div v-if="groupedServers.length === 0" class="empty-state">
        [!] {{ trans.noServer }}，请在 <a href="/admin" style="color: var(--accent-cyan);">{{ trans.backToAdmin }}</a> 中添加
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
              <th>{{ trans.archOs }}</th>
              <th>{{ trans.cpu }}</th>
              <th>{{ trans.ram }}</th>
              <th>{{ trans.disk }}</th>
              <th>{{ trans.dl }}</th>
              <th>{{ trans.ul }}</th>
              <th>{{ trans.rx }}</th>
              <th>{{ trans.tx }}</th>
              <th>{{ trans.update }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="filteredServers.length === 0">
              <td colspan="12" style="text-align:center; color:var(--text-muted);">[*] {{ trans.noData }}</td>
            </tr>
            <tr 
              v-for="server in filteredServers" 
              :key="server.id"
              @click="goToServer(server.id)"
              style="cursor:pointer;"
              :data-country="(server.country || 'xx').toLowerCase()"
            >
              <td style="text-align:center;">
                <div class="status-indicator" :style="{ background: getStatusColor(server), display: 'inline-block', margin: '0', width: '8px', height: '8px' }"></div>
              </td>
              <td><b>{{ server.name }}</b></td>
              <td>
                <span v-if="server.country">
                  <img :src="'https://flagcdn.com/24x18/' + (server.country || 'xx').toLowerCase() + '.png'" :alt="server.country" style="vertical-align: middle; border-radius: 2px; filter: brightness(0.9);">
                </span>
                <span v-else>🏳️</span>
                {{ (server.country || 'XX').toUpperCase() }}
              </td>
              <td><span class="os-label">{{ server.arch }} / {{ server.cpu_cores || 'N/A' }}C</span></td>
              <td>
                <div class="table-stat">
                  <div class="stat-bar-container" style="width:60px;">
                    <div class="stat-bar-fill" :style="{ width: (parseFloat(server.cpu) || 0) + '%', background: 'var(--accent-cyan)' }"></div>
                  </div>
                  <span>{{ (parseFloat(server.cpu) || 0).toFixed(1) }}%</span>
                </div>
              </td>
              <td>
                <div class="table-stat">
                  <div class="stat-bar-container" style="width:60px;">
                    <div class="stat-bar-fill" :style="{ width: (parseFloat(server.ram) || 0) + '%', background: 'var(--accent-purple)' }"></div>
                  </div>
                  <span>{{ (parseFloat(server.ram) || 0).toFixed(1) }}%</span>
                </div>
              </td>
              <td>
                <div class="table-stat">
                  <div class="stat-bar-container" style="width:60px;">
                    <div class="stat-bar-fill" :style="{ width: (parseFloat(server.disk) || 0) + '%', background: 'var(--accent-green)' }"></div>
                  </div>
                  <span>{{ (parseFloat(server.disk) || 0).toFixed(1) }}%</span>
                </div>
              </td>
              <td>{{ formatBytes(server.net_in_speed) }}/s</td>
              <td>{{ formatBytes(server.net_out_speed) }}/s</td>
              <td>{{ formatBytes(server.net_rx) }}</td>
              <td>{{ formatBytes(server.net_tx) }}</td>
              <td class="update-time">{{ getUpdateTime(server.last_updated) }}{{ trans.ago }}</td>
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
import TerminalHeader from '../components/TerminalHeader.vue'
import ServerCard from '../components/ServerCard.vue'
import Footer from '../components/Footer.vue'
import { fetchServers, formatBytes } from '../utils/api'
import { t, currentLang } from '../utils/i18n'
import { translations } from '../utils/i18n'

const servers = ref([])
const stats = ref({ total: '-', online: 0, offline: 0, globalNetRx: 0, globalNetTx: 0, globalSpeedIn: 0, globalSpeedOut: 0 })
const sysConfig = ref({
  show_price: true,
  show_expire: true,
  show_bw: true,
  show_tf: true,
  site_title: 'Server Monitor',
  admin_title: 'Admin'
})
const countryStats = ref({})
const currentView = ref('card')
const currentFilter = ref('all')
const mapInitialized = ref(false)

const trans = computed(() => translations[currentLang.value] || translations.en)

const filterOptions = computed(() => {
  const normalizedStats = {}
  for (const code in countryStats.value) {
    normalizedStats[code.toLowerCase()] = countryStats.value[code]
  }
  return { all: stats.value.total, ...normalizedStats }
})

const groupedServers = computed(() => {
  const groups = {}
  const order = []
  const filteredList = currentFilter.value === 'all' ? servers.value : servers.value.filter(s => (s.country || 'xx').toLowerCase() === currentFilter.value)
  filteredList.forEach(server => {
    const groupName = server.server_group || 'Default'
    if (!groups[groupName]) {
      groups[groupName] = []
      order.push(groupName)
    }
    groups[groupName].push(server)
  })
  return order.map(name => ({ name, servers: groups[name] }))
})

const filteredServers = computed(() => {
  if (currentFilter.value === 'all') return servers.value
  return servers.value.filter(s => (s.country || 'xx').toLowerCase() === currentFilter.value)
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
  return (Date.now() - lastUpdated) < 300000 ? 'var(--accent-green)' : 'var(--accent-red)'
}

const getUpdateTime = (lastUpdated) => {
  const last = new Date(lastUpdated).getTime()
  return Math.round((Date.now() - last) / 1000)
}

const refreshData = async () => {
  try {
    const data = await fetchServers()
    if (!data) return
    
    servers.value = data.servers || []
    stats.value = data.stats || { total: '-', online: 0, offline: 0, globalNetRx: 0, globalNetTx: 0, globalSpeedIn: 0, globalSpeedOut: 0 }
    countryStats.value = data.countryStats || {}
    
    sysConfig.value = {
      show_price: data.sysConfig?.show_price ?? true,
      show_expire: data.sysConfig?.show_expire ?? true,
      show_bw: data.sysConfig?.show_bw ?? true,
      show_tf: data.sysConfig?.show_tf ?? true,
      site_title: data.sysConfig?.site_title || 'Server Monitor',
      admin_title: data.sysConfig?.admin_title || 'Admin'
    }
    
    drawMarkers()
  } catch (e) {
    console.log('[INFO] Refresh pending...', e)
  }
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

const createMap = () => {
  window.myMap = window.L.map('map-container', {
    zoomControl: false,
    attributionControl: false,
    minZoom: 1
  }).setView([30, 10], 2)
  
  window.L.control.zoom({ position: 'bottomright' }).addTo(window.myMap)
  
  fetch('https://cdn.jsdelivr.net/gh/johan/world.geo.json@master/countries.geo.json')
    .then(res => res.json())
    .then(worldGeoJson => {
      window.worldGeoJson = worldGeoJson
      drawMarkers()
    })
    .catch(e => console.error('[ERROR] Map load failed', e))
}

const countryCoords = {
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

const iso2To3 = {
  "US":"USA","CN":"CHN","JP":"JPN","HK":"HKG","SG":"SGP","KR":"KOR","DE":"DEU","GB":"GBR",
  "NL":"NLD","FR":"FRA","CA":"CAN","AU":"AUS","IN":"IND","BR":"BRA","RU":"RUS","ZA":"ZAF",
  "TW":"TWN","IT":"ITA","SE":"SWE","CH":"CHE","ES":"ESP","PL":"POL","FI":"FIN","NO":"NOR",
  "DK":"DNK","IE":"IRL","AT":"AUT","TR":"TUR","AE":"ARE","MY":"MYS","TH":"THA","VN":"VNM",
  "PH":"PHL","ID":"IDN"
}

let markersLayer, geoJsonLayer, currentMapDataStr = ""

const drawMarkers = () => {
  if (!window.myMap || !window.worldGeoJson) return
  
  const newDataStr = JSON.stringify(countryStats.value)
  if (currentMapDataStr === newDataStr) return
  currentMapDataStr = newDataStr
  
  if (geoJsonLayer) window.myMap.removeLayer(geoJsonLayer)
  if (markersLayer) markersLayer.clearLayers()
  else markersLayer = window.L.layerGroup().addTo(window.myMap)
  
  const activeIso3 = {}
  for (const code in countryStats.value) {
    if (iso2To3[code.toUpperCase()]) activeIso3[iso2To3[code.toUpperCase()]] = true
  }
  
  geoJsonLayer = window.L.geoJSON(window.worldGeoJson, {
    style: function(feature) {
      const isActive = activeIso3[feature.id]
      return {
        fillColor: isActive ? '#00d4aa' : '#1e2a3a',
        weight: 1,
        opacity: 0.8,
        color: '#0a0e14',
        fillOpacity: isActive ? 0.4 : 0.2
      }
    }
  }).addTo(window.myMap)
  
  for (const [code, count] of Object.entries(countryStats.value)) {
    const upperCode = code.toUpperCase()
    if (countryCoords[upperCode]) {
      const icon = window.L.divIcon({
        className: 'custom-map-marker',
        html: `<div style="background:#00d4aa; color:#000; border-radius:50%; width:22px; height:22px; display:flex; align-items:center; justify-content:center; font-size:10px; font-weight:bold; border:2px solid #0a0e14; box-shadow:0 0 10px rgba(0,212,170,0.5); font-family:JetBrains Mono,monospace;">${count}</div>`,
        iconSize: [22,22]
      })
      window.L.marker(countryCoords[upperCode], {icon: icon}).addTo(markersLayer)
    }
  }
}

const goToServer = (id) => {
  window.location.href = `/server/${id}`
}

let refreshInterval = null

onMounted(() => {
  currentView.value = localStorage.getItem('monitor_preferred_view') || 'card'
  refreshData()
  refreshInterval = setInterval(refreshData, 60000)
})

onUnmounted(() => {
  if (refreshInterval) clearInterval(refreshInterval)
})
</script>