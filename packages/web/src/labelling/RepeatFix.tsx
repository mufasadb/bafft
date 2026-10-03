import { useState } from "react";
import type { CorrectionOccurrence } from "@bafft/shared";
import { formatClock } from "./turns.js";

export function RepeatFix({ occurrences, text, onApply, onClose }: {
  occurrences: CorrectionOccurrence[];
  text: string;
  onApply: (occurrence: CorrectionOccurrence) => Promise<void>;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState(() => new Set(occurrences.map((o) => o.wordIds[0]!)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chosen = occurrences.filter((o) => selected.has(o.wordIds[0]!));

  async function apply() {
    setBusy(true);
    setError(null);
    try {
      // Each saved occurrence updates the transcript immediately. On failure,
      // it disappears from the offer so retry only saves the remaining ones.
      for (const occurrence of chosen) await onApply(occurrence);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="repeat-fix panel" aria-label="Other occurrences">
      <p>
        <strong>Also fix {occurrences.length} {occurrences.length === 1 ? "other" : "others"}</strong> to <q>{text}</q>?
      </p>
      <div className="repeat-fix-list">
        {occurrences.map((o) => (
          <label key={o.wordIds[0]}>
            <input
              type="checkbox"
              checked={selected.has(o.wordIds[0]!)}
              disabled={busy}
              onChange={(e) => setSelected((prev) => {
                const next = new Set(prev);
                if (e.target.checked) next.add(o.wordIds[0]!);
                else next.delete(o.wordIds[0]!);
                return next;
              })}
            />
            <time>{formatClock(o.startMs)}</time>{" "}
            <span>{o.context}</span>
          </label>
        ))}
      </div>
      {error && <p className="error">{error}</p>}
      <div className="word-fix-actions">
        <button className="primary" disabled={busy || chosen.length === 0} onClick={() => void apply()}>
          {busy ? "Applying…" : "Apply"}
        </button>
        <button disabled={busy} onClick={onClose}>Dismiss</button>
      </div>
    </section>
  );
}
