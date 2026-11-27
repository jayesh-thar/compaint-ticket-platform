import { logger } from '../config/logger.js';
import { processOutboxOnce } from '../modules/notifications/poller.js';
import { runCleanup } from './cleanup.js';

/**
 * In-process background jobs (architecture 11). Started from server.ts only
 * when JOBS_ENABLED=true; never in tests. Each job is safe to run twice and
 * a run never overlaps the previous run of the same job.
 */

type Job = { name: string; everyMs: number; run: () => Promise<unknown> };

const timers: NodeJS.Timeout[] = [];
const running = new Set<string>();

const schedule = (job: Job) => {
  const tick = async () => {
    if (running.has(job.name)) return;
    running.add(job.name);
    try {
      await job.run();
    } catch (err) {
      logger.error({ err, job: job.name }, 'Background job failed');
    } finally {
      running.delete(job.name);
    }
  };
  timers.push(setInterval(tick, job.everyMs));
  void tick(); // run once at start-up too
};

export const jobs: Job[] = [
  { name: 'email-poller', everyMs: 15_000, run: () => processOutboxOnce() },
  { name: 'cleanup', everyMs: 24 * 60 * 60_000, run: () => runCleanup() },
];

export const startJobs = () => {
  jobs.forEach(schedule);
  logger.info({ jobs: jobs.map((j) => j.name) }, 'Background jobs started');
};

/** Stops new runs; waits briefly for a running one to finish. */
export const stopJobs = async () => {
  timers.splice(0).forEach(clearInterval);
  for (let i = 0; i < 50 && running.size > 0; i++) await new Promise((r) => setTimeout(r, 100));
};
