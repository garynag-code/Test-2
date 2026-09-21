/**
 * The adventure map (brief §26).
 *
 * A visual reading of the week the child has actually had: each approved
 * mission moves them one step along a path of named landmarks. Purely
 * motivational — no value is created here, and the maths is pure so the path
 * renders identically on every device.
 */

export interface MapStop {
  index: number;
  name: string;
  icon: string;
  /** Steps needed to arrive here. */
  requiredSteps: number;
  reached: boolean;
  current: boolean;
}

const LANDMARKS = [
  { name: 'Start', icon: '🚩' },
  { name: 'Meadow', icon: '🌾' },
  { name: 'Forest', icon: '🌲' },
  { name: 'River', icon: '🌉' },
  { name: 'Caves', icon: '🕳️' },
  { name: 'Mountain', icon: '⛰️' },
  { name: 'Castle', icon: '🏰' },
  { name: 'Treasure', icon: '💎' },
] as const;

export interface AdventurePath {
  stops: MapStop[];
  steps: number;
  totalSteps: number;
  /** 0..1 along the whole path. */
  progress: number;
  nextStopName: string | null;
  stepsToNextStop: number;
}

/**
 * Lays `steps` completed missions onto the landmark path.
 *
 * `totalSteps` is the week's target, so the map fills exactly as the weekly
 * quest does — two views of one truth rather than two competing scores.
 */
export function buildAdventurePath(steps: number, totalSteps: number): AdventurePath {
  const safeTotal = Math.max(1, Math.floor(totalSteps));
  const safeSteps = Math.max(0, Math.min(Math.floor(steps), safeTotal));

  const stops: MapStop[] = LANDMARKS.map((landmark, index) => {
    // The first landmark is always reached: a child who has started is on the map.
    const requiredSteps = Math.round((index / (LANDMARKS.length - 1)) * safeTotal);
    return {
      index,
      name: landmark.name,
      icon: landmark.icon,
      requiredSteps,
      reached: safeSteps >= requiredSteps,
      current: false,
    };
  });

  const lastReached = [...stops].reverse().find((stop) => stop.reached);
  if (lastReached) stops[lastReached.index]!.current = true;

  const nextStop = stops.find((stop) => !stop.reached) ?? null;

  return {
    stops,
    steps: safeSteps,
    totalSteps: safeTotal,
    progress: safeSteps / safeTotal,
    nextStopName: nextStop?.name ?? null,
    stepsToNextStop: nextStop ? Math.max(0, nextStop.requiredSteps - safeSteps) : 0,
  };
}
