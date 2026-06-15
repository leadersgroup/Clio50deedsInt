import express from 'express';
import { config } from '../config.js';
import { getDraft, updateDraftData, setDraftStripeSession } from '../db/drafts.js';
import { lookupProperty } from '../services/countyLookup.js';
import { createOrder } from '../services/orderSystem.js';
import { priceForState, priceDisplay } from '../services/priceTable.js';
import { stripe } from '../stripe/client.js';

export const orderRouter = express.Router();

// Live price lookup for the form.
orderRouter.get('/price', (req, res) => {
  const state = String(req.query.state || '');
  res.json({ cents: priceForState(state), display: priceDisplay(state) });
});

// Render the pre-filled order form for a draft.
orderRouter.get('/:draftId', async (req, res, next) => {
  try {
    const draft = await getDraft(req.params.draftId);
    if (!draft) return res.status(404).send('Order draft not found or expired.');
    res.render('orderForm', {
      draftId: draft.id,
      d: draft.data,
      priceDisplay: priceDisplay(draft.data.state?.value),
    });
  } catch (err) {
    next(err);
  }
});

// County record lookup — the differentiator. Triggered when the attorney confirms
// the property address. Returns APN, legal description, prior deed, owner/vesting.
orderRouter.post('/:draftId/county-lookup', async (req, res, next) => {
  try {
    const draft = await getDraft(req.params.draftId);
    if (!draft) return res.status(404).json({ error: 'draft not found' });

    const { address, state, county } = req.body || {};
    if (!address) return res.status(400).json({ error: 'address required' });

    const result = await lookupProperty({ address, state, county });

    // Persist the auto-filled values back onto the draft (provenance preserved).
    const data = draft.data;
    data.propertyAddress = { value: address, source: 'confirmed', needsConfirmation: false };
    if (result.found) {
      data.apn = { value: result.apn, source: 'county-lookup', needsConfirmation: false };
      data.legalDescription = { value: result.legalDescription, source: 'county-lookup', needsConfirmation: false };
      data.priorDeedReference = { value: result.priorDeedReference, source: 'county-lookup', needsConfirmation: false };
      if (result.county) data.county = { value: result.county, source: 'county-lookup', needsConfirmation: false };
      if (result.state) data.state = { value: result.state, source: 'county-lookup', needsConfirmation: false };
      data.currentOwner = { value: result.currentOwner, source: 'county-lookup', needsConfirmation: false };
    }
    await updateDraftData(draft.id, data);

    res.json(result);
  } catch (err) {
    if (err.status) return res.status(502).json({ error: 'county lookup unavailable', detail: err.message });
    next(err);
  }
});

// Submit: persist attorney edits, create the 50deeds order, start Stripe checkout.
orderRouter.post('/:draftId/submit', async (req, res, next) => {
  try {
    const draft = await getDraft(req.params.draftId);
    if (!draft) return res.status(404).send('Order draft not found or expired.');

    const body = req.body || {};
    const state = String(body.state || draft.data.state?.value || '').toUpperCase();

    // Merge attorney-confirmed values into the draft data.
    const fields = [
      'grantorName', 'grantorAddress', 'granteeName', 'propertyAddress',
      'county', 'state', 'apn', 'legalDescription', 'priorDeedReference', 'deedType',
    ];
    const data = draft.data;
    for (const f of fields) {
      if (body[f] !== undefined) {
        data[f] = { ...(data[f] || {}), value: body[f], needsConfirmation: false };
      }
    }
    await updateDraftData(draft.id, data);

    // Create the order in the existing 50deeds system of record (Base44 pipeline).
    const orderPayload = {
      source: 'clio-integration',
      clio_matter_id: draft.clio_matter_id,
      clio_display_number: draft.display_number,
      grantor_name: body.grantorName,
      grantor_address: body.grantorAddress,
      grantee_name: body.granteeName,
      property_address: body.propertyAddress,
      county: body.county,
      state,
      apn: body.apn,
      legal_description: body.legalDescription,
      prior_deed_reference: body.priorDeedReference,
      deed_type: body.deedType,
      amount_cents: priceForState(state),
    };
    const order = await createOrder(orderPayload);

    // Record the order id on the draft so the webhook / success page can tag it.
    data.orderId = order.id;
    await updateDraftData(draft.id, data);

    // Stripe Checkout for the state's flat rate.
    const amount = priceForState(state);
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: amount,
            product_data: {
              name: `50deeds ${deedTypeLabel(body.deedType)} — ${state}`,
              description: `Clio matter ${draft.display_number || draft.clio_matter_id}`,
            },
          },
        },
      ],
      // Trace everything back to the order + matter on payment success.
      metadata: {
        draft_id: draft.id,
        order_id: String(order.id),
        clio_matter_id: String(draft.clio_matter_id),
        clio_display_number: draft.display_number || '',
      },
      success_url: `${config.appBaseUrl}/order/${draft.id}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${config.appBaseUrl}/order/${draft.id}`,
    });

    await setDraftStripeSession(draft.id, session.id);
    res.redirect(303, session.url);
  } catch (err) {
    next(err);
  }
});

// Success landing. Confirms payment (webhook is the source of truth for fulfillment,
// but we also reconcile here so the attorney sees confirmation immediately).
orderRouter.get('/:draftId/success', async (req, res, next) => {
  try {
    const draft = await getDraft(req.params.draftId);
    if (!draft) return res.status(404).send('Order not found.');

    const sessionId = String(req.query.session_id || '');
    let paid = draft.status === 'paid';
    if (!paid && sessionId) {
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      paid = session.payment_status === 'paid';
      if (paid) {
        const { finalizePaidOrder } = await import('./stripe.js');
        await finalizePaidOrder(session);
      }
    }

    res.status(200).send(successHtml({
      paid,
      displayNumber: draft.display_number,
      orderId: draft.order_id || draft.data?.orderId,
    }));
  } catch (err) {
    next(err);
  }
});

function deedTypeLabel(t) {
  return { warranty: 'Warranty Deed', quitclaim: 'Quitclaim Deed', tod: 'TOD Deed', grant: 'Grant Deed' }[t] || 'Deed';
}

function successHtml({ paid, displayNumber, orderId }) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${paid ? 'Order confirmed' : 'Payment pending'}</title>
<style>body{font-family:system-ui,sans-serif;max-width:560px;margin:80px auto;padding:0 20px;color:#1a2b4a}
.ok{color:#1a7f4b}code{background:#f1f4f9;padding:2px 6px;border-radius:4px}</style></head>
<body><h1>${paid ? '✅ Deed order confirmed' : '⏳ Payment processing'}</h1>
${paid
  ? `<p class="ok">Your deed order has been placed and is in 50deeds fulfillment.</p>
     <p>Order <code>${orderId || ''}</code> · Clio matter <code>${displayNumber || ''}</code></p>`
  : `<p>We're confirming your payment. If this persists, check your email for a receipt.</p>`}
</body></html>`;
}
