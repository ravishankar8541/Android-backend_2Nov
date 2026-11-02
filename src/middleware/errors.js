import { HttpError } from '../utils/http-error.js';
import { logger } from '../utils/logger.js';

export function notFound(_req, _res, next) {
  next(new HttpError(404, 'The requested resource was not found', 'NOT_FOUND'));
}

export function errorHandler(error, req, res, _next) {
  if (error?.code === 11000) error = new HttpError(409, 'A record with this value already exists', 'DUPLICATE_RECORD');
  if (error?.name === 'CastError') error = new HttpError(400, 'Invalid record identifier', 'INVALID_ID');
  const status = error.status || 500;
  if (status >= 500) logger.error({ err: error, path: req.path, method: req.method }, 'Request failed');
  res.status(status).json({
    success: false,
    message: status >= 500 ? 'Something went wrong. Please try again.' : error.message,
    code: error.code || 'INTERNAL_ERROR',
    ...(error.details ? { details: error.details } : {}),
  });
}
