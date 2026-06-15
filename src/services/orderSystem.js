import { config } from '../config.js';

// Adapter to the EXISTING 50deeds order system of record (Base44 + Node middleware).
// Creating an order here makes it flow through the same fulfillment pipeline as a
// normal web order. In MOCK mode it just echoes an order id so local dev works.

export async function createOrder(orderPayload) {
  if (config.orderSystem.mock) {
    const id = `mock_order_${shortHash(JSON.stringify(orderPayload))}`;
    return { id, status: 'created', mock: true };
  }

  const res = await fetch(`${config.orderSystem.url.replace(/\/$/, '')}/orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(config.orderSystem.apiKey ? { Authorization: `Bearer ${config.orderSystem.apiKey}` } : {}),
    },
    body: JSON.stringify(orderPayload),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`50deeds order create failed (${res.status}): ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  return { id: data.id ?? data.order_id, status: data.status ?? 'created', raw: data };
}

// Write Clio traceability (matter number + id) + payment info onto an existing order
// after Stripe payment succeeds, so fulfillment can trace it back to the matter.
export async function tagOrderPaid(orderId, { clioMatterId, displayNumber, stripeSessionId, amountCents }) {
  if (config.orderSystem.mock) {
    return { id: orderId, status: 'paid', mock: true };
  }
  const res = await fetch(`${config.orderSystem.url.replace(/\/$/, '')}/orders/${orderId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(config.orderSystem.apiKey ? { Authorization: `Bearer ${config.orderSystem.apiKey}` } : {}),
    },
    body: JSON.stringify({
      status: 'paid',
      clio_matter_id: clioMatterId,
      clio_display_number: displayNumber,
      stripe_session_id: stripeSessionId,
      amount_cents: amountCents,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`50deeds order tag-paid failed (${res.status}): ${body.slice(0, 300)}`);
  }
  return res.json();
}

function shortHash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h.toString(16);
}
