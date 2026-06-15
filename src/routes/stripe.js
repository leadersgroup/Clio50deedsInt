import express from 'express';
import { config } from '../config.js';
import { stripe } from '../stripe/client.js';
import { getDraftByStripeSession, getDraft, markDraft } from '../db/drafts.js';
import { tagOrderPaid } from '../services/orderSystem.js';

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

// Idempotently finalize a paid order: mark draft paid + tag the 50deeds order with
// the Clio matter number/id and Stripe session for fulfillment traceability.
// Called from both the webhook and the success page (reconciliation).
export async function finalizePaidOrder(session) {
  const draft =
    (await getDraftByStripeSession(session.id)) ||
    (session.metadata?.draft_id ? await getDraft(session.metadata.draft_id) : null);
  if (!draft) {
    console.warn('[stripe] no draft for session', session.id);
    return;
  }
  if (draft.status === 'paid') return; // already finalized

  const orderId = draft.order_id || draft.data?.orderId || session.metadata?.order_id;
  if (orderId) {
    await tagOrderPaid(orderId, {
      clioMatterId: draft.clio_matter_id,
      displayNumber: draft.display_number,
      stripeSessionId: session.id,
      amountCents: session.amount_total,
    });
  }
  await markDraft(draft.id, { status: 'paid', orderId });
}
