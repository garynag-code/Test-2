import { requireParent } from '@/server/auth/guards';
import { prisma } from '@/server/db/prisma';
import { Card, CardTitle, EmptyState } from '@/components/ui/card';
import * as settings from '@/features/families/settings';
import * as invites from '@/features/families/invites';
import { FamilySettingsForm } from '@/components/parent/family-settings-form';
import { ChildSettingsCard } from '@/components/parent/child-settings-card';
import { InviteParentForm } from '@/components/parent/invite-parent-form';
import { DeleteFamilyForm } from '@/components/parent/delete-family-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Settings' };

export default async function SettingsPage() {
  const actor = await requireParent();

  const [family, setting, kids, pendingInvites, members] = await Promise.all([
    prisma.family.findUniqueOrThrow({
      where: { id: actor.familyId },
      select: { name: true, timezone: true, familyCode: true },
    }),
    prisma.familySetting.findUniqueOrThrow({ where: { familyId: actor.familyId } }),
    settings.getChildSettings(actor),
    invites.listInvites(actor),
    prisma.familyMember.findMany({
      where: { familyId: actor.familyId, status: 'ACTIVE' },
      include: { user: { select: { email: true, displayName: true } } },
      orderBy: { createdAt: 'asc' },
    }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black text-ink">Settings</h1>
        <p className="text-sm text-muted">
          {family.name} · {family.timezone}
        </p>
      </div>

      <section aria-labelledby="family-settings" className="space-y-3">
        <CardTitle>
          <span id="family-settings">Family</span>
        </CardTitle>
        <Card>
          <FamilySettingsForm setting={setting} />
        </Card>
      </section>

      <section aria-labelledby="child-settings" className="space-y-3">
        <CardTitle>
          <span id="child-settings">Children</span>
        </CardTitle>
        {kids.length === 0 ? (
          <EmptyState icon="🦸" title="No heroes yet" />
        ) : (
          kids.map((child) => (
            <ChildSettingsCard
              key={child.id}
              child={{
                id: child.id,
                nickname: child.nickname,
                themeKey: child.themeKey,
                status: child.status,
                pinRequired: child.pinRequired,
                pinLocked: Boolean(child.pinLockedUntil && child.pinLockedUntil > new Date()),
                reducedMotion: child.setting?.reducedMotion ?? false,
                characterAutoApprove: child.setting?.characterAutoApprove ?? false,
                dailyTaskTarget: child.setting?.dailyTaskTarget ?? 4,
                notificationsEnabled: child.setting?.notificationsEnabled ?? true,
                soundEnabled: child.setting?.soundEnabled ?? true,
              }}
            />
          ))
        )}
      </section>

      <section aria-labelledby="grown-ups" className="space-y-3">
        <CardTitle>
          <span id="grown-ups">Grown-ups</span>
        </CardTitle>
        <Card className="divide-y divide-border p-0">
          {members.map((member) => (
            <p
              key={member.id}
              className="flex items-center justify-between gap-3 px-4 py-3 text-sm"
            >
              <span className="min-w-0">
                <span className="block font-bold text-ink">{member.user.displayName}</span>
                <span className="block truncate text-muted">{member.user.email}</span>
              </span>
              <span className="shrink-0 rounded-full bg-brand-soft px-3 py-1 text-xs font-bold text-brand">
                {member.role.toLowerCase()}
              </span>
            </p>
          ))}
        </Card>

        {actor.role === 'OWNER' ? (
          <Card>
            <InviteParentForm
              invites={pendingInvites.map((invite) => ({
                id: invite.id,
                email: invite.email,
                role: invite.role,
                token: invite.token,
                expiresAt: invite.expiresAt,
              }))}
            />
          </Card>
        ) : (
          <p className="text-sm text-muted">Only the family owner can invite another grown-up.</p>
        )}
      </section>

      <section aria-labelledby="your-data" className="space-y-3">
        <CardTitle>
          <span id="your-data">Your data</span>
        </CardTitle>
        <Card className="space-y-3">
          <p className="text-sm text-muted">
            Mission Hero stores a nickname for each child and nothing else that identifies them — no
            email address, no phone number and no date of birth.
          </p>
          <a
            href="/api/family/export"
            className="mh-tap-sm inline-flex items-center rounded-full border-2 border-border px-4 text-sm font-bold text-ink"
          >
            Download everything as JSON
          </a>
          {actor.role === 'OWNER' ? (
            <div className="border-t border-border pt-3">
              <DeleteFamilyForm familyName={family.name} />
            </div>
          ) : null}
        </Card>
      </section>
    </div>
  );
}
