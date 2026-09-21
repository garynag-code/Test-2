import { execSync } from 'node:child_process';

/**
 * Integration tests run against a real PostgreSQL with the real migrations
 * applied. Prisma is never mocked: a mock cannot fail a unique constraint, and
 * unique constraints are half of how this product stays correct (docs/08 §2).
 */
export default function setup(): void {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      'TEST_DATABASE_URL is not set. Integration tests need a real PostgreSQL database.',
    );
  }

  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
}
