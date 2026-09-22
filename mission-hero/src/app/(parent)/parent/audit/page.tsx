import Link from 'next/link';
import { requireParent } from '@/server/auth/guards';
import { prisma } from '@/server/db/prisma';
import { Card, CardTitle, EmptyState } from '@/components/ui/card';
import { relativeTime } from '@/lib/utils';
import * as audit from '@/features/audit/service';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'History' };

/**
 * The audit log, read-only (brief §36). Append-only in the repository, so there
 * is no edit or delete path to expose here even if someone wanted one.
 */
export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const actor = await requireParent();
  const { page } = await searchParams;
  const pageNumber = Math.max(1, Number(page ?? 1) || 1);
  const pageSize = 50;

  const [entries, total] = await Promise.all([
    audit.listForFamily(prisma, actor.familyId, {
      take: pageSize,
      skip: (pageNumber - 1) * pageSize,
    }),
    prisma.auditLog.count({ where: { familyId: actor.familyId } }),
  ]);

  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-black text-ink">History</h1>
        <p className="text-sm text-muted">
          Everything that has happened in this family, with who did it and when. This record cannot
          be edited or deleted.
        </p>
      </div>

      {entries.length === 0 ? (
        <EmptyState icon="📋" title="Nothing recorded yet" />
      ) : (
        <>
          <CardTitle>
            {total} {total === 1 ? 'entry' : 'entries'}
          </CardTitle>
          <ul className="space-y-2">
            {entries.map((entry) => (
              <li key={entry.id}>
                <Card className="space-y-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="font-bold text-ink">{humanise(entry.action)}</p>
                    <p className="shrink-0 text-xs text-muted">{relativeTime(entry.createdAt)}</p>
                  </div>
                  <p className="text-sm text-muted">
                    {entry.user?.displayName ??
                      entry.child?.nickname ??
                      (entry.actorType === 'SYSTEM' ? 'Mission Hero' : 'Someone')}{' '}
                    · {entry.entityType}
                  </p>
                  {entry.reason ? <p className="text-sm text-ink">Reason: {entry.reason}</p> : null}
                  {entry.afterValue ? (
                    <p className="break-words rounded-lg bg-surface px-2 py-1 font-mono text-xs text-muted">
                      {JSON.stringify(entry.afterValue)}
                    </p>
                  ) : null}
                </Card>
              </li>
            ))}
          </ul>

          {pages > 1 ? (
            <nav aria-label="Pages" className="flex items-center justify-between gap-3">
              <PageLink page={pageNumber - 1} disabled={pageNumber <= 1} label="← Newer" />
              <span className="text-sm text-muted">
                Page {pageNumber} of {pages}
              </span>
              <PageLink page={pageNumber + 1} disabled={pageNumber >= pages} label="Older →" />
            </nav>
          ) : null}
        </>
      )}
    </div>
  );
}

function PageLink({ page, disabled, label }: { page: number; disabled: boolean; label: string }) {
  if (disabled) {
    return (
      <span className="mh-tap-sm flex items-center px-4 text-sm text-muted opacity-40">
        {label}
      </span>
    );
  }
  return (
    <Link
      href={`/parent/audit?page=${page}`}
      className="mh-tap-sm flex items-center rounded-full border-2 border-border px-4 text-sm font-bold text-ink"
    >
      {label}
    </Link>
  );
}

function humanise(action: string): string {
  const words = action.toLowerCase().replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}
