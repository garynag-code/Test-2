import { redirect } from 'next/navigation';
import { readBoundFamilyId, readChildClaims } from '@/server/auth/session';
import { prisma } from '@/server/db/prisma';
import * as children from '@/features/children/service';
import { FamilyCodeForm } from '@/components/kid/family-code-form';
import { ProfilePicker } from '@/components/kid/profile-picker';
import { APP_NAME, APP_TAGLINE } from '@/domain/constants';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Choose your hero' };

/**
 * Two steps, both deliberately low-trust: binding the device to a family, then
 * picking a profile. The device cookie alone reveals nothing but nicknames and
 * avatars, which is why child profiles hold no legal names (docs/03 §5).
 */
export default async function KidsEntryPage() {
  if (await readChildClaims()) redirect('/kids/home');

  const familyId = await readBoundFamilyId();
  if (!familyId) {
    return (
      <main id="main" className="mh-gradient min-h-dvh px-5 py-12 text-white">
        <div className="mx-auto max-w-sm">
          <h1 className="text-4xl font-black">{APP_NAME}</h1>
          <p className="mt-1 font-semibold text-white/80">{APP_TAGLINE}</p>
          <p className="mt-8 text-lg">Ask a grown-up for your family code.</p>
          <FamilyCodeForm />
        </div>
      </main>
    );
  }

  const family = await prisma.family.findUnique({
    where: { id: familyId },
    select: { id: true, name: true },
  });
  if (!family) {
    // The bound family is gone; fall back to asking for a code again.
    return (
      <main id="main" className="mh-gradient min-h-dvh px-5 py-12 text-white">
        <div className="mx-auto max-w-sm">
          <h1 className="text-3xl font-black">Let&apos;s try that again</h1>
          <FamilyCodeForm />
        </div>
      </main>
    );
  }

  const profiles = await children.listProfilesForDevice(family.id);

  return (
    <main id="main" className="mh-gradient min-h-dvh px-5 py-12 text-white">
      <div className="mx-auto max-w-sm">
        <p className="text-sm font-bold uppercase tracking-[0.2em] text-white/70">{family.name}</p>
        <h1 className="mt-1 text-4xl font-black">Who&apos;s playing?</h1>
        <ProfilePicker familyId={family.id} profiles={profiles} />
      </div>
    </main>
  );
}
