// Typed query helpers over the sessions table.
import { desc, eq } from "drizzle-orm";
import type { Session, SessionInput, SessionStatus } from "@bafft/shared";
import { db } from "./client.js";
import { sessions } from "./schema.js";

function toSession(row: typeof sessions.$inferSelect): Session {
  return row;
}

export async function createSession(
  input: Omit<SessionInput, "speakersExpected"> & { speakersExpected?: number | null },
): Promise<Session> {
  const [row] = await db
    .insert(sessions)
    .values({ title: input.title, sessionDate: input.sessionDate, speakersExpected: input.speakersExpected ?? null })
    .returning();
  return toSession(row);
}

export async function getSession(id: number): Promise<Session | undefined> {
  const [row] = await db.select().from(sessions).where(eq(sessions.id, id));
  return row ? toSession(row) : undefined;
}

export async function setSessionAudioPath(id: number, audioPath: string): Promise<Session> {
  const [row] = await db.update(sessions).set({ audioPath }).where(eq(sessions.id, id)).returning();
  return toSession(row);
}

export async function setSessionStatus(id: number, status: SessionStatus): Promise<Session> {
  const [row] = await db.update(sessions).set({ status }).where(eq(sessions.id, id)).returning();
  return toSession(row);
}

/** Records the outcome of a transcription run: which provider succeeded, or why it failed. */
export async function setTranscriptionOutcome(
  id: number,
  outcome: { provider: string } | { error: string },
): Promise<Session> {
  const values =
    "provider" in outcome
      ? { transcriptionProvider: outcome.provider, transcriptionError: null }
      : { transcriptionError: outcome.error };
  const [row] = await db.update(sessions).set(values).where(eq(sessions.id, id)).returning();
  return toSession(row);
}

export async function listSessions(): Promise<Session[]> {
  // Ordered by id, not createdAt: id is monotonic and unambiguous even for
  // sessions created within the same clock tick, which createdAt isn't.
  const rows = await db.select().from(sessions).orderBy(desc(sessions.id));
  return rows.map(toSession);
}
