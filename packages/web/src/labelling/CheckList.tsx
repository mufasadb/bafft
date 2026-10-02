// The "Check names" dropdown (bafft-wg1.14, the owner's pick of the Muse's
// widescreen mockups): opens over the top-right of the transcript, so the
// text keeps the full width. Names first; very low confidence is one click away.
import { useEffect, useState } from "react";
import type { Check } from "./checks.js";
import { formatClock } from "./turns.js";

export function CheckList({
  checks,
  onJump,
  onClose,
}: {
  checks: Check[];
  onJump: (check: Check) => void;
  onClose: () => void;
}) {
  const names = checks.filter((c) => c.kind === "name");
  const low = checks.filter((c) => c.kind === "low-confidence");
  const [tab, setTab] = useState<Check["kind"]>(names.length > 0 || low.length === 0 ? "name" : "low-confidence");
  const shown = tab === "name" ? names : low;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="check-list" role="dialog" aria-label="Places to check">
      <div className="check-tabs" role="tablist">
        <button role="tab" aria-selected={tab === "name"} onClick={() => setTab("name")}>
          Possible names ({names.length})
        </button>
        <button role="tab" aria-selected={tab === "low-confidence"} onClick={() => setTab("low-confidence")}>
          Very low confidence ({low.length})
        </button>
      </div>
      {shown.length === 0 ? (
        <p className="hint">{tab === "name" ? "No possible misheard names." : "No very low confidence words."}</p>
      ) : (
        <ol className="check-rows">
          {shown.map((c) => (
            <li key={`${c.kind}-${c.wordId}`}>
              <button className={`check-row ${c.kind}`} onClick={() => onJump(c)}>
                <time>{formatClock(c.startMs)}</time>
                <span className="heard">{c.heard}</span>
                <span className="suggestion">{c.suggestion ?? "—"}</span>
                <span className="context">
                  …{c.before} <mark>{c.heard}</mark> {c.after}…
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
