import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';

const make = (limit, message) =>
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => env.NODE_ENV === 'test',
    handler: (req, res, next) => next(new AppError(429, message, 'RATE_LIMITED')),
  });

export const apiLimiter = make(1500, 'Too many requests. Please slow down.');
export const loginLimiter = make(20, 'Too many sign-in attempts. Try again in a few minutes.');
export const sensitiveLimiter = make(30, 'Too many attempts. Try again in a few minutes.');
