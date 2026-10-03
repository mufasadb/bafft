// transcript_words domain model (bafft-wg1.8) — one row per ASR word,
// written by the run-transcription action and edited by the labelling UI.
import { z } from "zod";

export const TranscriptWordSchema = z.object({
  id: z.number().int().positive(),
  sessionId: z.number().int().positive(),
  // Raw diarisation label, e.g. "Speaker 1" — owner-renamable (wg1.12), not
  // FK'd to entities this milestone.
  speakerLabel: z.string(),
  text: z.string(),
  startMs: z.number().nonnegative(),
  endMs: z.number().nonnegative(),
  confidence: z.number().min(0).max(1),
  // Derived from a configurable confidence threshold at transcription time.
  isUncertain: z.boolean(),
  corrected: z.boolean(),
  // What the ASR wrote, kept from the first correction on (bafft-wg1.11).
  heardText: z.string().nullable(),
});
export type TranscriptWord = z.infer<typeof TranscriptWordSchema>;

// A run of words that's probably a misheard glossary name (bafft-wg1.15),
// e.g. "Hooper Duke" -> Hupperdook. Computed on read against the current
// glossary, not stored.
export const NameMatchSchema = z.object({
  wordIds: z.array(z.number().int().positive()).min(1),
  heard: z.string(),
  entityId: z.number().int().positive(),
  suggestion: z.string(),
  via: z.enum(["spelling", "sound", "sounds-like"]),
});
export type NameMatch = z.infer<typeof NameMatchSchema>;

// Correcting a word, or a run of adjacent words merged into one ("Hooper
// Duke" -> "Hupperdook"), on the labelling screen (bafft-wg1.11).
export const WordCorrectionSchema = z.object({
  wordIds: z.array(z.number().int().positive()).min(1),
  text: z.string().trim().min(1),
});
export type WordCorrection = z.infer<typeof WordCorrectionSchema>;

// What a correction means for the glossary:
// - "known": the new text is an existing name. `hint` says what happened to
//   the heard text: "added" as a sounds-like hint, so other sessions flag it
//   too; "already" known; or left out as "everyday" words ("acid"), which the
//   owner may still add, but then every "acid" would flag.
// - "unknown": it looks like a name nobody has entered; the owner is asked
//   whether to add it, and as what.
// - "none": an ordinary word.
export const GlossaryOutcomeSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("known"),
    entityId: z.number().int().positive(),
    name: z.string(),
    heard: z.string(),
    hint: z.enum(["added", "already", "everyday"]),
  }),
  z.object({ kind: z.literal("unknown"), name: z.string(), heard: z.string(), heardIsPlain: z.boolean() }),
  z.object({ kind: z.literal("none") }),
]);
export type GlossaryOutcome = z.infer<typeof GlossaryOutcomeSchema>;

export const CorrectionOccurrenceSchema = z.object({
  wordIds: z.array(z.number().int().positive()).min(1),
  startMs: z.number().nonnegative(),
  heard: z.string(),
  context: z.string(),
});
export type CorrectionOccurrence = z.infer<typeof CorrectionOccurrenceSchema>;

export const WordCorrectionResultSchema = z.object({
  word: TranscriptWordSchema,
  /** Words merged into `word` and gone from the transcript. */
  removedIds: z.array(z.number().int().positive()),
  glossary: GlossaryOutcomeSchema,
  /** Other uncorrected occurrences in this session (bafft-wg1.17). */
  occurrences: CorrectionOccurrenceSchema.array().optional(),
});
export type WordCorrectionResult = z.infer<typeof WordCorrectionResultSchema>;
