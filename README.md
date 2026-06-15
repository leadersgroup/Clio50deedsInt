# 50deeds × Clio Manage integration

One-click **"Order a deed with 50deeds"** custom action on a Clio Manage estate matter.
The attorney clicks it on the matter screen and lands on a 50deeds deed-order form
**already pre-filled** with the client and property data from that matter — no re-keying.
Confirming the property address auto-fills the deed-critical legal data (APN, legal
description, prior deed) that Clio never holds, via the existing 50deeds county lookup.

## How it works

```
Attorney clicks action on Matter ─▶ Clio GET /clio/custom-action?subject_url=…&custom_action_nonce=…
   │
   ├─ look up OAuth token for user_id (encrypted in Postgres)
   ├─ authenticated GET subject_url + nonce  ──▶  Clio validates nonce (single-use, 60s)
   ├─ pull matter + related contacts, map ─▶ deed-order draft (with field provenance)
   └─ redirect browser ─▶ /order/:draftId   (pre-filled form)
                              │
   confirm property address ──┼──▶ POST /order/:id/county-lookup  ─▶ APN, legal desc, prior deed
                              │
   submit ────────────────────┴──▶ create 50deeds order ─▶ Stripe Checkout
                                        │
   payment success ─▶ Stripe webhook ─▶ tag order paid + write Clio matter # / id
```

## Stack

- Node.js + Express (ES modules), deploys to **Railway** (`railway.json`, `/healthz`).
- **Postgres** for encrypted OAuth tokens (AES-256-GCM) and short-lived order drafts.
- **Stripe** Checkout for payment (existing 50deeds account).
- **Clio Manage API v4** (US server `https://app.clio.com/api/v4`).
- Adapters to the existing 50deeds **order system** (Base44) and **county lookup** —
  both run in MOCK mode locally when their URLs are unset.

## Project layout

| Path | Purpose |
|---|---|
| `src/server.js` | Express app, HTTPS enforcement, route wiring, health check |
| `src/config.js` | Env config (fails fast on missing required vars) |
| `src/crypto/tokenCrypto.js` | AES-256-GCM encrypt/decrypt for tokens |
| `src/db/` | Postgres pool, `migrate.js`, encrypted `tokens.js`, `drafts.js` |
| `src/clio/oauth.js` | Authorization-code flow + token refresh |
| `src/clio/client.js` | Authenticated GET with rate-limit/backoff retry |
| `src/clio/customActions.js` | Register/ensure the custom action |
| `src/clio/matters.js` | Fetch matter (with nonce) + contact detail; redaction-aware |
| `src/services/fieldMapper.js` | Clio matter → deed-order shape, with per-field provenance |
| `src/services/countyLookup.js` | 50deeds county property-record lookup adapter |
| `src/services/orderSystem.js` | 50deeds order create + paid-tagging adapter |
| `src/services/priceTable.js` | Flat-rate price per state ($299 / $649 NY) |
| `src/routes/customAction.js` | Custom-action receiver + nonce validation |
| `src/routes/order.js` | Form render, county lookup, submit, success |
| `src/routes/stripe.js` | Checkout webhook + paid finalization |
| `src/views/orderForm.ejs` | Pre-fill form (from-Clio / confirm / auto-filled tags) |
| `src/scripts/registerCustomAction.js` | Manual custom-action registration |

## OAuth scopes requested

Granted scopes are **fixed at authorization time**, so all are requested up front:

- **matters** — read the matter (client, relationships, custom fields)
- **contacts** — read related contact detail (matter client/relationships need *both* matters + contacts)
- **custom_actions** — register and receive the custom action

## Setup

### 1. Register the OAuth app (Clio Developer Portal)
- App type: Clio **Manage** (not Grow/Platform).
- Redirect URI: `https://<your-app>/clio/callback` (must match `CLIO_REDIRECT_URI`).
- Scopes: `matters`, `contacts`, `custom_actions`.
- Copy the **Client ID** and **Client Secret**.

### 2. Configure env
Copy `.env.example` → `.env` and fill it in. Generate the secrets:
```bash
node -e "console.log('TOKEN_ENCRYPTION_KEY=' + require('crypto').randomBytes(32).toString('base64'))"
node -e "console.log('COOKIE_SECRET=' + require('crypto').randomBytes(32).toString('hex'))"
```
Leave `ORDER_SYSTEM_URL` / `COUNTY_LOOKUP_URL` blank to run those in MOCK mode for local dev.

### 3. Install + migrate + run
```bash
npm install
npm run migrate     # create tables (idempotent; also runs on boot)
npm start           # or: npm run dev
```

### 4. Deploy to Railway
- Create a Railway project, add a **Postgres** plugin (sets `DATABASE_URL`).
- Add the env vars from `.env`. Set `APP_BASE_URL` and `CLIO_REDIRECT_URI` to your Railway domain.
- Deploy. `railway.json` runs `npm start` and health-checks `/healthz`.
- Add a Stripe webhook endpoint → `https://<your-app>/stripe/webhook`
  (events: `checkout.session.completed`), put the signing secret in `STRIPE_WEBHOOK_SECRET`.

### 5. Install for a firm
Send an attorney/admin to **`https://<your-app>/clio/install`**. They authorize in Clio;
on success we store their tokens and register the custom action automatically.
(Re-register manually any time: `npm run register-action -- <clio_user_id>`,
or `GET /clio/register-action?user_id=<id>`.)

The custom action URL Clio is configured with: **`https://<your-app>/clio/custom-action`**
(label `Order a deed with 50deeds`, `ui_reference` `matters/show`).

## Testing against a Clio dev/sandbox account

1. Create a Clio Manage **developer/sandbox** account and a sample **estate matter**
   with a client (person/company), a `primary_address`, and a related contact
   (e.g. a trust as "Trustee"). Optionally add a "Property Address" custom field.
2. Install the app via `/clio/install` from that account.
3. Open the matter → click **Order a deed with 50deeds**.
4. The order form opens with **grantor name + address pre-filled** from the matter client.
5. Confirm the property address → **APN + legal description + prior deed auto-populate**
   (mock data if `COUNTY_LOOKUP_URL` is unset).
6. Pick a deed type + state, continue to Stripe, pay with a **test card** `4242 4242 4242 4242`.
7. An order record is created in the 50deeds backend tagged with the Clio matter number
   (mock id printed if `ORDER_SYSTEM_URL` is unset).

Run unit tests (no DB/network needed):
```bash
npm test
```

## Security notes

- The inbound custom-action GET is treated as **untrusted**. Data is only accepted after
  an authenticated re-fetch of `subject_url` with the single-use 60s `custom_action_nonce`
  (Clio returns 403 if it's wrong/expired). The nonce is validated immediately, never queued.
- OAuth tokens are **encrypted at rest** (AES-256-GCM). Tokens and nonces are never logged.
- Per-contact **redaction** (403 / `redacted: true`) is surfaced in the UI, not submitted blank.
- HTTPS enforced in production (redirect + HSTS). Clio calls retry with backoff on 429/5xx.
- Token refresh is automatic; expired/revoked refresh tokens redirect the user to re-authorize.

## Out of scope (v1)

Clio Grow/Platform, two-way order-status sync (beyond a single confirmation), bulk/multi-matter
ordering, non-US Clio servers. A v1.1 hook to post a confirmation Activity/Document back to the
Clio matter can be added in `finalizePaidOrder` (`src/routes/stripe.js`).
