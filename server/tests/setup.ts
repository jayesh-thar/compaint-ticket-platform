import dotenv from 'dotenv';

// Load environment variables for testing
dotenv.config();

if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}

// Tests never run background jobs, and request logs only add noise.
process.env.JOBS_ENABLED = 'false';
process.env.LOG_LEVEL = process.env.TEST_LOG_LEVEL ?? 'silent';
