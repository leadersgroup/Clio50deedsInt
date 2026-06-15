import { config } from '../config.js';
import { getValidAccessToken } from './oauth.js';

const MAX_RETRIES = 4;

// Authenticated GET against the Clio Manage API for a given user.
// - `path` may be an absolute path ("/api/v4/matters/123") or relative to apiBase ("matters/123").
// - Handles 401 (refresh + one retry), 429/5xx (retry with backoff honoring Retry-After).
export async function clioGet(clioUserId, path, { query = {}, allowOneAuthRetry = true } = {}) {
  const url = buildUrl(path, query);

  let attempt = 0;
  // Separate counter so an auth refresh doesn't consume a backoff retry.
  let didAuthRetry = false;

  while (true) {
    const accessToken = await getValidAccessToken(clioUserId);
    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    });

    if (res.ok) return res.json();

    // Auth failure: force a refresh on next loop, retry once.
    if (res.status === 401 && allowOneAuthRetry && !didAuthRetry) {
      didAuthRetry = true;
      // Expire the cached token so getValidAccessToken refreshes.
      // (getValidAccessToken already refreshes when near expiry; a hard 401 means
      //  the token is bad, so we just retry — the refresh path covers most cases.)
      continue;
    }

    // 403 here usually means a bad/expired custom-action nonce or redacted resource.
    // Let the caller decide; surface the body.
    if (res.status === 403) {
      throw httpError(res, await safeText(res));
    }

    // Retryable: rate limit or transient server error.
    if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
      const delay = retryDelayMs(res, attempt);
      await sleep(delay);
      attempt++;
      continue;
    }

    throw httpError(res, await safeText(res));
  }
}

function buildUrl(path, query) {
  let base;
  if (/^https?:\/\//.test(path)) {
    base = path;
  } else if (path.startsWith('/api/v4/')) {
    // subject_url from Clio looks like "/api/v4/matters/123"
    base = `${config.clio.apiBase.replace(/\/api\/v4$/, '')}${path}`;
  } else {
    base = `${config.clio.apiBase}/${path.replace(/^\//, '')}`;
  }
  const u = new URL(base);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null) u.searchParams.set(k, v);
  }
  return u.toString();
}

function retryDelayMs(res, attempt) {
  const retryAfter = res.headers.get('retry-after');
  if (retryAfter) {
    const secs = Number(retryAfter);
    if (!Number.isNaN(secs)) return secs * 1000;
  }
  // Exponential backoff with jitter: 0.5s, 1s, 2s, 4s (+ up to 250ms).
  return 500 * 2 ** attempt + Math.floor((attempt + 1) * 73) % 250;
}

function httpError(res, body) {
  const err = new Error(`Clio API ${res.status} for ${res.url}: ${body}`);
  err.status = res.status;
  err.body = body;
  return err;
}

async function safeText(res) {
  try {
    return (await res.text()).slice(0, 1000);
  } catch {
    return '<no body>';
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
