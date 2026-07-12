import { md5Hash } from './common.js';

export const AGENT_CONFIG_SCHEMA_VERSION = 1;
export const AGENT_CONFIG_SCHEMA_HEADER = 'X-Agent-Config-Schema';
export const AGENT_CONFIG_MD5_HEADER = 'X-Agent-Config-Md5';
export const MAX_TRAFFIC_CORRECTION_GB = 1000000;

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

function sanitizePingNode(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/[^a-zA-Z0-9.\-_]/g, '').slice(0, 50);
}

export function isValidTrafficCorrection(value) {
  let number;
  if (typeof value === 'number') {
    number = value;
  } else if (typeof value === 'string' && /^[0-9]+(?:\.[0-9]+)?$/.test(value)) {
    number = Number(value);
  } else {
    return false;
  }
  return Number.isFinite(number) && number >= 0 && number <= MAX_TRAFFIC_CORRECTION_GB;
}

export function normalizeTrafficCorrection(value) {
  return isValidTrafficCorrection(value) ? Number(value) : 0;
}

export function buildAgentConfig(server, settings = null) {
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

  const customCt = sanitizePingNode(server?.custom_ct || settings?.custom_ct || '');
  const customCu = sanitizePingNode(server?.custom_cu || settings?.custom_cu || '');
  const customCm = sanitizePingNode(server?.custom_cm || settings?.custom_cm || '');
  const customBd = sanitizePingNode(server?.custom_bd || settings?.custom_bd || '');

  return {
    collect_interval: collectInterval,
    ping_mode: pingMode,
    report_interval: reportInterval,
    reset_day: resetDay,
    custom_ct: customCt,
    custom_cu: customCu,
    custom_cm: customCm,
    custom_bd: customBd,
    schema_version: AGENT_CONFIG_SCHEMA_VERSION
  };
}

export function serializeAgentConfig(config) {
  return `collect_interval=${config.collect_interval}` +
    `&ping_mode=${config.ping_mode}` +
    `&report_interval=${config.report_interval}` +
    `&reset_day=${config.reset_day}` +
    `&schema_version=${config.schema_version}` +
    `&custom_ct=${config.custom_ct}` +
    `&custom_cu=${config.custom_cu}` +
    `&custom_cm=${config.custom_cm}` +
    `&custom_bd=${config.custom_bd}`;
}

export function serializeCorrection(correction) {
  if (correction === null || correction === undefined) return '';
  return `&rx_correction=${correction.rx_correction}` +
    `&tx_correction=${correction.tx_correction}`;
}

export async function describeAgentConfig(server, settings = null) {
  const config = buildAgentConfig(server, settings);
  const serialized = serializeAgentConfig(config);
  const md5 = await md5Hash(serialized);

  const hasCorrection = server?.rx_correction != null || server?.tx_correction != null;
  let correction = null;
  if (hasCorrection) {
    correction = {
      rx_correction: normalizeTrafficCorrection(server.rx_correction),
      tx_correction: normalizeTrafficCorrection(server.tx_correction)
    };
  }

  return { config, serialized, md5, correction };
}
