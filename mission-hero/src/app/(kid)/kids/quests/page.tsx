import { requireChild } from '@/server/auth/guards';
import { prisma } from '@/server/db/prisma';
import { toLocalDate } from '@/domain/dates';
import { EmptyState } from '@/components/ui/card';
import * as missions from '@/features/secret-missions/service';
import { QuestList } from '@/components/kid/quest-list';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Quests' };

/**
 * Secret missions the child has found, plus bonus challenges, which need no
 * finding. Both run through the same submission and approval path.
 */
export default async function QuestsPage() {
  const actor = await requireChild();
  const family = await prisma.family.findUniqueOrThrow({
    where: { id: actor.familyId },
    select: { timezone: true, setting: true },
  });
  const today = toLocalDate(new Date(), family.timezone);

  const [quests, hidden] = await Promise.all([
    missions.listQuestsForChild(actor, actor.childId),
    missions.getHiddenObject(actor, { childId: actor.childId, today }),
  ]);

  const secretsFound = quests.filter((quest) => quest.kind === 'SECRET').length;

  return (
    <div className="pb-24">
      <header className="mh-gradient px-5 pb-8 pt-8 text-white">
        <div className="mx-auto max-w-md">
          <h1 className="text-3xl font-black">Quests</h1>
          <p className="mt-1 font-semibold text-white/90">
            {secretsFound > 0
              ? `${secretsFound} secret ${secretsFound === 1 ? 'mission' : 'missions'} found`
              : 'Bonus challenges, and secrets waiting to be found.'}
          </p>
        </div>
      </header>

      <div className="mx-auto max-w-md space-y-6 px-5 py-6">
        {quests.length === 0 ? (
          <EmptyState
            icon="🗺️"
            title="No quests right now"
            hint={
              family.setting?.hiddenObjectsEnabled
                ? 'Keep an eye out — secret missions hide around the app.'
                : 'A grown-up can add bonus challenges.'
            }
          />
        ) : (
          <QuestList quests={quests} />
        )}

        {hidden ? (
          <p className="text-center text-sm text-muted">
            Something is hidden somewhere today. Keep your eyes open.
          </p>
        ) : null}
      </div>
    </div>
  );
}
