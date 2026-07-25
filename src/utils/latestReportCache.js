const LATEST_REPORT_TTL_MS = 5 * 60 * 1000;
const MAX_LATEST_REPORT_SERVERS = 1000;

// 普通 Worker isolate 内的尽力而为缓存；不同 isolate 之间不共享。
const latestReportUpdates = new Map();

function normalizeTimestamp(value, fallback = 0) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return fallback;
  return timestamp < 10000000000 ? timestamp * 1000 : timestamp;
}

function getLatestSampleTimestamp(samples) {
  if (!Array.isArray(samples)) return 0;
  let latest = 0;
  for (const sample of samples) {
    if (!sample || typeof sample !== 'object') continue;
    const data = sample.data || sample.payload || sample.metrics || {};
    const timestamp = normalizeTimestamp(
      sample.ts ?? sample.timestamp ?? data.sample_timestamp ?? data.last_updated ?? data.timestamp,
      0
    );
    if (timestamp > latest) latest = timestamp;
  }
  return latest;
}

function pruneLatestReportUpdates(now = Date.now()) {
  for (const [serverId, update] of latestReportUpdates) {
    if (!update || now - update.reportTs > LATEST_REPORT_TTL_MS) {
      latestReportUpdates.delete(serverId);
    }
  }
}

export function cacheLatestReportUpdate(serverId, samples, reportTs = Date.now()) {
  if (!serverId || !Array.isArray(samples) || samples.length === 0) return;

  const now = Date.now();
  const normalizedReportTs = normalizeTimestamp(reportTs, now);
  if (now - normalizedReportTs > LATEST_REPORT_TTL_MS) return;

  pruneLatestReportUpdates(now);
  const normalizedServerId = String(serverId);
  const latestSampleTs = getLatestSampleTimestamp(samples);
  const existing = latestReportUpdates.get(normalizedServerId);

  if (existing) {
    if (existing.latestSampleTs > latestSampleTs) return;
    // 同一包从 DO 回填时保留更早的 Worker 接收时间，保证回放偏移准确。
    if (existing.latestSampleTs === latestSampleTs) {
      existing.reportTs = Math.min(existing.reportTs, normalizedReportTs);
      return;
    }
  }

  latestReportUpdates.delete(normalizedServerId);
  latestReportUpdates.set(normalizedServerId, {
    serverId: normalizedServerId,
    reportTs: normalizedReportTs,
    latestSampleTs,
    samples
  });

  while (latestReportUpdates.size > MAX_LATEST_REPORT_SERVERS) {
    const oldestServerId = latestReportUpdates.keys().next().value;
    if (oldestServerId === undefined) break;
    latestReportUpdates.delete(oldestServerId);
  }
}

export function getWorkerLatestReportUpdates(serverIds, now = Date.now()) {
  pruneLatestReportUpdates(now);
  if (!Array.isArray(serverIds)) return [];

  const updates = [];
  for (const serverId of serverIds) {
    const update = latestReportUpdates.get(String(serverId));
    if (!update) continue;
    const { latestSampleTs: _latestSampleTs, ...publicUpdate } = update;
    updates.push({
      ...publicUpdate,
      reportAgeMs: Math.max(0, now - update.reportTs)
    });
  }
  return updates;
}

export function getLatestReportSampleTimestamp(update) {
  return getLatestSampleTimestamp(update?.samples);
}
