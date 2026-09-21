import Link from 'next/link';
import { registerAction } from '@/features/auth/actions';
import { AuthForm } from '@/components/parent/auth-form';

export const metadata = { title: 'Create your family' };

export default function RegisterPage() {
  return (
    <main id="main" className="min-h-dvh bg-surface px-5 py-10">
      <div className="mx-auto max-w-sm">
        <Link href="/" className="text-sm font-semibold text-muted">
          ← Back
        </Link>
        <h1 className="mt-6 text-3xl font-black text-ink">Create your family</h1>
        <p className="mt-1 text-muted">
          You&apos;ll get character traits, levels and badges ready to go.
        </p>

        <AuthForm
          action={registerAction}
          submitLabel="Create family"
          fields={[
            {
              name: 'displayName',
              label: 'Your name',
              type: 'text',
              autoComplete: 'name',
              required: true,
            },
            { name: 'email', label: 'Email', type: 'email', autoComplete: 'email', required: true },
            {
              name: 'password',
              label: 'Password',
              type: 'password',
              autoComplete: 'new-password',
              required: true,
              hint: 'At least 10 characters.',
            },
            {
              name: 'familyName',
              label: 'Family name',
              type: 'text',
              required: true,
              placeholder: 'The Adventure Family',
            },
            {
              name: 'parentNickname',
              label: 'What the kids call you',
              type: 'text',
              placeholder: 'Mom',
              hint: 'Shown on approvals and encouragement.',
            },
          ]}
          hidden={{ timezone: 'Africa/Johannesburg' }}
        />

        <p className="mt-6 text-center text-sm text-muted">
          Already have a family?{' '}
          <Link href="/parent/login" className="font-bold text-brand underline">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
