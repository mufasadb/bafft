// Groups a session's words into speaker turns for the labelling screen
// (bafft-wg1.9). A turn is a run of consecutive words from one speaker; a long
// pause inside a run starts a new turn too, so a GM monologue doesn't become
// one giant block (easier to read, and keeps each block cheap to lay out).
import type { TranscriptWord } from "@bafft/shared";

export interface Turn {
  /** stable across re-renders: the id of the turn's first word */
  key: number;
  speakerLabel: string;
  startMs: number;
  words: TranscriptWord[];
}

/** A gap this long between one speaker's words starts a new turn. */
export const PAUSE_BREAK_MS = 4000;

export function groupTurns(words: TranscriptWord[], pauseBreakMs = PAUSE_BREAK_MS): Turn[] {
  const turns: Turn[] = [];
  let current: Turn | undefined;
  let lastEndMs = 0;
  for (const word of words) {
    if (!current || word.speakerLabel !== current.speakerLabel || word.startMs - lastEndMs >= pauseBreakMs) {
      current = { key: word.id, speakerLabel: word.speakerLabel, startMs: word.startMs, words: [] };
      turns.push(current);
    }
    current.words.push(word);
    lastEndMs = word.endMs;
  }
  return turns;
}

/** ms → "h:mm:ss" */
export function formatClock(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
