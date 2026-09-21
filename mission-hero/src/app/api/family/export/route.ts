import { NextResponse } from 'next/server';
import { requireParent } from '@/server/auth/guards';
import { isAppError } from '@/server/errors';
import { exportFamily } from '@/features/families/data';

export const dynamic = 'force-dynamic';

/**
 * Data export (brief §40). Family-scoped by the guard, so a parent can only
 * ever download their own family; password hashes are never included.
 */
export async function GET() {
  try {
    const actor = await requireParent();
    const data = await exportFamily(actor);

    return new NextResponse(JSON.stringify(data, null, 2), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="mission-hero-export-${new Date()
          .toISOString()
          .slice(0, 10)}.json"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    if (isAppError(error)) {
      return NextResponse.json({ error: error.publicMessage }, { status: error.status });
    }
    return NextResponse.json({ error: 'Could not build that export.' }, { status: 500 });
  }
}
