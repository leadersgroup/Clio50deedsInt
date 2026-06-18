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

export function isValidDeedType(value) {
  return DEED_TYPES.some((d) => d.value === value);
}

// All Clio-sourced orders currently map to this single Enterprise deed type.
// The attorney's chosen transfer parties (from/to) are captured separately and
// recorded in the order notes rather than changing the deed type.
export const DEFAULT_DEED_TYPE =
  'Transfer from individual to own Revocable Trust as grantor: FinCEN non-reportable';

// Party options offered in the "transfer parties" selector.
export const TRANSFER_PARTIES = ['Individual', 'Trust', 'Company'];
