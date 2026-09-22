import { redirect } from 'next/navigation';
import { readBoundFamilyId, readChildClaims } from '@/server/auth/session';
import { prisma } from '@/server/db/prisma';
import * as children from '@/features/children/service';
import { ProfilePicker } from '@/components/kid/profile-picker';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Choose your hero' };

/**
 * The profile picker, on its own route.
 *
 * Separate from `/kids` on purpose: binding a device used to return to the
 * same URL and rely on the page re-rendering to swap the code form for this
 * list, which the client router serves from cache often enough to be a real
 * problem. A distinct route makes the step an unambiguous navigation.
 *
 * Reachable with a device cookie alone, which carries no authority — it only
 * says "this device may show this family's nicknames" (docs/03 §5).
 */
export default async function ChooseHeroPage() {
  if (await readChildClaims()) redirect('/kids/home');

  const familyId = await readBoundFamilyId();
  if (!familyId) redirect('/kids');

  const family = await prisma.family.findUnique({
    where: { id: familyId },
    select: { id: true, name: true },
  });
  // The bound family is gone; send them back to ask for a code again.
  if (!family) redirect('/kids');

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
