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

// Mock county lookup is DISABLED — we never fabricate APN / legal description /
// prior-deed data. Without a real COUNTY_LOOKUP_URL these stay empty (so no fake
// legal data is ever submitted on an order); the real lookup fills them once set.
function mockLookup({ state, county }) {
  return { found: false, apn: '', legalDescription: '', currentOwner: '', priorDeedReference: '', county: county || '', state: state || '' };
}
