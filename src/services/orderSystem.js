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
  const attorney = data.attorney || {};
  const traceLines = [
    `Source: Clio Manage integration`,
    attorney.name ? `Ordering attorney: ${attorney.name}` : null,
    attorney.company ? `Firm: ${attorney.company}` : null,
    attorney.email ? `Attorney email: ${attorney.email}` : null,
    attorney.phone ? `Attorney phone: ${attorney.phone}` : null,
    val('transferFrom') || val('transferTo')
      ? `Transfer parties: ${val('transferFrom') || '?'} → ${val('transferTo') || '?'}`
      : null,
    draft.display_number ? `Clio matter: ${draft.display_number}` : null,
    draft.clio_matter_id ? `Clio matter id: ${draft.clio_matter_id}` : null,
    stripeSessionId ? `Stripe session: ${stripeSessionId}` : null,
    val('priorDeedReference') ? `Prior deed: ${val('priorDeedReference')}` : null,
    val('apn') ? `APN: ${val('apn')}` : null,
    val('legalDescription') ? `Legal description: ${val('legalDescription')}` : null,
  ].filter(Boolean);

  const extra = val('additionalInstructions');
  if (extra) traceLines.push(`Notes: ${extra}`);

  // Supporting documents uploaded on the form (homeowner ID, prior deed, cert of trust).
  const attachments = Array.isArray(data.attachments) ? data.attachments : [];

  const fields = {
    property_address: val('propertyAddress'),
    grantor_name: val('grantorName'),
    grantee_name: val('granteeName'),
    deed_type: val('deedType'),
    county: val('county'),
    state: (val('state') || '').toUpperCase(),
    // contact_name is REQUIRED by POST /orders; default to the client/grantor.
    contact_name: val('grantorName') || val('granteeName'),
    contact_email: val('contactEmail'),
    // Required for NY orders only; sent when collected.
    ...(val('grantorSsn') ? { grantor_ssn: val('grantorSsn') } : {}),
    ...(val('granteeSsn') ? { grantee_ssn: val('granteeSsn') } : {}),
    additional_instructions: traceLines.join('\n'),
    // Payment is collected from the attorney via Stripe BEFORE this call, so the
    // order must NOT trigger the enterprise ACH debit. Contract with the 50deeds
    // backend for the clioint@50deeds.com account: payment_method === "external"
    // (with a stripe_session_id present) => skip ACH, record the order as paid.
    payment_method: 'external',
    payment_status: 'paid',
    amount_cents: amountCents,
    stripe_session_id: stripeSessionId,
    ...(attachments.length ? { attachments } : {}),
    clio_matter_id: draft.clio_matter_id,
    clio_display_number: draft.display_number,
  };

  const order = await createOrder(fields);
  return { id: order.id, customOrderId: order.custom_order_id, status: order.status, raw: order };
}
