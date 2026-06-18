import express from 'express';
import { config } from '../config.js';
import { fetchMatter, fetchContact, fetchMatterRelationships, fetchUser } from '../clio/matters.js';
import { mapMatterToOrder } from '../services/fieldMapper.js';
import { createDraft, getDraftsByMatterId } from '../db/drafts.js';
import { getOrder } from '../services/enterpriseApi.js';

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
          .send(page('Could not verify this request', 'The secure link from Clio was invalid or expired (it lasts 60 seconds). Go back to the matter and click “Order a deed transfer with 50deeds” again.'));
      }
      throw err;
    }

    // 1b. The matter fetch is shallow (Clio rejects grandchild field nesting), so the
    //     client's mailing address comes from a separate contact fetch. Degrade
    //     gracefully (attorney confirms address) if the client is redacted/missing.
    if (matter.client?.id) {
      try {
        const { contact } = await fetchContact(clioUserId, matter.client.id);
        if (contact?.primary_address) matter.client.primary_address = contact.primary_address;
        if (!matter.client.primary_email_address && contact?.primary_email_address) {
          matter.client.primary_email_address = contact.primary_email_address;
        }
      } catch (err) {
        if (err.status !== 403) throw err; // redacted client -> proceed without address
      }
    }

    // 2. Related contacts (grantee candidates) via a separate /relationships query,
    //    then full detail per contact. Any failure here just yields no candidates —
    //    the form still renders with grantor + property; attorney enters the grantee.
    let relationships = [];
    try {
      relationships = await fetchMatterRelationships(clioUserId, matter.id);
    } catch (err) {
      if (err.status !== 403) console.error('[custom-action] relationships fetch failed:', err.message);
    }
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

    // Stamp the ordering attorney's contact onto the order — all orders go through
    // one shared 50deeds account, so this tells 50deeds who actually placed it.
    try {
      const u = await fetchUser(clioUserId, clioUserId);
      orderData.attorney = {
        name: u?.name || [u?.first_name, u?.last_name].filter(Boolean).join(' '),
        company: u?.account?.name || '',
        email: u?.email || '',
        phone: u?.phone_number || '',
      };
    } catch (err) {
      console.error('[custom-action] attorney lookup failed:', err.status || '', err.message);
    }

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

// Second custom action: "View/manage 50deeds order". Same untrusted-GET handling —
// validate the nonce by re-fetching the matter, then show the matter's 50deeds
// order(s) with live status and a place to upload documents back to 50deeds.
customActionRouter.get('/manage-order', async (req, res, next) => {
  try {
    const subjectUrl = String(req.query.subject_url || '');
    const nonce = String(req.query.custom_action_nonce || '');
    const clioUserId = Number(req.query.user_id);

    if (!subjectUrl || !nonce || !clioUserId) {
      return res.status(400).send(page('Missing parameters', 'This link is missing required Clio parameters.'));
    }
    if (!/^\/api\/v4\/matters\/\d+$/.test(subjectUrl)) {
      return res.status(400).send(page('Unsupported', 'This action only works from a Clio matter.'));
    }

    let matter;
    try {
      matter = await fetchMatter(clioUserId, subjectUrl, nonce);
    } catch (err) {
      if (err.code === 'NO_TOKEN') {
        return res.redirect(`/clio/install?return=${encodeURIComponent(req.originalUrl)}`);
      }
      if (err.status === 403) {
        return res
          .status(403)
          .send(page('Could not verify this request', 'The secure link from Clio was invalid or expired (it lasts 60 seconds). Reopen this from the matter.'));
      }
      throw err;
    }

    const drafts = await getDraftsByMatterId(matter.id);
    const orders = [];
    for (const d of drafts) {
      if (!d.order_id) continue; // only submitted orders
      const data = d.data || {};
      const val = (f) => (data[f] && typeof data[f] === 'object' ? data[f].value : data[f]) || '';
      let live = null;
      try {
        live = await getOrder(d.order_id);
      } catch (err) {
        console.error('[manage-order] live status fetch failed:', err.status || '', err.message);
      }
      orders.push({
        draftId: d.id,
        orderId: d.order_id,
        customOrderId: data.enterpriseCustomOrderId || live?.custom_order_id || '',
        status: live?.status || d.status || 'Submitted',
        transfer: val('transferFrom') || val('transferTo') ? `${val('transferFrom') || '?'} → ${val('transferTo') || '?'}` : '',
        propertyAddress: val('propertyAddress'),
        total: live && live.total_price != null ? `$${Number(live.total_price).toFixed(2)}` : '',
        attachments: (Array.isArray(live?.attachments) ? live.attachments : data.attachments) || [],
      });
    }

    res.render('manageOrder', {
      matterRef: matter.display_number || '',
      matterUrl: `${config.clio.authBase}/nc/#/matters/${matter.id}`,
      orders,
    });
  } catch (err) {
    next(err);
  }
});

function page(title, msg) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;max-width:520px;margin:80px auto;padding:0 20px;color:#1a2b4a}</style>
</head><body><h1>${title}</h1><p>${msg}</p></body></html>`;
}
