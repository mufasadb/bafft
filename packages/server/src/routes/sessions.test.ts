// Real HTTP integration test: spins up the actual Express app on an
// ephemeral port and posts real multipart/form-data (native fetch +
// FormData + Blob — no extra test-http dependency needed). Same
// hermetic-temp-dir pattern as db/entities.test.ts.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { EntitySchema, NameMatchSchema, SessionSchema, SpeakerSchema, TranscriptWordSchema, WordCorrectionResultSchema } from "@bafft/shared";

process.env.BAFFT_DATA_DIR = mkdtempSync(join(tmpdir(), "bafft-test-"));

const { migrate } = await import("drizzle-orm/libsql/migrator");
const { db, client } = await import("../db/client.js");
const { config, ensureDataDirs } = await import("../config.js");
const { createApp } = await import("../app.js");

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

test("POST /api/sessions creates a session and stores the audio file", async () => {
  const form = new FormData();
  form.set("title", "Session 1");
  form.set("sessionDate", "2026-09-13");
  // A "large-ish" fake clip — big enough to exercise real disk streaming,
  // small enough to keep the test fast.
  const bytes = new Uint8Array(5 * 1024 * 1024).fill(7);
  form.set("audio", new Blob([bytes], { type: "audio/wav" }), "session1.wav");

  const res = await fetch(`${baseUrl}/api/sessions`, { method: "POST", body: form });
  assert.equal(res.status, 201);
  const session = SessionSchema.parse(await res.json());
  assert.equal(session.status, "uploaded");
  assert.equal(session.title, "Session 1");
  assert.equal(session.audioPath, `audio/${session.id}/session1.wav`);

  const onDisk = join(config.audioDir, String(session.id), "session1.wav");
  assert.ok(existsSync(onDisk), "uploaded audio should be moved to its final data/audio/{id}/ home");
  assert.equal(readFileSync(onDisk).length, bytes.length);

  const list = SessionSchema.array().parse(await (await fetch(`${baseUrl}/api/sessions`)).json());
  assert.ok(list.some((s) => s.id === session.id));
});

test("POST /api/sessions without an audio file is rejected", async () => {
  const form = new FormData();
  form.set("title", "No audio");
  form.set("sessionDate", "2026-09-13");
  const res = await fetch(`${baseUrl}/api/sessions`, { method: "POST", body: form });
  assert.equal(res.status, 400);
});

test("POST /api/sessions/:id/transcribe runs the mock provider end to end", async () => {
  const form = new FormData();
  form.set("title", "Transcribe me");
  form.set("sessionDate", "2026-09-13");
  form.set("audio", new Blob([new Uint8Array(10)]), "clip.wav");
  const created = SessionSchema.parse(await (await fetch(`${baseUrl}/api/sessions`, { method: "POST", body: form })).json());
  assert.equal(created.status, "uploaded"); // AUTO_TRANSCRIBE_ON_UPLOAD is off by default

  const res = await fetch(`${baseUrl}/api/sessions/${created.id}/transcribe`, { method: "POST" });
  assert.equal(res.status, 200);
  const transcribed = SessionSchema.parse(await res.json());
  assert.equal(transcribed.status, "transcribed");

  const words = await (await fetch(`${baseUrl}/api/sessions/${created.id}/words`)).json();
  assert.ok(Array.isArray(words) && words.length > 0);
});

test("GET /api/sessions/:id/name-matches flags words close to a glossary name", async () => {
  const form = new FormData();
  form.set("title", "Name matches");
  form.set("sessionDate", "2026-09-29");
  form.set("audio", new Blob([new Uint8Array(10)]), "clip.wav");
  const created = SessionSchema.parse(await (await fetch(`${baseUrl}/api/sessions`, { method: "POST", body: form })).json());
  await fetch(`${baseUrl}/api/sessions/${created.id}/transcribe`, { method: "POST" });
  // The mock transcript says "tavern"; a glossary place called "Taverne" is one letter off.
  const entity = await fetch(`${baseUrl}/api/entities`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "location", name: "Taverne" }),
  });
  assert.equal(entity.status, 201);

  const words = (await (await fetch(`${baseUrl}/api/sessions/${created.id}/words`)).json()) as { id: number; text: string }[];
  const matches = NameMatchSchema.array().parse(
    await (await fetch(`${baseUrl}/api/sessions/${created.id}/name-matches`)).json(),
  );
  assert.deepEqual(
    matches.map((m) => [m.heard, m.suggestion, m.wordIds]),
    [["tavern", "Taverne", [words.find((w) => w.text === "tavern")!.id]]],
  );
});

test("POST /api/sessions/:id/transcribe on an unknown session returns a visible error, not a 500", async () => {
  const res = await fetch(`${baseUrl}/api/sessions/999999/transcribe`, { method: "POST" });
  assert.equal(res.status, 422);
  const body = (await res.json()) as { error?: string };
  assert.ok(body.error);
});

test("POST /api/sessions without a title is rejected and cleans up the uploaded temp file", async () => {
  const form = new FormData();
  form.set("sessionDate", "2026-09-13");
  form.set("audio", new Blob([new Uint8Array(10)]), "clip.wav");
  const res = await fetch(`${baseUrl}/api/sessions`, { method: "POST", body: form });
  assert.equal(res.status, 400);
});

test("POST /api/sessions stores the table size, and a blank one as unknown", async () => {
  async function create(speakersExpected: string) {
    const form = new FormData();
    form.set("title", "Table size");
    form.set("sessionDate", "2026-09-28");
    form.set("speakersExpected", speakersExpected);
    form.set("audio", new Blob([new Uint8Array(16)], { type: "audio/wav" }), "t.wav");
    return fetch(`${baseUrl}/api/sessions`, { method: "POST", body: form });
  }
  assert.equal(SessionSchema.parse(await (await create("6")).json()).speakersExpected, 6);
  assert.equal(SessionSchema.parse(await (await create("")).json()).speakersExpected, null);
  assert.equal((await create("0")).status, 400);
});

test("GET /api/sessions/:id returns one session, 404 for an unknown one", async () => {
  const form = new FormData();
  form.set("title", "Fetch me");
  form.set("sessionDate", "2026-09-28");
  form.set("audio", new Blob([new Uint8Array(16)], { type: "audio/wav" }), "f.wav");
  const created = SessionSchema.parse(await (await fetch(`${baseUrl}/api/sessions`, { method: "POST", body: form })).json());

  const res = await fetch(`${baseUrl}/api/sessions/${created.id}`);
  assert.equal(res.status, 200);
  assert.equal(SessionSchema.parse(await res.json()).title, "Fetch me");
  assert.equal((await fetch(`${baseUrl}/api/sessions/999999`)).status, 404);
});

test("GET /api/sessions/:id/audio serves the file with HTTP range support", async () => {
  const bytes = new Uint8Array(1000).map((_, i) => i % 256);
  const form = new FormData();
  form.set("title", "Seekable");
  form.set("sessionDate", "2026-09-28");
  form.set("audio", new Blob([bytes], { type: "audio/wav" }), "seek.wav");
  const created = SessionSchema.parse(await (await fetch(`${baseUrl}/api/sessions`, { method: "POST", body: form })).json());

  const full = await fetch(`${baseUrl}/api/sessions/${created.id}/audio`);
  assert.equal(full.status, 200);
  assert.equal(full.headers.get("accept-ranges"), "bytes");
  assert.equal((await full.arrayBuffer()).byteLength, 1000);

  const part = await fetch(`${baseUrl}/api/sessions/${created.id}/audio`, { headers: { Range: "bytes=100-199" } });
  assert.equal(part.status, 206);
  assert.deepEqual([...new Uint8Array(await part.arrayBuffer())], [...bytes.slice(100, 200)]);

  assert.equal((await fetch(`${baseUrl}/api/sessions/999999/audio`)).status, 404);
});

// bafft-wg1.11: corrections on the labelling screen.
async function sessionWithWords(texts: string[]) {
  const form = new FormData();
  form.set("title", "Corrections");
  form.set("sessionDate", "2026-10-02");
  form.set("audio", new Blob([new Uint8Array(10)]), "clip.wav");
  const created = SessionSchema.parse(await (await fetch(`${baseUrl}/api/sessions`, { method: "POST", body: form })).json());
  const { replaceTranscriptWords } = await import("../db/transcript-words.js");
  const words = await replaceTranscriptWords(
    created.id,
    texts.map((text, i) => ({ text, speakerLabel: "Speaker A", startMs: i * 500, endMs: i * 500 + 400, confidence: 0.9 })),
  );
  return { sessionId: created.id, words };
}

async function correct(sessionId: number, wordIds: number[], text: string) {
  return fetch(`${baseUrl}/api/sessions/${sessionId}/words`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wordIds, text }),
  });
}

async function createEntity(body: object) {
  const res = await fetch(`${baseUrl}/api/entities`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return EntitySchema.parse(await res.json());
}

test("PATCH /api/sessions/:id/words saves a correction at once and keeps what was heard", async () => {
  const { sessionId, words } = await sessionWithWords(["we", "sail", "tomorow"]);
  const res = await correct(sessionId, [words[2]!.id], "tomorrow");
  assert.equal(res.status, 200);
  const result = WordCorrectionResultSchema.parse(await res.json());
  assert.deepEqual(result.glossary, { kind: "none" });
  assert.deepEqual(result.removedIds, []);

  const stored = TranscriptWordSchema.array().parse(await (await fetch(`${baseUrl}/api/sessions/${sessionId}/words`)).json());
  assert.deepEqual(
    stored.map((w) => [w.text, w.corrected, w.heardText]),
    [["we", false, null], ["sail", false, null], ["tomorrow", true, "tomorow"]],
  );

  // A second fix keeps the ASR's original, not the first fix.
  await correct(sessionId, [words[2]!.id], "tomorrow!");
  const again = TranscriptWordSchema.array().parse(await (await fetch(`${baseUrl}/api/sessions/${sessionId}/words`)).json());
  assert.equal(again[2]!.heardText, "tomorow");
});

test("PATCH /api/sessions/:id/words merges adjacent words and teaches a known name what it was heard as", async () => {
  const hupperdook = await createEntity({ type: "location", name: "Hupperdook" });
  const { sessionId, words } = await sessionWithWords(["off", "to", "Hooper", "Duke", "tonight"]);
  const other = await sessionWithWords(["Hooper", "Duke", "again"]);

  const result = WordCorrectionResultSchema.parse(
    await (await correct(sessionId, [words[2]!.id, words[3]!.id], "Hupperdook")).json(),
  );
  assert.deepEqual(result.removedIds, [words[3]!.id]);
  assert.equal(result.word.startMs, words[2]!.startMs);
  assert.equal(result.word.endMs, words[3]!.endMs);
  assert.deepEqual(result.glossary, {
    kind: "known",
    entityId: hupperdook.id,
    name: "Hupperdook",
    heard: "Hooper Duke",
    hint: "added",
  });

  const stored = TranscriptWordSchema.array().parse(await (await fetch(`${baseUrl}/api/sessions/${sessionId}/words`)).json());
  assert.deepEqual(stored.map((w) => w.text), ["off", "to", "Hupperdook", "tonight"]);
  const entity = EntitySchema.parse(await (await fetch(`${baseUrl}/api/entities/${hupperdook.id}`)).json());
  assert.deepEqual(entity.soundsLike, ["Hooper Duke"]);

  // Another session's words are untouched, only flagged by the new hint.
  const otherWords = TranscriptWordSchema.array().parse(
    await (await fetch(`${baseUrl}/api/sessions/${other.sessionId}/words`)).json(),
  );
  assert.deepEqual(otherWords.map((w) => [w.text, w.corrected]), [["Hooper", false], ["Duke", false], ["again", false]]);
  const flags = NameMatchSchema.array().parse(
    await (await fetch(`${baseUrl}/api/sessions/${other.sessionId}/name-matches`)).json(),
  );
  assert.deepEqual(flags.map((m) => [m.heard, m.suggestion, m.via]), [["Hooper Duke", "Hupperdook", "sounds-like"]]);
});

test("PATCH /api/sessions/:id/words leaves everyday words out of sounds-like hints", async () => {
  const yasha = await createEntity({ type: "npc", name: "Yasha" });
  const { sessionId, words } = await sessionWithWords(["acid", "swings"]);
  const result = WordCorrectionResultSchema.parse(await (await correct(sessionId, [words[0]!.id], "Yasha")).json());
  assert.deepEqual(result.glossary, { kind: "known", entityId: yasha.id, name: "Yasha", heard: "acid", hint: "everyday" });
  const entity = EntitySchema.parse(await (await fetch(`${baseUrl}/api/entities/${yasha.id}`)).json());
  assert.deepEqual(entity.soundsLike, []);

  // Fixing the same mishearing again doesn't add the hint twice.
  const hupperdook = (await (await fetch(`${baseUrl}/api/entities`)).json() as { id: number; name: string }[]).find((e) => e.name === "Hupperdook")!;
  const again = await sessionWithWords(["Hooper", "Duke"]);
  const second = WordCorrectionResultSchema.parse(
    await (await correct(again.sessionId, again.words.map((w) => w.id), "Hupperdook")).json(),
  );
  assert.equal(second.glossary.kind === "known" && second.glossary.hint, "already");
  const entity2 = EntitySchema.parse(await (await fetch(`${baseUrl}/api/entities/${hupperdook.id}`)).json());
  assert.deepEqual(entity2.soundsLike, ["Hooper Duke"]);
});

test("PATCH /api/sessions/:id/words reports a name nobody has entered", async () => {
  const { sessionId, words } = await sessionWithWords(["meet", "zarro", "vitch"]);
  const result = WordCorrectionResultSchema.parse(
    await (await correct(sessionId, [words[1]!.id, words[2]!.id], "Zarovich")).json(),
  );
  assert.deepEqual(result.glossary, { kind: "unknown", name: "Zarovich", heard: "zarro vitch", heardIsPlain: false });
});

test("PATCH /api/sessions/:id/words refuses words that aren't neighbours or aren't in the session", async () => {
  const { sessionId, words } = await sessionWithWords(["one", "two", "three"]);
  const gap = await correct(sessionId, [words[0]!.id, words[2]!.id], "onethree");
  assert.equal(gap.status, 400);
  const other = await sessionWithWords(["elsewhere"]);
  assert.equal((await correct(sessionId, [other.words[0]!.id], "nope")).status, 400);
  assert.equal((await correct(sessionId, [words[0]!.id], "   ")).status, 400);
  const unchanged = TranscriptWordSchema.array().parse(await (await fetch(`${baseUrl}/api/sessions/${sessionId}/words`)).json());
  assert.deepEqual(unchanged.map((w) => w.text), ["one", "two", "three"]);
});

// bafft-wg1.12: who's talking.
async function sessionWithSpeakers(turns: [string, string][]) {
  const form = new FormData();
  form.set("title", "Speakers");
  form.set("sessionDate", "2026-10-02");
  form.set("audio", new Blob([new Uint8Array(10)]), "clip.wav");
  const created = SessionSchema.parse(await (await fetch(`${baseUrl}/api/sessions`, { method: "POST", body: form })).json());
  const { replaceTranscriptWords } = await import("../db/transcript-words.js");
  await replaceTranscriptWords(
    created.id,
    turns.map(([speakerLabel, text], i) => ({ text, speakerLabel, startMs: i * 500, endMs: i * 500 + 400, confidence: 0.9 })),
  );
  return created.id;
}

const putSpeaker = (sessionId: number, body: object) =>
  fetch(`${baseUrl}/api/sessions/${sessionId}/speakers`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

test("speakers can be named and linked to a player, whose hero comes along, without touching the words", async () => {
  const ava = await createEntity({ type: "player", name: "Ava" });
  const neris = await createEntity({ type: "character", name: "Neris" });
  await fetch(`${baseUrl}/api/entity-relationships`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fromEntityId: ava.id, toEntityId: neris.id, description: "plays" }),
  });
  const sessionId = await sessionWithSpeakers([
    ["Speaker A", "I"], ["Speaker A", "draw"], ["Speaker A", "my"], ["Speaker B", "Roll"], ["Speaker B", "it"],
  ]);

  const before = SpeakerSchema.array().parse(await (await fetch(`${baseUrl}/api/sessions/${sessionId}/speakers`)).json());
  assert.deepEqual(before.map((s) => [s.speakerLabel, s.wordCount, s.name]), [["Speaker A", 3, null], ["Speaker B", 2, null]]);

  const res = await putSpeaker(sessionId, { speakerLabel: "Speaker A", name: "Ava", entityId: ava.id });
  assert.equal(res.status, 200);
  const named = SpeakerSchema.parse(await res.json());
  assert.equal(named.name, "Ava");
  assert.equal(named.hero?.name, "Neris");

  // Free text for the GM; two speakers may even share a name and stay two.
  await putSpeaker(sessionId, { speakerLabel: "Speaker B", name: "Ava" });
  const after = SpeakerSchema.array().parse(await (await fetch(`${baseUrl}/api/sessions/${sessionId}/speakers`)).json());
  assert.deepEqual(after.map((s) => [s.speakerLabel, s.name, s.hero?.name ?? null]), [["Speaker A", "Ava", "Neris"], ["Speaker B", "Ava", null]]);
  const words = TranscriptWordSchema.array().parse(await (await fetch(`${baseUrl}/api/sessions/${sessionId}/words`)).json());
  assert.deepEqual([...new Set(words.map((w) => w.speakerLabel))], ["Speaker A", "Speaker B"]);

  // A blank name puts a speaker back to its label.
  await putSpeaker(sessionId, { speakerLabel: "Speaker B", name: "" });
  const reset = SpeakerSchema.array().parse(await (await fetch(`${baseUrl}/api/sessions/${sessionId}/speakers`)).json());
  assert.equal(reset[1]!.name, null);
});

test("naming a speaker the session doesn't have is refused", async () => {
  const sessionId = await sessionWithSpeakers([["Speaker A", "hello"]]);
  assert.equal((await putSpeaker(sessionId, { speakerLabel: "Speaker Z", name: "Ben" })).status, 400);
  assert.equal((await putSpeaker(sessionId, { speakerLabel: "Speaker A", name: "Ben", entityId: 99999 })).status, 400);
});
