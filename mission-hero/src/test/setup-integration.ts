import { afterAll, beforeEach } from 'vitest';

// Point the Prisma singleton at the test database before it is constructed.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
process.env.AUTH_SECRET ??= 'test-secret-test-secret-test-secret-test-secret';

const { prisma } = await import('@/server/db/prisma');

/**
 * Truncate rather than wrap each test in a rolled-back transaction: several of
 * the most valuable tests deliberately run concurrent transactions, which a
 * shared outer transaction would serialise and hide (docs/08 §2).
 */
beforeEach(async () => {
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'
  `;
  if (tables.length === 0) return;
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
});

afterAll(async () => {
  await prisma.$disconnect();
});
