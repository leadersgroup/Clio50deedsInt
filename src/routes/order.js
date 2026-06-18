import express from 'express';
import { config } from '../config.js';
import { getDraft, updateDraftData, setDraftStripeSession } from '../db/drafts.js';
import { saveFile, getFile } from '../db/files.js';
import { getOrder, uploadDocument } from '../services/enterpriseApi.js';
import { buildOrderList, mergeAttachments } from '../services/manageView.js';
import { encrypt } from '../crypto/tokenCrypto.js';
import { lookupProperty } from '../services/countyLookup.js';
import { resolvePrice, dollars } from '../services/priceTable.js';
import { isValidDeedType, deedTypeForParties, TRANSFER_PARTIES } from '../services/deedTypes.js';
import { stripe } from '../stripe/client.js';

export const orderRouter = express.Router();

// File types 50deeds' uploadDocument accepts (PDF, PNG, JPG, TIFF, DOC, DOCX). We force
// the canonical MIME so a file with a missing/odd browser MIME (e.g. a .jpg reported as
// octet-stream) still passes 50deeds' content-type check.
const ALLOWED_UPLOAD_MIME = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

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
      matterUrl: draft.clio_matter_id ? `${config.clio.authBase}/nc/#/matters/${draft.clio_matter_id}` : '',
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
    if (bytes.length > 14 * 1024 * 1024) return res.status(413).json({ error: 'File too large (max 14 MB).' });
    const fileName = String(file_name).slice(0, 200);

    // 50deeds only accepts certain types; reject others up front (rather than silently
    // hosting them locally, where they never become real 50deeds documents). Force the
    // canonical MIME so an odd/empty browser MIME on an allowed type still passes.
    const ext = (fileName.split('.').pop() || '').toLowerCase();
    const allowedMime = ALLOWED_UPLOAD_MIME[ext];
    if (!allowedMime) {
      return res.status(415).json({ error: 'Unsupported file type. Allowed: PDF, PNG, JPG, TIFF, DOC, DOCX.' });
    }

    // Upload to 50deeds storage (returns a public file_url). Fall back to hosting it
    // ourselves only if 50deeds rejects an allowed-type file transiently, so there's a URL.
    let attachment;
    let attached = false;
    try {
      attachment = await uploadDocument(bytes, fileName, allowedMime, {
        orderId: draft.order_id,
        customOrderId: draft.data?.enterpriseCustomOrderId,
      });
      attached = true; // the file is now stored at 50deeds
    } catch (err) {
      console.error('[order] uploadDocument failed, hosting locally:', err.status || '', err.message);
      const saved = await saveFile({ draftId: draft.id, fileName, mime, bytes });
      attachment = { file_url: `${config.appBaseUrl}/order/files/${saved.id}`, file_name: saved.fileName, file_size: saved.sizeBytes };
    }

    const data = draft.data;
    data.attachments = Array.isArray(data.attachments) ? data.attachments : [];
    data.attachments.push(attachment);
    await updateDraftData(draft.id, data);

    // uploadDocument receives order_id/custom_order_id, so 50deeds attaches the file
    // to the order (pre-order uploads also ride along in the POST /orders attachments).
    res.json({ ...attachment, attached });
  } catch (err) {
    next(err);
  }
});

// Live order status + attachments for a draft (capability URL by draftId; no Clio
// nonce needed). Powers the "Refresh" button on the manage page.
orderRouter.get('/:draftId/status', async (req, res, next) => {
  try {
    const draft = await getDraft(req.params.draftId);
    if (!draft) return res.status(404).json({ error: 'not found' });
    let live = null;
    if (draft.order_id) {
      try {
        live = await getOrder(draft.order_id);
      } catch (err) {
        console.error('[order] status fetch failed:', err.status || '', err.message);
      }
    }
    const data = draft.data || {};
    const removed = live?.notFound === true;
    res.json({
      status: removed ? 'Removed at 50deeds' : live?.status || draft.status || 'Submitted',
      removed,
      customOrderId: data.enterpriseCustomOrderId || live?.custom_order_id || '',
      total: removed ? '' : live && live.total_price != null ? `$${Number(live.total_price).toFixed(2)}` : '',
      attachments: removed ? [] : mergeAttachments(live?.attachments, data.attachments),
    });
  } catch (err) {
    next(err);
  }
});

// The "View/manage 50deeds order" page, reachable WITHOUT a Clio nonce (capability
// URL by draftId) — used by the success page's "View & track" button. Renders the
// same page as the custom action.
orderRouter.get('/:draftId/manage', async (req, res, next) => {
  try {
    const draft = await getDraft(req.params.draftId);
    if (!draft) return res.status(404).send('Order not found or expired.');
    const orders = await buildOrderList(draft.clio_matter_id);
    res.render('manageOrder', {
      matterRef: draft.display_number || '',
      matterUrl: draft.clio_matter_id ? `${config.clio.authBase}/nc/#/matters/${draft.clio_matter_id}` : '',
      orders,
    });
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
      'transferFrom', 'transferTo', 'city', 'grantorSsn', 'granteeSsn',
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
    // Encrypt SSNs at rest (PII) — decrypted only when the order is sent to 50deeds.
    for (const f of ['grantorSsn', 'granteeSsn']) {
      if (data[f]?.value) data[f] = { value: encrypt(String(data[f].value)) };
    }
    await updateDraftData(draft.id, data);

    // Pre-flight: the Enterprise POST /orders requires these and runs AFTER payment,
    // so validate now — block here rather than charge-then-fail.
    const fval = (f) => (data[f] && typeof data[f] === 'object' ? data[f].value : data[f]) || '';
    const missing = [];
    if (!String(fval('propertyAddress')).trim()) missing.push('property address');
    if (!String(fval('grantorName')).trim()) missing.push('homeowner name');
    if (!String(fval('granteeName')).trim()) missing.push('new owner name');
    if (!String(fval('contactEmail')).trim()) missing.push('contact email');
    if (missing.length) {
      return res.status(400).send(blockPage(`Please add the ${missing.join(', ')} before continuing to payment.`, `/order/${draft.id}`));
    }
    if (state === 'NY') {
      const nyMissing = [];
      if (!String(fval('grantorSsn')).trim()) nyMissing.push('homeowner (grantor) SSN');
      if (!String(fval('granteeSsn')).trim()) nyMissing.push('new owner (grantee) SSN');
      if (nyMissing.length) {
        return res.status(400).send(blockPage(`New York orders require the ${nyMissing.join(' and ')}.`, `/order/${draft.id}`));
      }
    }

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
      draftId: current.id,
    }));
  } catch (err) {
    next(err);
  }
});

// Shown when a submit is blocked pre-payment (missing field / unsupported state).
function blockPage(message, backUrl) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Cannot submit yet</title>
<style>body{font-family:system-ui,sans-serif;max-width:520px;margin:80px auto;padding:0 20px;color:#1a2b4a}
.amber{color:#b26a00}.btn{display:inline-block;margin-top:18px;background:#2563eb;color:#fff;text-decoration:none;font-weight:700;padding:11px 18px;border-radius:10px}</style></head>
<body><h1>⚠️ Can't submit this order yet</h1>
<p class="amber">${message}</p>
<p><a class="btn" href="${backUrl}">← Back to the order</a></p></body></html>`;
}

function successHtml({ paid, displayNumber, orderId, customOrderId, draftId }) {
  // Link to our "View/manage 50deeds order" page (capability URL, no Clio nonce).
  const manageUrl = draftId ? `/order/${draftId}/manage` : '';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${paid ? 'Order confirmed' : 'Payment pending'}</title>
<style>body{font-family:system-ui,sans-serif;max-width:560px;margin:80px auto;padding:0 20px;color:#1a2b4a}
.ok{color:#1a7f4b}code{background:#f1f4f9;padding:2px 6px;border-radius:4px}
.btn{display:inline-block;margin-top:18px;background:#2563eb;color:#fff;text-decoration:none;font-weight:700;padding:11px 18px;border-radius:10px}
.fine{font-size:13px;color:#7a8aa6;margin-top:10px}</style></head>
<body><h1>${paid ? '✅ Deed order confirmed' : '⏳ Payment processing'}</h1>
${paid
  ? `<p class="ok">Your deed order has been submitted to 50deeds and is in fulfillment.</p>
     <p>Order <code>${customOrderId || orderId || ''}</code> · Clio matter <code>${displayNumber || ''}</code></p>
     ${manageUrl ? `<p><a class="btn" href="${manageUrl}">View &amp; track this order →</a></p>
     <p class="fine">Status updates from 50deeds post automatically to this matter.</p>` : ''}`
  : `<p>We're confirming your payment and submitting your order. If this persists, check your email for a receipt.</p>`}
</body></html>`;
}
