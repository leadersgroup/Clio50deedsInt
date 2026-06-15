import { config } from '../config.js';
import { getValidAccessToken } from './oauth.js';

const LABEL = 'Order a deed with 50deeds';
const UI_REFERENCE = 'matters/show';

function targetUrl() {
  return `${config.appBaseUrl}/clio/custom-action`;
}

// List custom actions already registered under this OAuth app for the user.
export async function listCustomActions(clioUserId) {
  const accessToken = await getValidAccessToken(clioUserId);
  const res = await fetch(
    `${config.clio.apiBase}/custom_actions?fields=id,label,ui_reference,target_url`,
    { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } },
  );
  if (!res.ok) throw new Error(`List custom_actions failed (${res.status}): ${await res.text()}`);
  const json = await res.json();
  return json.data || [];
}

// Register the "Order a deed with 50deeds" action on the Matter screen.
// Idempotent: if an action with the same label + ui_reference exists, returns it.
export async function ensureCustomAction(clioUserId) {
  const existing = await listCustomActions(clioUserId);
  const match = existing.find((a) => a.label === LABEL && a.ui_reference === UI_REFERENCE);
  if (match) {
    if (match.target_url !== targetUrl()) {
      return updateCustomAction(clioUserId, match.id);
    }
    return { created: false, action: match };
  }

  const accessToken = await getValidAccessToken(clioUserId);
  const res = await fetch(`${config.clio.apiBase}/custom_actions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      data: { label: LABEL, ui_reference: UI_REFERENCE, target_url: targetUrl() },
    }),
  });
  if (!res.ok) throw new Error(`Create custom_action failed (${res.status}): ${await res.text()}`);
  const json = await res.json();
  return { created: true, action: json.data };
}

async function updateCustomAction(clioUserId, id) {
  const accessToken = await getValidAccessToken(clioUserId);
  const res = await fetch(`${config.clio.apiBase}/custom_actions/${id}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ data: { target_url: targetUrl() } }),
  });
  if (!res.ok) throw new Error(`Update custom_action failed (${res.status}): ${await res.text()}`);
  const json = await res.json();
  return { created: false, updated: true, action: json.data };
}
