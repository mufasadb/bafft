// The "Check names" list (bafft-wg1.14): every place worth a listen, in time
// order. Possible misheard names (wg1.15) are what the owner is there for;
// very-low-confidence words (wg1.16) are the quieter, optional kind.
import type { NameMatch, TranscriptWord } from "@bafft/shared";

export interface Check {
  kind: "name" | "low-confidence";
  /** The first word of the flagged run: where "jump" lands. */
  wordId: number;
  startMs: number;
  heard: string;
  suggestion?: string;
  /** A few words either side, so a row reads without jumping to it. */
  before: string;
  after: string;
}

const CONTEXT_WORDS = 6;

export function buildChecks(words: TranscriptWord[], nameMatches: NameMatch[]): Check[] {
  const indexOf = new Map(words.map((w, i) => [w.id, i]));
  const context = (first: number, last: number) => ({
    before: words.slice(Math.max(0, first - CONTEXT_WORDS), first).map((w) => w.text).join(" "),
    after: words.slice(last + 1, last + 1 + CONTEXT_WORDS).map((w) => w.text).join(" "),
  });

  const checks: Check[] = [];
  const inNameMatch = new Set<number>();
  for (const m of nameMatches) {
    const idx = m.wordIds.map((id) => indexOf.get(id)).filter((i) => i !== undefined);
    if (idx.length === 0) continue;
    m.wordIds.forEach((id) => inNameMatch.add(id));
    const first = Math.min(...idx);
    checks.push({
      kind: "name",
      wordId: words[first]!.id,
      startMs: words[first]!.startMs,
      heard: m.heard,
      suggestion: m.suggestion,
      ...context(first, Math.max(...idx)),
    });
  }
  words.forEach((w, i) => {
    if (!w.isUncertain || w.corrected || inNameMatch.has(w.id)) return;
    checks.push({ kind: "low-confidence", wordId: w.id, startMs: w.startMs, heard: w.text, ...context(i, i) });
  });
  return checks.sort((a, b) => a.startMs - b.startMs);
}
