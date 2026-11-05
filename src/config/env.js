import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  MONGODB_URI: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z.string().default('15m'),
  REFRESH_TOKEN_DAYS: z.coerce.number().int().positive().default(14),
  COOKIE_SECURE: z.string().default('false').transform((value) => value === 'true'),
  FRONTEND_ORIGINS: z.string().default('http://localhost:5173,https://android-frontend-2-nov.vercel.app'),
  DEFAULT_GEOFENCE_RADIUS_METERS: z.coerce.number().positive().default(25),
  MAX_LOCATION_ACCURACY_METERS: z.coerce.number().positive().default(100),
  OFFICE_TIME_ZONE: z.string().default('Asia/Kolkata'),
  DEFAULT_MONTHLY_LEAVES: z.coerce.number().min(0).max(31).default(2),
  SEED_ADMIN_EMAIL: z.string().email().optional(),
  SEED_ADMIN_PASSWORD: z.string().min(12).optional(),
  BIOMETRIC_PROVIDER: z.enum(['disabled', 'local']).default('local'),
  BIOMETRIC_ENCRYPTION_KEY: z.preprocess((value) => value === '' ? undefined : value, z.string().regex(/^[a-fA-F0-9]{64}$/).optional()),
  CLOUDINARY_URL: z.preprocess((value) => value === '' ? undefined : value, z.string().trim().min(1).optional()),
  BIOMETRIC_FACE_DISTANCE_THRESHOLD: z.coerce.number().positive().max(2).default(1.1),
  BIOMETRIC_LIVENESS_MAX_SCORE: z.coerce.number().min(0).max(1).default(0.2),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = Object.freeze({
  ...parsed.data,
  FRONTEND_ORIGINS: parsed.data.FRONTEND_ORIGINS.split(',').map((origin) => origin.trim()),
});
