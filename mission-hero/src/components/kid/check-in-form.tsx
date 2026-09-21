'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { STREAK } from '@/domain/copy';
import { checkInAction } from '@/features/check-ins/actions';

const MOODS = [
  { key: 'great', emoji: '🤩', label: 'Great' },
  { key: 'good', emoji: '🙂', label: 'Good' },
  { key: 'ok', emoji: '😐', label: 'OK' },
  { key: 'low', emoji: '😔', label: 'A bit low' },
  { key: 'tired', emoji: '🥱', label: 'Tired' },
] as const;

interface CheckInFormProps {
  alreadyDone: {
    mood: string | null;
    goalText: string | null;
    gratitudeText: string | null;
  } | null;
  xpOnOffer: number;
  pointsOnOffer: number;
  streakDays: number;
}

/**
 * One check-in per family-local day (BR-25). When today's is already done the
 * form does not re-arm — a second submit would award nothing anyway, and
 * offering a button that quietly does nothing would be a small lie.
 */
export function CheckInForm({
  alreadyDone,
  xpOnOffer,
  pointsOnOffer,
  streakDays,
}: CheckInFormProps) {
  const [mood, setMood] = useState<string | null>(alreadyDone?.mood ?? null);
  const [goal, setGoal] = useState(alreadyDone?.goalText ?? '');
  const [gratitude, setGratitude] = useState(alreadyDone?.gratitudeText ?? '');
  const [done, setDone] = useState(Boolean(alreadyDone));
  const [awarded, setAwarded] = useState<{ xp: number; points: number; streak: number } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (done) {
    return (
      <div className="space-y-4">
        <div
          role="status"
          className="animate-pop-in rounded-xl2 border-2 border-success bg-success/10 p-6 text-center"
        >
          <p aria-hidden className="text-5xl">
            {MOODS.find((m) => m.key === mood)?.emoji ?? '✅'}
          </p>
          <p className="mt-2 text-xl font-black text-ink">You&apos;ve checked in today!</p>
          {awarded ? (
            <p className="mt-1 font-bold text-xp">
              +{awarded.xp} XP
              {awarded.points > 0 ? ` · +${awarded.points} points` : ''}
            </p>
          ) : null}
          <p className="mt-2 text-sm text-muted">
            {(awarded?.streak ?? streakDays) > 0
              ? STREAK.showingUp(awarded?.streak ?? streakDays)
              : STREAK.keepGoing}
          </p>
        </div>

        {goal ? <Recap title="Today's goal" body={goal} /> : null}
        {gratitude ? <Recap title="Grateful for" body={gratitude} /> : null}

        <p className="text-center text-sm text-muted">Come back tomorrow for the next one.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <fieldset>
        <legend className="text-lg font-extrabold text-ink">How are you feeling?</legend>
        <ul className="mt-3 flex flex-wrap gap-2">
          {MOODS.map((option) => (
            <li key={option.key}>
              <button
                type="button"
                aria-pressed={mood === option.key}
                onClick={() => setMood(option.key)}
                className={`mh-tap flex flex-col items-center justify-center gap-1 rounded-xl2 border-2 px-4 ${
                  mood === option.key ? 'border-brand bg-brand-soft' : 'border-border bg-card'
                }`}
              >
                <span aria-hidden className="text-2xl">
                  {option.emoji}
                </span>
                <span className="text-xs font-bold text-ink">{option.label}</span>
              </button>
            </li>
          ))}
        </ul>
      </fieldset>

      <div className="space-y-2">
        <label htmlFor="goal" className="block text-lg font-extrabold text-ink">
          What are you going to crush today?
        </label>
        <textarea
          id="goal"
          value={goal}
          onChange={(event) => setGoal(event.target.value)}
          rows={2}
          maxLength={200}
          className="w-full rounded-xl2 border-2 border-border bg-card p-3 text-base"
          placeholder="Finish my reading before dinner."
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="gratitude" className="block text-lg font-extrabold text-ink">
          What are you thankful for?
        </label>
        <textarea
          id="gratitude"
          value={gratitude}
          onChange={(event) => setGratitude(event.target.value)}
          rows={2}
          maxLength={200}
          className="w-full rounded-xl2 border-2 border-border bg-card p-3 text-base"
          placeholder="My sister helped me with my bag."
        />
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-xl2 bg-star/10 px-4 py-3 text-sm font-semibold text-star"
        >
          {error}
        </p>
      ) : null}

      <Button
        variant="primary"
        size="block"
        disabled={pending || !mood}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const response = await checkInAction({
              mood: mood ?? undefined,
              goalText: goal.trim() || undefined,
              gratitudeText: gratitude.trim() || undefined,
            });
            if (response.error || !response.result) {
              setError(response.error ?? 'Something went wrong. Try again?');
              return;
            }
            setAwarded({
              xp: response.result.xpAwarded,
              points: response.result.pointsAwarded,
              streak: response.result.streakDays,
            });
            setDone(true);
          });
        }}
      >
        {pending ? 'Checking in…' : `CHECK IN${xpOnOffer > 0 ? ` · +${xpOnOffer} XP` : ''}`}
      </Button>
      {pointsOnOffer > 0 ? (
        <p className="text-center text-sm text-muted">Also worth +{pointsOnOffer} points today.</p>
      ) : null}
      {!mood ? (
        <p className="text-center text-sm text-muted">Pick how you&apos;re feeling first.</p>
      ) : null}
    </div>
  );
}

function Recap({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl2 border-2 border-border bg-card p-4">
      <p className="text-xs font-bold uppercase tracking-wide text-muted">{title}</p>
      <p className="mt-1 text-ink">{body}</p>
    </div>
  );
}
