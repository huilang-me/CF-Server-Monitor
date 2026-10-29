import { insertServerWithPartition } from '../database/indexOptimization.js';
import { clearServersListCache } from './cache.js';
import { normalizeBooleanSetting } from './settings.js';

// Agent 首次上报（id 为空）时自动建号：站点开关 + 去重 + 静默失败。
// 失败只写 console.warn，不重试、不触发任何通知。

export const AUTO_DISCOVERY_STATUS_HEADER = 'X-CFSM-Auto-Discovery';
export const AUTO_DISCOVERY_SERVER_ID_HEADER = 'X-CFSM-Server-Id';

export const AUTO_DISCOVERY_MODE_CREATED = 'created';
export const AUTO_DISCOVERY_MODE_REUSED = 'reused';
export const AUTO_DISCOVERY_MODE_FAILED = 'failed';

export const AUTO_DISCOVERY_ERROR_NO_NAME = 'no_name';
export const AUTO_DISCOVERY_ERROR_DB = 'db_error';

const MAX_NAME_LENGTH = 100;
const MAX_IP_LENGTH = 64;

export function isAutoDiscoveryEnabled(settings = {}) {
  return normalizeBooleanSetting(settings?.auto_discovery) === 'true';
}

function sanitizeServerName(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, MAX_NAME_LENGTH);
}

function sanitizeIpValue(value) {
  const ip = String(value ?? '').trim();
  if (!ip || ip.length > MAX_IP_LENGTH) return '';
  if (!/^[0-9A-Fa-f:.]+$/.test(ip)) return '';
  // Agent 在公网 IP 查询失败时会回填 "0"（见 buildMetrics 的 firstNonEmpty(probes.IPv4, "0")），
  // 必须排除这类占位值，否则会建出名为 "0" 的服务器。
  if (/^0+(\.0+)*$/.test(ip)) return '';
  if (!ip.includes('.') && !ip.includes(':')) return '';
  return ip;
}

// 名称优先级：显式 name（≤100 字符）→ 连接来源 IP（CF-Connecting-IP）。
export function resolveDiscoveredServerName({ name, request } = {}) {
  const explicit = sanitizeServerName(name);
  if (explicit) return explicit;

  return sanitizeIpValue(request?.headers?.get('CF-Connecting-IP'));
}

async function findServerIdByName(db, name) {
  const row = await db.prepare(
    'SELECT id FROM servers WHERE name = ? ORDER BY sort_order ASC, timestamp ASC, id ASC LIMIT 1'
  ).bind(name).first();
  return row?.id || '';
}

async function createServerRow(db, name) {
  const id = crypto.randomUUID();
  // 分区号在 INSERT 内原子分配，不再依赖 servers 列表缓存，多台机器同时自动发现也不会撞号。
  await insertServerWithPartition(db, { id, name });
  return id;
}

// 返回 { id, mode, code }；mode=failed 时 id 为空，调用方按原有 404 处理。
export async function discoverServer(env, options = {}) {
  const name = resolveDiscoveredServerName(options);
  if (!name) {
    console.warn('[AutoDiscovery] skipped: no name', {
      has_metrics: !!options.metrics,
      has_request: !!options.request
    });
    return { id: '', mode: AUTO_DISCOVERY_MODE_FAILED, code: AUTO_DISCOVERY_ERROR_NO_NAME };
  }

  const db = env.DB;

  let existingId = '';
  try {
    existingId = await findServerIdByName(db, name);
  } catch (e) {
    console.warn('[AutoDiscovery] dedupe lookup failed', { name, error: e?.message || e });
    return { id: '', mode: AUTO_DISCOVERY_MODE_FAILED, code: AUTO_DISCOVERY_ERROR_DB };
  }

  if (existingId) {
    console.warn('[AutoDiscovery] reused', { id: existingId, name });
    return { id: existingId, mode: AUTO_DISCOVERY_MODE_REUSED, code: '' };
  }

  let createdId = '';
  try {
    createdId = await createServerRow(db, name);
  } catch (e) {
    console.warn('[AutoDiscovery] create failed', { name, error: e?.message || e });
    return { id: '', mode: AUTO_DISCOVERY_MODE_FAILED, code: AUTO_DISCOVERY_ERROR_DB };
  }

  clearServersListCache();

  // 并发兜底：同名的另一条先落库时，保留更早的一条并丢弃刚插入的空壳。
  try {
    const winnerId = await findServerIdByName(db, name);
    if (winnerId && winnerId !== createdId) {
      await db.prepare('DELETE FROM servers WHERE id = ?').bind(createdId).run();
      clearServersListCache();
      console.warn('[AutoDiscovery] reused', { id: winnerId, name });
      return { id: winnerId, mode: AUTO_DISCOVERY_MODE_REUSED, code: '' };
    }
  } catch (e) {
    console.warn('[AutoDiscovery] dedupe recheck failed', { name, error: e?.message || e });
  }

  console.warn('[AutoDiscovery] created', { id: createdId, name });
  return { id: createdId, mode: AUTO_DISCOVERY_MODE_CREATED, code: '' };
}
