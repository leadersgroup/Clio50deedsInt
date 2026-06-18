import { config } from '../config.js';
import { getValidAccessToken } from './oauth.js';

const UI_REFERENCE = 'matters/show';

// All custom actions the app places on the Matter screen. Clio caps labels at 32
// chars (422 RecordInvalid otherwise), so clamp defensively.
const ACTIONS = [
  { label: 'Order deed transfer with 50deeds'.slice(0, 32), path: '/clio/custom-action' },
  { label: 'View/manage 50deeds order'.slice(0, 32), path: '/clio/manage-order' },
];
const target = (path) => `${config.appBaseUrl}${path}`;

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

// Ensure every app custom action exists on the Matter screen. Idempotent and
// self-healing: each action is identified by its target_url (stable across label
// changes), so a renamed label updates in place instead of creating a duplicate.
export async function ensureCustomAction(clioUserId) {
  const existing = await listCustomActions(clioUserId);
  const actions = [];
  for (const a of ACTIONS) {
    const url = target(a.path);
    const match =
      existing.find((e) => e.target_url === url && e.ui_reference === UI_REFERENCE) ||
      existing.find((e) => e.ui_reference === UI_REFERENCE && e.label === a.label);
    if (match) {
      if (match.label !== a.label || match.target_url !== url) {
        actions.push(await patchAction(clioUserId, match.id, a.label, url));
      } else {
        actions.push({ created: false, action: match });
      }
    } else {
      actions.push(await createAction(clioUserId, a.label, url));
    }
  }
  return { actions };
}

async function createAction(clioUserId, label, target_url) {
  const accessToken = await getValidAccessToken(clioUserId);
  const res = await fetch(`${config.clio.apiBase}/custom_actions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ data: { label, ui_reference: UI_REFERENCE, target_url } }),
  });
  if (!res.ok) throw new Error(`Create custom_action failed (${res.status}): ${await res.text()}`);
  const json = await res.json();
  return { created: true, action: json.data };
}

async function patchAction(clioUserId, id, label, target_url) {
  const accessToken = await getValidAccessToken(clioUserId);
  const res = await fetch(`${config.clio.apiBase}/custom_actions/${id}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ data: { label, target_url } }),
  });
  if (!res.ok) throw new Error(`Update custom_action failed (${res.status}): ${await res.text()}`);
  const json = await res.json();
  return { created: false, updated: true, action: json.data };
}
