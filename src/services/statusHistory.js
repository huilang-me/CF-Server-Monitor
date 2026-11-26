import { getLatestTimestampsForAllServers } from '../database/schema.js';
import {
  ensureStatusHistoryTable,
  getServerStatusHistory,
  pruneServerStatusHistory,
  recordServerStatusTransitions
} from '../database/statusHistory.js';
import { getAllServers } from '../utils/cache.js';

export async function checkAndRecordServerStatusHistory(db, options = {}) {
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  await ensureStatusHistoryTable(db);

  const servers = await getAllServers(db, true);
  if (!servers.length) return { success: true, recorded: 0 };

  const latestTimestamps = await getLatestTimestampsForAllServers(db, { servers });
  if (!latestTimestamps) {
    return { success: false, recorded: 0, reason: 'latest-report-query-failed' };
  }

  const recorded = await recordServerStatusTransitions(db, servers, latestTimestamps, now);
  return { success: true, recorded };
}

export async function fetchServerStatusHistory(db, serverIds, options = {}) {
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  return getServerStatusHistory(db, serverIds, now);
}

export async function pruneOldServerStatusHistory(db, now = Date.now()) {
  return pruneServerStatusHistory(db, now);
}
