import { LATENCY_WINDOW } from './constants.js'

// One refresh per dashboard latency block (2 hours / 20 blocks = 6 minutes by default).
export function getLatencyRefreshMs(latencyWindow = {}) {
  const points = Number(latencyWindow?.points) > 0 ? Number(latencyWindow.points) : LATENCY_WINDOW.POINTS
  const hours = Number(latencyWindow?.hours) > 0 ? Number(latencyWindow.hours) : LATENCY_WINDOW.HOURS
  return Math.round((hours * 60 * 60 * 1000) / points)
}

const serverKey = server => `${server?.source ?? ''}|${server?.id ?? ''}`

// Replaces only the ping/loss windows so live metrics already on screen are kept.
export function mergeLatencyWindows(currentServers, freshServers) {
  const freshByKey = new Map()
  for (const server of freshServers || []) {
    if (server?.id && Array.isArray(server.ping) && Array.isArray(server.loss)) {
      freshByKey.set(serverKey(server), server)
    }
  }

  return (currentServers || []).map(server => {
    const fresh = freshByKey.get(serverKey(server))
    return fresh ? { ...server, ping: fresh.ping, loss: fresh.loss } : server
  })
}
