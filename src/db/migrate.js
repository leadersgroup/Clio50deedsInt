import { pool } from './index.js';

// Idempotent schema. Safe to run on every deploy.
const DDL = `
CREATE TABLE IF NOT EXISTS clio_tokens (
  clio_user_id      BIGINT PRIMARY KEY,
  access_token_enc  TEXT NOT NULL,
  refresh_token_enc TEXT,
  -- Space-separated scopes granted at authorization time (fixed for the grant).
  scope             TEXT NOT NULL DEFAULT '',
  expires_at        TIMESTAMPTZ NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Short-lived draft orders created from a custom-action click, pre-filled from Clio
-- and shown to the attorney before payment. JSON holds the mapped + auto-filled fields.
CREATE TABLE IF NOT EXISTS deed_order_drafts (
  id             TEXT PRIMARY KEY,
  clio_user_id   BIGINT,
  clio_matter_id BIGINT,
  display_number TEXT,
  data           JSONB NOT NULL,
  status         TEXT NOT NULL DEFAULT 'draft', -- draft | paid | submitted
  order_id       TEXT,                          -- id returned by 50deeds order system
  stripe_session TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_drafts_stripe_session ON deed_order_drafts (stripe_session);

-- Supporting documents uploaded on the order form (homeowner ID, prior deed,
-- certificate of trust). Stored here and served back to the 50deeds backend by a
-- capability URL passed as the Enterprise order attachment file_url.
CREATE TABLE IF NOT EXISTS order_files (
  id          TEXT PRIMARY KEY,
  draft_id    TEXT NOT NULL,
  file_name   TEXT NOT NULL,
  mime        TEXT,
  size_bytes  INTEGER NOT NULL,
  bytes       BYTEA NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_order_files_draft ON order_files (draft_id);
`;

export async function migrate() {
  await pool.query(DDL);
  console.log('[migrate] schema ready');
}

// Run directly: `npm run migrate`
if (import.meta.url === `file://${process.argv[1]}`) {
  migrate()
    .then(() => pool.end())
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[migrate] failed', err);
      process.exit(1);
    });
}
