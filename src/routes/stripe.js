import express from 'express';
import { config } from '../config.js';
import { stripe } from '../stripe/client.js';
import { getDraftByStripeSession, getDraft, markDraft, updateDraftData } from '../db/drafts.js';
import { submitPaidOrder } from '../services/orderSystem.js';
import { postMatterNote } from '../clio/notes.js';

export const stripeRouter = express.Router();

// Stripe webhook. MUST receive the RAW body (wired with express.raw in server.js).
// On checkout.session.completed we tag the 50deeds order paid + write Clio traceability.
stripeRouter.post('/webhook', async (req, res) => {
  let event = req.body;

  if (config.stripe.webhookSecret) {
    const sig = req.headers['stripe-signature'];
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, config.stripe.webhookSecret);
    } catch (err) {
      console.error('[stripe] webhook signature verification failed', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }
  } else if (Buffer.isBuffer(req.body)) {
    // No secret configured (local/dev) — parse the raw body so the handler still works.
    try {
      event = JSON.parse(req.body.toString('utf8'));
    } catch {
      return res.status(400).send('Invalid payload');
    }
  }

  try {
    if (event.type === 'checkout.session.completed') {
      await finalizePaidOrder(event.data.object);
    }
    res.json({ received: true });
  } catch (err) {
    console.error('[stripe] webhook handler error', err.message);
    // 500 so Stripe retries.
    res.status(500).send('handler error');
  }
});

// Idempotently finalize a paid order: submit it to the 50deeds Enterprise pipeline
// (the same one fastwill.com orders flow through) with the Clio matter number/id and
// Stripe session embedded for traceability, then mark the draft paid.
// Called from both the webhook and the success page (reconciliation) — guarded so the
// Enterprise order is created at most once.
export async function finalizePaidOrder(session) {
  const draft =
    (await getDraftByStripeSession(session.id)) ||
    (session.metadata?.draft_id ? await getDraft(session.metadata.draft_id) : null);
  if (!draft) {
    console.warn('[stripe] no draft for session', session.id);
    return;
  }
  if (draft.status === 'paid' || draft.order_id) return; // already submitted

  const order = await submitPaidOrder(draft, {
    stripeSessionId: session.id,
    amountCents: session.amount_total,
  });

  // Record the Enterprise order id + custom order id on the draft for the success page.
  const data = draft.data || {};
  // Don't retain SSNs after the order has been submitted to 50deeds.
  delete data.grantorSsn;
  delete data.granteeSsn;
  data.enterpriseCustomOrderId = order.customOrderId;
  await updateDraftData(draft.id, data);
  await markDraft(draft.id, { status: 'paid', orderId: order.id });

  // Write a confirmation Note back to the Clio matter so the attorney sees the order
  // inside Clio. Best-effort: a failure here (e.g. missing Notes write permission)
  // must never undo the finalized order.
  try {
    if (draft.clio_user_id && draft.clio_matter_id) {
      await postMatterNote(draft.clio_user_id, draft.clio_matter_id, buildOrderNote(draft, order, session));
    }
  } catch (err) {
    console.error('[clio] matter note post failed:', err.status || '', err.message);
  }
}

// Build the confirmation note (subject + detail) posted to the Clio matter.
function buildOrderNote(draft, order, session) {
  const data = draft.data || {};
  const v = (f) => (data[f] && typeof data[f] === 'object' ? data[f].value : data[f]) || '';
  const amount = typeof session.amount_total === 'number' ? `$${(session.amount_total / 100).toFixed(2)}` : '';
  const ref = order.customOrderId || order.id || '';
  const lines = [
    'Deed order submitted to 50deeds.',
    '',
    `Order #: ${ref}${order.status ? ` (status: ${order.status})` : ''}`,
    v('transferFrom') || v('transferTo') ? `Transfer: ${v('transferFrom') || '?'} → ${v('transferTo') || '?'}` : null,
    v('deedType') ? `Deed type: ${v('deedType')}` : null,
    v('propertyAddress') ? `Property: ${v('propertyAddress')}` : null,
    v('grantorName') ? `Grantor (homeowner): ${v('grantorName')}` : null,
    v('granteeName') ? `Grantee (new owner): ${v('granteeName')}` : null,
    amount ? `Amount paid: ${amount}` : null,
  ].filter((x) => x !== null);
  return { subject: `50deeds deed order ${ref}`.trim(), detail: lines.join('\n') };
}
