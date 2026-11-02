import crypto from 'node:crypto';
import { env } from '../../config/env.js';
import { HttpError } from '../../utils/http-error.js';

export function isValidEmbedding(embedding) {
  if (!Array.isArray(embedding) || embedding.length !== 192
    || !embedding.every((value) => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1.1)) return false;
  const norm = Math.hypot(...embedding);
  return norm >= 0.85 && norm <= 1.15;
}

function encryptionKey() {
  if (env.BIOMETRIC_ENCRYPTION_KEY) return Buffer.from(env.BIOMETRIC_ENCRYPTION_KEY, 'hex');
  // Keep local development usable without another secret. Set a dedicated key before production;
  // rotating JWT_ACCESS_SECRET also rotates this derived key and requires employee re-enrollment.
  return crypto.createHash('sha256').update('vam-face-template-v1:').update(env.JWT_ACCESS_SECRET).digest();
}

export function encryptFaceTemplate(embedding) {
  if (!isValidEmbedding(embedding)) throw new HttpError(422, 'Face embedding is invalid', 'INVALID_FACE_EMBEDDING');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(embedding), 'utf8'), cipher.final()]);
  return { ciphertext: ciphertext.toString('base64'), iv: iv.toString('base64'), authTag: cipher.getAuthTag().toString('base64'), keyVersion: 1 };
}

export function decryptFaceTemplate(template) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(template.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(template.authTag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(template.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
  return JSON.parse(plaintext);
}

export function embeddingDistance(left, right) {
  if (!isValidEmbedding(left) || !isValidEmbedding(right)) return Infinity;
  let sum = 0;
  for (let index = 0; index < 192; index += 1) sum += (left[index] - right[index]) ** 2;
  return Math.sqrt(sum);
}
