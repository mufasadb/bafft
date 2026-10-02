// The vendor-agnostic ASR seam (bafft-wg1.4). Every ASR vendor sits behind
// TranscriptionProvider so vendor choice never touches the rest of the
// pipeline — downstream code (labelling UI, fixture harness) depends only
// on this interface, never a concrete vendor. See the milestone spec's
// "Open question: ASR vendor" for why this is deliberately left swappable.
import { z } from "zod";

export const WordSchema = z.object({
  text: z.string(),
  startMs: z.number().nonnegative(),
  endMs: z.number().nonnegative(),
  // 0-1. Confidence semantics differ per vendor; the "uncertain token"
  // threshold behaviour is expected to be revisited once one is chosen.
  confidence: z.number().min(0).max(1),
  // Raw diarisation label (e.g. "Speaker 1") — owner-renamable in the
  // labelling UI, not FK'd to entities this milestone.
  speakerLabel: z.string(),
});
export type Word = z.infer<typeof WordSchema>;

export interface TranscribeOptions {
  /** How many people are at the table, when the owner knows it. Vendors that take a speaker-count hint use it. */
  speakersExpected?: number;
}

export interface TranscriptionProvider {
  readonly name: string;
  /** keyterms is the compiled glossary alias list, used for keyterm/dictionary prompting. */
  transcribe(audioPath: string, keyterms: string[], options?: TranscribeOptions): Promise<Word[]>;
}
