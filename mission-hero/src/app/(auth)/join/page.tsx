import Link from 'next/link';
import { findValidInvite } from '@/features/families/invites';
import { JoinForm } from '@/components/parent/join-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Join a family' };

/**
 * Accepting an invite. An invalid, expired, used or revoked token all produce
 * the same message — nothing here confirms whether a token ever existed.
 */
export default async function JoinPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const invite = token ? await findValidInvite(token) : null;

  if (!invite) {
    return (
      <main id="main" className="min-h-dvh bg-surface px-5 py-10">
        <div className="mx-auto max-w-sm">
          <h1 className="text-3xl font-black text-ink">That link has expired</h1>
          <p className="mt-2 text-muted">
            Ask whoever invited you to send a fresh one — invite links can only be used once.
          </p>
          <Link
            href="/"
            className="mh-tap mt-6 flex items-center justify-center rounded-full border-2 border-border bg-card font-bold text-ink"
          >
            Back to the start
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main id="main" className="min-h-dvh bg-surface px-5 py-10">
      <div className="mx-auto max-w-sm">
        <h1 className="text-3xl font-black text-ink">Join {invite.family.name}</h1>
        <p className="mt-1 text-muted">
          You&apos;ve been invited as a {invite.role.toLowerCase()} for {invite.email}.
        </p>
        <JoinForm token={token!} />
      </div>
    </main>
  );
}
