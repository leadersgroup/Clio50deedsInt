import express from 'express';
import { fetchMatter, fetchContact } from '../clio/matters.js';
import { mapMatterToOrder } from '../services/fieldMapper.js';
import { createDraft } from '../db/drafts.js';

export const customActionRouter = express.Router();

// Clio sends the attorney's browser here (GET) when they click the custom action.
// Query params: custom_action_id, user_id, subject_url, custom_action_nonce.
//
// The inbound GET is UNAUTHENTICATED and forgeable. We never trust its data: we
// look up the OAuth token for user_id and re-request subject_url from Clio with
// the nonce. If the nonce is wrong/expired Clio returns 403. The nonce is
// single-use and expires in 60s, so we validate immediately — no queueing.
customActionRouter.get('/custom-action', async (req, res, next) => {
  try {
    const subjectUrl = String(req.query.subject_url || '');
    const nonce = String(req.query.custom_action_nonce || '');
    const clioUserId = Number(req.query.user_id);

    if (!subjectUrl || !nonce || !clioUserId) {
      return res.status(400).send(page('Missing parameters', 'This link is missing required Clio parameters.'));
    }
    if (!/^\/api\/v4\/matters\/\d+$/.test(subjectUrl)) {
      // Only matters are supported (ui_reference = matters/show).
      return res.status(400).send(page('Unsupported', 'This action only works from a Clio matter.'));
    }

    // 1. Authenticated fetch of the matter, passing the nonce (Clio validates it).
    let matter;
    try {
      matter = await fetchMatter(clioUserId, subjectUrl, nonce);
    } catch (err) {
      if (err.code === 'NO_TOKEN') {
        // No/expired authorization for this user — send them to install/re-auth.
        return res.redirect(`/clio/install?return=${encodeURIComponent(req.originalUrl)}`);
      }
      if (err.status === 403) {
        // Bad/expired nonce, or insufficient permission.
        return res
          .status(403)
          .send(page('Could not verify this request', 'The secure link from Clio was invalid or expired (it lasts 60 seconds). Go back to the matter and click “Order a deed with 50deeds” again.'));
      }
      throw err;
    }

    // 2. Pull full detail for related contacts (grantee candidates), handling
    //    Clio's per-contact redaction gracefully.
    const relationships = Array.isArray(matter.relationships) ? matter.relationships : [];
    const relatedContacts = [];
    for (const rel of relationships) {
      const c = rel.contact;
      if (!c?.id) continue;
      try {
        const { contact, redacted } = await fetchContact(clioUserId, c.id);
        relatedContacts.push({ ...contact, relationship: rel.description || '', redacted });
      } catch (err) {
        if (err.status === 403) {
          // Attorney lacks permission to this contact — surface as redacted, don't blank it.
          relatedContacts.push({ id: c.id, name: c.name, relationship: rel.description || '', redacted: true });
        } else {
          throw err;
        }
      }
    }

    // 3. Map Clio data into the deed-order shape (with provenance per field).
    const orderData = mapMatterToOrder(matter, relatedContacts);

    // 4. Persist a draft and redirect the attorney's browser to the pre-filled form.
    const draftId = await createDraft({
      clioUserId,
      clioMatterId: matter.id,
      displayNumber: matter.display_number,
      data: orderData,
    });

    res.redirect(`/order/${draftId}`);
  } catch (err) {
    next(err);
  }
});

function page(title, msg) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;max-width:520px;margin:80px auto;padding:0 20px;color:#1a2b4a}</style>
</head><body><h1>${title}</h1><p>${msg}</p></body></html>`;
}
