// Same hermetic-temp-dir pattern as db/entities.test.ts.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TranscriptionProvider } from "@bafft/shared";

process.env.BAFFT_DATA_DIR = mkdtempSync(join(tmpdir(), "bafft-test-"));

const { migrate } = await import("drizzle-orm/libsql/migrator");
const { db, client } = await import("../db/client.js");
const { config } = await import("../config.js");
const { createSession, getSession, setSessionAudioPath } = await import("../db/sessions.js");
const { listTranscriptWords } = await import("../db/transcript-words.js");
const { runTranscription, TranscriptionError } = await import("./run-transcription.js");
const { mockProvider, MOCK_WORDS } = await import("./mock-provider.js");

before(async () => {
  await migrate(db, { migrationsFolder: config.migrationsDir });
});

after(() => {
  client.close();
  rmSync(config.dataDir, { recursive: true, force: true });
});

async function newUploadedSession() {
  const session = await createSession({ title: "T", sessionDate: "2026-09-13" });
  return setSessionAudioPath(session.id, `audio/${session.id}/clip.wav`);
}

test("runTranscription: success path writes words, flags is_uncertain, ends transcribed", async () => {
  const session = await newUploadedSession();

  const updated = await runTranscription(session.id, mockProvider);
  assert.equal(updated.status, "transcribed");

  const words = await listTranscriptWords(session.id);
  assert.equal(words.length, MOCK_WORDS.length);
  // MOCK_WORDS includes a 0.32-confidence word ("tavern") — below the
  // default 0.4 threshold, so it should be flagged.
  const tavern = words.find((w) => w.text === "tavern");
  assert.equal(tavern?.isUncertain, true);
  const the = words.find((w) => w.text === "The");
  assert.equal(the?.isUncertain, false);
  assert.ok(words.every((w) => w.corrected === false));
});

test("runTranscription: failure reverts status to uploaded and leaves an error", async () => {
  const session = await newUploadedSession();
  const brokenProvider: TranscriptionProvider = {
    name: "broken",
    transcribe: async () => {
      throw new Error("vendor exploded");
    },
  };

  await assert.rejects(() => runTranscription(session.id, brokenProvider), /vendor exploded/);
  const after1 = await getSession(session.id);
  assert.equal(after1?.status, "uploaded");
});

test("runTranscription: rejects a session with no audio uploaded yet", async () => {
  const session = await createSession({ title: "No audio", sessionDate: "2026-09-13" });
  await assert.rejects(() => runTranscription(session.id, mockProvider), TranscriptionError);
});

test("runTranscription: a retry replaces, not duplicates, transcript_words", async () => {
  const session = await newUploadedSession();
  await runTranscription(session.id, mockProvider);
  await runTranscription(session.id, mockProvider);
  const words = await listTranscriptWords(session.id);
  assert.equal(words.length, MOCK_WORDS.length);
});

test("runTranscription: passes the table size through and records which provider ran", async () => {
  const created = await createSession({ title: "Table of 6", sessionDate: "2026-09-28", speakersExpected: 6 });
  const session = await setSessionAudioPath(created.id, `audio/${created.id}/clip.wav`);
  let seen: number | undefined;
  const spy: TranscriptionProvider = {
    name: "spy",
    transcribe: async (_path, _keyterms, options) => {
      seen = options?.speakersExpected;
      return MOCK_WORDS;
    },
  };

  const updated = await runTranscription(session.id, spy);
  assert.equal(seen, 6);
  assert.equal(updated.transcriptionProvider, "spy");
  assert.equal(updated.transcriptionError, null);
});

test("runTranscription: a failure's error is kept on the session and cleared by the next success", async () => {
  const session = await newUploadedSession();
  const broken: TranscriptionProvider = {
    name: "broken",
    transcribe: async () => {
      throw new Error("AssemblyAI POST failed (401)");
    },
  };

  await assert.rejects(() => runTranscription(session.id, broken));
  assert.equal((await getSession(session.id))?.transcriptionError, "AssemblyAI POST failed (401)");

  const retried = await runTranscription(session.id, mockProvider);
  assert.equal(retried.transcriptionError, null);
  assert.equal(retried.transcriptionProvider, "mock");
});
