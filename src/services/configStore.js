const CONFIG_CACHE_ID = 'global';
const DEFAULT_L1_TTL_MS = 5_000;
const MAX_L1_TTL_MS = 60_000;
const MAX_HISTORY_PARTITION_ID = 900;

const localCache = {
  servers: { data: null, loadedAt: 0, expiresAt: 0, loading: null, generation: 0 },
  settings: { data: null, loadedAt: 0, expiresAt: 0, loading: null, generation: 0 }
};

function getL1Ttl(env) {
  const configured = Number(env?.CONFIG_L1_TTL_MS);
  if (!Number.isFinite(configured)) return DEFAULT_L1_TTL_MS;
  return Math.max(0, Math.min(MAX_L1_TTL_MS, Math.trunc(configured)));
}

function clearLocalCache(scope = 'all') {
  for (const key of scope === 'all' ? ['servers', 'settings'] : [scope]) {
    const state = localCache[key];
    if (!state) continue;
    state.generation++;
    state.data = null;
    state.loadedAt = 0;
    state.expiresAt = 0;
  }
}

function setLocalCache(scope, data, env) {
  const state = localCache[scope];
  if (!state) return data;
  const ttl = getL1Ttl(env);
  state.generation++;
  state.data = ttl > 0 ? data : null;
  state.loadedAt = ttl > 0 ? Date.now() : 0;
  state.expiresAt = ttl > 0 ? state.loadedAt + ttl : 0;
  return data;
}

async function readThroughLocalCache(scope, env, loader) {
  const state = localCache[scope];
  const now = Date.now();
  if (state.data !== null && now < state.expiresAt) return state.data;
  if (state.loading && state.loading.generation === state.generation) {
    return state.loading.promise;
  }

  const generation = state.generation;
  const loading = { generation, promise: null };
  loading.promise = Promise.resolve()
    .then(loader)
    .then(data => {
      if (state.generation === generation) setLocalCache(scope, data, env);
      return data;
    })
    .finally(() => {
      if (state.loading === loading) state.loading = null;
    });
  state.loading = loading;
  return loading.promise;
}

export function getLocalConfigCacheStatus(env) {
  const now = Date.now();
  const describe = state => ({
    cached: state.data !== null,
    fresh: state.data !== null && now < state.expiresAt,
    ageMs: state.data !== null ? now - state.loadedAt : null,
    expiresInMs: state.data !== null ? Math.max(0, state.expiresAt - now) : null,
    loading: state.loading !== null
  });
  return {
    ttlMs: getL1Ttl(env),
    servers: describe(localCache.servers),
    settings: describe(localCache.settings)
  };
}

export class VersionConflictError extends Error {
  constructor(resource, current = null) {
    super('versionConflict');
    this.name = 'VersionConflictError';
    this.code = 'VERSION_CONFLICT';
    this.status = 409;
    this.resource = resource;
    this.current = current;
  }
}

function getCacheStub(env) {
  if (!env?.CONFIG_CACHE) return null;
  const id = env.CONFIG_CACHE.idFromName(CONFIG_CACHE_ID);
  return env.CONFIG_CACHE.get(id);
}

async function readCacheJson(env, path) {
  const stub = getCacheStub(env);
  if (!stub) return null;
  const response = await stub.fetch(`http://internal${path}`);
  if (!response.ok) {
    const message = await response.text();
    throw new Error(`ConfigCache ${path} failed: ${response.status} ${message}`);
  }
  return response.json();
}

async function mutateSettingsThroughCache(env, action, body) {
  const stub = getCacheStub(env);
  if (!stub) return { handled: false, result: null };
  // 请求结果可能不明确，发起写入前就使 L1 失效；旧回源受 generation 保护。
  clearLocalCache('settings');
  const response = await stub.fetch(`http://internal/settings/mutate/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (response.status === 409) {
    throw new VersionConflictError(data.resource || 'settings', data.current || null);
  }
  if (!response.ok) {
    throw new Error(data.error || `ConfigCache settings mutation failed: ${response.status}`);
  }
  return { handled: true, result: data.result };
}

async function createServerThroughCache(env, server) {
  const stub = getCacheStub(env);
  if (!stub) return { handled: false, result: null };
  clearLocalCache('servers');
  const response = await stub.fetch('http://internal/servers/mutate/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(server)
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || `ConfigCache server creation failed: ${response.status}`);
  }
  return { handled: true, result: data.result };
}

async function readServersFromD1(env) {
  const { results = [] } = await env.DB.prepare(
    'SELECT * FROM servers ORDER BY sort_order ASC'
  ).all();
  return results;
}

async function readSettingsFromD1(env) {
  const { results = [] } = await env.DB.prepare(
    'SELECT key, value, version FROM settings'
  ).all();
  return results;
}

export async function readServers(env, options = {}) {
  const loader = async () => {
    const cached = await readCacheJson(env, '/servers');
    return cached ? cached.servers || [] : readServersFromD1(env);
  };
  if (options.bypassL1) return loader();
  return readThroughLocalCache('servers', env, loader);
}

export async function readSettingsRows(env) {
  return readThroughLocalCache('settings', env, async () => {
    const cached = await readCacheJson(env, '/settings');
    return cached ? cached.settings || [] : readSettingsFromD1(env);
  });
}

export async function refreshConfigCache(env, scope = 'all') {
  clearLocalCache(scope);
  const stub = getCacheStub(env);
  if (!stub) {
    if (scope === 'servers') {
      const servers = await readServersFromD1(env);
      return { servers };
    }
    if (scope === 'settings') {
      const settings = await readSettingsFromD1(env);
      return { settings };
    }
    const [servers, settings] = await Promise.all([
      readServersFromD1(env),
      readSettingsFromD1(env)
    ]);
    return { servers, settings };
  }

  const response = await stub.fetch('http://internal/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scope })
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(`ConfigCache refresh failed: ${response.status} ${message}`);
  }
  const data = await response.json();
  return data;
}

export async function invalidateConfigCache(env, scope = 'all') {
  clearLocalCache(scope);
  const stub = getCacheStub(env);
  if (!stub) return;
  const response = await stub.fetch('http://internal/invalidate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scope })
  });
  if (!response.ok) {
    throw new Error(`ConfigCache invalidate failed: ${response.status}`);
  }
}

async function refreshAfterWrite(env, scope, write) {
  let result;
  let writeError;
  try {
    result = await write();
  } catch (error) {
    writeError = error;
  }

  try {
    await refreshConfigCache(env, scope);
  } catch (refreshError) {
    try {
      await invalidateConfigCache(env, scope);
    } catch (_) {}
    if (!writeError) throw refreshError;
    console.error(`[ConfigStore] ${scope} cache refresh failed after write error`, refreshError);
  }

  if (writeError) throw writeError;
  return result;
}

export async function insertServer(env, server) {
  const cachedMutation = await createServerThroughCache(env, server);
  if (cachedMutation.handled) return cachedMutation.result;

  return refreshAfterWrite(env, 'servers', async () => {
    const currentServers = await readServersFromD1(env);
    const maxSortOrder = currentServers.reduce(
      (max, item) => Math.max(max, Number(item.sort_order) || 0),
      -1
    );
    const usedPartitionIds = new Set(
      currentServers
        .map(item => Number(item.history_partition_id))
        .filter(id => Number.isInteger(id) && id > 0 && id <= MAX_HISTORY_PARTITION_ID)
    );
    let historyPartitionId = null;
    for (let id = 1; id <= MAX_HISTORY_PARTITION_ID; id++) {
      if (!usedPartitionIds.has(id)) {
        historyPartitionId = id;
        break;
      }
    }
    if (!historyPartitionId) throw new Error('No available history partition id');

    const result = await env.DB.prepare(`
      INSERT INTO servers
      (id, name, server_group, sort_order, history_partition_id, timestamp, version)
      VALUES (?, ?, ?, ?, ?, ?, 1)
      RETURNING *
    `).bind(
      server.id,
      server.name,
      server.server_group,
      maxSortOrder + 1,
      historyPartitionId,
      server.timestamp
    ).first();
    return result;
  });
}

const USER_SERVER_FIELDS = [
  'name', 'server_group', 'price', 'expire_date', 'bandwidth', 'traffic_limit',
  'traffic_calc_type', 'reset_day', 'collect_interval', 'report_interval',
  'ping_mode', 'offline_notify_disabled', 'is_hidden'
];

export async function updateServer(env, id, values, expectedVersion) {
  return refreshAfterWrite(env, 'servers', async () => {
    const version = Number(expectedVersion);
    if (!Number.isInteger(version) || version < 1) {
      throw new VersionConflictError(`server:${id}`);
    }

    const fields = USER_SERVER_FIELDS.filter(field => Object.prototype.hasOwnProperty.call(values, field));
    if (fields.length === 0) return null;
    const assignments = fields.map(field => `${field} = ?`).join(', ');
    const bindings = fields.map(field => values[field]);
    const updated = await env.DB.prepare(`
      UPDATE servers
      SET ${assignments}, version = version + 1
      WHERE id = ? AND version = ?
      RETURNING *
    `).bind(...bindings, id, version).first();

    if (!updated) {
      const current = await env.DB.prepare('SELECT * FROM servers WHERE id = ?').bind(id).first();
      throw new VersionConflictError(`server:${id}`, current || null);
    }
    return updated;
  });
}

export async function updateServerFields(env, id, values) {
  return refreshAfterWrite(env, 'servers', async () => {
    const allowed = ['sort_order', 'history_partition_id', 'timestamp'];
    const fields = allowed.filter(field => Object.prototype.hasOwnProperty.call(values, field));
    if (fields.length === 0) return null;
    const assignments = fields.map(field => `${field} = ?`).join(', ');
    const bindings = fields.map(field => values[field]);
    return env.DB.prepare(`
      UPDATE servers
      SET ${assignments}, version = version + 1
      WHERE id = ?
      RETURNING *
    `).bind(...bindings, id).first();
  });
}

async function deleteServerHistory(db, id) {
  for (const table of ['metrics_history', 'metrics_history_old']) {
    const exists = await db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?"
    ).bind(table).first();
    if (exists) {
      const foreignKeys = await db.prepare(`PRAGMA foreign_key_list(${table})`).all();
      if (!foreignKeys.results || foreignKeys.results.length === 0) continue;
      await db.prepare(`DELETE FROM ${table} WHERE server_id = ?`).bind(id).run();
    }
  }
}

export async function removeServer(env, id, expectedVersion = null) {
  return refreshAfterWrite(env, 'servers', async () => {
    const current = await env.DB.prepare('SELECT * FROM servers WHERE id = ?').bind(id).first();
    if (!current) return false;
    if (expectedVersion !== null && Number(expectedVersion) !== Number(current.version)) {
      throw new VersionConflictError(`server:${id}`, current);
    }

    const locked = await env.DB.prepare(`
      UPDATE servers
      SET version = version + 1
      WHERE id = ? AND version = ?
      RETURNING version
    `).bind(id, current.version).first();
    if (!locked) {
      const latest = await env.DB.prepare('SELECT * FROM servers WHERE id = ?').bind(id).first();
      throw new VersionConflictError(`server:${id}`, latest || null);
    }

    await deleteServerHistory(env.DB, id);
    const result = await env.DB.prepare(
      'DELETE FROM servers WHERE id = ? AND version = ?'
    ).bind(id, locked.version).run();
    if (result.meta.changes !== 1) {
      const latest = await env.DB.prepare('SELECT * FROM servers WHERE id = ?').bind(id).first();
      throw new VersionConflictError(`server:${id}`, latest || null);
    }
    return true;
  });
}

export async function removeServers(env, ids, expectedVersions = {}) {
  return refreshAfterWrite(env, 'servers', async () => {
    const requestedIds = new Set(ids);
    const currentById = new Map(
      (await readServers(env, { bypassL1: true }))
        .filter(server => requestedIds.has(server.id))
        .map(server => [server.id, server])
    );

    for (const id of ids) {
      const current = currentById.get(id);
      if (!current) continue;
      const expected = expectedVersions[id];
      if (expected !== null && expected !== undefined && Number(expected) !== Number(current.version)) {
        throw new VersionConflictError(`server:${id}`, current);
      }
    }

    const existingIds = ids.filter(id => currentById.has(id));
    const lockStatements = existingIds.map(id => {
      const current = currentById.get(id);
      return env.DB.prepare(
        'UPDATE servers SET version = version + 1 WHERE id = ? AND version = ?'
      ).bind(id, current.version);
    });
    const lockResults = lockStatements.length > 0 ? await env.DB.batch(lockStatements) : [];
    const failedIndex = lockResults.findIndex(result => result.meta.changes !== 1);
    if (failedIndex !== -1) {
      const id = existingIds[failedIndex];
      const latest = await env.DB.prepare('SELECT * FROM servers WHERE id = ?').bind(id).first();
      throw new VersionConflictError(`server:${id}`, latest || null);
    }

    for (const id of existingIds) await deleteServerHistory(env.DB, id);
    const deleteStatements = existingIds.map(id => {
      const lockedVersion = Number(currentById.get(id).version) + 1;
      return env.DB.prepare(
        'DELETE FROM servers WHERE id = ? AND version = ?'
      ).bind(id, lockedVersion);
    });
    const deleteResults = deleteStatements.length > 0 ? await env.DB.batch(deleteStatements) : [];
    const deleteFailedIndex = deleteResults.findIndex(result => result.meta.changes !== 1);
    if (deleteFailedIndex !== -1) {
      const id = existingIds[deleteFailedIndex];
      const latest = await env.DB.prepare('SELECT * FROM servers WHERE id = ?').bind(id).first();
      throw new VersionConflictError(`server:${id}`, latest || null);
    }
    return existingIds.length;
  });
}

export async function saveServerOrder(env, orders) {
  return refreshAfterWrite(env, 'servers', async () => {
    const statements = orders.map((id, index) => env.DB.prepare(
      'UPDATE servers SET sort_order = ?, version = version + 1 WHERE id = ?'
    ).bind(index, id));
    if (statements.length > 0) await env.DB.batch(statements);
    return true;
  });
}

function parseJson(value, fallback = {}) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch (_) {
    return fallback;
  }
}

function settingsMap(rows) {
  return new Map((rows || []).map(row => [row.key, row]));
}

export async function patchJsonSetting(env, key, updates, expectedVersion = null) {
  const cachedMutation = await mutateSettingsThroughCache(env, 'patch-json', {
    key,
    updates,
    expectedVersion
  });
  if (cachedMutation.handled) return cachedMutation.result;

  return refreshAfterWrite(env, 'settings', async () => {
    const rows = await readSettingsRows(env);
    const current = settingsMap(rows).get(key) || null;
    const currentVersion = Number(current?.version || 0);
    const requiredVersion = expectedVersion === null || expectedVersion === undefined
      ? currentVersion
      : Number(expectedVersion);

    if (!Number.isInteger(requiredVersion) || requiredVersion < 0 || requiredVersion !== currentVersion) {
      throw new VersionConflictError(`setting:${key}`, current);
    }

    const value = JSON.stringify({ ...parseJson(current?.value), ...updates });
    if (!current) {
      const inserted = await env.DB.prepare(
        'INSERT INTO settings (key, value, version) VALUES (?, ?, 1) RETURNING key, value, version'
      ).bind(key, value).first();
      return inserted;
    }

    const updated = await env.DB.prepare(`
      UPDATE settings
      SET value = ?, version = version + 1
      WHERE key = ? AND version = ?
      RETURNING key, value, version
    `).bind(value, key, requiredVersion).first();
    if (!updated) {
      const latest = await env.DB.prepare(
        'SELECT key, value, version FROM settings WHERE key = ?'
      ).bind(key).first();
      throw new VersionConflictError(`setting:${key}`, latest || null);
    }
    return updated;
  });
}

export async function saveSettingsBundle(env, valuesByKey, expectedVersions) {
  const cachedMutation = await mutateSettingsThroughCache(env, 'bundle', {
    valuesByKey,
    expectedVersions
  });
  if (cachedMutation.handled) return cachedMutation.result;

  return refreshAfterWrite(env, 'settings', async () => {
    const keys = Object.keys(valuesByKey);
    const { results = [] } = await env.DB.prepare(
      `SELECT key, value, version FROM settings WHERE key IN (${keys.map(() => '?').join(', ')})`
    ).bind(...keys).all();
    const current = settingsMap(results);

    for (const key of keys) {
      const expected = Number(expectedVersions?.[key]);
      const row = current.get(key);
      const validExisting = row && Number.isInteger(expected) && expected === Number(row.version);
      const validInsert = !row && expected === 0;
      if (!validExisting && !validInsert) {
        throw new VersionConflictError(`setting:${key}`, row || null);
      }
    }

    const statements = keys.map(key => {
      const row = current.get(key);
      const nextValue = {
        ...parseJson(row?.value),
        ...(valuesByKey[key] || {})
      };
      if (!row) {
        return env.DB.prepare(`
          INSERT INTO settings (key, value, version)
          SELECT ?, ?, 1
          WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key = ?)
        `).bind(key, JSON.stringify(nextValue), key);
      }
      return env.DB.prepare(`
        UPDATE settings
        SET value = ?, version = version + 1
        WHERE key = ? AND version = ?
      `).bind(JSON.stringify(nextValue), key, Number(expectedVersions[key]));
    });
    const batchResults = await env.DB.batch(statements);
    if (batchResults.some(result => result.meta.changes !== 1)) {
      const latest = await env.DB.prepare(
        `SELECT key, value, version FROM settings WHERE key IN (${keys.map(() => '?').join(', ')})`
      ).bind(...keys).all();
      throw new VersionConflictError('settings', latest.results || []);
    }
    return true;
  });
}

export async function setSettingValue(env, key, value) {
  const cachedMutation = await mutateSettingsThroughCache(env, 'set-value', { key, value });
  if (cachedMutation.handled) return cachedMutation.result;

  return refreshAfterWrite(env, 'settings', async () => {
    return env.DB.prepare(`
      INSERT INTO settings (key, value, version)
      VALUES (?, ?, 1)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        version = settings.version + 1
      RETURNING key, value, version
    `).bind(key, value).first();
  });
}
