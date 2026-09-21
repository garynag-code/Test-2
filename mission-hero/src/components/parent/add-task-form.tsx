'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { createTaskAction } from '@/features/tasks/actions';

interface ChildOption {
  id: string;
  nickname: string;
}

interface AddTaskFormProps {
  /** Not named `children`: that prop name is reserved by React. */
  childOptions: ChildOption[];
  traits: Array<{ id: string; label: string }>;
  categories: Array<{ key: string; label: string }>;
  today: string;
}

const ICONS = [
  'target',
  'bed',
  'book',
  'pencil',
  'backpack',
  'utensils',
  'broom',
  'scroll',
  'music',
  'sparkles',
];

const WEEKDAYS = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 0, label: 'Sun' },
];

export function AddTaskForm({ childOptions, traits, categories, today }: AddTaskFormProps) {
  const [state, action] = useActionState(createTaskAction, undefined);
  const [frequency, setFrequency] = useState('DAILY');
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) {
      formRef.current?.reset();
      setFrequency('DAILY');
    }
  }, [state?.ok]);

  return (
    <form ref={formRef} action={action} className="space-y-4">
      <Field label="Mission name" htmlFor="title">
        <input
          id="title"
          name="title"
          required
          maxLength={120}
          placeholder="Read for 20 minutes"
          className="mh-tap-sm w-full rounded-xl2 border-2 border-border bg-card px-4 text-base"
        />
      </Field>

      <fieldset className="space-y-1">
        <legend className="text-sm font-bold text-ink">Who&apos;s it for?</legend>
        <div className="flex flex-wrap gap-2">
          {childOptions.map((child) => (
            <label
              key={child.id}
              className="mh-tap-sm flex cursor-pointer items-center gap-2 rounded-full border-2 border-border px-4 text-sm font-bold has-[:checked]:border-brand has-[:checked]:bg-brand-soft"
            >
              <input type="checkbox" name="childIds" value={child.id} className="sr-only" />
              {child.nickname}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid grid-cols-2 gap-3">
        <Field label="XP" htmlFor="xpValue">
          <input
            id="xpValue"
            name="xpValue"
            type="number"
            min={0}
            max={1000}
            defaultValue={10}
            className="mh-tap-sm w-full rounded-xl2 border-2 border-border bg-card px-4 text-base"
          />
        </Field>
        <Field label="Reward points" htmlFor="rewardPointsValue">
          <input
            id="rewardPointsValue"
            name="rewardPointsValue"
            type="number"
            min={0}
            max={1000}
            defaultValue={5}
            className="mh-tap-sm w-full rounded-xl2 border-2 border-border bg-card px-4 text-base"
          />
        </Field>
      </div>

      <Field
        label="Also builds a character trait"
        htmlFor="characterTraitId"
        hint="Optional. Adds one Character Star when approved."
      >
        <select
          id="characterTraitId"
          name="characterTraitId"
          defaultValue=""
          className="mh-tap-sm w-full rounded-xl2 border-2 border-border bg-card px-4 text-base"
        >
          <option value="">None</option>
          {traits.map((trait) => (
            <option key={trait.id} value={trait.id}>
              {trait.label}
            </option>
          ))}
        </select>
      </Field>
      <input type="hidden" name="characterStarValue" value={1} />

      <div className="grid grid-cols-2 gap-3">
        <Field label="Category" htmlFor="categoryKey">
          <select
            id="categoryKey"
            name="categoryKey"
            defaultValue=""
            className="mh-tap-sm w-full rounded-xl2 border-2 border-border bg-card px-4 text-base"
          >
            <option value="">None</option>
            {categories.map((category) => (
              <option key={category.key} value={category.key}>
                {category.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Icon" htmlFor="iconKey">
          <select
            id="iconKey"
            name="iconKey"
            defaultValue="target"
            className="mh-tap-sm w-full rounded-xl2 border-2 border-border bg-card px-4 text-base"
          >
            {ICONS.map((icon) => (
              <option key={icon} value={icon}>
                {icon}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="How often?" htmlFor="frequency">
        <select
          id="frequency"
          name="frequency"
          value={frequency}
          onChange={(event) => setFrequency(event.target.value)}
          className="mh-tap-sm w-full rounded-xl2 border-2 border-border bg-card px-4 text-base"
        >
          <option value="DAILY">Every day</option>
          <option value="WEEKDAYS">Weekdays</option>
          <option value="WEEKENDS">Weekends</option>
          <option value="SELECTED_DAYS">Chosen days</option>
          <option value="WEEKLY">Weekly</option>
          <option value="MONTHLY">Monthly</option>
          <option value="ONE_TIME">Just once</option>
        </select>
      </Field>

      {frequency === 'SELECTED_DAYS' || frequency === 'WEEKLY' ? (
        <fieldset className="space-y-1">
          <legend className="text-sm font-bold text-ink">Which days?</legend>
          <div className="flex flex-wrap gap-2">
            {WEEKDAYS.map((day) => (
              <label
                key={day.value}
                className="mh-tap-sm flex cursor-pointer items-center justify-center rounded-full border-2 border-border px-3 text-sm font-bold has-[:checked]:border-brand has-[:checked]:bg-brand-soft"
              >
                <input type="checkbox" name="weekdays" value={day.value} className="sr-only" />
                {day.label}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      <div className="grid grid-cols-2 gap-3">
        <Field label="Starting" htmlFor="startDate">
          <input
            id="startDate"
            name="startDate"
            type="date"
            defaultValue={today}
            required
            className="mh-tap-sm w-full rounded-xl2 border-2 border-border bg-card px-4 text-base"
          />
        </Field>
        <Field label="Evidence" htmlFor="evidenceType">
          <select
            id="evidenceType"
            name="evidenceType"
            defaultValue="NONE"
            className="mh-tap-sm w-full rounded-xl2 border-2 border-border bg-card px-4 text-base"
          >
            <option value="NONE">None</option>
            <option value="NOTE">A short note</option>
            <option value="PARENT_CONFIRM">You confirm it</option>
          </select>
        </Field>
      </div>

      {state?.error ? (
        <p
          role="alert"
          className="rounded-xl2 bg-star/10 px-4 py-3 text-sm font-semibold text-star"
        >
          {state.error}
        </p>
      ) : null}
      {state?.ok ? (
        <p
          role="status"
          className="rounded-xl2 bg-success/10 px-4 py-3 text-sm font-semibold text-success"
        >
          Mission created.
        </p>
      ) : null}

      <Submit />
    </form>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={htmlFor} className="block text-sm font-bold text-ink">
        {label}
      </label>
      {children}
      {hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" size="block" disabled={pending}>
      {pending ? 'Creating…' : 'Create mission'}
    </Button>
  );
}
