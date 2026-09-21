'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { spinAction, markSpinRevealedAction } from '@/features/reward-wheel/actions';
import type { SpinResult, WheelView } from '@/features/reward-wheel/types';

const SEGMENT_COLOURS = [
  '#4f46e5',
  '#0ea5e9',
  '#16a34a',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#0891b2',
  '#db2777',
];

const SPIN_MS = 3600;

/**
 * The wheel is a *replay*, not a decision.
 *
 * The server has already drawn the winner and written the RewardSpin row before
 * this component learns anything; all this code does is rotate to the angle of
 * the segment it was given (BR-46). There is no near-miss easing and no
 * casino styling — the rotation simply decelerates and stops (brief §42).
 */
export function RewardWheel({ wheel }: { wheel: WheelView }) {
  const [result, setResult] = useState<SpinResult | null>(null);
  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const segmentCount = Math.max(1, wheel.segments.length);
  const sliceAngle = 360 / segmentCount;

  const spin = useCallback(() => {
    setError(null);
    startTransition(async () => {
      const response = await spinAction(wheel.wheelId);
      if (response.error || !response.result) {
        setError(response.error ?? 'Something went wrong. Try again?');
        return;
      }

      const index = Number(response.result.segmentIndex);
      // Land with the winning slice's centre under the pointer at the top.
      const target = 360 * 5 - (index * sliceAngle + sliceAngle / 2);

      if (reducedMotion) {
        setRotation(target);
        setResult(response.result);
        void markSpinRevealedAction(response.result.spinId);
        return;
      }

      setSpinning(true);
      setRotation(target);
      timer.current = setTimeout(() => {
        setSpinning(false);
        setResult(response.result!);
        void markSpinRevealedAction(response.result!.spinId);
      }, SPIN_MS);
    });
  }, [reducedMotion, sliceAngle, wheel.wheelId]);

  return (
    <div className="space-y-5">
      <div className="relative mx-auto aspect-square w-full max-w-[320px]">
        <div
          aria-hidden
          className="absolute left-1/2 top-0 z-10 h-0 w-0 -translate-x-1/2 border-x-[12px] border-t-[20px] border-x-transparent border-t-ink"
        />
        <svg
          viewBox="0 0 200 200"
          className="h-full w-full drop-shadow-lg"
          style={{
            transform: `rotate(${rotation}deg)`,
            transition: spinning
              ? `transform ${SPIN_MS}ms cubic-bezier(0.15, 0.85, 0.2, 1)`
              : undefined,
          }}
          role="img"
          aria-label={`A wheel with ${segmentCount} rewards`}
        >
          {wheel.segments.map((segment, index) => (
            <path
              key={segment.id}
              d={slicePath(index, sliceAngle)}
              fill={SEGMENT_COLOURS[index % SEGMENT_COLOURS.length]}
              stroke="white"
              strokeWidth="1.5"
            />
          ))}
          <circle cx="100" cy="100" r="18" fill="white" />
        </svg>
      </div>

      <ol className="grid grid-cols-2 gap-2 text-sm">
        {wheel.segments.map((segment, index) => (
          <li key={segment.id} className="flex items-center gap-2">
            <span
              aria-hidden
              className="h-3 w-3 shrink-0 rounded-full"
              style={{ background: SEGMENT_COLOURS[index % SEGMENT_COLOURS.length] }}
            />
            <span className="truncate font-semibold text-ink">{segment.label}</span>
          </li>
        ))}
      </ol>

      {result ? (
        <div
          role="status"
          className="animate-pop-in rounded-xl2 border-2 border-success bg-success/10 p-6 text-center"
        >
          <p aria-hidden className="text-5xl">
            🎉
          </p>
          <p className="mt-2 text-sm font-black uppercase tracking-widest text-success">You won</p>
          <p className="text-2xl font-black text-ink">{result.label}</p>
          {result.pointsSpent > 0 ? (
            <p className="mt-2 text-sm text-muted">
              {result.pointsSpent} points spent · {result.balanceAfter} left
            </p>
          ) : null}
        </div>
      ) : (
        <>
          <Progress
            label="Points toward a spin"
            value={Math.min(wheel.balance, wheel.pointThreshold)}
            max={wheel.pointThreshold}
            caption={`${Math.min(wheel.balance, wheel.pointThreshold)} / ${wheel.pointThreshold}`}
          />
          {wheel.deductPoints ? (
            <p className="text-center text-sm text-muted">
              Costs {wheel.pointsCost} points · You have {wheel.balance}
            </p>
          ) : null}
          <Button
            variant="primary"
            size="block"
            disabled={!wheel.eligible || pending || spinning}
            onClick={spin}
          >
            {spinning ? 'Spinning…' : pending ? 'Just a moment…' : 'SPIN!'}
          </Button>
          {!wheel.eligible ? (
            <p className="text-center text-sm text-muted">{unavailableMessage(wheel)}</p>
          ) : null}
        </>
      )}

      {error ? (
        <p
          role="alert"
          className="rounded-xl2 bg-star/10 px-4 py-3 text-center text-sm font-semibold text-star"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** A pie slice from the centre, starting at 12 o'clock. */
function slicePath(index: number, sliceAngle: number): string {
  const start = (index * sliceAngle - 90) * (Math.PI / 180);
  const end = ((index + 1) * sliceAngle - 90) * (Math.PI / 180);
  const radius = 98;
  const x1 = 100 + radius * Math.cos(start);
  const y1 = 100 + radius * Math.sin(start);
  const x2 = 100 + radius * Math.cos(end);
  const y2 = 100 + radius * Math.sin(end);
  const largeArc = sliceAngle > 180 ? 1 : 0;
  return `M100,100 L${x1.toFixed(2)},${y1.toFixed(2)} A${radius},${radius} 0 ${largeArc},1 ${x2.toFixed(2)},${y2.toFixed(2)} Z`;
}

/** Plain facts only — no countdown pressure, no "last chance" (brief §42). */
function unavailableMessage(wheel: WheelView): string {
  switch (wheel.reason) {
    case 'BELOW_THRESHOLD':
    case 'INSUFFICIENT_POINTS':
      return `${wheel.pointsNeeded} more points to unlock a spin.`;
    case 'DAILY_LIMIT_REACHED':
      return 'Next spin available tomorrow.';
    case 'WEEKLY_LIMIT_REACHED':
      return 'Next spin available next week.';
    case 'COOLING_DOWN':
      return 'The wheel is resting. Try again a bit later.';
    default:
      return 'The wheel is not available right now.';
  }
}
