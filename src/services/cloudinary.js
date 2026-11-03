import cloudinaryPackage from 'cloudinary';
import { env } from '../config/env.js';
import { HttpError } from '../utils/http-error.js';

const { v2: cloudinary } = cloudinaryPackage;

export const EMPLOYEE_PHOTO_FOLDER = 'vam/employees';
export const ATTENDANCE_SELFIE_FOLDER = 'vam/attendance';
const AVATAR_SIZE = 512;
const SELFIE_WIDTH = 900;

function client() {
  if (!env.CLOUDINARY_URL) {
    throw new HttpError(503, 'Photo storage is not configured for this workspace yet', 'EMPLOYEE_PHOTO_UNAVAILABLE');
  }
  cloudinary.config({ url: env.CLOUDINARY_URL, secure: true });
  return cloudinary;
}

/**
 * Stores the bytes as a square, face-cropped avatar so every client renders the same
 * aspect ratio, and returns the public id so a replaced photo can be cleaned up later.
 */
export function uploadEmployeePhoto(buffer) {
  return new Promise((resolve, reject) => {
    const stream = client().uploader.upload_stream({
      folder: EMPLOYEE_PHOTO_FOLDER,
      resource_type: 'image',
      format: 'jpg',
      transformation: [{ width: AVATAR_SIZE, height: AVATAR_SIZE, crop: 'fill', gravity: 'face' }, { quality: 'auto:good' }],
    }, (error, result) => {
      if (error) reject(new HttpError(502, 'The photo could not be stored. Try again.', 'EMPLOYEE_PHOTO_UPLOAD_FAILED'));
      else resolve({ url: result.secure_url, publicId: result.public_id });
    });
    stream.on('error', () => reject(new HttpError(502, 'The photo could not be stored. Try again.', 'EMPLOYEE_PHOTO_UPLOAD_FAILED')));
    stream.end(buffer);
  });
}

/** Attendance evidence is stored as framed by the employee, so only the width is capped. */
export function uploadAttendanceSelfie(buffer) {
  return new Promise((resolve, reject) => {
    const stream = client().uploader.upload_stream({
      folder: ATTENDANCE_SELFIE_FOLDER,
      resource_type: 'image',
      format: 'jpg',
      transformation: [{ width: SELFIE_WIDTH, crop: 'limit' }, { quality: 'auto:good' }],
    }, (error, result) => {
      if (error) reject(new HttpError(502, 'The photo could not be stored. Try again.', 'ATTENDANCE_SELFIE_UPLOAD_FAILED'));
      else resolve({ url: result.secure_url, publicId: result.public_id });
    });
    stream.on('error', () => reject(new HttpError(502, 'The photo could not be stored. Try again.', 'ATTENDANCE_SELFIE_UPLOAD_FAILED')));
    stream.end(buffer);
  });
}

/** Best effort: the record no longer points at this asset, so a failed delete only leaks storage. */
export async function deleteEmployeePhoto(publicId) {
  if (!env.CLOUDINARY_URL || !publicId) return;
  try {
    await client().uploader.destroy(publicId);
  } catch {
    // The photo is already unreferenced, so there is nothing left to repair.
  }
}
