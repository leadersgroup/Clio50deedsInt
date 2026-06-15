import { config } from '../config.js';
import { saveToken, getToken } from '../db/tokens.js';

// ── Authorization-code flow ──────────────────────────────────────────────────

// Build the Clio consent URL. `state` is an opaque, signed value we verify on callback.
export function buildAuthorizeUrl(state) {
  const u = new URL(`${config.clio.authBase}/oauth/authorize`);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', config.clio.clientId);
  u.searchParams.set('redirect_uri', config.clio.redirectUri);
  u.searchParams.set('scope', config.clio.scopes.join(' '));
  u.searchParams.set('state', state);
  // Ensure we always receive a refresh_token.
  u.searchParams.set('redirect_on_decline', 'true');
  return u.toString();
}

// Exchange an authorization code for tokens, then persist them for the granting user.
export async function exchangeCodeForToken(code) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: config.clio.clientId,
    client_secret: config.clio.clientSecret,
    redirect_uri: config.clio.redirectUri,
  });

  const res = await fetch(`${config.clio.authBase}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
  });
  if (!res.ok) {
    throw new Error(`Clio token exchange failed (${res.status}): ${await safeText(res)}`);
  }
  const tok = await res.json();

  // We need the granting user's Clio id to key the token. /users/who_am_i returns it.
  const clioUserId = await fetchWhoAmI(tok.access_token);

  await persist(clioUserId, tok);
  return { clioUserId };
}

// ── Token refresh ────────────────────────────────────────────────────────────

// Return a valid (non-expired) access token for a user, refreshing if needed.
// Throws a tagged error if the user has no token (needs (re)authorization).
export async function getValidAccessToken(clioUserId) {
  const stored = await getToken(clioUserId);
  if (!stored) {
    const err = new Error(`No Clio token for user ${clioUserId}`);
    err.code = 'NO_TOKEN';
    throw err;
  }

  // 60s safety margin.
  if (stored.expiresAt.getTime() - Date.now() > 60_000) {
    return stored.accessToken;
  }

  if (!stored.refreshToken) {
    const err = new Error(`Access token expired and no refresh token for user ${clioUserId}`);
    err.code = 'NO_TOKEN';
    throw err;
  }

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: stored.refreshToken,
    client_id: config.clio.clientId,
    client_secret: config.clio.clientSecret,
  });
  const res = await fetch(`${config.clio.authBase}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
  });
  if (!res.ok) {
    // Refresh token revoked/expired -> user must re-authorize.
    const err = new Error(`Clio token refresh failed (${res.status}): ${await safeText(res)}`);
    err.code = 'NO_TOKEN';
    throw err;
  }
  const tok = await res.json();
  await persist(clioUserId, tok, stored.refreshToken);
  return tok.access_token;
}

// ── helpers ──────────────────────────────────────────────────────────────────

async function persist(clioUserId, tok, fallbackRefresh = null) {
  const expiresAt = new Date(Date.now() + (Number(tok.expires_in) || 3600) * 1000);
  await saveToken({
    clioUserId,
    accessToken: tok.access_token,
    refreshToken: tok.refresh_token || fallbackRefresh,
    scope: tok.scope || config.clio.scopes.join(' '),
    expiresAt,
  });
}

async function fetchWhoAmI(accessToken) {
  const res = await fetch(`${config.clio.apiBase}/users/who_am_i?fields=id`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Clio who_am_i failed (${res.status}): ${await safeText(res)}`);
  const json = await res.json();
  const id = json?.data?.id;
  if (!id) throw new Error('Clio who_am_i returned no user id');
  return Number(id);
}

async function safeText(res) {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return '<no body>';
  }
}
