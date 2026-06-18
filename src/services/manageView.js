import { getDraftsByMatterId } from '../db/drafts.js';
import { getOrder } from './enterpriseApi.js';

// Format an ISO timestamp as Eastern Time, e.g. "Jun 18, 2026, 2:13 PM ET".
// Intl applies EST/EDT automatically for America/New_York regardless of server TZ.
export function formatET(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return (
    d.toLocaleString('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }) + ' ET'
  );
}

// Merge the live order's attachments with the ones we've uploaded/stored, deduped by
// file_url (or name). Keeps a just-uploaded file visible even before/if it's linked
// to the order at 50deeds, so it doesn't vanish on Refresh. Each attachment gets an
// `uploaded_et` (Eastern Time) derived from 50deeds' uploaded_date or our uploaded_at.
export function mergeAttachments(live, stored) {
  const out = [];
  const seen = new Set();
  for (const a of [...(Array.isArray(live) ? live : []), ...(Array.isArray(stored) ? stored : [])]) {
    if (!a) continue;
    const key = a.file_url || a.file_name;
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    out.push({ ...a, uploaded_et: formatET(a.uploaded_date || a.uploaded_at) });
  }
  return out;
}

// Build the order list shown on the "View/manage 50deeds order" page for a matter:
// every submitted order with its live Enterprise status (or "Removed at 50deeds"
// when the order 404s) and attachments. Shared by the custom-action receiver and
// the nonce-free /order/:draftId/manage route (reached from the success page).
export async function buildOrderList(clioMatterId) {
  const drafts = await getDraftsByMatterId(clioMatterId);
  const orders = [];
  for (const d of drafts) {
    if (!d.order_id) continue; // only submitted orders
    const data = d.data || {};
    const val = (f) => (data[f] && typeof data[f] === 'object' ? data[f].value : data[f]) || '';
    let live = null;
    try {
      live = await getOrder(d.order_id);
    } catch (err) {
      console.error('[manage] live status fetch failed:', err.status || '', err.message);
    }
    const removed = live?.notFound === true;
    orders.push({
      draftId: d.id,
      orderId: d.order_id,
      customOrderId: data.enterpriseCustomOrderId || live?.custom_order_id || '',
      status: removed ? 'Removed at 50deeds' : live?.status || d.status || 'Submitted',
      removed,
      transfer: val('transferFrom') || val('transferTo') ? `${val('transferFrom') || '?'} → ${val('transferTo') || '?'}` : '',
      propertyAddress: val('propertyAddress'),
      total: removed ? '' : live && live.total_price != null ? `$${Number(live.total_price).toFixed(2)}` : '',
      attachments: removed ? [] : mergeAttachments(live?.attachments, data.attachments),
    });
  }
  return orders;
}
