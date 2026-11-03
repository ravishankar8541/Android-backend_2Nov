import multer from 'multer';
import { HttpError } from '../utils/http-error.js';

const ACCEPTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_BYTES = 5 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1 },
  fileFilter: (_req, file, done) => {
    if (!ACCEPTED_TYPES.has(file.mimetype)) {
      done(new HttpError(415, 'Use a JPG, PNG or WebP image', 'EMPLOYEE_PHOTO_TYPE'));
      return;
    }
    done(null, true);
  },
});

/**
 * Photos go to Cloudinary, not Mongo, so the file is held in memory only long enough to
 * hand off. Multer's own limit errors are re-thrown as HttpErrors to keep the envelope flat.
 */
export const employeePhotoUpload = (req, res, next) => upload.single('photo')(req, res, (error) => {
  if (error?.code === 'LIMIT_FILE_SIZE') {
    next(new HttpError(413, 'Photo must be 5 MB or smaller', 'EMPLOYEE_PHOTO_TOO_LARGE'));
    return;
  }
  next(error);
});
