import crypto from 'node:crypto';
import { query } from './index.js';

export function newDraftId() {
  return crypto.randomBytes(16).toString('hex');
}

export async function createDraft({ clioUserId, clioMatterId, displayNumber, data }) {
  const id = newDraftId();
  await query(
    `INSERT INTO deed_order_drafts (id, clio_user_id, clio_matter_id, display_number, data)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, clioUserId, clioMatterId, displayNumber, data],
  );
  return id;
}

export async function getDraft(id) {
  const { rows } = await query(`SELECT * FROM deed_order_drafts WHERE id = $1`, [id]);
  return rows[0] || null;
}

export async function updateDraftData(id, data) {
  await query(
    `UPDATE deed_order_drafts SET data = $2, updated_at = now() WHERE id = $1`,
    [id, data],
  );
}

export async function setDraftStripeSession(id, stripeSessionId) {
  await query(
    `UPDATE deed_order_drafts SET stripe_session = $2, updated_at = now() WHERE id = $1`,
    [id, stripeSessionId],
  );
}

export async function getDraftByStripeSession(stripeSessionId) {
  const { rows } = await query(
    `SELECT * FROM deed_order_drafts WHERE stripe_session = $1`,
    [stripeSessionId],
  );
  return rows[0] || null;
}

export async function markDraft(id, { status, orderId }) {
  await query(
    `UPDATE deed_order_drafts SET status = $2, order_id = COALESCE($3, order_id), updated_at = now() WHERE id = $1`,
    [id, status, orderId ?? null],
  );
}
