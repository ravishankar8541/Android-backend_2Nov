import crypto from 'node:crypto';
import { env } from '../../config/env.js';
import { HttpError } from '../../utils/http-error.js';

const MAX_GALLERY_SIZE = 4;

export function isValidEmbedding(embedding) {
  if (!Array.isArray(embedding) || embedding.length !== 192
    || !embedding.every((value) => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1.1)) return false;
  const norm = Math.hypot(...embedding);
  return norm >= 0.85 && norm <= 1.15;
}

function asGallery(embeddings) {
  const gallery = Array.isArray(embeddings?.[0]) ? embeddings : [embeddings];
  if (gallery.length > MAX_GALLERY_SIZE) throw new HttpError(422, `A face template holds at most ${MAX_GALLERY_SIZE} captures`, 'INVALID_FACE_EMBEDDING');
  if (!gallery.every(isValidEmbedding)) throw new HttpError(422, 'Face embedding is invalid', 'INVALID_FACE_EMBEDDING');
  return gallery;
}

function encryptionKey() {
  if (env.BIOMETRIC_ENCRYPTION_KEY) return Buffer.from(env.BIOMETRIC_ENCRYPTION_KEY, 'hex');
  // Keep local development usable without another secret. Set a dedicated key before production;
  // rotating JWT_ACCESS_SECRET also rotates this derived key and requires employee re-enrollment.
  return crypto.createHash('sha256').update('vam-face-template-v1:').update(env.JWT_ACCESS_SECRET).digest();
}

export function encryptFaceTemplate(embeddings) {
  const gallery = asGallery(embeddings);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(gallery), 'utf8'), cipher.final()]);
  return { ciphertext: ciphertext.toString('base64'), iv: iv.toString('base64'), authTag: cipher.getAuthTag().toString('base64'), keyVersion: 1 };
}

export function decryptFaceTemplate(template) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(template.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(template.authTag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(template.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
  const stored = JSON.parse(plaintext);
  return Array.isArray(stored[0]) ? stored : [stored];
}

export function embeddingDistance(left, right) {
  if (!isValidEmbedding(left) || !isValidEmbedding(right)) return Infinity;
  let sum = 0;
  for (let index = 0; index < 192; index += 1) sum += (left[index] - right[index]) ** 2;
  return Math.sqrt(sum);
}

/**
 * Enrollment captures several head positions, and averaging them pulls the template away from any
 * single straight-on frame. Matching the closest capture instead is what removes the repeated
 * "face does not match" rejections without changing the threshold.
 */
export function closestDistance(candidate, gallery) {
  let closest = Infinity;
  for (const enrolled of gallery) closest = Math.min(closest, embeddingDistance(candidate, enrolled));
  return closest;
}
