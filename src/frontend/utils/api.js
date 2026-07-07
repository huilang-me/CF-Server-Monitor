import { http, isAdminLoggedIn } from './http'
import { getApiBases, getWsBase, hasMultipleApiBases, getTitle, getBackgroundImage } from './config'
import { DEFAULT_SITE_TITLE } from './constants'
import { ref } from 'vue'
import { normalizeTimestamp } from './time.js'
import { TIME } from './constants'

export { getApiBases, getWsBase }

export const VERSION = ref('')

export const createLiveSocket = (subscribe, handlers = {}, apiIndex = 0, serverIds = []) => {
  const { onUpdate, onStatus, onMessage } = handlers
  const shouldReplay = handlers.replay !== false
  const scope = (subscribe || 'all').toLowerCase()
  let ws = null
  let manualClose = false
  let reconnectTimer = null
  let reconnectDelay = TIME.RECONNECT_INITIAL_DELAY_MS
  let reconnectAttempts = 0
  const MAX_REPLAY_DELAY = 120000
  let isConnected = false
  const replayTimers = new Set()

  const getWsBaseByIndex = (index) => {
    const bases = getApiBases()
    if (bases.length > 0 && bases[index]) {
      try {
        const u = new URL(bases[index])
        const wsProto = u.protocol === 'https:' ? 'wss:' : 'ws:'
        return `${wsProto}//${u.host}`
      } catch (_) {
        return `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`
      }
    }
    return getWsBase()
  }

  const setStatus = (connected, reason) => {
    isConnected = connected
    if (typeof onStatus === 'function') {
      onStatus({ connected, reason: reason || '' })
    }
  }

  const clearReplayTimers = () => {
    replayTimers.forEach(timer => clearTimeout(timer))
    replayTimers.clear()
  }

  const normalizeReplayTimestamp = (value, fallback = Date.now()) => {
    return normalizeTimestamp(value, fallback)
  }

  const emitUpdate = ({ serverId, data, ts }) => {
    if (serverId && data && typeof onUpdate === 'function') {
      const receiveTs = Date.now()
      const sampleTs = normalizeReplayTimestamp(data.sample_timestamp || data.last_updated || data.timestamp || ts, receiveTs)
      onUpdate({
        serverId,
        data: {
          ...data,
          sample_timestamp: sampleTs,
          last_updated: receiveTs,
          timestamp: receiveTs
        }
      })
    }
  }

  const collectBatchEventGroups = (msg) => {
    const groups = []
    const updates = Array.isArray(msg.updates) ? msg.updates : []

    for (const update of updates) {
      if (!update || !update.serverId) continue
      const events = []
      const samples = Array.isArray(update.samples) ? update.samples : []

      for (const sample of samples) {
        if (!sample || typeof sample !== 'object') continue
        const data = sample.data || sample.payload || sample.metrics
        if (!data) continue
        events.push({
          serverId: update.serverId,
          ts: normalizeReplayTimestamp(sample.ts || sample.timestamp || data.last_updated || msg.ts),
          data
        })
      }

      events.sort((a, b) => a.ts - b.ts)
      if (events.length > 0) groups.push(events)
    }

    return groups
  }

  const replayBatch = (msg) => {
    const groups = collectBatchEventGroups(msg)
    if (groups.length === 0) return

    for (const events of groups) {
      const firstTs = events[0].ts
      for (const event of events) {
        const delay = Math.max(0, Math.min(event.ts - firstTs, MAX_REPLAY_DELAY))
        const timer = setTimeout(() => {
          replayTimers.delete(timer)
          emitUpdate(event)
        }, delay)
        replayTimers.add(timer)
      }
    }
  }

  const connect = () => {
    manualClose = false
    try {
      ws = new WebSocket(`${getWsBaseByIndex(apiIndex)}/api/ws?subscribe=${encodeURIComponent(scope)}`)
    } catch (e) {
      setStatus(false, 'WebSocket not supported')
      return
    }

    ws.addEventListener('open', () => {
      reconnectDelay = TIME.RECONNECT_INITIAL_DELAY_MS
      reconnectAttempts = 0
      try {
        ws.send(JSON.stringify({
          type: 'subscribe',
          scope,
          ids: Array.isArray(serverIds) ? serverIds : []
        }))
      } catch (_) {}
      setStatus(true, 'connected')
    })

    ws.addEventListener('message', (event) => {
      let msg = null
      try {
        msg = typeof event.data === 'string' ? JSON.parse(event.data) : null
      } catch (_) { return }
      if (!msg) return

      if (shouldReplay && msg.type === 'batchUpdate') {
        replayBatch(msg)
      }
      if (typeof onMessage === 'function') onMessage(msg)
    })

    ws.addEventListener('close', () => {
      setStatus(false, 'disconnected')
      scheduleReconnect()
    })

    ws.addEventListener('error', () => {
      setStatus(false, 'error')
      try { ws.close() } catch (_) {}
    })
  }

  const scheduleReconnect = () => {
    if (manualClose) return
    if (reconnectTimer) return
    if (reconnectAttempts >= TIME.MAX_RECONNECT_ATTEMPTS) {
      setStatus(false, 'max reconnect attempts reached')
      return
    }

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      reconnectAttempts++
      const delay = reconnectDelay
      reconnectDelay = Math.min(reconnectDelay * 2, TIME.RECONNECT_MAX_DELAY_MS)
      setTimeout(connect, delay)
    }, 50)
  }

  connect()

  return {
    close() {
      manualClose = true
      reconnectAttempts = TIME.MAX_RECONNECT_ATTEMPTS
      clearReplayTimers()
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
      if (ws) { try { ws.close() } catch (_) {} ws = null }
    },
    reconnect() {
      manualClose = false
      reconnectAttempts = 0
      clearReplayTimers()
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
      if (ws) { try { ws.close() } catch (_) {} ws = null }
      connect()
    },
    get isConnected() {
      return isConnected
    }
  }
}

export const getFlagRegionCode = (region) => {
  const code = (region || '').toUpperCase()
  if (code === 'TW' || code === 'HK' || code === 'MO') return 'cn'
  return code.toLowerCase()
}

export const formatBytes = (bytes) => {
  bytes = parseFloat(bytes) || 0
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  const safeIndex = Math.max(0, Math.min(i, sizes.length - 1))
  return parseFloat((bytes / Math.pow(k, safeIndex)).toFixed(2)) + ' ' + sizes[safeIndex]
}

export const getTrafficUsagePercent = (server) => {
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

  return ((usedBytes / limitBytes) * 100).toFixed(1)
}

export const isServerOnline = (server, now = Date.now()) => {
  const lastUpdated = normalizeTimestamp(server?.report_timestamp ?? server?.last_updated)
  return lastUpdated && (now - lastUpdated) < TIME.ONLINE_THRESHOLD_MS
}

export const fetchServers = async () => {
  const result = await http.get('/api/servers')
  if (result.error) return null
  return result.data
}

export const fetchServersAll = async () => {
  const results = await http.getAll('/api/servers')
  const multiSite = hasMultipleApiBases()
  const localTitle = getTitle() || DEFAULT_SITE_TITLE
  const localBg = getBackgroundImage()

  const mergedData = createEmptyMergedData()
  mergedData.sysConfig.site_title = multiSite ? localTitle : DEFAULT_SITE_TITLE
  mergedData.sysConfig.backgroundImage = multiSite ? localBg : ''

  for (const result of results) {
    mergeSiteResult(mergedData, result, multiSite, localTitle, localBg)
  }

  return mergedData
}

const createEmptyMergedData = () => ({
  servers: [],
  stats: { total: 0, online: 0, offline: 0, globalNetRx: 0, globalNetTx: 0, globalSpeedIn: 0, globalSpeedOut: 0 },
  regionStats: {},
  sysConfig: {
    show_price: true,
    show_expire: true,
    show_bw: true,
    show_tf: true,
    show_time: true,
    site_title: DEFAULT_SITE_TITLE,
    backgroundImage: ''
  }
})

const mergeSiteResult = (mergedData, { data, error, baseUrl }, multiSite, localTitle, localBg) => {
  if (error || !data) return

  const rawServers = Array.isArray(data.servers)
    ? data.servers
    : Object.entries(data.latestMetricsMap || {}).map(([id, metrics]) => ({ id, ...metrics }))

  for (const server of rawServers) {
    mergedData.servers.push({ ...server, source: baseUrl })
  }

  if (data.stats) {
    mergedData.stats.total += data.stats.total || 0
    mergedData.stats.online += data.stats.online || 0
    mergedData.stats.offline += data.stats.offline || 0
    mergedData.stats.globalNetRx += data.stats.globalNetRx || 0
    mergedData.stats.globalNetTx += data.stats.globalNetTx || 0
    mergedData.stats.globalSpeedIn += data.stats.globalSpeedIn || 0
    mergedData.stats.globalSpeedOut += data.stats.globalSpeedOut || 0
  }

  if (data.regionStats) {
    for (const code in data.regionStats) {
      mergedData.regionStats[code] = (mergedData.regionStats[code] || 0) + data.regionStats[code]
    }
  }

  if (data.sysConfig) {
    mergedData.sysConfig = {
      show_price: data.sysConfig.show_price ?? mergedData.sysConfig.show_price,
      show_expire: data.sysConfig.show_expire ?? mergedData.sysConfig.show_expire,
      show_bw: data.sysConfig.show_bw ?? mergedData.sysConfig.show_bw,
      show_tf: data.sysConfig.show_tf ?? mergedData.sysConfig.show_tf,
      show_time: data.sysConfig.show_time ?? mergedData.sysConfig.show_time,
      site_title: multiSite ? localTitle : (data.sysConfig.site_title || mergedData.sysConfig.site_title),
      backgroundImage: multiSite ? localBg : (data.sysConfig.backgroundImage || mergedData.sysConfig.backgroundImage || '')
    }
  }
}

export const fetchServersAllWithProgress = async (onResult) => {
  const multiSite = hasMultipleApiBases()
  const localTitle = getTitle() || DEFAULT_SITE_TITLE
  const localBg = getBackgroundImage()

  const mergedData = createEmptyMergedData()
  mergedData.sysConfig.site_title = multiSite ? localTitle : DEFAULT_SITE_TITLE
  mergedData.sysConfig.backgroundImage = multiSite ? localBg : ''

  let corsErrorSites = []

  await http.getAllWithProgress('/api/servers', (result) => {
    mergeSiteResult(mergedData, result, multiSite, localTitle, localBg)
    if (result.corsError && !corsErrorSites.includes(result.baseUrl)) corsErrorSites.push(result.baseUrl)
    onResult({ ...mergedData, corsErrorSites })
  })

  return mergedData
}

export const fetchServerDetail = async (id, apiIndex = 0) => {
  const result = await http.getByIndex(`/api/server?id=${id}`, apiIndex)
  if (result.error) return null
  return result.data
}

export const fetchAllHistory = async (id, hours, apiIndex = 0) => {
  const result = await http.getByIndex(`/api/history/all?id=${id}&hours=${hours}`, apiIndex)
  if (result.error) {
    const error = new Error(result.error)
    error.code = result.code
    error.status = result.status
    error.message = result.message || result.error
    throw error
  }
  return result.data
}

export const adminApi = async (data, apiIndex = 0) => {
  const result = await http.postByIndex('/admin/api', data, apiIndex)
  return result
}

export const login = async (username, password, turnstileToken = '', apiIndex = 0) => {
  if (turnstileToken) {
    localStorage.setItem('turnstile_token', turnstileToken)
  }
  const result = await http.postByIndex('/admin/api', { action: 'login', username, password }, apiIndex, { autoRedirect: false })
  
  if (!result.error && result.data && result.data.token) {
    localStorage.setItem('jwt_token', result.data.token)
  }
  return result
}

export const logout = () => {
  localStorage.removeItem('jwt_token')
}

export const fetchConfig = async () => {
  const result = await http.get('/api/config', { includeAuth: true, includeTurnstile: false })
  if (result.error) return null
  if (result.data && result.data.version) {
    VERSION.value = result.data.version
  }
  return result.data
}

export const upgradeDatabase = async (apiIndex = 0) => {
  const result = await http.postByIndex('/updateDatabase', {}, apiIndex, { autoRedirect: false })
  if (result.error) {
    if (result.status === 401) {
      return { success: false, error: 'Unauthorized' }
    }
    return { success: false, error: 'Request failed' }
  }
  return result.data
}

export const rebuildDatabase = async (apiIndex = 0) => {
  const result = await http.postByIndex('/rebuild', {}, apiIndex, { autoRedirect: false })
  if (result.error) {
    if (result.status === 401) {
      return { success: false, error: 'Unauthorized' }
    }
    return { success: false, error: 'Request failed' }
  }
  return result.data
}

export const optimizeHistoryIndex = async (apiIndex = 0) => {
  const result = await http.postByIndex('/optimizeHistoryIndex', {}, apiIndex, { autoRedirect: false })
  if (result.error) {
    if (result.status === 401) {
      return { success: false, error: 'Unauthorized' }
    }
    return { success: false, error: 'Request failed' }
  }
  return result.data
}

export { isAdminLoggedIn }
