import { requireParent } from '@/server/auth/guards';
import { prisma } from '@/server/db/prisma';
import { toLocalDate, utcDateToLocalDate } from '@/domain/dates';
import { Card, CardTitle, EmptyState } from '@/components/ui/card';
import * as children from '@/features/children/service';
import * as character from '@/features/character/service';
import { AddTaskForm } from '@/components/parent/add-task-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Missions' };

const FREQUENCY_LABELS: Record<string, string> = {
  ONE_TIME: 'Once',
  DAILY: 'Every day',
  WEEKDAYS: 'Weekdays',
  WEEKENDS: 'Weekends',
  SELECTED_DAYS: 'Chosen days',
  WEEKLY: 'Weekly',
  MONTHLY: 'Monthly',
  QUARTERLY: 'Quarterly',
  ANNUAL: 'Yearly',
  CUSTOM: 'Custom',
};

export default async function TasksPage() {
  const actor = await requireParent();
  const family = await prisma.family.findUniqueOrThrow({
    where: { id: actor.familyId },
    select: { timezone: true },
  });

  const [kids, traits, categories, tasks] = await Promise.all([
    children.listChildren(actor),
    character.listTraits(actor),
    prisma.taskCategory.findMany({
      where: { familyId: actor.familyId },
      orderBy: { sortOrder: 'asc' },
    }),
    prisma.task.findMany({
      where: { familyId: actor.familyId, deletedAt: null },
      include: {
        schedule: true,
        assignments: { include: { child: { select: { nickname: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black text-ink">Missions</h1>
        <p className="text-sm text-muted">
          What a mission is worth is set here, and only here — nothing a child sends can change it.
        </p>
      </div>

      {kids.length === 0 ? (
        <EmptyState
          icon="🦸"
          title="Add a hero first"
          hint="Missions are assigned to children, so there needs to be at least one."
        />
      ) : (
        <>
          <section aria-labelledby="add-task" className="space-y-3">
            <CardTitle>
              <span id="add-task">New mission</span>
            </CardTitle>
            <Card>
              <AddTaskForm
                childOptions={kids.map((child) => ({ id: child.id, nickname: child.nickname }))}
                traits={traits.map((trait) => ({ id: trait.id, label: trait.label }))}
                categories={categories.map((category) => ({
                  key: category.key,
                  label: category.label,
                }))}
                today={toLocalDate(new Date(), family.timezone)}
              />
            </Card>
          </section>

          <section aria-labelledby="existing" className="space-y-3">
            <CardTitle>
              <span id="existing">{tasks.length} missions</span>
            </CardTitle>
            {tasks.length === 0 ? (
              <EmptyState icon="🎯" title="No missions yet" hint="Create your first one above." />
            ) : (
              <ul className="space-y-2">
                {tasks.map((task) => (
                  <li key={task.id}>
                    <Card>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-extrabold text-ink">{task.title}</p>
                          <p className="text-sm text-muted">
                            {FREQUENCY_LABELS[task.schedule?.frequency ?? ''] ?? 'Scheduled'}
                            {task.schedule
                              ? ` from ${utcDateToLocalDate(task.schedule.startDate)}`
                              : ''}
                          </p>
                          <p className="text-sm text-muted">
                            {task.assignments.map((a) => a.child.nickname).join(', ') ||
                              'Not assigned'}
                          </p>
                        </div>
                        <p className="shrink-0 text-right text-xs font-bold">
                          {task.xpValue > 0 ? (
                            <span className="text-xp">+{task.xpValue} XP</span>
                          ) : null}
                          {task.rewardPointsValue > 0 ? (
                            <>
                              <br />
                              <span className="text-points">+{task.rewardPointsValue} pts</span>
                            </>
                          ) : null}
                          {task.characterStarValue > 0 ? (
                            <>
                              <br />
                              <span className="text-star">+{task.characterStarValue} ⭐</span>
                            </>
                          ) : null}
                        </p>
                      </div>
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
