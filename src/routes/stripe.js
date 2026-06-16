import express from 'express';
import { config } from '../config.js';
import { stripe } from '../stripe/client.js';
import { getDraftByStripeSession, getDraft, markDraft, updateDraftData } from '../db/drafts.js';
import { submitPaidOrder } from '../services/orderSystem.js';

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
  data.enterpriseCustomOrderId = order.customOrderId;
  await updateDraftData(draft.id, data);
  await markDraft(draft.id, { status: 'paid', orderId: order.id });
}
