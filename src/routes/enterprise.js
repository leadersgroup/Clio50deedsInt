import express from 'express';
import { config } from '../config.js';
import { getDraftByOrderId } from '../db/drafts.js';
import { postMatterNote } from '../clio/notes.js';
import { registerWebhook } from '../services/enterpriseApi.js';

export const enterpriseRouter = express.Router();

// Two-way sync inbound: the 50deeds Enterprise API POSTs an order_status_update here
// whenever an order's status changes. We map it back to the originating Clio matter
// (by the stored Enterprise order id) and post a Note so the attorney sees status
// progress inside Clio. The path carries a shared secret because the Enterprise
// webhook has no signature. Always answers 2xx so 50deeds doesn't retry-storm.
enterpriseRouter.post('/webhook/:token', async (req, res) => {
  if (!config.enterprise.webhookSecret || req.params.token !== config.enterprise.webhookSecret) {
    return res.status(404).send('Not found');
  }
  try {
    const e = req.body || {};
    if (e.event_type === 'order_status_update' && e.order_id) {
      const draft = await getDraftByOrderId(String(e.order_id));
      if (draft?.clio_user_id && draft?.clio_matter_id) {
        const d = e.details || {};
        const ref = e.custom_order_id || e.order_id;
        try {
          await postMatterNote(draft.clio_user_id, draft.clio_matter_id, {
            subject: `50deeds order ${ref} — ${d.new_status || 'status update'}`,
            detail: [
              'Status update from 50deeds.',
              '',
              `Order #: ${ref}`,
              d.old_status || d.new_status ? `Status: ${d.old_status || '?'} → ${d.new_status || '?'}` : null,
              d.updated_by ? `Updated by: ${d.updated_by}` : null,
              e.timestamp ? `At: ${e.timestamp}` : null,
            ].filter((x) => x !== null).join('\n'),
          });
        } catch (err) {
          console.error('[enterprise-webhook] clio note failed:', err.status || '', err.message);
        }
      } else {
        console.warn('[enterprise-webhook] no matter for order_id', e.order_id);
      }
    }
  } catch (err) {
    console.error('[enterprise-webhook] handler error:', err.message);
  }
  res.json({ received: true });
});

// One-time admin trigger: register THIS app's webhook URL with the 50deeds API.
// Guarded by the same shared secret (passed as ?token=).
enterpriseRouter.get('/register-webhook', async (req, res, next) => {
  try {
    if (!config.enterprise.webhookSecret) return res.status(400).send('Set ENTERPRISE_WEBHOOK_SECRET first.');
    if (req.query.token !== config.enterprise.webhookSecret) {
      return res.status(403).send('Provide ?token=<ENTERPRISE_WEBHOOK_SECRET>');
    }
    const url = `${config.appBaseUrl}/enterprise/webhook/${config.enterprise.webhookSecret}`;
    const result = await registerWebhook(url);
    res.json({ registered: true, url, result });
  } catch (err) {
    next(err);
  }
});
