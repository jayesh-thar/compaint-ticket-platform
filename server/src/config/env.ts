import dotenv from 'dotenv';
import { z } from 'zod';

// Load .env file
dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(5000),
  APP_ORIGIN: z.string().url().default('http://localhost:5173'),
  TRUST_PROXY: z.coerce.number().default(0),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  TEST_DATABASE_URL: z.string().optional(),
  EMAIL_TRANSPORT: z.enum(['console', 'resend']).default('console'),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default('Complaint Portal <no-reply@example.com>'),
  // Off (default) = new accounts are verified on sign-up and no verify email is sent.
  // Turn on once a real email domain + Resend are set up.
  EMAIL_VERIFICATION_REQUIRED: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .default('false'),
  JOBS_ENABLED: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .default('true'),
  LOG_LEVEL: z.enum(['silent', 'fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

// Production must send real email: the console transport would print one-time
// tokens (verify, reset, invite) into the server logs.
const envWithRules = envSchema.superRefine((e, ctx) => {
  if (e.NODE_ENV === 'production' && (e.EMAIL_TRANSPORT !== 'resend' || !e.RESEND_API_KEY)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['EMAIL_TRANSPORT'],
      message: 'In production set EMAIL_TRANSPORT=resend and RESEND_API_KEY.',
    });
  }
});

const parseEnv = () => {
  const result = envWithRules.safeParse(process.env);
  if (!result.success) {
    const formatted = result.error.format();
    console.error('Invalid environment variables:', JSON.stringify(formatted, null, 2));
    throw new Error('Invalid environment variables. Check your .env file.');
  }
  return result.data;
};

export const env = parseEnv();
