interface LevelRingProps {
  levelNumber: number;
  levelName: string;
  progress: number;
  xpToNext: number;
}

/**
 * The level ring. Drawn as SVG so it scales crisply and the progress is
 * available to assistive technology as text rather than only as an arc.
 */
export function LevelRing({ levelNumber, levelName, progress, xpToNext }: LevelRingProps) {
  const radius = 26;
  const circumference = 2 * Math.PI * radius;
  const dash = circumference * Math.min(1, Math.max(0, progress));

  return (
    <div className="flex items-center gap-3">
      <svg
        width="64"
        height="64"
        viewBox="0 0 64 64"
        role="img"
        aria-label={`Level ${levelNumber}, ${Math.round(progress * 100)}% to the next level`}
      >
        <circle
          cx="32"
          cy="32"
          r={radius}
          fill="none"
          stroke="rgb(255 255 255 / 0.25)"
          strokeWidth="6"
        />
        <circle
          cx="32"
          cy="32"
          r={radius}
          fill="none"
          stroke="white"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference}`}
          transform="rotate(-90 32 32)"
        />
        <text x="32" y="38" textAnchor="middle" className="fill-white text-xl font-extrabold">
          {levelNumber}
        </text>
      </svg>
      <div>
        <p className="text-xs font-bold uppercase tracking-widest text-white/80">
          Level {levelNumber}
        </p>
        <p className="text-lg font-extrabold leading-tight text-white">{levelName}</p>
        <p className="text-xs text-white/80">
          {xpToNext > 0 ? `${xpToNext} XP to the next level` : 'Top level reached!'}
        </p>
      </div>
    </div>
  );
}
