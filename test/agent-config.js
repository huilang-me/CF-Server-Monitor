import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  buildAgentConfig,
  describeAgentConfig,
  isValidTrafficCorrection,
  serializeAgentConfig,
  serializeCorrection,
  validateAgentConfigInput
} from '../src/utils/agentConfig.js';
import { md5Hash } from '../src/utils/common.js';

const server = {
  collect_interval: 1,
  ping_mode: 'tcp',
  report_interval: 60,
  reset_day: 15
};
const expected = 'collect_interval=1&ping_mode=tcp&report_interval=60&reset_day=15&schema_version=1&custom_ct=&custom_cu=&custom_cm=&custom_bd=';

const config = buildAgentConfig(server);
assert.equal(serializeAgentConfig(config), expected);

const descriptor = await describeAgentConfig(server);
assert.equal(descriptor.serialized, expected);
assert.equal(descriptor.md5, createHash('md5').update(expected).digest('hex'));
assert.equal(descriptor.correction, null);

const correctionDescriptor = await describeAgentConfig({ ...server, rx_correction: null, tx_correction: 5 });
assert.deepEqual(correctionDescriptor.correction, {
  rx_correction: 0,
  tx_correction: 5
});
assert.equal(serializeCorrection(correctionDescriptor.correction), '&rx_correction=0&tx_correction=5');
assert.equal(isValidTrafficCorrection('0'), true);
assert.equal(isValidTrafficCorrection('0.5'), true);
assert.equal(isValidTrafficCorrection('1000000'), true);
assert.equal(isValidTrafficCorrection('-1'), false);
assert.equal(isValidTrafficCorrection('1e3'), false);
assert.equal(isValidTrafficCorrection('0x10'), false);
assert.equal(isValidTrafficCorrection('1000000.1'), false);

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
  custom_ct: '',
  custom_cu: '',
  custom_cm: '',
  custom_bd: '',
  schema_version: 1
});

// Test server-level ping node priority
const serverWithCustomPing = {
  collect_interval: 0,
  ping_mode: 'http',
  report_interval: 60,
  reset_day: 1,
  custom_ct: 'ct-server.example.com',
  custom_cu: '',
  custom_cm: '',
  custom_bd: ''
};
const settings = { custom_ct: 'ct-global.example.com', custom_cu: 'cu-global.example.com', custom_cm: 'cm-global.example.com', custom_bd: 'bd-global.example.com' };
const resolvedConfig = buildAgentConfig(serverWithCustomPing, settings);
assert.equal(resolvedConfig.custom_ct, 'ct-server.example.com');
assert.equal(resolvedConfig.custom_cu, 'cu-global.example.com');
assert.equal(resolvedConfig.custom_cm, 'cm-global.example.com');
assert.equal(resolvedConfig.custom_bd, 'bd-global.example.com');
assert.equal(buildAgentConfig({ custom_ct: 'a'.repeat(100) }).custom_ct.length, 50);

console.log('agent config tests passed');
