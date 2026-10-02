import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";

const dataDir = mkdtempSync(join(tmpdir(), "bafft-import-data-"));
const importDir = mkdtempSync(join(tmpdir(), "bafft-import-root-"));
process.env.BAFFT_DATA_DIR = dataDir;
process.env.BAFFT_IMPORT_DIR = importDir;

const { migrate } = await import("drizzle-orm/libsql/migrator");
const { db, client } = await import("../db/client.js");
const { config, ensureDataDirs } = await import("../config.js");
const { createApp } = await import("../app.js");
const { soundAssets } = await import("../db/schema.js");
const { eq } = await import("drizzle-orm");

ensureDataDirs();
let server: import("node:http").Server;
let baseUrl: string;

before(async () => {
  const pack = join(importDir, "Nakarada");
  mkdirSync(join(pack, "Calm", "Night"), { recursive: true });
  writeFileSync(join(pack, "bafft-source.json"), JSON.stringify({ pack: "Alexander Nakarada", category: "music", licence: "CC BY 4.0", attribution: "{title} by Alexander Nakarada", tags: ["nakarada"] }));
  writeFileSync(join(pack, "Calm", "Night", "moon_song-test.ogg"), "audio");
  mkdirSync(join(importDir, "NoSidecar"));
  writeFileSync(join(importDir, "NoSidecar", "bell-flare.flac"), "audio");
  await migrate(db, { migrationsFolder: config.migrationsDir });
  server = createApp().listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  client.close();
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(importDir, { recursive: true, force: true });
});

test("the folder is indexed once, searched as a Find more source, and added to the library in place (bafft-c4d.10)", { concurrency: false }, async () => {
  const before = (await (await fetch(`${baseUrl}/api/sound-assets/import-status`)).json()) as { packs: unknown[]; scannedAt: string | null };
  assert.deepEqual([before.packs, before.scannedAt], [[], null]);
  const scan = (await (await fetch(`${baseUrl}/api/sound-assets/import-scan`, { method: "POST" })).json()) as Record<string, unknown>;
  assert.deepEqual({ ...scan, scannedAt: typeof scan.scannedAt }, { files: 2, scannedAt: "string", updated: 0, removed: 0, missing: 0 });
  const status = (await (await fetch(`${baseUrl}/api/sound-assets/import-status`)).json()) as { packs: unknown[]; scannedAt: string };
  assert.deepEqual(status.packs, [{ pack: "Alexander Nakarada", files: 1 }, { pack: "NoSidecar", files: 1 }]);
  assert.equal(status.scannedAt, scan.scannedAt);

  // Scanning no longer fills the library; the tracks are searchable instead.
  assert.deepEqual(await (await fetch(`${baseUrl}/api/sound-assets`)).json(), []);
  const found = (await (await fetch(`${baseUrl}/api/catalogue?source=folder&q=moon`)).json()) as { tracks: any[] };
  assert.deepEqual(found.tracks.map((t) => [t.title, t.category, t.keptAssetId]), [["moon song test", "music", null]]);
  const preview = await fetch(`${baseUrl}${found.tracks[0].previewUrl}`);
  assert.equal(await preview.text(), "audio");
  assert.equal((await fetch(`${baseUrl}/api/catalogue/folder/audio?path=${encodeURIComponent("../escape.wav")}`)).status, 404);

  // The index is kept: a new file shows up only after a rescan.
  writeFileSync(join(importDir, "NoSidecar", "late-bell.flac"), "audio");
  const stale = (await (await fetch(`${baseUrl}/api/catalogue?source=folder&q=late`)).json()) as { tracks: unknown[] };
  assert.equal(stale.tracks.length, 0);
  await fetch(`${baseUrl}/api/sound-assets/import-scan`, { method: "POST" });
  const fresh = (await (await fetch(`${baseUrl}/api/catalogue?source=folder&q=late`)).json()) as { tracks: unknown[] };
  assert.equal(fresh.tracks.length, 1);
  rmSync(join(importDir, "NoSidecar", "late-bell.flac"));

  const kept = await fetch(`${baseUrl}/api/catalogue/keep`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source: "folder", sourceId: "Nakarada/Calm/Night/moon_song-test.ogg" }) });
  assert.equal(kept.status, 201);
  const asset = (await kept.json()) as any;
  assert.deepEqual([asset.title, asset.source, asset.tags, asset.attribution], ["moon song test", "folder", ["alexander nakarada", "nakarada", "calm", "night"], "moon song test by Alexander Nakarada"]);
  assert.deepEqual([...new Uint8Array(await (await fetch(`${baseUrl}/api/sound-assets/${asset.id}/audio`)).arrayBuffer())], [...Buffer.from("audio")]);
  const again = (await (await fetch(`${baseUrl}/api/catalogue?source=folder&q=moon`)).json()) as { tracks: any[] };
  assert.equal(again.tracks[0].keptAssetId, asset.id);
});

test("rescan refreshes and removes unused library tracks, but keeps in-use files missing", { concurrency: false }, async () => {
  const keep = (sourceId: string) => fetch(`${baseUrl}/api/catalogue/keep`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source: "folder", sourceId }) });
  await keep("NoSidecar/bell-flare.flac");
  const first = (await (await fetch(`${baseUrl}/api/sound-assets/import-scan`, { method: "POST" })).json()) as Record<string, unknown>;
  assert.deepEqual([first.updated, first.removed, first.missing], [2, 0, 0]);
  rmSync(join(importDir, "NoSidecar", "bell-flare.flac"));
  const rows = await db.select().from(soundAssets).where(eq(soundAssets.sourceId, "NoSidecar/bell-flare.flac"));
  const boardRes = await fetch(`${baseUrl}/api/soundboards`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Uses bell" }) });
  const board = (await boardRes.json()) as { id: number };
  await fetch(`${baseUrl}/api/soundboards/${board.id}/clips`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ assetId: rows[0].id }) });
  const second = (await (await fetch(`${baseUrl}/api/sound-assets/import-scan`, { method: "POST" })).json()) as Record<string, unknown>;
  assert.deepEqual([second.files, second.updated, second.removed, second.missing], [1, 1, 0, 1]);
  assert.deepEqual(await (await fetch(`${baseUrl}/api/sound-assets/${rows[0].id}/audio`)).status, 404);
  await db.update(soundAssets).set({ audioPath: "import:../escape.wav" }).where(eq(soundAssets.sourceId, "Nakarada/Calm/Night/moon_song-test.ogg"));
  const escaped = await (await fetch(`${baseUrl}/api/sound-assets/${(await db.select().from(soundAssets).where(eq(soundAssets.sourceId, "Nakarada/Calm/Night/moon_song-test.ogg")))[0].id}/audio`)).status;
  assert.equal(escaped, 404);
});
