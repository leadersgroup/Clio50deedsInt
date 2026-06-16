import { getPricing } from './enterpriseApi.js';

// Static fallback price (USD cents) per state, used only when the Enterprise
// pricing endpoint has no row for the state/county (404) or is unreachable.
const DEFAULT_PRICE_CENTS = 29900; // $299
const STATE_PRICE_CENTS = {
  NY: 64900, // $649
};

export function fallbackCents(state) {
  return STATE_PRICE_CENTS[(state || '').toUpperCase()] ?? DEFAULT_PRICE_CENTS;
}

// Resolve the price to charge. Prefer the Enterprise /pricing endpoint (authoritative,
// per county + deed type, includes recording + FinCEN fees and premium discount).
// Falls back to the static table if pricing data is unavailable.
// Returns { cents, display, source, breakdown }.
export async function resolvePrice({ state, county, deedType }) {
  if (state && county) {
    try {
      const p = await getPricing({ state, county, deedType });
      if (p && typeof p.total === 'number') {
        const cents = Math.round(p.total * 100);
        return { cents, display: dollars(cents), source: 'enterprise', breakdown: p };
      }
    } catch (err) {
      console.error('[pricing] enterprise lookup failed, using fallback:', err.message);
    }
  }
  const cents = fallbackCents(state);
  return { cents, display: dollars(cents), source: 'fallback', breakdown: null };
}

export function dollars(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}
