// Same hermetic-temp-dir pattern as entities.test.ts — see its header comment.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.BAFFT_DATA_DIR = mkdtempSync(join(tmpdir(), "bafft-test-"));

const { migrate } = await import("drizzle-orm/libsql/migrator");
const { db, client } = await import("./client.js");
const { config } = await import("../config.js");
const { createSession } = await import("./sessions.js");
const { replaceTranscriptWords, listTranscriptWords } = await import("./transcript-words.js");

before(async () => {
  await migrate(db, { migrationsFolder: config.migrationsDir });
});

after(() => {
  client.close();
  rmSync(config.dataDir, { recursive: true, force: true });
});

const word = (text: string, startMs: number) => ({ speakerLabel: "A", text, startMs, endMs: startMs + 200, confidence: 0.9 });

test("replacing words swaps the old pass for the new one", async () => {
  const session = await createSession({ title: "Replace", sessionDate: "2026-10-03" });
  await replaceTranscriptWords(session.id, [word("first", 0), word("pass", 300)]);
  await replaceTranscriptWords(session.id, [word("second", 0)]);
  assert.deepEqual((await listTranscriptWords(session.id)).map((w) => w.text), ["second"]);
});

test("a failed insert keeps the words the session already had (bafft-dat)", async () => {
  const session = await createSession({ title: "Rollback", sessionDate: "2026-10-03" });
  await replaceTranscriptWords(session.id, [word("kept", 0), word("words", 300)]);
  // text is NOT NULL, so the insert fails after the delete has run.
  const broken = [word("new", 0), { ...word("x", 300), text: null as unknown as string }];
  await assert.rejects(replaceTranscriptWords(session.id, broken));
  assert.deepEqual((await listTranscriptWords(session.id)).map((w) => w.text), ["kept", "words"]);
});
