// The run-transcription action (bafft-wg1.8): wires a session to a
// TranscriptionProvider. Used both by the "Run transcription" button
// (routes/sessions.ts) and, when AUTO_TRANSCRIBE_ON_UPLOAD is on, run
// inline right after upload — same code path either way, only the trigger
// differs (see design spec, workflow B).
import { resolve } from "node:path";
import type { Session, TranscriptionProvider } from "@bafft/shared";
import { config } from "../config.js";
import { getSession, setSessionStatus, setTranscriptionOutcome } from "../db/sessions.js";
import { compileKeyterms } from "../db/entities.js";
import { replaceTranscriptWords } from "../db/transcript-words.js";

export class TranscriptionError extends Error {}

export async function runTranscription(sessionId: number, provider: TranscriptionProvider): Promise<Session> {
  const session = await getSession(sessionId);
  if (!session) throw new TranscriptionError(`session ${sessionId} not found`);
  if (!session.audioPath) throw new TranscriptionError(`session ${sessionId} has no audio uploaded`);

  await setSessionStatus(sessionId, "transcribing");
  try {
    const keyterms = await compileKeyterms();
    const words = await provider.transcribe(resolve(config.dataDir, session.audioPath), keyterms, {
      speakersExpected: session.speakersExpected ?? undefined,
    });
    await replaceTranscriptWords(sessionId, words);
    await setTranscriptionOutcome(sessionId, { provider: provider.name });
    return await setSessionStatus(sessionId, "transcribed");
  } catch (err) {
    // On failure the session returns to `uploaded` (not left stuck in
    // `transcribing`) so the "Run transcription" button reappears as the
    // retry action — no separate retry endpoint needed. The error is kept on
    // the session so an auto-transcribe failure isn't silently swallowed.
    await setTranscriptionOutcome(sessionId, { error: err instanceof Error ? err.message : String(err) });
    await setSessionStatus(sessionId, "uploaded");
    throw err;
  }
}
