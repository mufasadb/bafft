// Real HTTP integration test, same pattern as routes/entities.test.ts.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { CampaignSchema, EntitySchema, NpcDraftSchema } from "@bafft/shared";

process.env.BAFFT_DATA_DIR = mkdtempSync(join(tmpdir(), "bafft-test-"));
// Never call a real AI vendor from tests, even if the shell has a key.
process.env.BAFFT_DRAFT_PROVIDER = "mock";
process.env.BAFFT_IMAGE_PROVIDER = "mock";

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

function patch(path: string, body: unknown) {
  return fetch(`${baseUrl}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("the migration seeds campaign 1, which existing rows already point at", async () => {
  const list = CampaignSchema.array().parse(await (await fetch(`${baseUrl}/api/campaigns`)).json());
  assert.equal(list.length, 1);
  assert.equal(list[0].id, 1);
  assert.equal(list[0].gameSystem, "other");
});

test("campaign settings can be edited", async () => {
  const res = await patch("/api/campaigns/1", {
    name: "The Amber Road",
    gameSystem: "draw-steel",
    styleAnchor: "muted watercolour, ink outlines",
    settingNotes: "A drowned empire resurfacing.",
  });
  assert.equal(res.status, 200);
  const saved = CampaignSchema.parse(await res.json());
  assert.equal(saved.name, "The Amber Road");
  assert.equal(saved.gameSystem, "draw-steel");

  const fetched = CampaignSchema.parse(await (await fetch(`${baseUrl}/api/campaigns/1`)).json());
  assert.equal(fetched.styleAnchor, "muted watercolour, ink outlines");
});

test("bad campaign input is a 400, unknown campaign a 404", async () => {
  assert.equal((await patch("/api/campaigns/1", { gameSystem: "gurps" })).status, 400);
  assert.equal((await patch("/api/campaigns/1", { name: "" })).status, 400);
  assert.equal((await patch("/api/campaigns/99", { name: "x" })).status, 404);
  assert.equal((await fetch(`${baseUrl}/api/campaigns/99`)).status, 404);
});

test("picture this uses the campaign's style anchor", async () => {
  await patch("/api/campaigns/1", { styleAnchor: "woodcut print" });
  const created = await fetch(`${baseUrl}/api/entities`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "npc", name: "Styled" }),
  });
  const npc = EntitySchema.parse(await created.json());
  const gen = await fetch(`${baseUrl}/api/entities/${npc.id}/picture/generate`, { method: "POST" });
  const { dataUrl } = (await gen.json()) as { dataUrl: string };
  const svg = Buffer.from(dataUrl.split(",")[1], "base64").toString();
  assert.match(svg, /style: woodcut print/);
});

test("NPC draft keeps the GM's fields and adds negotiation for Draw Steel campaigns", async () => {
  await patch("/api/campaigns/1", { gameSystem: "draw-steel" });
  const res = await fetch(`${baseUrl}/api/entities/npc-draft`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ blurb: "wary innkeeper", name: "Boran", profile: { ancestry: "dwarf" } }),
  });
  assert.equal(res.status, 200);
  const draft = NpcDraftSchema.parse(await res.json());
  assert.equal(draft.name, "Boran");
  assert.equal(draft.profile.ancestry, "dwarf");
  assert.equal(draft.profile.occupation, "ferryman", "blank fields come from the (mock) AI");
  assert.equal(draft.profile.negotiation?.motivations.length, 2);

  await patch("/api/campaigns/1", { gameSystem: "shadowdark" });
  const other = NpcDraftSchema.parse(
    await (
      await fetch(`${baseUrl}/api/entities/npc-draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: {} }),
      })
    ).json(),
  );
  assert.equal(other.profile.negotiation, undefined);
});

test("keep to my notes: the draft route returns colour but no AI story (bafft-w8f.10)", async () => {
  const res = await fetch(`${baseUrl}/api/entities/npc-draft`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ colourOnly: true, profile: { wants: "to be seen as hold kin" } }),
  });
  const draft = NpcDraftSchema.parse(await res.json());
  assert.equal(draft.profile.look, "rope-burned hands and a sodden felt hat");
  assert.equal(draft.profile.wants, "to be seen as hold kin");
  assert.equal(draft.profile.story, undefined);
  assert.equal(draft.profile.plan, undefined);
});

test("API responses are never cached (a 304 used to surface as an error)", async () => {
  const res = await fetch(`${baseUrl}/api/campaigns/1`);
  assert.equal(res.headers.get("etag"), null);
  assert.equal(res.headers.get("cache-control"), "no-store");
});
