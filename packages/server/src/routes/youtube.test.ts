// YouTube as a library source (bafft-w8f.17): search, add by link, streamed not stored.
import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { parseYouTubeRef, SoundAssetSchema, YouTubeResultSchema } from "@bafft/shared";

process.env.BAFFT_DATA_DIR = mkdtempSync(join(tmpdir(), "bafft-test-"));

const { migrate } = await import("drizzle-orm/libsql/migrator");
const { db, client } = await import("../db/client.js");
const { config, ensureDataDirs } = await import("../config.js");
const { createApp } = await import("../app.js");
const { catalogueDeps } = await import("../sound/catalogues.js");

ensureDataDirs();
let baseUrl: string;
let server: import("node:http").Server;
const realFetch = catalogueDeps.fetch;
const savedEnv = { ...process.env };

before(async () => {
  await migrate(db, { migrationsFolder: config.migrationsDir });
  server = createApp().listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(() => {
  catalogueDeps.fetch = realFetch;
  process.env = { ...savedEnv };
});
after(async () => {
  await new Promise((resolve) => server.close(resolve));
  client.close();
  rmSync(config.dataDir, { recursive: true, force: true });
});

const post = (path: string, body: unknown) =>
  fetch(`${baseUrl}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

test("links of every shape parse to a video or a playlist", () => {
  assert.deepEqual(parseYouTubeRef("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42"), { kind: "video", id: "dQw4w9WgXcQ" });
  assert.deepEqual(parseYouTubeRef("https://youtu.be/dQw4w9WgXcQ"), { kind: "video", id: "dQw4w9WgXcQ" });
  assert.deepEqual(parseYouTubeRef("https://music.youtube.com/watch?v=dQw4w9WgXcQ"), { kind: "video", id: "dQw4w9WgXcQ" });
  assert.deepEqual(parseYouTubeRef("https://www.youtube.com/embed/dQw4w9WgXcQ"), { kind: "video", id: "dQw4w9WgXcQ" });
  assert.deepEqual(parseYouTubeRef("https://www.youtube.com/playlist?list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG"), {
    kind: "playlist",
    id: "PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG",
  });
  assert.equal(parseYouTubeRef("https://vimeo.com/123"), null);
  assert.equal(parseYouTubeRef("not a link"), null);
});

test("a pasted link becomes a streamed library track, titled from oEmbed; adding it again is a no-op", async () => {
  catalogueDeps.fetch = (async (url: string | URL) => {
    assert.match(String(url), /youtube\.com\/oembed/);
    return Response.json({ title: "Dwarven Tavern Music", author_name: "Ambient Worlds" });
  }) as typeof fetch;
  const res = await post("/api/catalogue/youtube", { url: "https://youtu.be/abcdefghijk" });
  assert.equal(res.status, 201);
  const asset = SoundAssetSchema.parse(await res.json());
  assert.equal(asset.title, "Dwarven Tavern Music");
  assert.equal(asset.source, "youtube");
  assert.equal(asset.category, "music");
  assert.equal(asset.audioPath, "youtube:video:abcdefghijk");
  assert.match(asset.attribution!, /Ambient Worlds/);

  const again = await post("/api/catalogue/youtube", { url: "https://www.youtube.com/watch?v=abcdefghijk" });
  assert.equal(SoundAssetSchema.parse(await again.json()).id, asset.id);
  // There's no file to serve.
  assert.equal((await fetch(`${baseUrl}/api/sound-assets/${asset.id}/audio`)).status, 409);
});

test("a link YouTube doesn't know is refused; so is a non-YouTube link", async () => {
  catalogueDeps.fetch = (async () => new Response("Not Found", { status: 404 })) as typeof fetch;
  assert.equal((await post("/api/catalogue/youtube", { url: "https://youtu.be/zzzzzzzzzzz" })).status, 404);
  assert.equal((await post("/api/catalogue/youtube", { url: "https://vimeo.com/1" })).status, 400);
});

test("search returns videos and playlists and marks ones already in the library", async () => {
  process.env.GEMINI_API_KEY = "k";
  catalogueDeps.fetch = (async () =>
    Response.json({
      items: [
        { id: { kind: "youtube#video", videoId: "abcdefghijk" }, snippet: { title: "Dwarven Tavern &amp; Forge", channelTitle: "Ambient Worlds" } },
        { id: { kind: "youtube#playlist", playlistId: "PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG" }, snippet: { title: "Epic battle", channelTitle: "Mix" } },
        { id: { kind: "youtube#channel", channelId: "UC1" }, snippet: { title: "a channel", channelTitle: "x" } },
      ],
    })) as typeof fetch;
  const res = await fetch(`${baseUrl}/api/catalogue/youtube?q=dwarf`);
  const results = YouTubeResultSchema.array().parse(await res.json());
  assert.equal(results.length, 2);
  assert.equal(results[0]!.title, "Dwarven Tavern & Forge");
  assert.ok(results[0]!.keptAssetId, "added in the test above");
  assert.equal(results[1]!.kind, "playlist");
  assert.equal(results[1]!.keptAssetId, null);
});

test("search with the Data API switched off says how to switch it on", async () => {
  process.env.GEMINI_API_KEY = "k";
  catalogueDeps.fetch = (async () =>
    Response.json(
      {
        error: {
          message: "YouTube Data API v3 has not been used in project 1 before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/youtube.googleapis.com/overview?project=1 then retry.",
          errors: [{ reason: "accessNotConfigured" }],
        },
      },
      { status: 403 },
    )) as typeof fetch;
  const res = await fetch(`${baseUrl}/api/catalogue/youtube?q=dwarf`);
  assert.equal(res.status, 503);
  const { error } = (await res.json()) as { error: string };
  assert.match(error, /Enable the YouTube Data API v3 here: https:\/\/console\.developers\.google\.com\S+project=1/);
});

test("an API-restricted key gets told to allow the YouTube Data API (bafft-w8f.17)", async () => {
  process.env.GEMINI_API_KEY = "k";
  catalogueDeps.fetch = (async () =>
    Response.json(
      { error: { message: "Requests to this API youtube method youtube.api.v3.V3DataSearchService.List are blocked.", errors: [{ reason: "forbidden" }] } },
      { status: 403 },
    )) as typeof fetch;
  const res = await fetch(`${baseUrl}/api/catalogue/youtube?q=dwarf`);
  assert.equal(res.status, 503);
  assert.match(((await res.json()) as { error: string }).error, /add "YouTube Data API v3" to the key's API restrictions/);
});
