// Flat-rate price (USD cents) per US state for a deed order.
// Mirrors the existing 50deeds price table. Override values here as the real
// table changes, or wire this to pull from the 50deeds backend.
const DEFAULT_PRICE_CENTS = 29900; // $299 most states

const STATE_PRICE_CENTS = {
  NY: 64900, // $649
  // add per-state overrides as needed
};

export function priceForState(state) {
  const s = (state || '').toUpperCase();
  return STATE_PRICE_CENTS[s] ?? DEFAULT_PRICE_CENTS;
}

export function priceDisplay(state) {
  const cents = priceForState(state);
  return `$${(cents / 100).toFixed(2)}`;
}
