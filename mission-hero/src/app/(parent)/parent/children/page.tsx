import { requireParent } from '@/server/auth/guards';
import { prisma } from '@/server/db/prisma';
import { toLocalDate } from '@/domain/dates';
import { Card, CardTitle, EmptyState } from '@/components/ui/card';
import { formatNumber } from '@/lib/utils';
import * as children from '@/features/children/service';
import { AddChildForm } from '@/components/parent/add-child-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Children' };

export default async function ChildrenPage() {
  const actor = await requireParent();
  const family = await prisma.family.findUniqueOrThrow({
    where: { id: actor.familyId },
    select: { timezone: true, familyCode: true },
  });
  const today = toLocalDate(new Date(), family.timezone);

  const kids = await children.listChildren(actor);
  const summaries = await Promise.all(
    kids.map((child) => children.getSummary(actor, { childId: child.id, today })),
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black text-ink">Children</h1>
        <p className="text-sm text-muted">
          Nickname only — Mission Hero never asks for a child&apos;s full name, email or date of
          birth.
        </p>
      </div>

      {summaries.length === 0 ? (
        <EmptyState icon="🦸" title="No heroes yet" hint="Add your first one below." />
      ) : (
        <ul className="space-y-3">
          {summaries.map((summary, index) => (
            <li key={summary.id}>
              <Card className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-lg font-extrabold text-ink">{summary.nickname}</p>
                  <p className="text-sm text-muted">
                    Level {summary.levelNumber} {summary.levelName} ·{' '}
                    {kids[index]?.pinRequired ? 'PIN set' : 'No PIN'}
                  </p>
                </div>
                <p className="shrink-0 text-right text-sm font-bold">
                  <span className="text-xp">⚡ {formatNumber(summary.lifetimeXp)}</span>
                  <br />
                  <span className="text-points">⭐ {formatNumber(summary.rewardPoints)}</span>
                </p>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <section aria-labelledby="add-child" className="space-y-3">
        <CardTitle>
          <span id="add-child">Add a hero</span>
        </CardTitle>
        <Card>
          <AddChildForm />
        </Card>
      </section>

      <Card>
        <p className="text-sm text-muted">
          On your child&apos;s device, open Mission Hero and enter this family code:
        </p>
        <p className="mt-2 font-mono text-2xl font-black tracking-[0.3em] text-brand">
          {family.familyCode}
        </p>
      </Card>
    </div>
  );
}
