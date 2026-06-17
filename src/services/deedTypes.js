// The 10 FinCEN-classified deed types the Enterprise API expects, verbatim.
// The `value` is the exact string the API requires for /pricing and /orders.
// Estate-relevant types are listed first (trust funding, death transfer).
export const DEED_TYPES = [
  {
    value: 'Transfer from individual to own Revocable Trust as grantor: FinCEN non-reportable',
    label: 'Individual → own Revocable Trust (trust funding)',
    estate: true,
  },
  {
    value: 'Transfer due to death of individual: FinCEN non-reportable',
    label: 'Transfer due to death of individual (estate/probate)',
    estate: true,
  },
  {
    value: 'Transfer to Individual: FinCEN non-reportable',
    label: 'Transfer to an individual',
    estate: true,
  },
  {
    value: 'Transfer from entity to Trust: FinCEN reportable',
    label: 'Entity (LLC/Corp) → Trust  (+$95 FinCEN)',
    estate: true,
  },
  {
    value: 'Transfer to Company: FinCEN reportable',
    label: 'Transfer to a company/entity  (+$95 FinCEN)',
  },
  {
    value: 'Transfer due to divorce: FinCEN non-reportable',
    label: 'Transfer due to divorce',
  },
  {
    value: 'Transfer due to court order: FinCEN non-reportable',
    label: 'Transfer due to court order',
  },
  {
    value: 'Transfer of non-residential property: FinCEN non-reportable',
    label: 'Non-residential / commercial property',
  },
  {
    value: 'Transfer to qualified intermediary for 1031 purpose: FinCEN non-reportable',
    label: '1031 exchange intermediary',
  },
  {
    value: 'Transfer to regulated entity: FinCEN non-reportable',
    label: 'Transfer to a regulated entity',
  },
];

export function isValidDeedType(value) {
  return DEED_TYPES.some((d) => d.value === value);
}
