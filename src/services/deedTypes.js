// The 10 FinCEN-classified deed types the Enterprise API expects, verbatim.
// The `value` is the exact string the API requires for /pricing and /orders.
// Estate-relevant types are listed first (trust funding, death transfer).
export const DEED_TYPES = [
  {
    value: 'Transfer from individual to own Revocable Trust as grantor: FinCEN non-reportable',
    label: 'Individual → own Revocable Trust (trust funding)',
    from: 'Individual', to: 'Trust', transfer: 'Transfer from Individual to Trust',
    estate: true,
  },
  {
    value: 'Transfer due to death of individual: FinCEN non-reportable',
    label: 'Transfer due to death of individual (estate/probate)',
    from: 'Individual', to: 'Heir / Beneficiary', transfer: 'Transfer due to death of individual',
    estate: true,
  },
  {
    value: 'Transfer to Individual: FinCEN non-reportable',
    label: 'Transfer to an individual',
    from: 'Individual', to: 'Individual', transfer: 'Transfer to an Individual',
    estate: true,
  },
  {
    value: 'Transfer from entity to Trust: FinCEN reportable',
    label: 'Entity (LLC/Corp) → Trust  (+$95 FinCEN)',
    from: 'Entity', to: 'Trust', transfer: 'Transfer from Entity to Trust',
    estate: true,
  },
  {
    value: 'Transfer to Company: FinCEN reportable',
    label: 'Transfer to a company/entity  (+$95 FinCEN)',
    from: 'Owner', to: 'Company', transfer: 'Transfer to a Company',
  },
  {
    value: 'Transfer due to divorce: FinCEN non-reportable',
    label: 'Transfer due to divorce',
    from: 'Spouse', to: 'Spouse', transfer: 'Transfer due to divorce',
  },
  {
    value: 'Transfer due to court order: FinCEN non-reportable',
    label: 'Transfer due to court order',
    from: 'Owner', to: 'Recipient', transfer: 'Transfer due to court order',
  },
  {
    value: 'Transfer of non-residential property: FinCEN non-reportable',
    label: 'Non-residential / commercial property',
    from: 'Owner', to: 'New Owner', transfer: 'Transfer of non-residential property',
  },
  {
    value: 'Transfer to qualified intermediary for 1031 purpose: FinCEN non-reportable',
    label: '1031 exchange intermediary',
    from: 'Owner', to: '1031 Intermediary', transfer: 'Transfer to 1031 intermediary',
  },
  {
    value: 'Transfer to regulated entity: FinCEN non-reportable',
    label: 'Transfer to a regulated entity',
    from: 'Owner', to: 'Regulated Entity', transfer: 'Transfer to a regulated entity',
  },
];

// Party options offered in the "transfer parties" selector.
export const TRANSFER_PARTIES = ['Individual', 'Trust', 'Company'];

// The attorney picks who is transferring and who is receiving; that combination
// maps to the EXACT Enterprise deed-type string. These are verbatim from the
// 50deeds backend's accepted list — the irregular casing is intentional and
// matched exactly so a case-sensitive backend won't reject them.
const DEED_TYPE_BY_PARTIES = {
  'individual|individual': 'Individual to individual',
  'individual|trust': 'Individual to trust',
  'individual|company': 'Individual to company',
  'trust|individual': 'Trust to Individual',
  'trust|trust': 'Trust to trust',
  'trust|company': 'Trust to company',
  'company|individual': 'Company to individual',
  'company|trust': 'Company to Trust',
  'company|company': 'Company to Company',
};

export function deedTypeForParties(from, to) {
  const f = String(from || '').trim().toLowerCase();
  const t = String(to || '').trim().toLowerCase();
  return DEED_TYPE_BY_PARTIES[`${f}|${t}`] || '';
}

// The 9 valid Enterprise deed types (verbatim).
export const PARTY_DEED_TYPES = Object.values(DEED_TYPE_BY_PARTIES);

export function isValidDeedType(value) {
  return PARTY_DEED_TYPES.includes(value);
}
