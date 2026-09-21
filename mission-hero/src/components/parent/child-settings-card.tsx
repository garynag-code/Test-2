'use client';

import { useActionState, useTransition } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ToggleRow, NumberRow } from '@/components/parent/toggle-row';
import {
  setChildPinAction,
  setChildStatusAction,
  updateChildSettingsAction,
} from '@/features/families/actions';

const THEMES = [
  'space',
  'jungle',
  'superhero',
  'underwater',
  'sports',
  'fantasy',
  'racing',
  'robots',
  'dinosaurs',
];

interface ChildRow {
  id: string;
  nickname: string;
  themeKey: string;
  status: string;
  pinRequired: boolean;
  pinLocked: boolean;
  reducedMotion: boolean;
  characterAutoApprove: boolean;
  dailyTaskTarget: number;
  notificationsEnabled: boolean;
  soundEnabled: boolean;
}

export function ChildSettingsCard({ child }: { child: ChildRow }) {
  const [state, action] = useActionState(updateChildSettingsAction, undefined);
  const [pinState, pinAction] = useActionState(setChildPinAction, undefined);
  const [pending, startTransition] = useTransition();

  return (
    <Card className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-lg font-extrabold text-ink">{child.nickname}</h3>
        <span className="rounded-full bg-surface px-3 py-1 text-xs font-bold text-muted">
          {child.status.toLowerCase()}
        </span>
      </div>

      <form action={action} className="space-y-3">
        <input type="hidden" name="childId" value={child.id} />

        <div className="space-y-1">
          <label htmlFor={`nickname-${child.id}`} className="block text-sm font-bold text-ink">
            Nickname
          </label>
          <input
            id={`nickname-${child.id}`}
            name="nickname"
            defaultValue={child.nickname}
            maxLength={30}
            required
            className="mh-tap-sm w-full rounded-xl2 border-2 border-border bg-card px-4 text-base"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor={`theme-${child.id}`} className="block text-sm font-bold text-ink">
            Theme
          </label>
          <select
            id={`theme-${child.id}`}
            name="themeKey"
            defaultValue={child.themeKey}
            className="mh-tap-sm w-full rounded-xl2 border-2 border-border bg-card px-4 text-base capitalize"
          >
            {THEMES.map((theme) => (
              <option key={theme} value={theme}>
                {theme}
              </option>
            ))}
          </select>
        </div>

        <NumberRow
          name="dailyTaskTarget"
          label="Missions a day"
          defaultValue={child.dailyTaskTarget}
          min={1}
          max={20}
        />

        <ToggleRow
          name="reducedMotion"
          label="Reduce animation"
          hint="Also honoured automatically when the device asks for it."
          defaultChecked={child.reducedMotion}
        />
        <ToggleRow
          name="characterAutoApprove"
          label="Confirm character moments automatically"
          hint="Off is strongly recommended: a star should mean a grown-up noticed."
          defaultChecked={child.characterAutoApprove}
        />
        <ToggleRow
          name="notificationsEnabled"
          label="In-app notifications"
          defaultChecked={child.notificationsEnabled}
        />
        <ToggleRow name="soundEnabled" label="Sound" defaultChecked={child.soundEnabled} />

        {state?.error ? (
          <p role="alert" className="text-sm font-semibold text-star">
            {state.error}
          </p>
        ) : null}
        {state?.ok ? (
          <p role="status" className="text-sm font-semibold text-success">
            Saved.
          </p>
        ) : null}

        <SaveButton />
      </form>

      <form action={pinAction} className="space-y-2 border-t border-border pt-4">
        <input type="hidden" name="childId" value={child.id} />
        <label htmlFor={`pin-${child.id}`} className="block text-sm font-bold text-ink">
          PIN {child.pinRequired ? '(set)' : '(none)'}
          {child.pinLocked ? ' · locked out' : ''}
        </label>
        <div className="flex gap-2">
          <input
            id={`pin-${child.id}`}
            name="pin"
            inputMode="numeric"
            maxLength={6}
            placeholder={child.pinRequired ? 'New PIN, or blank to remove' : '4–6 digits'}
            className="mh-tap-sm flex-1 rounded-xl2 border-2 border-border bg-card px-4 text-base"
          />
          <PinButton />
        </div>
        <p className="text-xs text-muted">
          Saving also clears any lockout. PINs are stored hashed and never shown again.
        </p>
        {pinState?.error ? (
          <p role="alert" className="text-sm font-semibold text-star">
            {pinState.error}
          </p>
        ) : null}
        {pinState?.ok ? (
          <p role="status" className="text-sm font-semibold text-success">
            PIN updated.
          </p>
        ) : null}
      </form>

      <div className="flex flex-wrap gap-2 border-t border-border pt-4">
        {(['ACTIVE', 'PAUSED', 'ARCHIVED'] as const).map((status) => (
          <Button
            key={status}
            variant={child.status === status ? 'soft' : 'outline'}
            size="sm"
            disabled={pending || child.status === status}
            onClick={() =>
              startTransition(() => setChildStatusAction(child.id, status).then(() => undefined))
            }
          >
            {status === 'ACTIVE' ? 'Active' : status === 'PAUSED' ? 'Pause' : 'Archive'}
          </Button>
        ))}
      </div>
      <p className="text-xs text-muted">
        Archiving hides a child from the app. Nothing they earned is deleted.
      </p>
    </Card>
  );
}

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" size="block" disabled={pending}>
      {pending ? 'Saving…' : 'Save'}
    </Button>
  );
}

function PinButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" disabled={pending}>
      {pending ? '…' : 'Set'}
    </Button>
  );
}
