// Durable Object: servers/settings 全局内存缓存。
//
// D1 始终是唯一真源；本对象不把缓存再次写入 Durable Object Storage。
// 对象被回收后，下一次读取会自动从 D1 重建缓存。

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

const CONFIG_CACHE_TTL_MS = 5 * 60 * 1000;
const HISTORY_MAX_PARTITION_ID = 900;

class CacheVersionConflictError extends Error {
  constructor(resource, current = null) {
    super('versionConflict');
    this.status = 409;
    this.resource = resource;
    this.current = current;
  }
}

function parseJson(value, fallback = {}) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch (_) {
    return fallback;
  }
}

export class ConfigCache {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.servers = null;
    this.settings = null;
    this.serversLoadedAt = 0;
    this.settingsLoadedAt = 0;
    this.schemaPromise = null;
    this.serversLoadPromise = null;
    this.settingsLoadPromise = null;
    this.mutationQueue = Promise.resolve();
    this.serverMutationQueue = Promise.resolve();
  }

  async _ensureVersionColumns() {
    if (!this.schemaPromise) {
      this.schemaPromise = (async () => {
        const [serverInfo, settingsInfo] = await Promise.all([
          this.env.DB.prepare('PRAGMA table_info(servers)').all(),
          this.env.DB.prepare('PRAGMA table_info(settings)').all()
        ]);

        const serverColumns = new Set((serverInfo.results || []).map(column => column.name));
        const settingsColumns = new Set((settingsInfo.results || []).map(column => column.name));

        if (serverColumns.size > 0 && !serverColumns.has('version')) {
          await this.env.DB.prepare(
            'ALTER TABLE servers ADD COLUMN version INTEGER NOT NULL DEFAULT 1'
          ).run();
        }
        if (settingsColumns.size > 0 && !settingsColumns.has('version')) {
          await this.env.DB.prepare(
            'ALTER TABLE settings ADD COLUMN version INTEGER NOT NULL DEFAULT 1'
          ).run();
        }
      })().catch(error => {
        this.schemaPromise = null;
        throw error;
      });
    }
    return this.schemaPromise;
  }

  async _loadServers(force = false) {
    await this._ensureVersionColumns();
    if (force) {
      if (this.serversLoadPromise) {
        try { await this.serversLoadPromise; } catch (_) {}
      }
      this.servers = null;
      this.serversLoadedAt = 0;
      this.serversLoadPromise = null;
    }
    if (this.servers && Date.now() - this.serversLoadedAt < CONFIG_CACHE_TTL_MS) {
      return this.servers;
    }

    if (!this.serversLoadPromise) {
      this.serversLoadPromise = this.env.DB.prepare(
        'SELECT * FROM servers ORDER BY sort_order ASC'
      ).all().then(({ results = [] }) => {
        this.servers = results;
        this.serversLoadedAt = Date.now();
        return this.servers;
      }).finally(() => {
        this.serversLoadPromise = null;
      });
    }
    return this.serversLoadPromise;
  }

  async _loadSettings(force = false) {
    await this._ensureVersionColumns();
    if (force) {
      if (this.settingsLoadPromise) {
        try { await this.settingsLoadPromise; } catch (_) {}
      }
      this.settings = null;
      this.settingsLoadedAt = 0;
      this.settingsLoadPromise = null;
    }
    if (this.settings && Date.now() - this.settingsLoadedAt < CONFIG_CACHE_TTL_MS) {
      return this.settings;
    }

    if (!this.settingsLoadPromise) {
      this.settingsLoadPromise = this.env.DB.prepare(
        'SELECT key, value, version FROM settings'
      ).all().then(({ results = [] }) => {
        this.settings = results;
        this.settingsLoadedAt = Date.now();
        return this.settings;
      }).finally(() => {
        this.settingsLoadPromise = null;
      });
    }
    return this.settingsLoadPromise;
  }

  _enqueueSettingsMutation(operation) {
    const run = this.mutationQueue.then(async () => {
      try {
        return await operation();
      } finally {
        this.settings = null;
        this.settingsLoadedAt = 0;
        try {
          await this._loadSettings(true);
        } catch (_) {
          this.settings = null;
          this.settingsLoadedAt = 0;
        }
      }
    });
    this.mutationQueue = run.catch(() => {});
    return run;
  }

  _enqueueServerMutation(operation) {
    const run = this.serverMutationQueue.then(async () => {
      try {
        return await operation();
      } finally {
        this.servers = null;
        this.serversLoadedAt = 0;
        try {
          await this._loadServers(true);
        } catch (_) {
          this.servers = null;
          this.serversLoadedAt = 0;
        }
      }
    });
    this.serverMutationQueue = run.catch(() => {});
    return run;
  }

  async _createServer(body) {
    if (!body || typeof body.id !== 'string' || !body.id || typeof body.name !== 'string' || !body.name) {
      throw new Error('invalid server');
    }
    const { results = [] } = await this.env.DB.prepare(
      'SELECT sort_order, history_partition_id FROM servers'
    ).all();
    const usedPartitionIds = new Set(
      results
        .map(server => Number(server.history_partition_id))
        .filter(id => Number.isInteger(id) && id > 0 && id <= HISTORY_MAX_PARTITION_ID)
    );
    let historyPartitionId = null;
    for (let id = 1; id <= HISTORY_MAX_PARTITION_ID; id++) {
      if (!usedPartitionIds.has(id)) {
        historyPartitionId = id;
        break;
      }
    }
    if (!historyPartitionId) throw new Error('No available history partition id');

    const maxSortOrder = results.reduce(
      (max, server) => Math.max(max, Number(server.sort_order) || 0),
      -1
    );
    return this.env.DB.prepare(`
      INSERT INTO servers
      (id, name, server_group, sort_order, history_partition_id, timestamp, version)
      VALUES (?, ?, ?, ?, ?, ?, 1)
      RETURNING *
    `).bind(
      body.id,
      body.name,
      body.server_group || 'Default',
      maxSortOrder + 1,
      historyPartitionId,
      Number(body.timestamp) || Date.now()
    ).first();
  }

  async _patchJsonSetting(body) {
    const key = String(body.key || '');
    if (!key || !body.updates || typeof body.updates !== 'object' || Array.isArray(body.updates)) {
      throw new Error('invalid setting patch');
    }

    const current = await this.env.DB.prepare(
      'SELECT key, value, version FROM settings WHERE key = ?'
    ).bind(key).first();
    const currentVersion = Number(current?.version || 0);
    if (body.expectedVersion !== null && body.expectedVersion !== undefined) {
      const expected = Number(body.expectedVersion);
      if (!Number.isInteger(expected) || expected !== currentVersion) {
        throw new CacheVersionConflictError(`setting:${key}`, current || null);
      }
    }

    const value = JSON.stringify({ ...parseJson(current?.value), ...body.updates });
    if (!current) {
      return this.env.DB.prepare(
        'INSERT INTO settings (key, value, version) VALUES (?, ?, 1) RETURNING key, value, version'
      ).bind(key, value).first();
    }

    const updated = await this.env.DB.prepare(`
      UPDATE settings
      SET value = ?, version = version + 1
      WHERE key = ? AND version = ?
      RETURNING key, value, version
    `).bind(value, key, currentVersion).first();
    if (!updated) {
      const latest = await this.env.DB.prepare(
        'SELECT key, value, version FROM settings WHERE key = ?'
      ).bind(key).first();
      throw new CacheVersionConflictError(`setting:${key}`, latest || null);
    }
    return updated;
  }

  async _saveSettingsBundle(body) {
    const valuesByKey = body.valuesByKey || {};
    const expectedVersions = body.expectedVersions || {};
    const keys = Object.keys(valuesByKey);
    if (keys.length === 0) throw new Error('empty settings bundle');

    const { results = [] } = await this.env.DB.prepare(
      `SELECT key, value, version FROM settings WHERE key IN (${keys.map(() => '?').join(', ')})`
    ).bind(...keys).all();
    const current = new Map(results.map(row => [row.key, row]));

    for (const key of keys) {
      const row = current.get(key);
      const expected = Number(expectedVersions[key]);
      const validExisting = row && Number.isInteger(expected) && expected === Number(row.version);
      const validInsert = !row && expected === 0;
      if (!validExisting && !validInsert) {
        throw new CacheVersionConflictError(`setting:${key}`, row || null);
      }
    }

    const statements = keys.map(key => {
      const row = current.get(key);
      const nextValue = {
        ...parseJson(row?.value),
        ...(valuesByKey[key] || {})
      };
      if (!row) {
        return this.env.DB.prepare(`
          INSERT INTO settings (key, value, version)
          SELECT ?, ?, 1
          WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key = ?)
        `).bind(key, JSON.stringify(nextValue), key);
      }
      return this.env.DB.prepare(`
        UPDATE settings
        SET value = ?, version = version + 1
        WHERE key = ? AND version = ?
      `).bind(JSON.stringify(nextValue), key, Number(expectedVersions[key]));
    });
    const batchResults = await this.env.DB.batch(statements);
    if (batchResults.some(result => result.meta.changes !== 1)) {
      const latest = await this.env.DB.prepare(
        `SELECT key, value, version FROM settings WHERE key IN (${keys.map(() => '?').join(', ')})`
      ).bind(...keys).all();
      throw new CacheVersionConflictError('settings', latest.results || []);
    }
    return { ok: true };
  }

  async _setSettingValue(body) {
    const key = String(body.key || '');
    if (!key) throw new Error('invalid setting key');
    return this.env.DB.prepare(`
      INSERT INTO settings (key, value, version)
      VALUES (?, ?, 1)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        version = settings.version + 1
      RETURNING key, value, version
    `).bind(key, String(body.value ?? '')).first();
  }

  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (request.method === 'GET' && path === '/servers') {
        return json({ servers: await this._loadServers() });
      }

      if (request.method === 'GET' && path === '/settings') {
        return json({ settings: await this._loadSettings() });
      }

      if (request.method === 'POST' && path === '/servers/mutate/create') {
        const body = await request.json();
        const result = await this._enqueueServerMutation(() => this._createServer(body));
        return json({ result });
      }

      if (request.method === 'POST' && path.startsWith('/settings/mutate/')) {
        const body = await request.json();
        const action = path.slice('/settings/mutate/'.length);
        const result = await this._enqueueSettingsMutation(() => {
          if (action === 'patch-json') return this._patchJsonSetting(body);
          if (action === 'bundle') return this._saveSettingsBundle(body);
          if (action === 'set-value') return this._setSettingValue(body);
          throw new Error('invalid settings mutation');
        });
        return json({ result });
      }

      if (request.method === 'POST' && path === '/refresh') {
        let body = {};
        try {
          body = await request.json();
        } catch (_) {}

        const scope = body.scope || 'all';
        const result = {};
        if (scope === 'all' || scope === 'servers') {
          result.servers = await this._loadServers(true);
        }
        if (scope === 'all' || scope === 'settings') {
          result.settings = await this._loadSettings(true);
        }
        if (!['all', 'servers', 'settings'].includes(scope)) {
          return json({ error: 'invalid cache scope' }, 400);
        }
        return json(result);
      }

      if (request.method === 'POST' && path === '/invalidate') {
        let body = {};
        try {
          body = await request.json();
        } catch (_) {}
        const scope = body.scope || 'all';
        if (scope === 'all' || scope === 'servers') {
          this.servers = null;
          this.serversLoadedAt = 0;
        }
        if (scope === 'all' || scope === 'settings') {
          this.settings = null;
          this.settingsLoadedAt = 0;
        }
        if (!['all', 'servers', 'settings'].includes(scope)) {
          return json({ error: 'invalid cache scope' }, 400);
        }
        return json({ ok: true });
      }

      if (request.method === 'GET' && path === '/health') {
        return json({
          ok: true,
          serversCached: this.servers !== null,
          settingsCached: this.settings !== null,
          serversAgeMs: this.servers ? Date.now() - this.serversLoadedAt : null,
          settingsAgeMs: this.settings ? Date.now() - this.settingsLoadedAt : null,
          ttlMs: CONFIG_CACHE_TTL_MS
        });
      }

      return new Response('Not found', { status: 404 });
    } catch (error) {
      if (error instanceof CacheVersionConflictError) {
        const current = Array.isArray(error.current)
          ? error.current.map(row => ({ key: row.key, version: row.version }))
          : (error.current ? { key: error.current.key, version: error.current.version } : null);
        return json({
          error: 'versionConflict',
          conflictCode: 'VERSION_CONFLICT',
          resource: error.resource,
          current
        }, 409);
      }
      console.error('[ConfigCache]', error);
      return json({ error: error?.message || String(error) }, 500);
    }
  }
}

export default ConfigCache;
