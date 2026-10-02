// Real HTTP integration test, same pattern as routes/sessions.test.ts.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { EntitySchema, EntityRelationshipSchema, GlossaryEntrySchema } from "@bafft/shared";

process.env.BAFFT_DATA_DIR = mkdtempSync(join(tmpdir(), "bafft-test-"));
// Never call a real AI vendor from tests, even if the shell has a key.
process.env.BAFFT_DRAFT_PROVIDER = "mock";
process.env.BAFFT_IMAGE_PROVIDER = "mock";

const { migrate } = await import("drizzle-orm/libsql/migrator");
const { db, client } = await import("../db/client.js");
const { config, ensureDataDirs } = await import("../config.js");
const { createApp } = await import("../app.js");
const { sweepStaleImageTemps, sweepOrphanedEntityImages } = await import("../image/cleanup.js");

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

async function createEntity(body: Record<string, unknown>) {
  const res = await fetch(`${baseUrl}/api/entities`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  assert.equal(res.status, 201);
  return EntitySchema.parse(await res.json());
}

test("full entity CRUD via HTTP", async () => {
  const created = await createEntity({ type: "npc", name: "Alice", tags: ["merchant"] });
  assert.equal(created.name, "Alice");
  assert.deepEqual(created.tags, ["merchant"]);

  const fetched = EntitySchema.parse(await (await fetch(`${baseUrl}/api/entities/${created.id}`)).json());
  assert.equal(fetched.name, "Alice");

  const patched = await fetch(`${baseUrl}/api/entities/${created.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ notes: "runs the general store" }),
  });
  assert.equal(patched.status, 200);
  assert.equal(EntitySchema.parse(await patched.json()).notes, "runs the general store");

  const del = await fetch(`${baseUrl}/api/entities/${created.id}`, { method: "DELETE" });
  assert.equal(del.status, 204);
  assert.equal((await fetch(`${baseUrl}/api/entities/${created.id}`)).status, 404);
});

test("GET /api/entities/tree nests locations via containment relationships", async () => {
  const country = await createEntity({ type: "location", name: "Andor" });
  const town = await createEntity({ type: "location", name: "Falme" });
  const rel = await fetch(`${baseUrl}/api/entity-relationships`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fromEntityId: town.id, toEntityId: country.id, description: "located in", isContainment: true }),
  });
  assert.equal(rel.status, 201);

  const tree = (await (await fetch(`${baseUrl}/api/entities/tree`)).json()) as Array<{ id: number; children: unknown[] }>;
  const countryNode = tree.find((n) => n.id === country.id);
  assert.ok(countryNode);
  assert.equal((countryNode!.children as { id: number }[]).length, 1);
  assert.equal((countryNode!.children as { id: number }[])[0]!.id, town.id);
});

test("GET /api/entities/glossary lists names and flags everyday-word ones (bafft-w8f.1)", async () => {
  const warden = await createEntity({ type: "npc", name: "Hold-Warden Tavia Kelvor", aliases: ["the Warden"], soundsLike: ["kel-vor"] });
  const res = await fetch(`${baseUrl}/api/entities/glossary`);
  assert.equal(res.status, 200);
  const rows = GlossaryEntrySchema.array().parse(await res.json());
  const row = rows.find((r) => r.id === warden.id);
  assert.deepEqual(row?.skipped, ["the Warden"]);
  assert.deepEqual(row?.soundsLike, ["kel-vor"]);
});

test("factions can be created and listed (bafft-w8f.5)", async () => {
  const res = await fetch(`${baseUrl}/api/entities`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "faction", name: "The Silver Circle" }),
  });
  assert.equal(res.status, 201);
  const all = EntitySchema.array().parse(await (await fetch(`${baseUrl}/api/entities`)).json());
  assert.ok(all.some((e) => e.type === "faction" && e.name === "The Silver Circle"));
});

test("an npc can have multiple relationships to different entities", async () => {
  const mira = await createEntity({ type: "npc", name: "Mira" });
  const pub = await createEntity({ type: "location", name: "The Pub" });
  const coin = await createEntity({ type: "item", name: "A lucky coin" });

  for (const [toEntityId, description] of [
    [pub.id, "owner of"],
    [coin.id, "owns"],
  ] as const) {
    const res = await fetch(`${baseUrl}/api/entity-relationships`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fromEntityId: mira.id, toEntityId, description }),
    });
    assert.equal(res.status, 201);
  }

  const list = EntityRelationshipSchema.array().parse(
    await (await fetch(`${baseUrl}/api/entity-relationships?entityId=${mira.id}`)).json(),
  );
  assert.equal(list.length, 2);
  assert.ok(list.some((r) => r.description === "owner of" && r.toEntityId === pub.id));
  assert.ok(list.some((r) => r.description === "owns" && r.toEntityId === coin.id));

  const delRes = await fetch(`${baseUrl}/api/entity-relationships/${list[0]!.id}`, { method: "DELETE" });
  assert.equal(delRes.status, 204);
});

test("deleting an entity cascades its relationships instead of failing (caught manually against the real dev db — not exercised by the DB-level tests, which never delete an entity with relationships)", async () => {
  const lethara = await createEntity({ type: "location", name: "Lethara" });
  const docks = await createEntity({ type: "location", name: "The Docks" });
  const rel = await fetch(`${baseUrl}/api/entity-relationships`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fromEntityId: docks.id, toEntityId: lethara.id, description: "located in", isContainment: true }),
  });
  assert.equal(rel.status, 201);

  const del = await fetch(`${baseUrl}/api/entities/${lethara.id}`, { method: "DELETE" });
  assert.equal(del.status, 204, "delete should cascade the relationship, not hit a FOREIGN KEY constraint error");

  const remaining = EntityRelationshipSchema.array().parse(
    await (await fetch(`${baseUrl}/api/entity-relationships?entityId=${docks.id}`)).json(),
  );
  assert.equal(remaining.length, 0);
});

test("a containment relationship between two non-locations is rejected over HTTP", async () => {
  const a = await createEntity({ type: "npc", name: "A" });
  const b = await createEntity({ type: "npc", name: "B" });
  const res = await fetch(`${baseUrl}/api/entity-relationships`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fromEntityId: a.id, toEntityId: b.id, description: "sibling of", isContainment: true }),
  });
  assert.equal(res.status, 422);
});

test("POST /api/entities/draft returns an unsaved draft, guided and prompt modes", async () => {
  const guided = await fetch(`${baseUrl}/api/entities/draft`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "location", guided: { climate: "coastal" } }),
  });
  assert.equal(guided.status, 200);
  const guidedDraft = (await guided.json()) as { name: string };
  assert.ok(guidedDraft.name);

  const prompt = await fetch(`${baseUrl}/api/entities/draft`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "npc", prompt: "a grumpy dockworker" }),
  });
  assert.equal(prompt.status, 200);

  const both = await fetch(`${baseUrl}/api/entities/draft`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "npc", prompt: "x", guided: { a: "b" } }),
  });
  assert.equal(both.status, 400, "prompt and guided together should be rejected");

  const blank = await fetch(`${baseUrl}/api/entities/draft`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "npc", guided: { age: "  " } }),
  });
  assert.equal(blank.status, 400, "guided with nothing filled in should be rejected");
});

test("picture this: generate stages a temp image, accept persists it", async () => {
  const npc = await createEntity({ type: "npc", name: "Portrait Test", quirks: ["wears a battered hat"] });

  const gen = await fetch(`${baseUrl}/api/entities/${npc.id}/picture/generate`, { method: "POST" });
  assert.equal(gen.status, 200);
  const { tempId, dataUrl } = (await gen.json()) as { tempId: string; dataUrl: string };
  assert.ok(tempId.endsWith(".svg"));
  assert.ok(dataUrl.startsWith("data:image/svg+xml;base64,"));

  const accept = await fetch(`${baseUrl}/api/entities/${npc.id}/picture/accept`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tempId }),
  });
  assert.equal(accept.status, 200);
  const accepted = EntitySchema.parse(await accept.json());
  assert.equal(accepted.imagePath, `images/${npc.id}/portrait.svg`);
  assert.ok(existsSync(join(config.imagesDir, String(npc.id), "portrait.svg")));

  const served = await fetch(`${baseUrl}/data/${accepted.imagePath}`);
  assert.equal(served.status, 200);
  // Only pictures: the database next to them isn't downloadable (bafft-bfz).
  assert.equal((await fetch(`${baseUrl}/data/bafft.db`)).status, 404);
  assert.equal((await fetch(`${baseUrl}/data/images/../bafft.db`)).status, 404);
});

test("picture accept without a prior generate is rejected, not a 500", async () => {
  const npc = await createEntity({ type: "npc", name: "No Portrait Yet" });
  const res = await fetch(`${baseUrl}/api/entities/${npc.id}/picture/accept`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tempId: "does-not-exist.svg" }),
  });
  assert.equal(res.status, 422);
});

async function generateAndAccept(id: number): Promise<string> {
  const gen = await fetch(`${baseUrl}/api/entities/${id}/picture/generate`, { method: "POST" });
  const { tempId } = (await gen.json()) as { tempId: string };
  const accept = await fetch(`${baseUrl}/api/entities/${id}/picture/accept`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tempId }),
  });
  assert.equal(accept.status, 200);
  return tempId;
}

test("deleting an entity removes its picture folder", async () => {
  const npc = await createEntity({ type: "npc", name: "Doomed Portrait" });
  await generateAndAccept(npc.id);
  const dir = join(config.imagesDir, String(npc.id));
  assert.ok(existsSync(dir));

  assert.equal((await fetch(`${baseUrl}/api/entities/${npc.id}`, { method: "DELETE" })).status, 204);
  assert.ok(!existsSync(dir));
});

test("accepting a new picture replaces the old file instead of leaving it beside the new one", async () => {
  const npc = await createEntity({ type: "npc", name: "Twice Painted" });
  await generateAndAccept(npc.id);
  const stale = join(config.imagesDir, String(npc.id), "portrait.png");
  writeFileSync(stale, "old picture from a different vendor");

  await generateAndAccept(npc.id);
  assert.ok(!existsSync(stale));
  assert.ok(existsSync(join(config.imagesDir, String(npc.id), "portrait.svg")));
});

test("a failed accept leaves the existing picture alone", async () => {
  const npc = await createEntity({ type: "npc", name: "Keeps Portrait" });
  await generateAndAccept(npc.id);
  const res = await fetch(`${baseUrl}/api/entities/${npc.id}/picture/accept`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tempId: "does-not-exist.svg" }),
  });
  assert.equal(res.status, 422);
  assert.ok(existsSync(join(config.imagesDir, String(npc.id), "portrait.svg")));
});

test("startup sweeps drop day-old unaccepted generations and folders of deleted entities", async () => {
  const fresh = join(config.imagesTmpDir, "fresh.svg");
  const old = join(config.imagesTmpDir, "old.svg");
  writeFileSync(fresh, "x");
  writeFileSync(old, "x");
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  utimesSync(old, twoDaysAgo, twoDaysAgo);

  assert.equal(await sweepStaleImageTemps(), 1);
  assert.ok(existsSync(fresh));
  assert.ok(!existsSync(old));

  const keeper = await createEntity({ type: "npc", name: "Still Here" });
  mkdirSync(join(config.imagesDir, String(keeper.id)), { recursive: true });
  mkdirSync(join(config.imagesDir, "999999"), { recursive: true });
  await sweepOrphanedEntityImages([keeper.id]);
  assert.ok(existsSync(join(config.imagesDir, String(keeper.id))));
  assert.ok(!existsSync(join(config.imagesDir, "999999")));
});

async function relate(fromEntityId: number, toEntityId: number, isContainment: boolean) {
  return fetch(`${baseUrl}/api/entity-relationships`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fromEntityId, toEntityId, description: "part of", isContainment }),
  });
}

test("an entity can't be related to itself (a self-containment made it vanish from the location tree)", async () => {
  const loc = await createEntity({ type: "location", name: "Self Loop" });
  assert.equal((await relate(loc.id, loc.id, true)).status, 422);
  assert.equal((await relate(loc.id, loc.id, false)).status, 422);
});

test("a containment loop is rejected, at any depth, and the tree keeps every location", async () => {
  const region = await createEntity({ type: "location", name: "Loop Region" });
  const town = await createEntity({ type: "location", name: "Loop Town" });
  const pub = await createEntity({ type: "location", name: "Loop Pub" });
  assert.equal((await relate(town.id, region.id, true)).status, 201);
  assert.equal((await relate(pub.id, town.id, true)).status, 201);

  assert.equal((await relate(region.id, town.id, true)).status, 422, "direct loop");
  assert.equal((await relate(region.id, pub.id, true)).status, 422, "two-level loop");
  assert.equal((await relate(region.id, pub.id, false)).status, 201, "non-containment links can point anywhere");

  type Node = { id: number; children: Node[] };
  const tree = (await (await fetch(`${baseUrl}/api/entities/tree`)).json()) as Node[];
  const ids = new Set<number>();
  const walk = (nodes: Node[]) => nodes.forEach((n) => (ids.add(n.id), walk(n.children)));
  walk(tree);
  for (const e of [region, town, pub]) assert.ok(ids.has(e.id), `${e.name} missing from tree`);
});

test("non-numeric or non-positive ids are a 400, not a 500", async () => {
  for (const path of [
    "/api/entities/abc",
    "/api/entities/0",
    "/api/entities/1.5",
    "/api/sessions/abc/words",
  ]) {
    assert.equal((await fetch(`${baseUrl}${path}`)).status, 400, path);
  }
  assert.equal((await fetch(`${baseUrl}/api/entities/abc`, { method: "DELETE" })).status, 400);
  assert.equal((await fetch(`${baseUrl}/api/entity-relationships/abc`, { method: "DELETE" })).status, 400);
  assert.equal((await fetch(`${baseUrl}/api/sessions/abc/transcribe`, { method: "POST" })).status, 400);
});

test("an NPC's profile round-trips, and bad negotiation picks are rejected", async () => {
  const npc = await createEntity({
    type: "npc",
    name: "Boran Ashkettle",
    profile: {
      ancestry: "dwarf",
      occupation: "innkeeper",
      secret: "owes the syndicate sixty silver",
      negotiation: {
        attitude: "suspicious",
        impression: 2,
        motivations: [{ kind: "greed", reason: "wants the debt gone" }, { kind: "protection" }],
        pitfalls: [{ kind: "higher authority", reason: "hates the watch" }],
      },
    },
  });
  assert.equal(npc.profile?.negotiation?.motivations[1].reason, "");
  const fetched = EntitySchema.parse(await (await fetch(`${baseUrl}/api/entities/${npc.id}`)).json());
  assert.equal(fetched.profile?.negotiation?.attitude, "suspicious");

  const post = (profile: unknown) =>
    fetch(`${baseUrl}/api/entities`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "npc", name: "Bad", profile }),
    });
  assert.equal((await post({ negotiation: { motivations: [{ kind: "snacks" }] } })).status, 400);
  assert.equal((await post({ negotiation: { impression: 13 } })).status, 400);
  assert.equal(
    (await post({ negotiation: { motivations: [{ kind: "greed" }], pitfalls: [{ kind: "greed" }] } })).status,
    400,
    "a motivation can't also be a pitfall",
  );
});

test("picture prompts use an NPC's look but never its secret or notes", async () => {
  const { buildImagePrompt } = await import("./entities.js");
  const prompt = buildImagePrompt({
    type: "npc",
    name: "Boran",
    tags: [],
    quirks: [],
    profile: { ancestry: "dwarf", occupation: "innkeeper", look: "copper beads in his beard", story: "Secret: is a lich" },
  });
  assert.match(prompt, /a dwarf innkeeper/);
  assert.match(prompt, /copper beads/);
  assert.doesNotMatch(prompt, /lich/);
});

test("relationship labels and Inside changes through HTTP (bafft-w8f.2)", async () => {
  const outer = await createEntity({ type: "location", name: "Label province" });
  const inner = await createEntity({ type: "location", name: "Label town" });
  for (let i = 0; i < 2; i++) {
    assert.equal((await fetch(`${baseUrl}/api/entity-relationships`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fromEntityId: inner.id, toEntityId: outer.id, description: "secretly serves" }),
    })).status, 201);
  }
  const labels = await (await fetch(`${baseUrl}/api/entity-relationships/labels`)).json() as string[];
  assert.equal(labels.filter((label) => label === "secretly serves").length, 1);
  const inside = (id: number, parentId: unknown) => fetch(`${baseUrl}/api/entity-relationships/${id}/inside`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ parentId }),
  });
  assert.equal((await inside(inner.id, outer.id)).status, 204);
  assert.equal((await inside(outer.id, inner.id)).status, 422);
  assert.equal((await inside(inner.id, "wrong")).status, 400);
  const relationships = EntityRelationshipSchema.array().parse(await (await fetch(`${baseUrl}/api/entity-relationships?entityId=${inner.id}`)).json());
  assert.equal(relationships.find((r) => r.isContainment)?.toEntityId, outer.id);
  assert.equal((await inside(inner.id, null)).status, 204);
});

test("GM-only links persist, toggle from either endpoint, and stay out of player lists, labels and containment", async () => {
  const inner = await createEntity({ type: "location", name: "Hidden chamber" });
  const outer = await createEntity({ type: "location", name: "Public keep" });
  const created = await fetch(`${baseUrl}/api/entity-relationships`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fromEntityId: inner.id, toEntityId: outer.id, description: "concealed underneath", isContainment: true, gmOnly: true }),
  });
  assert.equal(created.status, 201);
  const secret = EntityRelationshipSchema.parse(await created.json());
  assert.equal(secret.gmOnly, true);
  for (const id of [inner.id, outer.id]) {
    const gm = EntityRelationshipSchema.array().parse(await (await fetch(`${baseUrl}/api/entity-relationships?entityId=${id}`)).json());
    assert.equal(gm.find((r) => r.id === secret.id)?.gmOnly, true);
    const player = await (await fetch(`${baseUrl}/api/entity-relationships?entityId=${id}&audience=player`)).json();
    assert.deepEqual(player, []);
  }
  const labels = await (await fetch(`${baseUrl}/api/entity-relationships/labels?audience=player`)).json() as string[];
  assert.ok(!labels.includes("concealed underneath"));
  const gmLabels = await (await fetch(`${baseUrl}/api/entity-relationships/labels`)).json() as string[];
  assert.ok(gmLabels.includes("concealed underneath"));
  const tree = await (await fetch(`${baseUrl}/api/entities/tree?audience=player`)).json() as { id: number; children: { id: number }[] }[];
  assert.ok(tree.some((e) => e.id === inner.id));
  assert.ok(!tree.find((e) => e.id === outer.id)?.children.some((e) => e.id === inner.id));
  const patch = (id: number, gmOnly: unknown) => fetch(`${baseUrl}/api/entity-relationships/${id}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ gmOnly }),
  });
  assert.equal((await patch(secret.id, "true")).status, 400);
  assert.equal((await patch(9999999, true)).status, 404);
  const published = await patch(secret.id, false);
  assert.equal(published.status, 200);
  assert.equal(EntityRelationshipSchema.parse(await published.json()).gmOnly, false);
  const playerLinks = EntityRelationshipSchema.array().parse(await (await fetch(`${baseUrl}/api/entity-relationships?entityId=${outer.id}&audience=player`)).json());
  assert.equal(playerLinks[0]?.id, secret.id);
  const publicTree = await (await fetch(`${baseUrl}/api/entities/tree?audience=player`)).json() as { id: number; children: { id: number }[] }[];
  assert.ok(publicTree.find((e) => e.id === outer.id)?.children.some((e) => e.id === inner.id));
  const publicLabels = await (await fetch(`${baseUrl}/api/entity-relationships/labels?audience=player`)).json() as string[];
  assert.ok(publicLabels.includes("concealed underneath"));
  assert.equal((await patch(secret.id, true)).status, 200);
});
