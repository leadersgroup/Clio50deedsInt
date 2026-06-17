import crypto from 'node:crypto';
import { query } from './index.js';

export function newFileId() {
  return crypto.randomBytes(16).toString('hex');
}

// Store an uploaded supporting document. `bytes` is a Buffer.
export async function saveFile({ draftId, fileName, mime, bytes }) {
  const id = newFileId();
  await query(
    `INSERT INTO order_files (id, draft_id, file_name, mime, size_bytes, bytes)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, draftId, fileName, mime || 'application/octet-stream', bytes.length, bytes],
  );
  return { id, fileName, sizeBytes: bytes.length };
}

export async function getFile(id) {
  const { rows } = await query(`SELECT * FROM order_files WHERE id = $1`, [id]);
  return rows[0] || null;
}
