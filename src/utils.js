export const HISTORY_HOURS = ['0.167', '0.5', '1', '6', '12', '24', '48', '96', '168']

export function validHistoryHours(value) {
  return HISTORY_HOURS.includes(String(value))
}

export function isOnline(lastUpdated, now = Date.now()) {
  const timestamp = Number(lastUpdated)
  return Number.isFinite(timestamp) && timestamp > 0 && now - timestamp < 5 * 60 * 1000
}

export function formatBytes(value) {
  let bytes = Number(value)
  if (!Number.isFinite(bytes) || bytes < 0) bytes = 0
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let index = 0
  while (bytes >= 1024 && index < units.length - 1) {
    bytes /= 1024
    index++
  }
  return bytes.toFixed(index === 0 ? 0 : 1) + ' ' + units[index]
}

export function metricLabel(value) {
  if (value === false || value === undefined) return 'hidden'
  if (value === null) return 'timeout'
  return 'value'
}

export function metricText(value, unit = '', language = 'en') {
  if (value === false || value === undefined) return '—'
  if (value === null) return language === 'zh' ? '超时' : 'Timeout'
  return String(value) + (unit ? ' ' + unit : '')
}

export function normalizeGpu(value) {
  if (typeof value === 'string') {
    try { value = JSON.parse(value) } catch { return [] }
  }
  if (!Array.isArray(value)) return []
  return value.filter(item => item && typeof item === 'object' && !Array.isArray(item))
}
