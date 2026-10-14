import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../.env') });

const bool = z.enum(['true', 'false']).default('false');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(5000),
  HOST: z.string().default('127.0.0.1'),
  MONGODB_URI: z.string().default('mongodb://127.0.0.1:27017/bugsbon_hrms'),
  MONGODB_URI_TEST: z.string().optional(),
  USE_TRANSACTIONS: z.enum(['auto', 'true', 'false']).default('auto'),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  SESSION_TTL_HOURS: z.coerce.number().positive().default(8),
  COOKIE_SECURE: bool,
  COMPANY_TIMEZONE: z.string().default('Asia/Kolkata'),
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),
  MAX_FAILED_LOGINS: z.coerce.number().int().positive().default(5),
  LOCKOUT_MINUTES: z.coerce.number().positive().default(15),
  SESSION_AUTO_REMOVE: z.enum(['native', 'interval', 'disabled']).default('native'),
  UPLOAD_DIR: z.string().default('storage'),
  MAX_APK_MB: z.coerce.number().positive().max(2000).default(300),
  MAX_IMAGE_MB: z.coerce.number().positive().max(50).default(5),
  SERVE_CLIENT: bool,
  SMTP_ENABLED: bool,
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('\nInvalid environment configuration (check server/.env):');
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  }
  console.error('');
  process.exit(1);
}

export const env = Object.freeze(parsed.data);
