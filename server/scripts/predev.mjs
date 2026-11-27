// Runs automatically before `npm run dev` (npm "predev" hook).
// 1. Checks that .env and DATABASE_URL exist.
// 2. Applies any pending Prisma migrations (safe: never resets or deletes data).
// 3. Regenerates the Prisma client so it matches schema.prisma.
// If PostgreSQL is not reachable it stops with a clear message instead of
// letting the server start and fail on every request.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import 'dotenv/config';

const ok = (msg) => console.log(`\x1b[32m✔\x1b[0m ${msg}`);
const warn = (msg) => console.log(`\x1b[33m!\x1b[0m ${msg}`);
const fail = (msg) => {
  console.error(`\x1b[31m✖ ${msg}\x1b[0m`);
  process.exit(1);
};

const run = (args) => {
  const r = spawnSync(`npx prisma ${args.join(' ')}`, { encoding: 'utf8', shell: true });
  return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
};

if (!existsSync('.env')) fail('server/.env is missing. Copy .env.example to .env and fill it in.');
if (!process.env.DATABASE_URL) fail('DATABASE_URL is not set in server/.env.');

console.log('Checking database and migrations...');
const migrate = run(['migrate', 'deploy']);
if (migrate.code !== 0) {
  const out = migrate.out;
  if (/P1001|Can't reach database/i.test(out)) {
    fail('Cannot reach PostgreSQL. Start the PostgreSQL service (Windows: services.msc → postgresql) and check host/port in DATABASE_URL.');
  }
  if (/P1000|Authentication failed/i.test(out)) {
    fail('PostgreSQL rejected the username/password in DATABASE_URL.');
  }
  console.error(out);
  fail('prisma migrate deploy failed (see output above).');
}
const applied = /have been applied/i.test(migrate.out);
ok(applied ? 'Pending migrations applied.' : 'Database schema is up to date.');

const gen = run(['generate']);
if (gen.code === 0) ok('Prisma client generated.');
// On Windows this fails with EPERM if another server instance is holding the engine file.
else warn('prisma generate skipped (is another server already running?). Using the existing client.');
