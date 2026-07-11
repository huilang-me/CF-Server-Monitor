import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  buildAgentConfig,
  describeAgentConfig,
  serializeAgentConfig,
  validateAgentConfigInput
} from '../src/utils/agentConfig.js';
import { md5Hash } from '../src/utils/common.js';

const server = {
  collect_interval: 1,
  ping_mode: 'tcp',
  report_interval: 60,
  reset_day: 15
};
const expected = 'collect_interval=1&ping_mode=tcp&report_interval=60&reset_day=15&schema_version=1';

const config = buildAgentConfig(server);
assert.equal(serializeAgentConfig(config), expected);

const descriptor = await describeAgentConfig(server);
assert.equal(descriptor.serialized, expected);
assert.equal(descriptor.md5, createHash('md5').update(expected).digest('hex'));

for (const value of ['', 'abc', '中文', 'a'.repeat(1000)]) {
  assert.equal(await md5Hash(value), createHash('md5').update(value).digest('hex'));
}

assert.equal(validateAgentConfigInput(server).valid, true);
assert.equal(validateAgentConfigInput({ ...server, collect_interval: '1' }).valid, false);
assert.equal(validateAgentConfigInput({ ...server, ping_mode: 'http;reboot' }).valid, false);
assert.equal(validateAgentConfigInput({ ...server, reset_day: 32 }).valid, false);
assert.deepEqual(buildAgentConfig({}), {
  collect_interval: 0,
  ping_mode: 'http',
  report_interval: 60,
  reset_day: 1,
  schema_version: 1
});

console.log('agent config tests passed');
