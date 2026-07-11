import { md5Hash } from './common.js';

export const AGENT_CONFIG_SCHEMA_VERSION = 1;
export const AGENT_CONFIG_SCHEMA_HEADER = 'X-Agent-Config-Schema';
export const AGENT_CONFIG_MD5_HEADER = 'X-Agent-Config-Md5';

const ALLOWED_COLLECT_INTERVALS = new Set([0, 1, 2, 5, 10]);
const ALLOWED_REPORT_INTERVALS = new Set([30, 60, 120, 180]);
const ALLOWED_PING_MODES = new Set(['http', 'tcp']);

function validateInteger(name, value, allowedValues = null, min = null, max = null) {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return `${name} must be an integer`;
  }
  if (allowedValues && !allowedValues.has(value)) {
    return `${name} is not allowed`;
  }
  if (min !== null && value < min) return `${name} is below the minimum`;
  if (max !== null && value > max) return `${name} is above the maximum`;
  return null;
}

export function validateAgentConfigInput(input) {
  const collectError = validateInteger(
    'collect_interval',
    input.collect_interval,
    ALLOWED_COLLECT_INTERVALS
  );
  if (collectError) return { valid: false, error: collectError };

  const reportError = validateInteger(
    'report_interval',
    input.report_interval,
    ALLOWED_REPORT_INTERVALS
  );
  if (reportError) return { valid: false, error: reportError };

  const resetError = validateInteger('reset_day', input.reset_day, null, 0, 31);
  if (resetError) return { valid: false, error: resetError };

  if (typeof input.ping_mode !== 'string' || !ALLOWED_PING_MODES.has(input.ping_mode)) {
    return { valid: false, error: 'ping_mode must be http or tcp' };
  }

  if (input.collect_interval > 0 && input.report_interval < input.collect_interval) {
    return { valid: false, error: 'report_interval must be greater than or equal to collect_interval' };
  }

  if (
    input.collect_interval > 0 &&
    Math.ceil(input.report_interval / input.collect_interval) > 300
  ) {
    return { valid: false, error: 'configuration would create more than 300 samples per report' };
  }

  return {
    valid: true,
    config: {
      collect_interval: input.collect_interval,
      ping_mode: input.ping_mode,
      report_interval: input.report_interval,
      reset_day: input.reset_day,
      schema_version: AGENT_CONFIG_SCHEMA_VERSION
    }
  };
}

function storedInteger(value, allowedValues, fallback) {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(number) && allowedValues.has(number) ? number : fallback;
}

export function buildAgentConfig(server) {
  const collectInterval = storedInteger(server?.collect_interval, ALLOWED_COLLECT_INTERVALS, 0);
  let reportInterval = storedInteger(server?.report_interval, ALLOWED_REPORT_INTERVALS, 60);
  if (collectInterval > 0 && reportInterval < collectInterval) reportInterval = 60;

  const resetNumber = typeof server?.reset_day === 'number'
    ? server.reset_day
    : Number(server?.reset_day);
  const resetDay = Number.isInteger(resetNumber) && resetNumber >= 0 && resetNumber <= 31
    ? resetNumber
    : 1;

  const pingMode = ALLOWED_PING_MODES.has(server?.ping_mode) ? server.ping_mode : 'http';

  return {
    collect_interval: collectInterval,
    ping_mode: pingMode,
    report_interval: reportInterval,
    reset_day: resetDay,
    schema_version: AGENT_CONFIG_SCHEMA_VERSION
  };
}

export function serializeAgentConfig(config) {
  return `collect_interval=${config.collect_interval}` +
    `&ping_mode=${config.ping_mode}` +
    `&report_interval=${config.report_interval}` +
    `&reset_day=${config.reset_day}` +
    `&schema_version=${config.schema_version}`;
}

export async function describeAgentConfig(server) {
  const config = buildAgentConfig(server);
  const serialized = serializeAgentConfig(config);
  const md5 = await md5Hash(serialized);
  return { config, serialized, md5 };
}
