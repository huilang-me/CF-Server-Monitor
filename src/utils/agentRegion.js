export function normalizeAgentRegion(value) {
  const region = String(value ?? '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(region) ? region : '';
}

export function resolveReportedAgentRegion(data, request) {
  if (Object.prototype.hasOwnProperty.call(data || {}, 'agent_region')) {
    return normalizeAgentRegion(data.agent_region);
  }

  return normalizeAgentRegion(
    request?.cf?.country || request?.headers?.get('cf-ipcountry') || ''
  );
}
