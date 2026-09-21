import Link from 'next/link';
import { loginAction } from '@/features/auth/actions';
import { AuthForm } from '@/components/parent/auth-form';

export const metadata = { title: 'Sign in' };

export default function LoginPage() {
  return (
    <main id="main" className="min-h-dvh bg-surface px-5 py-10">
      <div className="mx-auto max-w-sm">
        <Link href="/" className="text-sm font-semibold text-muted">
          ← Back
        </Link>
        <h1 className="mt-6 text-3xl font-black text-ink">Welcome back</h1>
        <p className="mt-1 text-muted">Sign in to your family.</p>

        <AuthForm
          action={loginAction}
          submitLabel="Sign in"
          fields={[
            { name: 'email', label: 'Email', type: 'email', autoComplete: 'email', required: true },
            {
              name: 'password',
              label: 'Password',
              type: 'password',
              autoComplete: 'current-password',
              required: true,
            },
          ]}
        />

        <p className="mt-6 text-center text-sm text-muted">
          No family yet?{' '}
          <Link href="/parent/register" className="font-bold text-brand underline">
            Create one
          </Link>
        </p>
      </div>
    </main>
  );
}
