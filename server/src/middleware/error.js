import { ZodError } from 'zod';
import mongoose from 'mongoose';
import { AppError } from '../utils/AppError.js';
import { env } from '../config/env.js';

export function notFound(req, res, next) {
  next(new AppError(404, 'Resource not found.', 'NOT_FOUND'));
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'Something went wrong on the server.';
  let details;

  if (err instanceof AppError) {
    ({ status, code, message, details } = err);
  } else if (err instanceof ZodError) {
    status = 400;
    code = 'VALIDATION_ERROR';
    message = 'Please correct the highlighted fields.';
    details = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
  } else if (err instanceof mongoose.Error.ValidationError) {
    status = 400;
    code = 'VALIDATION_ERROR';
    message = 'Validation failed.';
    details = Object.values(err.errors).map((e) => ({ path: e.path, message: e.message }));
  } else if (err instanceof mongoose.Error.CastError) {
    status = 400;
    code = 'INVALID_ID';
    message = 'Invalid identifier.';
  } else if (err?.code === 11000) {
    status = 409;
    code = 'DUPLICATE';
    message = 'A record with the same unique value already exists.';
  } else if (err?.name === 'MulterError') {
    const tooBig = err.code === 'LIMIT_FILE_SIZE';
    status = tooBig ? 413 : 400;
    code = tooBig ? 'FILE_TOO_LARGE' : 'UPLOAD_ERROR';
    message = tooBig ? 'The uploaded file is larger than the allowed size.' : `Upload rejected: ${err.message}`;
  } else if (err?.type === 'entity.parse.failed') {
    status = 400;
    code = 'BAD_JSON';
    message = 'Request body is not valid JSON.';
  } else if (err?.type === 'entity.too.large') {
    status = 413;
    code = 'PAYLOAD_TOO_LARGE';
    message = 'Request body is too large.';
  }

  if (status >= 500) {
    // Full detail goes to the server log only — never to the client.
    console.error(`[error] ${req.method} ${req.originalUrl}`, env.NODE_ENV === 'test' ? err.message : err);
  }
  res.status(status).json({ error: { code, message, ...(details ? { details } : {}) } });
}
