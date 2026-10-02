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
const { createSession, getSession, listSessions, setSessionAudioPath } = await import(
  "./sessions.js"
);

before(async () => {
  await migrate(db, { migrationsFolder: config.migrationsDir });
});

after(() => {
  client.close();
  rmSync(config.dataDir, { recursive: true, force: true });
});

test("a new session persists in status=uploaded with no audio path yet", async () => {
  const session = await createSession({ title: "Session 1", sessionDate: "2026-09-13" });
  assert.equal(session.status, "uploaded");
  assert.equal(session.audioPath, null);
  assert.equal(session.title, "Session 1");

  const readBack = await getSession(session.id);
  assert.equal(readBack?.status, "uploaded");
});

test("setSessionAudioPath updates the row", async () => {
  const session = await createSession({ title: "Session 2", sessionDate: "2026-09-14" });
  const updated = await setSessionAudioPath(session.id, `audio/${session.id}/clip.wav`);
  assert.equal(updated.audioPath, `audio/${session.id}/clip.wav`);
});

test("listSessions returns newest first", async () => {
  const a = await createSession({ title: "Older", sessionDate: "2026-01-01" });
  await new Promise((r) => setTimeout(r, 5));
  const b = await createSession({ title: "Newer", sessionDate: "2026-01-02" });
  const all = await listSessions();
  const ai = all.findIndex((s) => s.id === a.id);
  const bi = all.findIndex((s) => s.id === b.id);
  assert.ok(bi < ai, "newer session should come first");
});
