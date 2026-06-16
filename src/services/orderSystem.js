import { createOrder } from './enterpriseApi.js';

// Submit a paid deed order to the 50deeds Enterprise system of record (Base44),
// the same pipeline fastwill.com orders flow through. Called AFTER Stripe payment
// succeeds, so the order arrives already paid.
//
// `draft` is the deed_order_drafts row; `data` is its mapped/confirmed field values.
export async function submitPaidOrder(draft, { stripeSessionId, amountCents } = {}) {
  const data = draft.data || {};
  const val = (f) => (data[f] && typeof data[f] === 'object' ? data[f].value : data[f]) || '';

  // Trace back to the Clio matter (the Enterprise API has no dedicated Clio field,
  // so matter identity rides in additional_instructions + custom traceability).
  const traceLines = [
    `Source: Clio Manage integration`,
    draft.display_number ? `Clio matter: ${draft.display_number}` : null,
    draft.clio_matter_id ? `Clio matter id: ${draft.clio_matter_id}` : null,
    stripeSessionId ? `Stripe session: ${stripeSessionId}` : null,
    val('priorDeedReference') ? `Prior deed: ${val('priorDeedReference')}` : null,
    val('apn') ? `APN: ${val('apn')}` : null,
    val('legalDescription') ? `Legal description: ${val('legalDescription')}` : null,
  ].filter(Boolean);

  const extra = val('additionalInstructions');
  if (extra) traceLines.push(`Notes: ${extra}`);

  const fields = {
    property_address: val('propertyAddress'),
    grantor_name: val('grantorName'),
    grantee_name: val('granteeName'),
    deed_type: val('deedType'),
    county: val('county'),
    state: (val('state') || '').toUpperCase(),
    contact_email: val('contactEmail'),
    additional_instructions: traceLines.join('\n'),
    // Carry payment + Clio identity as explicit fields too (ignored by the API if
    // unknown, but useful if/when the backend adds columns for them).
    payment_status: 'paid',
    amount_cents: amountCents,
    stripe_session_id: stripeSessionId,
    clio_matter_id: draft.clio_matter_id,
    clio_display_number: draft.display_number,
  };

  const order = await createOrder(fields);
  return { id: order.id, customOrderId: order.custom_order_id, status: order.status, raw: order };
}
