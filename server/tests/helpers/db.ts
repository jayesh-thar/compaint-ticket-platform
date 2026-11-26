import { prisma } from '../../src/config/prisma.js';

/**
 * Empties every application table (all tables except Prisma's migration history),
 * so new tables are covered automatically and no test sees another test's rows.
 */
export const cleanDatabase = async () => {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length === 0) return;
  const list = tables.map((t) => `"${t.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE;`);
};
