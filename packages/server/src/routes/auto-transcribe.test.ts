// AUTO_TRANSCRIBE_ON_UPLOAD needs to be set before config.ts's first
// evaluation (it's a plain env read, not a getter) — separate file from
// sessions.test.ts so that one's flag-off assumption isn't disturbed.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";

process.env.BAFFT_DATA_DIR = mkdtempSync(join(tmpdir(), "bafft-test-"));
process.env.AUTO_TRANSCRIBE_ON_UPLOAD = "true";

const { migrate } = await import("drizzle-orm/libsql/migrator");
const { db, client } = await import("../db/client.js");
const { config, ensureDataDirs } = await import("../config.js");
const { createApp } = await import("../app.js");
const { SessionSchema } = await import("@bafft/shared");

ensureDataDirs();
let baseUrl: string;
let server: import("node:http").Server;

before(async () => {
  await migrate(db, { migrationsFolder: config.migrationsDir });
  server = createApp().listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  client.close();
  rmSync(config.dataDir, { recursive: true, force: true });
});

test("AUTO_TRANSCRIBE_ON_UPLOAD=true runs transcription inline on upload, no extra click", async () => {
  assert.equal(config.autoTranscribeOnUpload, true);

  const form = new FormData();
  form.set("title", "Auto");
  form.set("sessionDate", "2026-09-13");
  form.set("audio", new Blob([new Uint8Array(10)]), "clip.wav");

  const res = await fetch(`${baseUrl}/api/sessions`, { method: "POST", body: form });
  assert.equal(res.status, 201);
  const session = SessionSchema.parse(await res.json());
  assert.equal(session.status, "transcribed");

  const words = await (await fetch(`${baseUrl}/api/sessions/${session.id}/words`)).json();
  assert.ok(Array.isArray(words) && words.length > 0);
});
