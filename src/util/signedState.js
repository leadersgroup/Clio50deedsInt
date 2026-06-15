import crypto from 'node:crypto';
import { config } from '../config.js';

// Stateless, tamper-evident OAuth `state` value: random nonce + HMAC.
// Avoids needing server-side session storage for the short-lived auth handshake.

export function createState(payload = {}) {
  const nonce = crypto.randomBytes(16).toString('hex');
  const body = Buffer.from(JSON.stringify({ nonce, ...payload, t: undefined })).toString('base64url');
  const sig = sign(body);
  return `${body}.${sig}`;
}

export function verifyState(state) {
  if (!state || typeof state !== 'string') return null;
  const [body, sig] = state.split('.');
  if (!body || !sig) return null;
  const expected = sign(body);
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function sign(body) {
  return crypto.createHmac('sha256', config.cookieSecret).update(body).digest('base64url');
}
