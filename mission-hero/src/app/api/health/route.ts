import { NextResponse } from 'next/server';
import { prisma } from '@/server/db/prisma';
import { appVersion } from '@/domain/version';

export const dynamic = 'force-dynamic';

/**
 * Liveness, a real database round trip, and what is running.
 *
 * The version is here as well as in the app because this needs no sign-in:
 * after a push you can open /api/health on a phone and see whether the new
 * commit is live yet, which is otherwise guesswork.
 */
export async function GET() {
  const version = appVersion();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: 'ok', database: 'ok', ...version });
  } catch {
    return NextResponse.json(
      { status: 'degraded', database: 'unreachable', ...version },
      { status: 503 },
    );
  }
}
