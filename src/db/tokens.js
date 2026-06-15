import { query } from './index.js';
import { encrypt, decrypt } from '../crypto/tokenCrypto.js';

// Persist (upsert) a token set for a Clio user. Tokens are encrypted at rest.
export async function saveToken({ clioUserId, accessToken, refreshToken, scope, expiresAt }) {
  await query(
    `INSERT INTO clio_tokens (clio_user_id, access_token_enc, refresh_token_enc, scope, expires_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (clio_user_id) DO UPDATE
       SET access_token_enc  = EXCLUDED.access_token_enc,
           -- Clio may omit a new refresh_token on refresh; keep the old one if so.
           refresh_token_enc = COALESCE(EXCLUDED.refresh_token_enc, clio_tokens.refresh_token_enc),
           scope             = EXCLUDED.scope,
           expires_at        = EXCLUDED.expires_at,
           updated_at        = now()`,
    [
      clioUserId,
      encrypt(accessToken),
      refreshToken ? encrypt(refreshToken) : null,
      scope || '',
      expiresAt,
    ],
  );
}

export async function getToken(clioUserId) {
  const { rows } = await query(
    `SELECT clio_user_id, access_token_enc, refresh_token_enc, scope, expires_at
       FROM clio_tokens WHERE clio_user_id = $1`,
    [clioUserId],
  );
  if (!rows[0]) return null;
  const r = rows[0];
  return {
    clioUserId: Number(r.clio_user_id),
    accessToken: decrypt(r.access_token_enc),
    refreshToken: r.refresh_token_enc ? decrypt(r.refresh_token_enc) : null,
    scope: r.scope,
    expiresAt: new Date(r.expires_at),
  };
}

export async function deleteToken(clioUserId) {
  await query(`DELETE FROM clio_tokens WHERE clio_user_id = $1`, [clioUserId]);
}
