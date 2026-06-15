import { config } from '../config.js';

// Adapter to the EXISTING 50deeds county property-record lookup.
// Given a confirmed property address it returns deed-critical legal data that
// Clio never holds: APN, legal description, current owner/vesting, prior deed ref.
//
// In MOCK mode (no COUNTY_LOOKUP_URL set) it returns deterministic sample data so
// the flow is fully testable locally.
export async function lookupProperty({ address, state, county }) {
  if (config.countyLookup.mock) {
    return mockLookup({ address, state, county });
  }

  const res = await fetch(config.countyLookup.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(config.countyLookup.apiKey ? { Authorization: `Bearer ${config.countyLookup.apiKey}` } : {}),
    },
    body: JSON.stringify({ address, state, county }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`County lookup failed (${res.status}): ${body.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  // Normalize to our shape regardless of upstream field naming.
  return {
    found: data.found ?? true,
    apn: data.apn ?? data.parcel_number ?? '',
    legalDescription: data.legal_description ?? data.legalDescription ?? '',
    currentOwner: data.current_owner ?? data.owner ?? data.vesting ?? '',
    priorDeedReference: data.prior_deed ?? data.priorDeedReference ?? data.instrument_number ?? '',
    county: data.county ?? county ?? '',
    state: data.state ?? state ?? '',
  };
}

function mockLookup({ address, state, county }) {
  if (!address) return { found: false, apn: '', legalDescription: '', currentOwner: '', priorDeedReference: '', county: county || '', state: state || '' };
  // Deterministic pseudo-APN derived from the address so tests are stable.
  const seed = Array.from(address).reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const apn = `${String(seed % 1000).padStart(3, '0')}-${String((seed >>> 4) % 100).padStart(2, '0')}-${String((seed >>> 8) % 1000).padStart(3, '0')}`;
  return {
    found: true,
    apn,
    legalDescription: `LOT ${seed % 50 || 1}, BLOCK ${seed % 12 || 1}, AS PER MAP RECORDED IN BOOK ${seed % 200} PAGE ${seed % 99}, ${(county || 'COUNTY').toUpperCase()} RECORDS`,
    currentOwner: 'AS SHOWN ON CURRENT VESTING DEED',
    priorDeedReference: `INST# ${2000000 + (seed % 999999)}`,
    county: county || 'Sample County',
    state: state || '',
  };
}
