// Maps a Clio matter (+ related contacts) into the 50deeds deed-order shape.
// Every field carries provenance so the UI can mark "from Clio" vs "needs confirmation".

const US_STATES = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS',
  kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD', massachusetts: 'MA',
  michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO', montana: 'MT',
  nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ',
  'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND',
  ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI',
  'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX',
  utah: 'UT', vermont: 'VT', virginia: 'VA', washington: 'WA', 'west virginia': 'WV',
  wisconsin: 'WI', wyoming: 'WY', 'district of columbia': 'DC',
};

function field(value, source) {
  const v = value ?? '';
  return { value: v, source, needsConfirmation: source !== 'clio' || v === '' };
}

function normalizeState(province) {
  if (!province) return '';
  const p = String(province).trim();
  if (/^[A-Za-z]{2}$/.test(p)) return p.toUpperCase();
  return US_STATES[p.toLowerCase()] || p;
}

function formatAddress(addr) {
  if (!addr) return '';
  return [addr.street, addr.city, [normalizeState(addr.province), addr.postal_code].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(', ');
}

function contactDisplayName(c) {
  if (!c) return '';
  if (c.name) return c.name;
  return [c.first_name, c.last_name].filter(Boolean).join(' ');
}

// Heuristic: find a configured property-address custom field, else try to parse
// the matter description. Property address is deliberately left "needs confirmation"
// because confirming it triggers the county lookup (the differentiator).
function derivePropertyAddress(matter) {
  const cfvs = matter.custom_field_values || [];
  const propCfv = cfvs.find((c) => /property|subject\s*address|real\s*estate/i.test(c.field_name || c.custom_field?.name || ''));
  if (propCfv?.value) return { value: String(propCfv.value), source: 'clio-custom-field' };

  // Fallback: very light parse of a street-looking line from the description.
  const desc = matter.description || '';
  const m = desc.match(/\d{1,6}\s+[\w.\- ]+(?:st|street|ave|avenue|rd|road|dr|drive|ln|lane|blvd|boulevard|ct|court|way|pl|place|ter|terrace|cir|circle)\b[^,\n]*/i);
  if (m) return { value: m[0].trim(), source: 'parsed-description' };
  return { value: '', source: 'none' };
}

export function mapMatterToOrder(matter, relatedContacts = []) {
  const client = matter.client || {};
  const prop = derivePropertyAddress(matter);
  const stateFromProp = (() => {
    // try to pull a 2-letter state out of the property string
    const m = (prop.value || '').match(/\b([A-Z]{2})\b\s*\d{5}/);
    return m ? m[1] : normalizeState(client.primary_address?.province);
  })();

  // Grantee candidates = related contacts (trustees, beneficiaries, co-owners).
  const granteeCandidates = relatedContacts.map((c) => ({
    id: c.id,
    name: contactDisplayName(c),
    relationship: c.relationship || '',
    redacted: Boolean(c.redacted),
    address: formatAddress(c.primary_address),
  }));

  return {
    matterReference: field(matter.display_number, 'clio'),
    clioMatterId: matter.id,

    grantorName: field(contactDisplayName(client), client.name || client.last_name ? 'clio' : 'missing'),
    grantorAddress: field(formatAddress(client.primary_address), client.primary_address ? 'clio' : 'missing'),

    // Grantee filled by attorney from candidates (or free text).
    granteeName: field('', 'missing'),
    granteeCandidates,

    propertyAddress: field(prop.value, prop.source === 'none' ? 'missing' : prop.source),
    state: field(stateFromProp, stateFromProp ? 'derived' : 'missing'),
    county: field('', 'missing'), // derived from address / confirmed by attorney

    // These three are NOT in Clio — auto-filled by the 50deeds county lookup
    // after the attorney confirms the property address.
    apn: field('', 'county-lookup'),
    legalDescription: field('', 'county-lookup'),
    priorDeedReference: field('', 'county-lookup'),

    deedType: field('', 'attorney-select'), // one of the FinCEN deed-type strings
    contactEmail: field(client.primary_email_address?.address || '', client.primary_email_address?.address ? 'clio' : 'missing'),
    additionalInstructions: field('', 'optional'),
  };
}

export { normalizeState, formatAddress, contactDisplayName };
