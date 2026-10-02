// Click-to-hear timing for the labelling screen (bafft-wg1.10). Clicking a word
// plays a short clip around it: a little lead-in so the word isn't clipped,
// then a few seconds of context. Change these two numbers to retune it.
export const CLIP_LEAD_MS = 500;
export const CLIP_LENGTH_MS = 4000;

/** The clip to play for a word starting at `startMs`, in seconds for HTMLAudioElement. */
export function clipWindow(startMs: number, leadMs = CLIP_LEAD_MS, lengthMs = CLIP_LENGTH_MS) {
  const fromMs = Math.max(0, startMs - leadMs);
  return { fromSec: fromMs / 1000, toSec: (fromMs + lengthMs) / 1000 };
}

/**
 * Index of the word being spoken at `ms`: the last word starting at or before
 * it. `starts` must be ascending (words come back ordered by time). -1 before
 * the first word. Binary search, since it runs every frame on ~40k words.
 */
export function wordIndexAt(starts: number[], ms: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (starts[mid]! <= ms) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}
