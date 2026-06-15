import crypto from 'node:crypto';
import { config } from '../config.js';

// AES-256-GCM at-rest encryption for OAuth tokens.
// Stored format: base64(iv).base64(authTag).base64(ciphertext)

const ALGO = 'aes-256-gcm';

function getKey() {
  const key = Buffer.from(config.tokenEncryptionKey, 'base64');
  if (key.length !== 32) {
    throw new Error(
      'TOKEN_ENCRYPTION_KEY must be 32 bytes, base64-encoded. ' +
        'Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
    );
  }
  return key;
}

export function encrypt(plaintext) {
  if (plaintext == null) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${tag.toString('base64')}.${ct.toString('base64')}`;
}

export function decrypt(payload) {
  if (payload == null) return null;
  const [ivB64, tagB64, ctB64] = String(payload).split('.');
  if (!ivB64 || !tagB64 || !ctB64) throw new Error('Malformed encrypted token payload');
  const decipher = crypto.createDecipheriv(ALGO, getKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
}
