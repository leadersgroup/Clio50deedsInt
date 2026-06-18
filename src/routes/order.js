import express from 'express';
import { config } from '../config.js';
import { getDraft, updateDraftData, setDraftStripeSession } from '../db/drafts.js';
import { saveFile, getFile } from '../db/files.js';
import { lookupProperty } from '../services/countyLookup.js';
import { resolvePrice, dollars } from '../services/priceTable.js';
import { isValidDeedType, deedTypeForParties, TRANSFER_PARTIES } from '../services/deedTypes.js';
import { stripe } from '../stripe/client.js';

export const orderRouter = express.Router();

// Live price lookup for the form. Pulls authoritative pricing from the Enterprise
// /pricing endpoint (per county + deed type), falling back to the static table.
orderRouter.get('/price', async (req, res, next) => {
  try {
    const price = await resolvePrice({
      state: String(req.query.state || ''),
      county: String(req.query.county || ''),
      deedType: String(req.query.deedType || ''),
    });
    res.json({ cents: price.cents, display: price.display, source: price.source, breakdown: price.breakdown });
  } catch (err) {
    next(err);
  }
});

// Serve an uploaded supporting document by capability URL. This URL is passed to the
// Enterprise order as the attachment file_url so the 50deeds backend can fetch it.
// Defined before '/:draftId' so it isn't shadowed by the draft route.
orderRouter.get('/files/:fileId', async (req, res, next) => {
  try {
    const f = await getFile(req.params.fileId);
    if (!f) return res.status(404).send('Not found');
    res.setHeader('Content-Type', f.mime || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(f.file_name)}"`);
    res.send(f.bytes);
  } catch (err) {
    next(err);
  }
});

// Render the pre-filled order form for a draft.
orderRouter.get('/:draftId', async (req, res, next) => {
  try {
    const draft = await getDraft(req.params.draftId);
    if (!draft) return res.status(404).send('Order draft not found or expired.');
    const price = await resolvePrice({
      state: draft.data.state?.value,
      county: draft.data.county?.value,
      deedType: draft.data.deedType?.value,
    });
    res.render('orderForm', {
      draftId: draft.id,
      d: draft.data,
      priceDisplay: price.display,
      initialDeedType: deedTypeForParties(draft.data.transferFrom?.value, draft.data.transferTo?.value),
      transferParties: TRANSFER_PARTIES,
      googleMapsApiKey: config.googleMapsApiKey,
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

// Upload a supporting document (base64 JSON). Stored in Postgres and tracked on the
// draft as an attachment { file_url, file_name, file_size } for the Enterprise order.
orderRouter.post('/:draftId/upload', async (req, res, next) => {
  try {
    const draft = await getDraft(req.params.draftId);
    if (!draft) return res.status(404).json({ error: 'draft not found' });

    const { file_name, mime, data_base64 } = req.body || {};
    if (!file_name || !data_base64) return res.status(400).json({ error: 'file_name and data_base64 required' });

    const bytes = Buffer.from(String(data_base64), 'base64');
    if (bytes.length === 0) return res.status(400).json({ error: 'empty file' });
    if (bytes.length > 15 * 1024 * 1024) return res.status(413).json({ error: 'file too large (max 15MB)' });

    const saved = await saveFile({ draftId: draft.id, fileName: String(file_name).slice(0, 200), mime, bytes });
    const fileUrl = `${config.appBaseUrl}/order/files/${saved.id}`;

    const data = draft.data;
    data.attachments = Array.isArray(data.attachments) ? data.attachments : [];
    data.attachments.push({ file_url: fileUrl, file_name: saved.fileName, file_size: saved.sizeBytes });
    await updateDraftData(draft.id, data);

    res.json({ id: saved.id, file_name: saved.fileName, file_size: saved.sizeBytes, file_url: fileUrl });
  } catch (err) {
    next(err);
  }
});

// Submit: persist attorney edits, then start Stripe checkout for the resolved price.
// The Enterprise order itself is created AFTER payment succeeds (see routes/stripe.js)
// so it arrives already paid — the same way fastwill.com orders reach the pipeline.
orderRouter.post('/:draftId/submit', async (req, res, next) => {
  try {
    const draft = await getDraft(req.params.draftId);
    if (!draft) return res.status(404).send('Order draft not found or expired.');

    const body = req.body || {};
    const state = String(body.state || draft.data.state?.value || '').toUpperCase();
    const county = String(body.county || draft.data.county?.value || '');
    // Deed type is derived from the chosen transfer parties (9 combinations).
    const deedType = deedTypeForParties(body.transferFrom, body.transferTo);

    if (!isValidDeedType(deedType)) {
      return res.status(400).send('Please choose who is transferring and who is receiving the property.');
    }

    // Merge attorney-confirmed values into the draft data.
    const editable = [
      'grantorName', 'grantorAddress', 'granteeName', 'propertyAddress', 'county', 'state',
      'apn', 'legalDescription', 'priorDeedReference', 'deedType', 'contactEmail', 'additionalInstructions',
      'transferFrom', 'transferTo', 'city',
    ];
    const data = draft.data;
    for (const f of editable) {
      if (body[f] !== undefined) {
        data[f] = { ...(data[f] || {}), value: body[f], needsConfirmation: false };
      }
    }
    data.state = { ...(data.state || {}), value: state };
    // Authoritative deed type derived server-side from the transfer parties.
    data.deedType = { ...(data.deedType || {}), value: deedType, needsConfirmation: false };
    await updateDraftData(draft.id, data);

    // Resolve the price to charge (Enterprise pricing, per county + deed type).
    const price = await resolvePrice({ state, county, deedType });

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      ...(body.contactEmail ? { customer_email: body.contactEmail } : {}),
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: price.cents,
            product_data: {
              name: `50deeds deed order — ${state}${county ? ' / ' + county : ''}`,
              description: `${deedType} · Clio matter ${draft.display_number || draft.clio_matter_id}`,
            },
          },
        },
      ],
      metadata: {
        draft_id: draft.id,
        clio_matter_id: String(draft.clio_matter_id),
        clio_display_number: draft.display_number || '',
        price_source: price.source,
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

// Success landing. The webhook is the source of truth for submitting the order to
// the Enterprise pipeline; we also reconcile here so the attorney sees confirmation
// immediately even if the webhook is delayed.
orderRouter.get('/:draftId/success', async (req, res, next) => {
  try {
    const draft = await getDraft(req.params.draftId);
    if (!draft) return res.status(404).send('Order not found.');

    const sessionId = String(req.query.session_id || '');
    let current = draft;
    if (draft.status !== 'paid' && sessionId) {
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      if (session.payment_status === 'paid') {
        const { finalizePaidOrder } = await import('./stripe.js');
        await finalizePaidOrder(session);
        current = (await getDraft(draft.id)) || draft;
      }
    }

    res.status(200).send(successHtml({
      paid: current.status === 'paid',
      displayNumber: current.display_number,
      orderId: current.order_id,
      customOrderId: current.data?.enterpriseCustomOrderId,
    }));
  } catch (err) {
    next(err);
  }
});

function successHtml({ paid, displayNumber, orderId, customOrderId }) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${paid ? 'Order confirmed' : 'Payment pending'}</title>
<style>body{font-family:system-ui,sans-serif;max-width:560px;margin:80px auto;padding:0 20px;color:#1a2b4a}
.ok{color:#1a7f4b}code{background:#f1f4f9;padding:2px 6px;border-radius:4px}</style></head>
<body><h1>${paid ? '✅ Deed order confirmed' : '⏳ Payment processing'}</h1>
${paid
  ? `<p class="ok">Your deed order has been submitted to 50deeds and is in fulfillment.</p>
     <p>Order <code>${customOrderId || orderId || ''}</code> · Clio matter <code>${displayNumber || ''}</code></p>`
  : `<p>We're confirming your payment and submitting your order. If this persists, check your email for a receipt.</p>`}
</body></html>`;
}
