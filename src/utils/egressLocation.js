const LOCATION_FIELDS = Object.freeze([
  'egress_city',
  'egress_region',
  'egress_region_code',
  'egress_country',
  'egress_latitude',
  'egress_longitude'
]);

const HEADER_FIELDS = Object.freeze([
  ['egress_city', 'X-CFSM-Egress-City'],
  ['egress_region', 'X-CFSM-Egress-Region'],
  ['egress_region_code', 'X-CFSM-Egress-Region-Code'],
  ['egress_country', 'X-CFSM-Egress-Country'],
  ['egress_latitude', 'X-CFSM-Egress-Latitude'],
  ['egress_longitude', 'X-CFSM-Egress-Longitude']
]);

function cleanText(value, maxLength = 96) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function coordinate(value, min, max) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) return null;
  // Cloudflare IP geolocation is approximate; retain city-scale placement without
  // implying that the marker identifies a physical machine or facility.
  return Number(number.toFixed(2));
}

export function normalizeEgressLocation(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null;

  const city = cleanText(source.egress_city ?? source.city);
  const region = cleanText(source.egress_region ?? source.region);
  const regionCode = cleanText(source.egress_region_code ?? source.regionCode, 24);
  const country = cleanText(source.egress_country ?? source.country, 16).toUpperCase();
  let latitude = coordinate(source.egress_latitude ?? source.latitude, -90, 90);
  let longitude = coordinate(source.egress_longitude ?? source.longitude, -180, 180);

  // A half-coordinate is not a usable point and must never be plotted.
  if (latitude === null || longitude === null) {
    latitude = null;
    longitude = null;
  }

  if (!city && !region && !regionCode && !country && latitude === null) return null;
  return {
    egress_city: city,
    egress_region: region,
    egress_region_code: regionCode,
    egress_country: country,
    egress_latitude: latitude,
    egress_longitude: longitude
  };
}

export function egressLocationFromCf(cf) {
  if (!cf || typeof cf !== 'object' || Array.isArray(cf)) return null;
  return normalizeEgressLocation({
    city: cf.city,
    region: cf.region,
    regionCode: cf.regionCode,
    country: cf.country,
    latitude: cf.latitude,
    longitude: cf.longitude
  });
}

export function egressLocationFromHeaders(headers) {
  if (!headers || typeof headers.get !== 'function') return null;
  return normalizeEgressLocation(Object.fromEntries(HEADER_FIELDS.map(([field, header]) => [
    field,
    headers.get(header)
  ])));
}

export function applyEgressLocation(metrics, location) {
  if (!metrics || typeof metrics !== 'object' || Array.isArray(metrics)) return metrics;
  for (const field of LOCATION_FIELDS) delete metrics[field];
  const normalized = normalizeEgressLocation(location);
  if (normalized) Object.assign(metrics, normalized);
  return metrics;
}

export function writeEgressLocationHeaders(headers, location) {
  if (!headers || typeof headers.set !== 'function' || typeof headers.delete !== 'function') return headers;
  for (const [, header] of HEADER_FIELDS) headers.delete(header);
  const normalized = normalizeEgressLocation(location);
  if (!normalized) return headers;
  for (const [field, header] of HEADER_FIELDS) {
    const value = normalized[field];
    if (value !== '' && value !== null && value !== undefined) headers.set(header, String(value));
  }
  return headers;
}
