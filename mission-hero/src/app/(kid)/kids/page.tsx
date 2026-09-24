import { redirect } from 'next/navigation';
import { readBoundFamilyId, readChildClaims } from '@/server/auth/session';
import { FamilyCodeForm } from '@/components/kid/family-code-form';
import { APP_NAME, APP_TAGLINE, FAMILY_CODE_LENGTH } from '@/domain/constants';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Enter your family code' };

/**
 * Step one of two, both deliberately low-trust: bind the device to a family
 * here, then pick a profile on `/kids/who`. The device cookie alone reveals
 * nothing but nicknames and avatars, which is why child profiles hold no legal
 * names (docs/03 §5).
 */
export default async function KidsEntryPage() {
  if (await readChildClaims()) redirect('/kids/home');
  if (await readBoundFamilyId()) redirect('/kids/who');

  return (
    <main id="main" className="mh-gradient min-h-dvh px-5 py-12 text-white">
      <div className="mx-auto max-w-sm">
        <h1 className="text-4xl font-black">{APP_NAME}</h1>
        <p className="mt-1 font-semibold text-white/80">{APP_TAGLINE}</p>
        <p className="mt-8 text-lg">Ask a grown-up for your family code.</p>
        <p className="mt-1 text-white/80">
          It&apos;s {FAMILY_CODE_LENGTH} letters and numbers — not your family&apos;s name. A
          grown-up finds it in Mission Hero under <strong className="font-bold">Children</strong>.
        </p>
        <FamilyCodeForm />
      </div>
    </main>
  );
}
