import dotenv from 'dotenv';
dotenv.config();

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function optional(name, fallback = '') {
  return process.env[name] ?? fallback;
}

const isProd = process.env.NODE_ENV === 'production';

export const config = {
  isProd,
  port: parseInt(process.env.PORT || '3000', 10),
  appBaseUrl: required('APP_BASE_URL').replace(/\/$/, ''),

  cookieSecret: required('COOKIE_SECRET'),
  tokenEncryptionKey: required('TOKEN_ENCRYPTION_KEY'),

  clio: {
    clientId: required('CLIO_CLIENT_ID'),
    clientSecret: required('CLIO_CLIENT_SECRET'),
    redirectUri: required('CLIO_REDIRECT_URI'),
    apiBase: optional('CLIO_API_BASE', 'https://app.clio.com/api/v4').replace(/\/$/, ''),
    authBase: optional('CLIO_AUTH_BASE', 'https://app.clio.com').replace(/\/$/, ''),
    // Granted scopes are fixed at authorization time, so request everything up front.
    scopes: ['matters', 'contacts', 'custom_actions'],
  },

  db: {
    connectionString: required('DATABASE_URL'),
    ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false,
  },

  stripe: {
    secretKey: required('STRIPE_SECRET_KEY'),
    webhookSecret: optional('STRIPE_WEBHOOK_SECRET'),
  },

  // 50deeds Enterprise API (Base44 function) — same pipeline as fastwill.com orders.
  enterprise: {
    url: optional(
      'ENTERPRISE_API_URL',
      'https://50-deedscom-enterprise-db0653f4.base44.app/api/functions/enterpriseApi',
    ),
    apiKey: optional('ENTERPRISE_API_KEY'),
    // No API key configured -> run in MOCK mode (local dev / tests).
    get mock() {
      return !this.apiKey;
    },
  },

  countyLookup: {
    url: optional('COUNTY_LOOKUP_URL'),
    apiKey: optional('COUNTY_LOOKUP_API_KEY'),
    get mock() {
      return !this.url;
    },
  },
};
