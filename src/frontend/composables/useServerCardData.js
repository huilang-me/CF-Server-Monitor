import { computed } from 'vue'
import { formatBytes, getFlagRegionCode, isServerOnline } from '../utils/api'
import { getPublicAssetUrl } from '../utils/config'
import { currentLang, useTranslation } from '../utils/i18n'
import { PING } from '../utils/constants'
import { formatBillingPrice } from '../utils/server.js'

export const DEFAULT_SERVER_CARD_CONFIG = {
  show_price: true,
  show_expire: true,
  show_tf: true,
  show_three_net_details: false,
  display_mode: 'bar'
}

const THREE_NET_DEFS = [
  { key: 'ct', pingField: 'ping_ct', lossField: 'loss_ct', labelKey: 'pingCt', fallbackLabel: 'CT' },
  { key: 'cu', pingField: 'ping_cu', lossField: 'loss_cu', labelKey: 'pingCu', fallbackLabel: 'CU' },
  { key: 'cm', pingField: 'ping_cm', lossField: 'loss_cm', labelKey: 'pingCm', fallbackLabel: 'CM' }
]

const DEFAULT_THREE_NET_POINT_COUNT = 30

const normalizeLatencyTimestamp = (value, fallback = 0) => {
  const timestamp = Number(value)
  if (!Number.isFinite(timestamp) || timestamp <= 0) return fallback
  return timestamp < 10000000000 ? timestamp * 1000 : timestamp
}

const normalizeProbeMetricValue = (value) => {
  if (value === false || value === 'false') return false
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

const formatPercentValue = (value) => {
  const number = Number(value)
  if (!Number.isFinite(number)) return '--'
  return `${Number.isInteger(number) ? number : number.toFixed(1)}%`
}

const trimFixed = (value, digits = 1) => {
  const number = Number(value)
  if (!Number.isFinite(number)) return ''
  return number.toFixed(digits).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1')
}

const formatCount = (value) => {
  const number = Number.parseInt(value, 10)
  if (!Number.isFinite(number) || number < 0) return '0'
  return number.toLocaleString('en-US')
}

export const getTrafficUsageBytes = (server) => {
  const rx = parseFloat(server.net_rx_monthly) || 0
  const tx = parseFloat(server.net_tx_monthly) || 0
  const calcType = server.traffic_calc_type || 'total'
  if (calcType === 'dl') return rx
  if (calcType === 'ul') return tx
  if (calcType === 'max') return Math.max(rx, tx)
  return rx + tx
}

export const calcTrafficUsagePercent = (server) => {
  const limit = parseFloat(server.traffic_limit) || 0
  if (limit <= 0) return 0
  const limitBytes = limit * 1024 * 1024 * 1024
  const usedBytes = getTrafficUsageBytes(server)
  return (usedBytes / limitBytes) * 100
}

const clampPercent = (value) => {
  const num = Number(value)
  if (!Number.isFinite(num)) return 0
  return Math.max(0, Math.min(100, num))
}

export const getUsageColor = (percent) => {
  const p = clampPercent(percent)
  if (p >= 95) return 'var(--accent-red)'
  if (p >= 80) return 'var(--accent-yellow)'
  if (p >= 50) return 'var(--accent-blue)'
  return 'var(--accent-green)'
}

export function useServerCardData(props) {
  const trans = useTranslation()

  const currentTime = computed(() => {
    const ts = Number(props.server.current_timestamp)
    if (Number.isFinite(ts) && ts > 0) {
      return ts < 10000000000 ? ts * 1000 : ts
    }
    return Date.now()
  })

  const regionCode = computed(() => getFlagRegionCode(props.server.region))
  const isOnline = computed(() => isServerOnline(props.server, currentTime.value))
  const statusColor = computed(() => isOnline.value ? 'var(--accent-green)' : 'var(--accent-red)')
  const statusText = computed(() => isOnline.value ? trans.value.online : trans.value.offline)

  const cpuPercent = computed(() => clampPercent(Number.parseFloat(props.server.cpu || 0) || 0))
  const cpuCores = computed(() => parseInt(props.server.cpu_cores) || 0)
  const ramPercent = computed(() => {
    const total = Number.parseFloat(props.server.ram_total) || 0
    if (total > 0) {
      return clampPercent(((Number.parseFloat(props.server.ram_used) || 0) / total) * 100)
    }
    return 0
  })
  const swapTotal = computed(() => Number.parseFloat(props.server.swap_total) || 0)
  const swapUsed = computed(() => Number.parseFloat(props.server.swap_used) || 0)
  const hasSwapData = computed(() => swapTotal.value > 0)
  const swapPercent = computed(() => hasSwapData.value ? clampPercent((swapUsed.value / swapTotal.value) * 100) : 0)
  const diskPercent = computed(() => {
    const total = Number.parseFloat(props.server.disk_total) || 0
    if (total > 0) {
      return clampPercent(((Number.parseFloat(props.server.disk_used) || 0) / total) * 100)
    }
    return 0
  })

  const trafficLimitSummary = computed(() => {
    const limitGb = Number.parseFloat(props.server.traffic_limit) || 0
    if (limitGb <= 0) return null
    const limitBytes = limitGb * 1024 * 1024 * 1024
    const usedBytes = getTrafficUsageBytes(props.server)
    return {
      usedBytes,
      limitBytes,
      percent: (usedBytes / limitBytes) * 100
    }
  })

  const trafficUsagePercent = computed(() => trafficLimitSummary.value ? trafficLimitSummary.value.percent : 0)
  const trafficUsagePercentText = computed(() => trafficUsagePercent.value.toFixed(2))
  const trafficLimitPercentText = computed(() => {
    if (!trafficLimitSummary.value) return '0.0'
    return trafficUsagePercent.value.toFixed(1)
  })
  const trafficLimitText = computed(() => {
    if (trafficLimitSummary.value){
      return `${formatBytes(trafficLimitSummary.value.usedBytes)} / ${formatBytes(trafficLimitSummary.value.limitBytes)}`
    }else{
      return `↓ ${totalRxMonthly.value} ↑ ${totalTxMonthly.value}`
    }
  })

  const tagList = computed(() => String(props.server.tags || '')
    .split(',')
    .map(tag => tag.trim())
    .filter(Boolean)
  )
  const tagColorClass = (index) => `tag-color-${index % 6}`
  const hasPublicIPv4 = computed(() => String(props.server.ip_v4 ?? '').trim() === '1')
  const hasPublicIPv6 = computed(() => String(props.server.ip_v6 ?? '').trim() === '1')

  const netInSpeed = computed(() => formatBytes(props.server.net_in_speed))
  const netOutSpeed = computed(() => formatBytes(props.server.net_out_speed))
  const tcpConn = computed(() => formatCount(props.server.tcp_conn))
  const udpConn = computed(() => formatCount(props.server.udp_conn))
  const connPair = computed(() => `${tcpConn.value} / ${udpConn.value}`)
  const totalRx = computed(() => formatBytes(props.server.net_rx))
  const totalTx = computed(() => formatBytes(props.server.net_tx))
  const totalRxMonthly = computed(() => formatBytes(props.server.net_rx_monthly))
  const totalTxMonthly = computed(() => formatBytes(props.server.net_tx_monthly))
  const priceText = computed(() => formatBillingPrice(props.server, currentLang.value))

  const formatDateOnly = (value) => {
    const raw = String(value || '').trim()
    if (!raw) return ''
    const dateOnly = raw.match(/^(\d{4}-\d{2}-\d{2})/)?.[1]
    if (dateOnly) return dateOnly

    const date = new Date(raw)
    if (Number.isNaN(date.getTime())) return ''
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0')
    ].join('-')
  }

  const expireDateTitle = computed(() => {
    const expireDate = formatDateOnly(props.server.expire_date)
    return expireDate ? `${trans.value.expirationDate || 'Expiration Date'}: ${expireDate}` : ''
  })

  const loadAvg = computed(() => {
    const raw = String(props.server.load_avg || '').trim()
    if (!raw) return [0, 0, 0]
    const parts = raw.split(/\s+/)
    return [parseFloat(parts[0]) || 0, parseFloat(parts[1]) || 0, parseFloat(parts[2]) || 0]
  })

  const formatUptime = (bootTime, nowTs = Date.now()) => {
    if (!bootTime) return 'N/A'

    let bootTimeMs = null
    if (typeof bootTime === 'string' && !/^\d+$/.test(bootTime)) {
      const parsed = new Date(bootTime)
      if (!Number.isNaN(parsed.getTime())) {
        bootTimeMs = parsed.getTime()
      }
    } else {
      const timestamp = Number.parseInt(bootTime)
      if (Number.isFinite(timestamp)) {
        bootTimeMs = timestamp < 1000000000000 ? timestamp * 1000 : timestamp
      }
    }

    if (!bootTimeMs) return 'N/A'

    const diffMs = nowTs - bootTimeMs
    if (diffMs < 0) return 'N/A'

    const totalSeconds = Math.floor(diffMs / 1000)
    const days = Math.floor(totalSeconds / 86400)
    const hours = Math.floor((totalSeconds % 86400) / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60
    const zh = currentLang.value === 'zh'
    const parts = []

    if (days > 0) parts.push(zh ? `${days}天` : `${days}d`)
    if (hours > 0) parts.push(zh ? `${hours}小时` : `${hours}h`)
    if (minutes > 0) parts.push(zh ? `${minutes}分` : `${minutes}m`)
    if (seconds > 0 || parts.length === 0) parts.push(zh ? `${seconds}秒` : `${seconds}s`)

    return parts.slice(0, 3).join(' ')
  }

  const uptimeText = computed(() => formatUptime(props.server.boot_time, currentTime.value))

  const formatMetricUsage = (used, total) => `${formatBytes((Number(used) || 0) * 1024 * 1024)} / ${formatBytes((Number(total) || 0) * 1024 * 1024)}`
  const ramUsageText = computed(() => formatMetricUsage(props.server.ram_used, props.server.ram_total))
  const diskUsageText = computed(() => formatMetricUsage(props.server.disk_used, props.server.disk_total))

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

  const getRingStyle = (value, color) => ({
    '--ring-value': `${clampPercent(value)}`,
    '--ring-color': color
  })

  const getMemoryRingStyle = (ramValue, ramColor, swapValue, swapColor) => ({
    ...getRingStyle(ramValue, ramColor),
    '--swap-ring-value': `${clampPercent(swapValue)}`,
    '--swap-ring-color': swapColor
  })

  const roundedPercent = (value) => Math.round(clampPercent(value))

  const isPingValid = (ping) => {
    if (isPingDisabled(ping)) return false
    if (ping === null || ping === undefined || ping === '' || ping === '0') {
      return false
    }
    const val = parseInt(ping)
    return val > 0
  }

  const isPingDisabled = (ping) => ping === false || ping === 'false'

  const getPingColor = (ping) => {
    if (!isPingValid(ping)) return 'var(--accent-red)'
    const val = parseInt(ping)
    if (val < PING.GOOD_THRESHOLD) return 'var(--accent-green)'
    if (val < PING.WARNING_THRESHOLD) return 'var(--accent-blue)'
    if (val < PING.CRITICAL_THRESHOLD) return 'var(--accent-yellow)'
    return 'var(--accent-red)'
  }

  const getLossColor = (loss) => {
    const value = normalizeProbeMetricValue(loss)
    if (value === null || value === false) return 'rgba(255, 255, 255, 0.08)'
    if (value <= 0) return 'var(--accent-green)'
    if (value < 5) return 'var(--accent-blue)'
    if (value < 20) return 'var(--accent-yellow)'
    return 'var(--accent-red)'
  }

  const formatPingValue = (value) => isPingValid(value) ? `${Math.round(Number(value))}ms` : trans.value.timeout
  const formatLossValue = (value) => formatPercentValue(normalizeProbeMetricValue(value))
  const noSampleText = computed(() => currentLang.value === 'zh' ? '无样本' : 'No samples')

  const formatLatencyTimeText = (timestamp) => {
    const startTs = normalizeLatencyTimestamp(timestamp, 0)
    if (!startTs) return ''
    const date = new Date(startTs)
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  }

  const formatBucketTooltip = (timestamp, summary) => {
    const timeText = formatLatencyTimeText(timestamp)
    return timeText ? `${timeText} · ${summary}` : summary
  }

  const formatPingBucketSummary = (hasPing, ping, offline) => {
    if (offline) return trans.value.offline
    if (hasPing) return `${trimFixed(ping, 1)} ms`
    return noSampleText.value
  }

  const formatLossBucketSummary = (hasLoss, loss, offline) => {
    if (offline) return trans.value.offline
    if (hasLoss) return `${trimFixed(loss, 1)}%`
    return noSampleText.value
  }

  const getLatencySeries = (seriesName, key) => {
    const source = Array.isArray(props.server[seriesName]) ? props.server[seriesName] : []
    return source
      .map(point => {
        if (!point || typeof point !== 'object') return null
        const ts = normalizeLatencyTimestamp(point.ts ?? point.timestamp, 0)
        if (!ts) return null
        return { ts, value: normalizeProbeMetricValue(point[key]) }
      })
      .filter(point => point && point.value !== false)
      .sort((a, b) => a.ts - b.ts)
  }

  const getLatestSeriesValue = (series, fallback) => {
    for (let index = series.length - 1; index >= 0; index -= 1) {
      if (series[index].value !== null) return series[index].value
    }
    const value = normalizeProbeMetricValue(fallback)
    return value === false ? null : value
  }

  const getAverageSeriesValue = (series, fallback) => {
    const values = series
      .map(point => normalizeProbeMetricValue(point.value))
      .filter(value => typeof value === 'number' && Number.isFinite(value))
    if (values.length > 0) {
      return values.reduce((sum, value) => sum + value, 0) / values.length
    }
    const value = normalizeProbeMetricValue(fallback)
    return value === false ? null : value
  }

  const getLatencyWindowPointCount = () => {
    const pingCount = Array.isArray(props.server.ping) ? props.server.ping.length : 0
    const lossCount = Array.isArray(props.server.loss) ? props.server.loss.length : 0
    return Math.max(pingCount, lossCount, DEFAULT_THREE_NET_POINT_COUNT)
  }

  const threeNetDetails = computed(() => THREE_NET_DEFS
    .map(def => {
      const label = trans.value[def.labelKey] || def.fallbackLabel
      const pingSeries = getLatencySeries('ping', def.key)
      const lossSeries = getLatencySeries('loss', def.key)
      const pointCount = Math.max(pingSeries.length, lossSeries.length, getLatencyWindowPointCount())
      const points = Array.from({ length: pointCount }, (_, index) => {
        const pingPoint = pingSeries[index] ?? null
        const lossPoint = lossSeries[index] ?? null
        const ping = pingPoint?.value ?? null
        const loss = lossPoint?.value ?? null
        const timestamp = pingPoint?.ts ?? lossPoint?.ts ?? null
        const hasPing = typeof ping === 'number' && Number.isFinite(ping) && ping >= 0
        const hasLoss = typeof loss === 'number' && Number.isFinite(loss)
        const offline = !hasPing && !hasLoss
        const pingSummary = formatPingBucketSummary(hasPing, ping, offline)
        const lossSummary = formatLossBucketSummary(hasLoss, loss, offline)
        return {
          ping,
          loss,
          pingHeight: hasPing ? 84 : 25,
          lossHeight: 84,
          pingColor: hasPing ? getPingColor(ping) : 'var(--accent-red)',
          lossColor: offline ? 'var(--accent-red)' : getLossColor(loss),
          pingOpacity: hasPing ? 0.94 : 0.52,
          lossOpacity: hasLoss ? 0.94 : (offline ? 0.52 : 0.42),
          pingTooltip: formatBucketTooltip(timestamp, pingSummary),
          lossTooltip: formatBucketTooltip(timestamp, lossSummary)
        }
      })
      const hasMeasuredPoint = points.some(point => (
        (typeof point.ping === 'number' && Number.isFinite(point.ping)) ||
        (typeof point.loss === 'number' && Number.isFinite(point.loss))
      ))

      return {
        ...def,
        label,
        latestPing: getLatestSeriesValue(pingSeries, props.server[def.pingField]),
        averageLoss: getAverageSeriesValue(lossSeries, props.server[def.lossField]),
        title: hasMeasuredPoint ? '' : `${label} ${trans.value.offline}`,
        points
      }
    })
  )

  const hasThreeNetDetails = computed(() => threeNetDetails.value.length > 0)

  const pingList = computed(() => [
    { label: 'CT', value: props.server.ping_ct },
    { label: 'CU', value: props.server.ping_cu },
    { label: 'CM', value: props.server.ping_cm },
    { label: 'BGP', value: props.server.ping_bd }
  ].filter(ping => !isPingDisabled(ping.value)))

  const hasPingData = computed(() => pingList.value.length > 0)

  return {
    trans,
    currentTime,
    regionCode,
    isOnline,
    statusColor,
    statusText,
    cpuPercent,
    cpuCores,
    ramPercent,
    swapPercent,
    hasSwapData,
    diskPercent,
    trafficLimitSummary,
    trafficUsagePercent,
    trafficUsagePercentText,
    trafficLimitPercentText,
    trafficLimitText,
    tagList,
    tagColorClass,
    hasPublicIPv4,
    hasPublicIPv6,
    netInSpeed,
    netOutSpeed,
    tcpConn,
    udpConn,
    connPair,
    totalRx,
    totalTx,
    totalRxMonthly,
    totalTxMonthly,
    priceText,
    expireDateTitle,
    loadAvg,
    uptimeText,
    ramUsageText,
    diskUsageText,
    isExpired,
    expireText,
    getUsageColor,
    getRingStyle,
    getMemoryRingStyle,
    roundedPercent,
    isPingValid,
    isPingDisabled,
    getPingColor,
    getLossColor,
    formatPingValue,
    formatLossValue,
    pingList,
    hasPingData,
    threeNetDetails,
    hasThreeNetDetails,
    getPublicAssetUrl,
    formatBytes
  }
}
