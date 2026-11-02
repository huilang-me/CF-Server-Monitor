import assert from 'node:assert/strict';
import test from 'node:test';

import { parseServerBackup } from '../src/frontend/utils/backup.js';

test('旧版纯服务器数组备份仍按服务器列表解析', () => {
  const legacy = [{ id: 'a', name: 'HK-01' }, { id: 'b', name: 'JP-01' }];
  const result = parseServerBackup(JSON.stringify(legacy));
  assert.deepEqual(result.servers, legacy);
  assert.equal(result.settings, null);
});

test('新版备份同时解析服务器与设置', () => {
  const payload = {
    format: 'cfsm-backup',
    version: 1,
    exported_at: '2026-11-02T00:00:00.000Z',
    servers: [{ id: 'a' }],
    settings: { site: { is_public: 'true' }, appearance: { site_title: 'X' } }
  };
  const result = parseServerBackup(JSON.stringify(payload));
  assert.deepEqual(result.servers, [{ id: 'a' }]);
  assert.deepEqual(result.settings, payload.settings);
});

test('只带设置的备份也能导入', () => {
  const result = parseServerBackup(JSON.stringify({ settings: { site: { is_public: 'false' } } }));
  assert.deepEqual(result.servers, []);
  assert.deepEqual(result.settings, { site: { is_public: 'false' } });
});

test('非法 settings 与缺失 servers 都退化为空，不抛错', () => {
  for (const raw of ['{}', '{"servers":"x","settings":[]}', '{"servers":null,"settings":"x"}', 'null', '42']) {
    const result = parseServerBackup(raw);
    assert.deepEqual(result.servers, [], raw);
    assert.equal(result.settings, null, raw);
  }
});

test('非法 JSON 由调用方捕获', () => {
  assert.throws(() => parseServerBackup('not json'), SyntaxError);
});
