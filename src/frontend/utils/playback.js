function toFiniteNumber(value, fallback = null) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

export function resolvePlaybackCursor(
  firstSampleTs,
  currentDisplayTs,
  { replayCachedReport = false, reportAgeMs = 0 } = {}
) {
  const first = toFiniteNumber(firstSampleTs)
  if (first === null) return null

  if (replayCachedReport) {
    const age = Math.max(0, toFiniteNumber(reportAgeMs, 0))
    return first + age
  }

  const current = toFiniteNumber(currentDisplayTs)
  return current === null ? first : Math.max(first, current)
}

export function getPlaybackElapsedMs(nowTs, previousTickTs, fallbackMs = 1000) {
  const now = toFiniteNumber(nowTs)
  const previous = toFiniteNumber(previousTickTs)
  if (now === null || previous === null || now < previous) return Math.max(0, fallbackMs)
  return now - previous
}
