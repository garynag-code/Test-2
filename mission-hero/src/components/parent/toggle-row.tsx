/** A labelled switch. Kept as a component so every toggle is equally reachable. */
export function ToggleRow({
  name,
  label,
  hint,
  defaultChecked,
}: {
  name: string;
  label: string;
  hint?: string;
  defaultChecked: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl2 border-2 border-border p-3">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="mt-0.5 h-5 w-5 shrink-0 accent-[rgb(var(--mh-brand))]"
      />
      <span className="min-w-0">
        <span className="block text-sm font-bold text-ink">{label}</span>
        {hint ? <span className="block text-xs text-muted">{hint}</span> : null}
      </span>
    </label>
  );
}

export function NumberRow({
  name,
  label,
  hint,
  defaultValue,
  min = 0,
  max = 1000,
}: {
  name: string;
  label: string;
  hint?: string;
  defaultValue: number;
  min?: number;
  max?: number;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={name} className="block text-sm font-bold text-ink">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type="number"
        min={min}
        max={max}
        defaultValue={defaultValue}
        aria-describedby={hint ? `${name}-hint` : undefined}
        className="mh-tap-sm w-full rounded-xl2 border-2 border-border bg-card px-4 text-base"
      />
      {hint ? (
        <p id={`${name}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
