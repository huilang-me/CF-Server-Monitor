export const STATUS_HISTORY_WINDOW_SECONDS = 7 * 24 * 60 * 60;

const WRITE_BATCH_SIZE = 50;
const QUERY_ID_CHUNK_SIZE = 40;

export async function ensureStatusHistoryTable(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS server_status_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      server_id TEXT NOT NULL,
      status INTEGER NOT NULL CHECK (status IN (0, 1)),
      changed_at INTEGER NOT NULL,
      event_type TEXT NOT NULL CHECK (event_type IN ('baseline', 'transition'))
    )
  `).run();
  await db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_server_status_history_server_time
    ON server_status_history (server_id, changed_at, id)
  `).run();
}

/**
 * Record one baseline per server, then append only observed status transitions.
 * Timestamps use Unix seconds; status is based on the same five-minute freshness
 * window as the server list API. The SQL checks the previous state atomically so
 * concurrent cron invocations do not create duplicate same-state records.
 */
export async function recordServerStatusTransitions(db, servers, latestTimestamps, now = Date.now(), thresholdMs = 5 * 60 * 1000) {
  await ensureStatusHistoryTable(db);
  if (!Array.isArray(servers) || servers.length === 0) return 0;

  const changedAt = Math.floor(now / 1000);
  const statements = [];
  for (const server of servers) {
    const serverId = String(server?.id || '');
    if (!serverId) continue;
    const lastTimestamp = Number(latestTimestamps?.get(server.id) ?? latestTimestamps?.get(serverId));
    const isOnline = Number.isFinite(lastTimestamp) && lastTimestamp > 0 && now - lastTimestamp < thresholdMs ? 1 : 0;

    statements.push(db.prepare(`
      INSERT INTO server_status_history (server_id, status, changed_at, event_type)
      SELECT ?, ?, ?, CASE WHEN EXISTS (
        SELECT 1 FROM server_status_history WHERE server_id = ?
      ) THEN 'transition' ELSE 'baseline' END
      WHERE COALESCE((
        SELECT status FROM server_status_history
        WHERE server_id = ?
        ORDER BY changed_at DESC, id DESC
        LIMIT 1
      ), -1) <> ?
    `).bind(serverId, isOnline, changedAt, serverId, serverId, isOnline));
  }

  let writes = 0;
  for (let offset = 0; offset < statements.length; offset += WRITE_BATCH_SIZE) {
    const result = await db.batch(statements.slice(offset, offset + WRITE_BATCH_SIZE));
    for (const item of result || []) writes += Number(item?.meta?.changes || 0);
  }
  return writes;
}

/**
 * Keep every record in the latest seven days and one state anchor before the
 * window for each server. That anchor makes the seven-day interval measurable
 * without retaining an unbounded transition log.
 */
export async function pruneServerStatusHistory(db, now = Date.now()) {
  await ensureStatusHistoryTable(db);
  const cutoff = Math.floor(now / 1000) - STATUS_HISTORY_WINDOW_SECONDS;
  const result = await db.prepare(`
    DELETE FROM server_status_history
    WHERE changed_at < ?
      AND id NOT IN (
        SELECT MAX(id)
        FROM server_status_history
        WHERE changed_at < ?
        GROUP BY server_id
      )
  `).bind(cutoff, cutoff).run();
  return Number(result?.meta?.changes || 0);
}

/**
 * Return a carry-forward state anchor and all records in the fixed seven-day
 * window for the requested, already-authorized server IDs.
 */
export async function getServerStatusHistory(db, serverIds, now = Date.now()) {
  await ensureStatusHistoryTable(db);
  const ids = [...new Set((Array.isArray(serverIds) ? serverIds : []).map((id) => String(id || '')).filter(Boolean))];
  const windowStart = Math.floor(now / 1000) - STATUS_HISTORY_WINDOW_SECONDS;
  const records = [];

  for (let offset = 0; offset < ids.length; offset += QUERY_ID_CHUNK_SIZE) {
    const chunk = ids.slice(offset, offset + QUERY_ID_CHUNK_SIZE);
    const placeholders = chunk.map(() => '?').join(', ');
    const result = await db.prepare(`
      WITH ranked AS (
        SELECT id, server_id, status, changed_at, event_type,
          ROW_NUMBER() OVER (PARTITION BY server_id ORDER BY changed_at DESC, id DESC) AS rank
        FROM server_status_history
        WHERE changed_at < ? AND server_id IN (${placeholders})
      )
      SELECT id, server_id, status, changed_at, event_type
      FROM ranked WHERE rank = 1
      UNION ALL
      SELECT id, server_id, status, changed_at, event_type
      FROM server_status_history
      WHERE server_id IN (${placeholders}) AND changed_at >= ?
      ORDER BY server_id ASC, changed_at ASC, id ASC
    `).bind(windowStart, ...chunk, ...chunk, windowStart).all();

    for (const row of result?.results || []) {
      records.push({
        server_id: String(row.server_id),
        t: Number(row.changed_at),
        is_online: Number(row.status) === 1 ? 1 : 0,
        event_type: String(row.event_type)
      });
    }
  }

  return {
    generated_at: Math.floor(now / 1000),
    window_start: windowStart,
    records
  };
}
