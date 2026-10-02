// Sound library + soundboard API (bafft-c4d.1 / .5), over real HTTP with real multipart uploads.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { CatalogueSearchSchema, SoundAssetSchema, SoundClipSchema, SoundboardSchema, SoundboardWithClipsSchema } from "@bafft/shared";

process.env.BAFFT_DATA_DIR = mkdtempSync(join(tmpdir(), "bafft-test-"));

const { migrate } = await import("drizzle-orm/libsql/migrator");
const { db, client } = await import("../db/client.js");
const { config, ensureDataDirs } = await import("../config.js");
const { createApp } = await import("../app.js");
const { catalogueDeps, clearCatalogueMemory } = await import("../sound/catalogues.js");

ensureDataDirs();
let baseUrl: string;
let server: import("node:http").Server;

before(async () => {
  await migrate(db, { migrationsFolder: config.migrationsDir });
  server = createApp().listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  client.close();
  rmSync(config.dataDir, { recursive: true, force: true });
});

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

async function newBoard(name = "The Amber Road — Act 1") {
  const res = await fetch(`${baseUrl}/api/soundboards`, json("POST", { name }));
  assert.equal(res.status, 201);
  return SoundboardSchema.parse(await res.json());
}

async function upload(filename: string, fields: Record<string, string> = {}) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  form.set("audio", new Blob([new Uint8Array([1, 2, 3, 4])]), filename);
  return fetch(`${baseUrl}/api/sound-assets`, { method: "POST", body: form });
}

async function newAsset(filename: string, fields: Record<string, string> = {}) {
  const res = await upload(filename, fields);
  assert.equal(res.status, 201);
  return SoundAssetSchema.parse(await res.json());
}

async function addClip(boardId: number, body: Record<string, unknown>) {
  return fetch(`${baseUrl}/api/soundboards/${boardId}/clips`, json("POST", body));
}

test("uploads go into the library, in each format, and their audio is served", async () => {
  const song = await newAsset("amber road song.mp3", { title: "The Amber Road", category: "music", tags: "dwarves, chant" });
  assert.deepEqual(
    [song.title, song.category, song.tags, song.source, song.licence],
    ["The Amber Road", "music", ["dwarves", "chant"], "upload", null],
  );
  assert.ok(existsSync(join(config.dataDir, song.audioPath)));
  // Defaults: named after the file, filed as a sound effect.
  const jeers = await newAsset("Crowd jeers.m4a");
  assert.deepEqual([jeers.title, jeers.category, jeers.tags], ["Crowd jeers", "sfx", []]);
  assert.equal((await upload("bell.WAV")).status, 201);

  const audio = await fetch(`${baseUrl}/api/sound-assets/${song.id}/audio`);
  assert.equal(audio.status, 200);
  assert.deepEqual([...new Uint8Array(await audio.arrayBuffer())], [1, 2, 3, 4]);
});

test("the library can be searched by title or tag, and filtered by category", async () => {
  await newAsset("festival.mp3", { title: "Village Festival", category: "ambience", tags: "throng, fair" });
  await newAsset("cheer.mp3", { title: "Big cheer", category: "sfx", tags: "throng" });
  const titles = async (query: string) =>
    SoundAssetSchema.array()
      .parse(await (await fetch(`${baseUrl}/api/sound-assets?${query}`)).json())
      .map((a) => a.title);
  assert.deepEqual(await titles("q=festival"), ["Village Festival"]);
  assert.deepEqual(await titles("q=throng"), ["Big cheer", "Village Festival"]);
  assert.deepEqual(await titles("q=throng&category=sfx"), ["Big cheer"]);
});

test("rejects other file types and bad fields, leaving no staged file behind", async () => {
  assert.equal((await upload("notes.txt")).status, 400);
  assert.equal((await upload("a.mp3", { category: "noise" })).status, 400);
  assert.deepEqual(readdirSync(config.uploadsTmpDir), []);
});

test("a library track goes on a board, defaulting to its title, and loop for music", async () => {
  const board = await newBoard();
  const song = await newAsset("song.mp3", { title: "The Amber Road", category: "music" });
  const bell = await newAsset("bell.mp3", { title: "Temple bell" });

  const songClip = SoundClipSchema.parse(await (await addClip(board.id, { assetId: song.id, group: "The Speech", fadeInMs: 4000 })).json());
  assert.deepEqual([songClip.name, songClip.kind, songClip.group, songClip.fadeInMs], ["The Amber Road", "loop", "The Speech", 4000]);
  const bellClip = SoundClipSchema.parse(await (await addClip(board.id, { assetId: bell.id, name: "Bell!" })).json());
  assert.deepEqual([bellClip.name, bellClip.kind, bellClip.position], ["Bell!", "one-shot", 1]);

  // The same track can sit on another board too.
  const other = await newBoard("Act 2");
  assert.equal((await addClip(other.id, { assetId: song.id })).status, 201);

  const full = SoundboardWithClipsSchema.parse(await (await fetch(`${baseUrl}/api/soundboards/${board.id}`)).json());
  assert.deepEqual(full.clips.map((c) => [c.name, c.asset.title]), [["The Amber Road", "The Amber Road"], ["Bell!", "Temple bell"]]);

  assert.equal((await addClip(board.id, { assetId: 999999 })).status, 404);
  assert.equal((await addClip(999999, { assetId: song.id })).status, 404);
  assert.equal((await addClip(board.id, { assetId: song.id, volume: 2 })).status, 400);
});

test("edits a clip's settings (the loop toggle) and reorders the board", async () => {
  const board = await newBoard();
  const a = SoundClipSchema.parse(await (await addClip(board.id, { assetId: (await newAsset("a.mp3")).id })).json());
  const b = SoundClipSchema.parse(await (await addClip(board.id, { assetId: (await newAsset("b.mp3")).id })).json());

  const edited = await fetch(`${baseUrl}/api/sound-clips/${a.id}`, json("PATCH", { kind: "loop", volume: 0.3 }));
  const clip = SoundClipSchema.parse(await edited.json());
  assert.deepEqual([clip.kind, clip.volume, clip.name], ["loop", 0.3, "a"]);
  assert.equal((await fetch(`${baseUrl}/api/sound-clips/${a.id}`, json("PATCH", { volume: -1 }))).status, 400);

  const reordered = await fetch(`${baseUrl}/api/soundboards/${board.id}/clip-order`, json("PUT", { clipIds: [b.id, a.id] }));
  assert.deepEqual(SoundboardWithClipsSchema.parse(await reordered.json()).clips.map((c) => c.id), [b.id, a.id]);
  assert.equal((await fetch(`${baseUrl}/api/soundboards/${board.id}/clip-order`, json("PUT", { clipIds: [a.id] }))).status, 409);
});

test("a track on a board can't be deleted from the library; off every board, it and its file go", async () => {
  const board = await newBoard("The Amber Road — Act 1");
  const song = await newAsset("song.mp3");
  const clip = SoundClipSchema.parse(await (await addClip(board.id, { assetId: song.id })).json());

  const blocked = await fetch(`${baseUrl}/api/sound-assets/${song.id}`, { method: "DELETE" });
  assert.equal(blocked.status, 409);
  assert.deepEqual(((await blocked.json()) as { usedOn: string[] }).usedOn, ["The Amber Road — Act 1"]);

  // Taking it off the board (or deleting the board) leaves the library track.
  assert.equal((await fetch(`${baseUrl}/api/sound-clips/${clip.id}`, { method: "DELETE" })).status, 204);
  assert.equal((await fetch(`${baseUrl}/api/sound-assets/${song.id}`)).status, 200);

  assert.equal((await fetch(`${baseUrl}/api/sound-assets/${song.id}`, { method: "DELETE" })).status, 204);
  assert.equal(existsSync(join(config.dataDir, song.audioPath)), false);
  assert.equal((await fetch(`${baseUrl}/api/sound-assets/${song.id}/audio`)).status, 404);
});

test("deleting a board keeps its tracks in the library", async () => {
  const board = await newBoard();
  const song = await newAsset("song.mp3");
  await addClip(board.id, { assetId: song.id });
  assert.equal((await fetch(`${baseUrl}/api/soundboards/${board.id}`, { method: "DELETE" })).status, 204);
  assert.equal((await fetch(`${baseUrl}/api/soundboards/${board.id}`)).status, 404);
  assert.equal((await fetch(`${baseUrl}/api/sound-assets/${song.id}`, { method: "DELETE" })).status, 204);
});

test("lists boards in order and renames them", async () => {
  const board = await newBoard("Draft");
  const renamed = await fetch(`${baseUrl}/api/soundboards/${board.id}`, json("PATCH", { name: "Act 2" }));
  assert.equal(SoundboardSchema.parse(await renamed.json()).name, "Act 2");
  assert.equal((await fetch(`${baseUrl}/api/soundboards/${board.id}`, json("PATCH", { name: " " }))).status, 400);
  const all = SoundboardSchema.array().parse(await (await fetch(`${baseUrl}/api/soundboards`)).json());
  assert.equal(all.at(-1)?.name, "Act 2");
});

// ---------- catalogues (bafft-c4d.6), over recorded fixtures ----------

const FIXTURES = join(import.meta.dirname, "../sound/fixtures");
const requested: string[] = [];
function fakeCatalogues({ failDownloads = false } = {}) {
  clearCatalogueMemory();
  rmSync(join(config.dataDir, "catalogues"), { recursive: true, force: true });
  catalogueDeps.fetch = (async (url: string | URL) => {
    const u = String(url);
    requested.push(u);
    if (u.endsWith("tta_data")) return new Response(readFileSync(join(FIXTURES, "tta_data.json")));
    if (u.endsWith("pieces.json")) return new Response(readFileSync(join(FIXTURES, "incompetech-pieces.json")));
    if (failDownloads) return new Response("nope", { status: 503 });
    return new Response(new Uint8Array([9, 9, 9]));
  }) as typeof fetch;
}

test("searches a catalogue, marking tracks already in the library", async () => {
  fakeCatalogues();
  const res = await fetch(`${baseUrl}/api/catalogue?source=tabletop-audio&q=festival`);
  const { tracks } = CatalogueSearchSchema.parse(await res.json());
  assert.deepEqual(tracks.map((t) => [t.title, t.keptAssetId]), [["Village Festival", null]]);
  assert.equal((await fetch(`${baseUrl}/api/catalogue?source=spotify`)).status, 400);
});

test("one search covers every catalogue, filters by kind, and names a source it couldn't reach (bafft-c4d.10)", async () => {
  fakeCatalogues();
  const all = CatalogueSearchSchema.parse(await (await fetch(`${baseUrl}/api/catalogue`)).json());
  assert.deepEqual([...new Set(all.tracks.map((t) => t.source))].sort(), ["incompetech", "tabletop-audio"]);
  const music = CatalogueSearchSchema.parse(await (await fetch(`${baseUrl}/api/catalogue?category=music`)).json());
  assert.ok(music.tracks.length > 0 && music.tracks.every((t) => t.category === "music"));

  catalogueDeps.fetch = async (url) => {
    if (String(url).includes("incompetech")) throw new Error("offline");
    return new Response(JSON.stringify({ tracks: [] }));
  };
  clearCatalogueMemory();
  rmSync(join(config.dataDir, "catalogues"), { recursive: true, force: true });
  const partial = CatalogueSearchSchema.parse(await (await fetch(`${baseUrl}/api/catalogue?q=x`)).json());
  assert.deepEqual(partial.unavailable.map((u) => u.source), ["incompetech"]);
});

test("keeping a track downloads it into the library with its credit; keeping it again is a no-op", async () => {
  fakeCatalogues();
  const kept = await fetch(`${baseUrl}/api/catalogue/keep`, json("POST", { source: "incompetech", sourceId: "The Britons.mp3" }));
  assert.equal(kept.status, 201);
  const asset = SoundAssetSchema.parse(await kept.json());
  assert.deepEqual([asset.title, asset.category, asset.source, asset.licence, asset.durationMs], ["The Britons", "music", "incompetech", "CC BY 4.0", 307_000]);
  assert.match(asset.attribution ?? "", /Kevin MacLeod/);
  assert.ok(requested.includes("https://incompetech.com/music/royalty-free/mp3-royaltyfree/The%20Britons.mp3"));
  const audio = await fetch(`${baseUrl}/api/sound-assets/${asset.id}/audio`);
  assert.deepEqual([...new Uint8Array(await audio.arrayBuffer())], [9, 9, 9]);

  const again = await fetch(`${baseUrl}/api/catalogue/keep`, json("POST", { source: "incompetech", sourceId: "The Britons.mp3" }));
  assert.equal(again.status, 200);
  assert.equal(SoundAssetSchema.parse(await again.json()).id, asset.id);

  const { tracks: listed } = CatalogueSearchSchema.parse(await (await fetch(`${baseUrl}/api/catalogue?source=incompetech&q=britons`)).json());
  assert.equal(listed[0]?.keptAssetId, asset.id);
});

test("a failed download leaves nothing half-kept", async () => {
  fakeCatalogues({ failDownloads: true });
  const res = await fetch(`${baseUrl}/api/catalogue/keep`, json("POST", { source: "tabletop-audio", sourceId: "114" }));
  assert.equal(res.status, 502);
  const found = SoundAssetSchema.array().parse(await (await fetch(`${baseUrl}/api/sound-assets?q=Dwarven`)).json());
  assert.deepEqual(found, []);
  assert.equal((await fetch(`${baseUrl}/api/catalogue/keep`, json("POST", { source: "tabletop-audio", sourceId: "nope" }))).status, 404);
});


// ---------- Freesound (bafft-c4d.8), live search over a fake API ----------

const ROCKSLIDE = {
  id: 77931, name: "Rockslide.wav", tags: ["rockslide", "rocks"], description: "Boulders <b>falling</b>",
  license: "https://creativecommons.org/licenses/by/4.0/", username: "juskiddink", duration: 12.5,
  previews: { "preview-hq-mp3": "https://cdn.freesound.org/previews/77/77931_649468-hq.mp3" },
};

test("Freesound joins the search once something is typed, and adding one copies its preview with the credit (bafft-c4d.8)", async () => {
  const { clearFreesoundMemory } = await import("../sound/freesound.js");
  fakeCatalogues();
  clearFreesoundMemory();
  const calls: string[] = [];
  const base = catalogueDeps.fetch;
  catalogueDeps.fetch = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("freesound.org/apiv2/search/text/")) { calls.push(u); return new Response(JSON.stringify({ results: [ROCKSLIDE] })); }
    if (u.includes("freesound.org/apiv2/sounds/77931/")) return new Response(JSON.stringify(ROCKSLIDE));
    return base(url, init);
  }) as typeof fetch;

  delete process.env.FREESOUND_API_KEY;
  const noKey = CatalogueSearchSchema.parse(await (await fetch(`${baseUrl}/api/catalogue?q=rockslide`)).json());
  assert.ok(noKey.tracks.every((t) => t.source !== "freesound"));

  process.env.FREESOUND_API_KEY = "test-key";
  try {
    const empty = CatalogueSearchSchema.parse(await (await fetch(`${baseUrl}/api/catalogue`)).json());
    assert.ok(empty.tracks.every((t) => t.source !== "freesound"));
    assert.equal(calls.length, 0);

    const found = CatalogueSearchSchema.parse(await (await fetch(`${baseUrl}/api/catalogue?q=rockslide&category=sfx`)).json());
    const rock = found.tracks.find((t) => t.source === "freesound")!;
    assert.deepEqual([rock.title, rock.category, rock.licence, rock.durationMs, rock.description], ["Rockslide", "sfx", "CC BY 4.0", 12_500, "Boulders falling"]);
    const asked = new URL(calls[0]!);
    assert.equal(asked.searchParams.get("token"), "test-key");
    assert.match(asked.searchParams.get("filter")!, /Creative Commons 0.*duration:\[0 TO 30\]/);
    // Music isn't Freesound's thing; the same search again comes from memory.
    await fetch(`${baseUrl}/api/catalogue?q=rockslide&category=music`);
    await fetch(`${baseUrl}/api/catalogue?q=rockslide&category=sfx`);
    assert.equal(calls.length, 1);

    const kept = await fetch(`${baseUrl}/api/catalogue/keep`, json("POST", { source: "freesound", sourceId: "77931" }));
    assert.equal(kept.status, 201);
    const asset = SoundAssetSchema.parse(await kept.json());
    assert.deepEqual([asset.title, asset.source, asset.category, asset.licence], ["Rockslide", "freesound", "sfx", "CC BY 4.0"]);
    assert.equal(asset.attribution, "“Rockslide” by juskiddink (freesound.org/s/77931), CC BY 4.0");
    assert.deepEqual([...new Uint8Array(await (await fetch(`${baseUrl}/api/sound-assets/${asset.id}/audio`)).arrayBuffer())], [9, 9, 9]);
    assert.equal((await fetch(`${baseUrl}/api/catalogue/keep`, json("POST", { source: "freesound", sourceId: "not-a-number" }))).status, 404);
  } finally {
    delete process.env.FREESOUND_API_KEY;
  }
});

test("Freesound licence links read as short names", async () => {
  const { licenceName } = await import("../sound/freesound.js");
  assert.equal(licenceName("http://creativecommons.org/publicdomain/zero/1.0/"), "CC0 1.0");
  assert.equal(licenceName("https://creativecommons.org/licenses/by-nc/4.0/"), "CC BY-NC 4.0");
  assert.equal(licenceName("http://creativecommons.org/licenses/by/3.0/"), "CC BY 3.0");
});

test("scene order and locations persist, and invalid locations and duplicate scenes are rejected", async () => {
  const board = await newBoard("Ordered scenes");
  const locationRes = await fetch(baseUrl + "/api/entities", json("POST", { name: "The Keep", type: "location" }));
  assert.equal(locationRes.status, 201);
  const location = await locationRes.json() as { id: number };
  const scenes = [{ name: "The Keep", locationId: location.id }, { name: "The Riot", locationId: null }];
  const save = (scenes: unknown) => fetch(baseUrl + "/api/soundboards/" + board.id + "/scenes", json("PUT", { scenes }));
  assert.equal((await save(scenes)).status, 200);
  assert.deepEqual(SoundboardWithClipsSchema.parse(await (await fetch(baseUrl + "/api/soundboards/" + board.id)).json()).scenes, scenes);
  assert.equal((await save([...scenes].reverse())).status, 200);
  assert.equal((await save([scenes[0], scenes[0]])).status, 400);
  assert.equal((await save([{ name: "Missing", locationId: 999999 }])).status, 400);
  const npcRes = await fetch(baseUrl + "/api/entities", json("POST", { name: "Guard", type: "npc" }));
  const npc = await npcRes.json() as { id: number };
  assert.equal((await save([{ name: "Guard", locationId: npc.id }])).status, 400);
  assert.deepEqual(SoundboardWithClipsSchema.parse(await (await fetch(baseUrl + "/api/soundboards/" + board.id)).json()).scenes, [...scenes].reverse());
});
