'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import type { ActionState } from '@/features/auth/actions';

interface Field {
  name: string;
  label: string;
  type: 'text' | 'email' | 'password';
  autoComplete?: string;
  required?: boolean;
  placeholder?: string;
  hint?: string;
}

interface AuthFormProps {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  fields: Field[];
  submitLabel: string;
  hidden?: Record<string, string>;
}

export function AuthForm({ action, fields, submitLabel, hidden }: AuthFormProps) {
  const [state, formAction] = useActionState(action, undefined);

  return (
    <form action={formAction} className="mt-8 space-y-4" noValidate>
      {Object.entries(hidden ?? {}).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}

      {fields.map((field) => (
        <div key={field.name} className="space-y-1">
          <label htmlFor={field.name} className="block text-sm font-bold text-ink">
            {field.label}
            {field.required ? <span className="sr-only"> (required)</span> : null}
          </label>
          <input
            id={field.name}
            name={field.name}
            type={field.type}
            autoComplete={field.autoComplete}
            required={field.required}
            placeholder={field.placeholder}
            aria-describedby={field.hint ? `${field.name}-hint` : undefined}
            className="mh-tap-sm w-full rounded-xl2 border-2 border-border bg-card px-4 text-base text-ink"
          />
          {field.hint ? (
            <p id={`${field.name}-hint`} className="text-xs text-muted">
              {field.hint}
            </p>
          ) : null}
        </div>
      ))}

      {state?.error ? (
        <p
          role="alert"
          className="rounded-xl2 bg-star/10 px-4 py-3 text-sm font-semibold text-star"
        >
          {state.error}
        </p>
      ) : null}

      <SubmitButton label={submitLabel} />
    </form>
  );
}

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" size="block" disabled={pending}>
      {pending ? 'Just a moment…' : label}
    </Button>
  );
}
