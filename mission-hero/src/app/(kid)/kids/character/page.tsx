import { requireChild } from '@/server/auth/guards';
import { prisma } from '@/server/db/prisma';
import { toLocalDate, localDateToUtcDate } from '@/domain/dates';
import { CHARACTER } from '@/domain/copy';
import * as characterService from '@/features/character/service';
import { CharacterCheckIn } from '@/components/kid/character-check-in';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Character power' };

/** Vertical Slice 2 as the child sees it (brief §48). */
export default async function CharacterPage() {
  const actor = await requireChild();
  const family = await prisma.family.findUniqueOrThrow({
    where: { id: actor.familyId },
    select: { timezone: true },
  });
  const today = toLocalDate(new Date(), family.timezone);

  const [traits, pending] = await Promise.all([
    characterService.listTraits(actor),
    prisma.characterSubmission.findMany({
      where: { childId: actor.childId, localDate: localDateToUtcDate(today) },
      include: { trait: { select: { label: true, emoji: true } } },
      orderBy: { submittedAt: 'desc' },
    }),
  ]);

  return (
    <div className="pb-24">
      <header className="mh-gradient px-5 pb-8 pt-8 text-white">
        <div className="mx-auto max-w-md">
          <h1 className="text-3xl font-black">Character Power</h1>
          <p className="mt-1 font-semibold text-white/90">{CHARACTER.prompt}</p>
        </div>
      </header>

      <div className="mx-auto max-w-md space-y-6 px-5 py-6">
        <CharacterCheckIn traits={traits} />

        {pending.length > 0 ? (
          <section aria-labelledby="today-moments" className="space-y-2">
            <h2 id="today-moments" className="text-sm font-bold uppercase tracking-wide text-muted">
              Today&apos;s moments
            </h2>
            <ul className="space-y-2">
              {pending.map((submission) => (
                <li key={submission.id} className="rounded-xl2 border-2 border-border bg-card p-4">
                  <p className="font-extrabold text-ink">
                    <span aria-hidden>{submission.trait.emoji}</span> {submission.trait.label}
                  </p>
                  <p className="mt-1 text-sm text-muted">“{submission.story}”</p>
                  <p className="mt-2 text-xs font-bold uppercase tracking-wide text-warn">
                    {submission.status === 'PENDING'
                      ? CHARACTER.waitingForParent
                      : submission.status === 'APPROVED'
                        ? 'Confirmed ⭐'
                        : "Let's talk about this one"}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}
