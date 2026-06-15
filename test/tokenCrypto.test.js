import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

// Provide a deterministic key + required envs before importing config-bound modules.
process.env.TOKEN_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
process.env.COOKIE_SECRET = 'test-cookie-secret';
process.env.APP_BASE_URL = 'https://example.test';
process.env.CLIO_CLIENT_ID = 'x';
process.env.CLIO_CLIENT_SECRET = 'x';
process.env.CLIO_REDIRECT_URI = 'https://example.test/clio/callback';
process.env.DATABASE_URL = 'postgres://u:p@localhost:5432/db';
process.env.STRIPE_SECRET_KEY = 'sk_test_x';

const { encrypt, decrypt } = await import('../src/crypto/tokenCrypto.js');

test('encrypt/decrypt round-trips', () => {
  const secret = 'refresh-token-abc-123';
  const enc = encrypt(secret);
  assert.notEqual(enc, secret);
  assert.equal(decrypt(enc), secret);
});

test('ciphertext differs each call (random IV)', () => {
  assert.notEqual(encrypt('same'), encrypt('same'));
});

test('tampered ciphertext fails authentication', () => {
  const enc = encrypt('value');
  const parts = enc.split('.');
  parts[2] = Buffer.from('tampered').toString('base64');
  assert.throws(() => decrypt(parts.join('.')));
});
