import { requireParent } from '@/server/auth/guards';
import { prisma } from '@/server/db/prisma';
import { Card, CardTitle, EmptyState } from '@/components/ui/card';
import * as children from '@/features/children/service';
import * as character from '@/features/character/service';
import { AddChallengeForm } from '@/components/parent/add-challenge-form';
import { AddQuestForm } from '@/components/parent/add-quest-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Learning & quests' };

const CATEGORY_LABELS: Record<string, string> = {
  BIBLE_VERSE: 'Verse',
  QUOTE: 'Quote',
  AFFIRMATION: 'Affirmation',
  FAMILY_SAYING: 'Family saying',
  SLOGAN: 'Slogan',
  VOCABULARY: 'Word',
  SCHOOL_FACT: 'Fact',
  CUSTOM: 'Challenge',
};

/**
 * Everything a family chooses to teach. Mission Hero has no opinion about what
 * belongs here — a verse, a quote, a times table and a family saying are all
 * the same kind of row.
 */
export default async function LearningPage() {
  const actor = await requireParent();

  const [kids, traits, challenges, quests] = await Promise.all([
    children.listChildren(actor),
    character.listTraits(actor),
    prisma.memoryChallenge.findMany({
      where: { familyId: actor.familyId, deletedAt: null },
      include: { assignments: { include: { child: { select: { nickname: true } } } } },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.secretMission.findMany({
      where: { familyId: actor.familyId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black text-ink">Learning &amp; Quests</h1>
        <p className="text-sm text-muted">
          Verses, quotes, family sayings, school facts — and the quests that go with them.
        </p>
      </div>

      {kids.length === 0 ? (
        <EmptyState
          icon="🦸"
          title="Add a hero first"
          hint="Challenges are assigned to children, so there needs to be at least one."
        />
      ) : (
        <>
          <section aria-labelledby="add-challenge" className="space-y-3">
            <CardTitle>
              <span id="add-challenge">New memory challenge</span>
            </CardTitle>
            <Card>
              <AddChallengeForm
                childOptions={kids.map((child) => ({ id: child.id, nickname: child.nickname }))}
              />
            </Card>
          </section>

          <section aria-labelledby="challenges" className="space-y-3">
            <CardTitle>
              <span id="challenges">{challenges.length} memory challenges</span>
            </CardTitle>
            {challenges.length === 0 ? (
              <EmptyState icon="📜" title="Nothing to learn yet" />
            ) : (
              <ul className="space-y-2">
                {challenges.map((challenge) => (
                  <li key={challenge.id}>
                    <Card>
                      <p className="text-xs font-bold uppercase tracking-wide text-muted">
                        {CATEGORY_LABELS[challenge.category] ?? 'Challenge'}
                        {challenge.reference ? ` · ${challenge.reference}` : ''}
                      </p>
                      <p className="font-extrabold text-ink">{challenge.title}</p>
                      <p className="mt-1 text-sm text-muted">{challenge.bodyText}</p>
                      <p className="mt-2 text-xs text-muted">
                        {challenge.assignments.map((a) => a.child.nickname).join(', ') ||
                          'Not assigned'}{' '}
                        · +{challenge.xpValue} XP
                      </p>
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="add-quest" className="space-y-3">
            <CardTitle>
              <span id="add-quest">New quest</span>
            </CardTitle>
            <Card>
              <AddQuestForm traits={traits.map((t) => ({ id: t.id, label: t.label }))} />
            </Card>
          </section>

          <section aria-labelledby="quests" className="space-y-3">
            <CardTitle>
              <span id="quests">{quests.length} quests</span>
            </CardTitle>
            {quests.length === 0 ? (
              <EmptyState icon="🗝️" title="No quests yet" />
            ) : (
              <ul className="space-y-2">
                {quests.map((quest) => (
                  <li key={quest.id}>
                    <Card>
                      <p className="text-xs font-bold uppercase tracking-wide text-muted">
                        {quest.requiresDiscovery ? '🗝️ Secret mission' : '⭐ Bonus challenge'} ·{' '}
                        {quest.rarity.toLowerCase()}
                      </p>
                      <p className="font-extrabold text-ink">{quest.title}</p>
                      <p className="mt-1 text-sm text-muted">{quest.instructions}</p>
                      <p className="mt-2 text-xs text-muted">
                        +{quest.xpValue} XP
                        {quest.rewardPointsValue > 0 ? ` · +${quest.rewardPointsValue} points` : ''}
                      </p>
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
