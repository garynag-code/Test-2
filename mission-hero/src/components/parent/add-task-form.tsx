'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { createTaskAction, updateTaskAction } from '@/features/tasks/actions';

interface ChildOption {
  id: string;
  nickname: string;
}

/** An existing mission, when this form is editing one rather than adding. */
export interface TaskDefaults {
  id: string;
  title: string;
  description: string | null;
  categoryKey: string | null;
  iconKey: string;
  xpValue: number;
  rewardPointsValue: number;
  characterTraitId: string | null;
  evidenceType: string;
  frequency: string;
  weekdays: number[];
  startDate: string;
  dueTime: string | null;
  childIds: string[];
}

interface AddTaskFormProps {
  /** Not named `children`: that prop name is reserved by React. */
  childOptions: ChildOption[];
  traits: Array<{ id: string; label: string }>;
  categories: Array<{ key: string; label: string }>;
  today: string;
  /** Absent when adding. Present when editing that mission. */
  task?: TaskDefaults;
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

/**
 * One form for adding a mission and for editing one.
 *
 * The fields are identical either way, and two copies of twenty inputs would
 * drift apart the first time one of them changed. Editing differs only in
 * where it posts, what the values start as, and that it does not clear itself
 * afterwards — you have just told it what you wanted.
 */
export function AddTaskForm({ childOptions, traits, categories, today, task }: AddTaskFormProps) {
  const editing = Boolean(task);
  const [state, action] = useActionState(editing ? updateTaskAction : createTaskAction, undefined);
  const [frequency, setFrequency] = useState(task?.frequency ?? 'DAILY');
  // Several edit forms can be open at once; duplicate ids would aim every
  // label at whichever rendered first.
  const uid = task ? `t-${task.id}` : 'new';
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok && !editing) {
      formRef.current?.reset();
      setFrequency('DAILY');
    }
  }, [state?.ok, editing]);

  return (
    <form ref={formRef} action={action} className="space-y-4">
      {task ? <input type="hidden" name="taskId" value={task.id} /> : null}
      <Field label="Mission name" htmlFor={`${uid}-title`}>
        <input
          id={`${uid}-title`}
          name="title"
          defaultValue={task?.title ?? ''}
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
              <input
                type="checkbox"
                name="childIds"
                value={child.id}
                defaultChecked={task?.childIds.includes(child.id) ?? false}
                className="sr-only"
              />
              {child.nickname}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid grid-cols-2 gap-3">
        <Field label="XP" htmlFor={`${uid}-xpValue`}>
          <input
            id={`${uid}-xpValue`}
            name="xpValue"
            type="number"
            min={0}
            max={1000}
            defaultValue={task?.xpValue ?? 10}
            className="mh-tap-sm w-full rounded-xl2 border-2 border-border bg-card px-4 text-base"
          />
        </Field>
        <Field label="Reward points" htmlFor={`${uid}-rewardPointsValue`}>
          <input
            id={`${uid}-rewardPointsValue`}
            name="rewardPointsValue"
            type="number"
            min={0}
            max={1000}
            defaultValue={task?.rewardPointsValue ?? 5}
            className="mh-tap-sm w-full rounded-xl2 border-2 border-border bg-card px-4 text-base"
          />
        </Field>
      </div>

      <Field
        label="Also builds a character trait"
        htmlFor={`${uid}-characterTraitId`}
        hint="Optional. Adds one Character Star when approved."
      >
        <select
          id={`${uid}-characterTraitId`}
          name="characterTraitId"
          defaultValue={task?.characterTraitId ?? ''}
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
        <Field label="Category" htmlFor={`${uid}-categoryKey`}>
          <select
            id={`${uid}-categoryKey`}
            name="categoryKey"
            defaultValue={task?.categoryKey ?? ''}
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
        <Field label="Icon" htmlFor={`${uid}-iconKey`}>
          <select
            id={`${uid}-iconKey`}
            name="iconKey"
            defaultValue={task?.iconKey ?? 'target'}
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

      <Field label="How often?" htmlFor={`${uid}-frequency`}>
        <select
          id={`${uid}-frequency`}
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
                <input
                  type="checkbox"
                  name="weekdays"
                  value={day.value}
                  defaultChecked={task?.weekdays.includes(day.value) ?? false}
                  className="sr-only"
                />
                {day.label}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      <div className="grid grid-cols-2 gap-3">
        <Field label="Starting" htmlFor={`${uid}-startDate`}>
          <input
            id={`${uid}-startDate`}
            name="startDate"
            type="date"
            defaultValue={task?.startDate ?? today}
            required
            className="mh-tap-sm w-full rounded-xl2 border-2 border-border bg-card px-4 text-base"
          />
        </Field>
        <Field label="Evidence" htmlFor={`${uid}-evidenceType`}>
          <select
            id={`${uid}-evidenceType`}
            name="evidenceType"
            defaultValue={task?.evidenceType ?? 'NONE'}
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
          {editing ? 'Saved.' : 'Mission created.'}
        </p>
      ) : null}

      <Submit editing={editing} />
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

function Submit({ editing }: { editing: boolean }) {
  const { pending } = useFormStatus();
  const label = editing ? 'Save changes' : 'Create mission';
  return (
    <Button type="submit" variant="primary" size="block" disabled={pending}>
      {pending ? (editing ? 'Saving…' : 'Creating…') : label}
    </Button>
  );
}
