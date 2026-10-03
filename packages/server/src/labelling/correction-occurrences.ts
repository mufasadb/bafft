import type { CorrectionOccurrence, TranscriptWord } from "@bafft/shared";

// Trim punctuation at word edges, preserving spelling inside a word.
const tokens = (text: string) => text.toLowerCase().trim().split(/\s+/)
  .map((s) => s.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""));

const neighbours = (a: TranscriptWord, b: TranscriptWord) =>
  a.speakerLabel === b.speakerLabel && b.startMs - a.endMs < 4000;

/** Exact heard-text matches, including adjacent runs that will merge. */
export function findCorrectionOccurrences(words: TranscriptWord[], heard: string): CorrectionOccurrence[] {
  const target = tokens(heard);
  if (target.some((t) => !t)) return [];
  const normalized = words.map((w) => tokens(w.text));
  const matches: CorrectionOccurrence[] = [];
  for (let i = 0; i < words.length; i++) {
    let offset = 0;
    for (let j = i; j < words.length; j++) {
      const word = words[j]!;
      if (word.corrected || (j > i && !neighbours(words[j - 1]!, word))) break;
      const pieces = normalized[j]!;
      if (pieces.some((t, k) => !t || t !== target[offset + k])) break;
      offset += pieces.length;
      if (offset !== target.length) continue;
      let from = i;
      let to = j;
      while (from > Math.max(0, i - 3) && neighbours(words[from - 1]!, words[from]!)) from--;
      while (to < Math.min(words.length - 1, j + 3) && neighbours(words[to]!, words[to + 1]!)) to++;
      const run = words.slice(i, j + 1);
      matches.push({
        wordIds: run.map((w) => w.id),
        startMs: words[i]!.startMs,
        heard: run.map((w) => w.text).join(" "),
        context: words.slice(from, to + 1).map((w) => w.text).join(" "),
      });
      i = j; // Offers must not overlap: each can be applied independently.
      break;
    }
  }
  return matches;
}
