/** Draw Steel's 0-5 negotiation meters (Interest, Patience) as filled dots.
 * Display only: the starting values come from the attitude. */
export function Pips({ value, max = 5, label, title }: { value: number; max?: number; label: string; title?: string }) {
  return (
    <span className="pips" role="img" aria-label={`${label} ${value} of ${max}`} title={title}>
      {Array.from({ length: max }, (_, i) => (
        <span key={i} className={i < value ? "pip on" : "pip"} />
      ))}
    </span>
  );
}
