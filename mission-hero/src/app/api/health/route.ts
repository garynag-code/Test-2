import { NextResponse } from 'next/server';
import { prisma } from '@/server/db/prisma';

export const dynamic = 'force-dynamic';

/** Liveness plus a real database round trip, for deployment checks. */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: 'ok', database: 'ok' });
  } catch {
    return NextResponse.json({ status: 'degraded', database: 'unreachable' }, { status: 503 });
  }
}
