import { requireChild } from '@/server/auth/guards';
import { EmptyState } from '@/components/ui/card';
import * as memory from '@/features/memory/service';
import { MemoryList } from '@/components/kid/memory-list';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Learn by heart' };

/**
 * Memory challenges (brief §15). What a family wants learned by heart is
 * entirely theirs — a verse, a quote, a family saying and a times table are
 * the same kind of row here.
 */
export default async function MemoryPage() {
  const actor = await requireChild();
  const challenges = await memory.listForChild(actor, actor.childId);

  const toLearn = challenges.filter((challenge) => challenge.status !== 'APPROVED');
  const mastered = challenges.filter((challenge) => challenge.status === 'APPROVED');

  return (
    <div className="pb-24">
      <header className="mh-gradient px-5 pb-8 pt-8 text-white">
        <div className="mx-auto max-w-md">
          <h1 className="text-3xl font-black">Learn By Heart</h1>
          <p className="mt-1 font-semibold text-white/90">
            {mastered.length > 0
              ? `${mastered.length} mastered · ${toLearn.length} to go`
              : 'Read it, learn it, then type it from memory.'}
          </p>
        </div>
      </header>

      <div className="mx-auto max-w-md space-y-6 px-5 py-6">
        {challenges.length === 0 ? (
          <EmptyState
            icon="📜"
            title="Nothing to learn yet"
            hint="A grown-up can add verses, quotes or family sayings."
          />
        ) : (
          <MemoryList challenges={challenges} />
        )}
      </div>
    </div>
  );
}
