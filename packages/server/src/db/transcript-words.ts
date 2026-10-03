// Typed query helpers over the transcript_words table.
import { and, asc, eq, gte, inArray, lte, notInArray } from "drizzle-orm";
import type { TranscriptWord, Word } from "@bafft/shared";
import { config } from "../config.js";
import { db } from "./client.js";
import { transcriptWords } from "./schema.js";

/**
 * Replaces a session's transcript_words wholesale with freshly-transcribed
 * `words`, deriving is_uncertain from the configured confidence threshold.
 * A plain delete-then-insert (not wrapped in an explicit transaction —
 * single-user local tool, and a run-transcription retry is already the
 * unusual path): re-running transcription on retry replaces rather than
 * duplicates, so a session's words always reflect its latest ASR pass.
 */
export async function replaceTranscriptWords(sessionId: number, words: Word[]): Promise<TranscriptWord[]> {
  // One transaction (bafft-dat): a failed insert must not leave the session with no words.
  return db.transaction(async (tx) => {
    await tx.delete(transcriptWords).where(eq(transcriptWords.sessionId, sessionId));
    if (words.length === 0) return [];
    return tx
      .insert(transcriptWords)
      .values(
        words.map((w) => ({
          sessionId,
          speakerLabel: w.speakerLabel,
          text: w.text,
          startMs: w.startMs,
          endMs: w.endMs,
          confidence: w.confidence,
          isUncertain: w.confidence < config.uncertainConfidenceThreshold,
          corrected: false,
        })),
      )
      .returning();
  });
}

export async function listTranscriptWords(sessionId: number): Promise<TranscriptWord[]> {
  return db
    .select()
    .from(transcriptWords)
    .where(eq(transcriptWords.sessionId, sessionId))
    .orderBy(asc(transcriptWords.startMs));
}

export class CorrectionError extends Error {}

/**
 * The owner's correction of one word, or of a run of adjacent words that
 * become one ("Hooper Duke" -> "Hupperdook"; bafft-wg1.11). Saved on its own,
 * straight away: there is no batch save to lose. The first word takes the new
 * text and the run's full time span; the rest are deleted. What the ASR wrote
 * is kept in heard_text from the first correction on.
 */
export async function correctTranscriptWords(
  sessionId: number,
  wordIds: number[],
  text: string,
): Promise<{ word: TranscriptWord; removedIds: number[]; heard: string }> {
  return db.transaction(async (tx) => {
    const run = await tx
      .select()
      .from(transcriptWords)
      .where(and(eq(transcriptWords.sessionId, sessionId), inArray(transcriptWords.id, wordIds)))
      .orderBy(asc(transcriptWords.startMs), asc(transcriptWords.id));
    if (run.length !== new Set(wordIds).size) throw new CorrectionError("word not found in this session");
    const first = run[0]!;
    const last = run[run.length - 1]!;
    if (run.length > 1) {
      // Only neighbours merge: nothing else of this session may sit inside the run.
      const inside = await tx
        .select({ id: transcriptWords.id })
        .from(transcriptWords)
        .where(
          and(
            eq(transcriptWords.sessionId, sessionId),
            startsWithin(first.startMs, last.startMs),
            notInArray(transcriptWords.id, wordIds),
          ),
        );
      if (inside.length > 0) throw new CorrectionError("only adjacent words can be corrected together");
    }
    const heard = run.map((w) => w.heardText ?? w.text).join(" ");
    const [word] = await tx
      .update(transcriptWords)
      .set({
        text,
        endMs: Math.max(...run.map((w) => w.endMs)),
        corrected: true,
        heardText: heard,
      })
      .where(eq(transcriptWords.id, first.id))
      .returning();
    const removedIds = run.slice(1).map((w) => w.id);
    if (removedIds.length > 0) await tx.delete(transcriptWords).where(inArray(transcriptWords.id, removedIds));
    return { word: word!, removedIds, heard };
  });
}

const startsWithin = (fromMs: number, toMs: number) =>
  and(gte(transcriptWords.startMs, fromMs), lte(transcriptWords.startMs, toMs));
