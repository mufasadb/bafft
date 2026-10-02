// Session domain model (bafft-wg1.7).
import { z } from "zod";

export const SESSION_STATUSES = ["uploaded", "transcribing", "transcribed", "labelled"] as const;
export const SessionStatusSchema = z.enum(SESSION_STATUSES);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

export const SessionSchema = z.object({
  id: z.number().int().positive(),
  campaignId: z.number().int().positive(),
  title: z.string().min(1),
  // Owner-picked date, stored as an ISO "YYYY-MM-DD" string (not a full
  // timestamp — this is "which session date", not "when was this recorded").
  sessionDate: z.string(),
  audioPath: z.string().nullable(),
  status: SessionStatusSchema,
  // People at the table (GM included), sent to ASR as a speaker-count hint.
  // Exact counts beat ranges on the wg1.6 fixtures; null = let the vendor guess.
  speakersExpected: z.number().int().positive().nullable(),
  // Which TranscriptionProvider produced the current words, so a confidence
  // threshold tuned for one vendor is never applied to another's scores.
  transcriptionProvider: z.string().nullable(),
  // The last failed run's message, cleared by the next successful one.
  transcriptionError: z.string().nullable(),
  // coerce: validates both raw DB rows (real Date objects) and parsed HTTP
  // JSON responses (ISO date strings — JSON has no native Date type).
  createdAt: z.coerce.date(),
});
export type Session = z.infer<typeof SessionSchema>;

export const SessionInputSchema = z.object({
  title: z.string().min(1),
  sessionDate: z.string().min(1),
  // Arrives as a multipart form string; blank means unknown. 20 is AssemblyAI's cap.
  speakersExpected: z.preprocess(
    (v) => (v === "" || v === undefined || v === null ? null : v),
    z.coerce.number().int().min(1).max(20).nullable(),
  ).default(null),
});
export type SessionInput = z.infer<typeof SessionInputSchema>;
