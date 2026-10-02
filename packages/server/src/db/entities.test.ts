// Uses dynamic imports after pointing BAFFT_DATA_DIR at a scratch dir, so
// this hermetic test DB is picked up instead of the real dev data/bafft.db
// (config.ts reads the env var once at module-eval time, before a static
// import would let us set it).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EntityInputSchema, EntityRelationshipInputSchema } from "@bafft/shared";

process.env.BAFFT_DATA_DIR = mkdtempSync(join(tmpdir(), "bafft-test-"));

const { migrate } = await import("drizzle-orm/libsql/migrator");
const { db, client } = await import("./client.js");
const { config } = await import("../config.js");
const { createEntity, getEntity, listEntities, getLocationTree, compileKeyterms, listGlossary } = await import(
  "./entities.js"
);
const { createRelationship, listRelationshipsFor, RelationshipError } = await import(
  "./entity-relationships.js"
);
const { entities } = await import("./schema.js");

before(async () => {
  await migrate(db, { migrationsFolder: config.migrationsDir });
});

after(() => {
  client.close();
  rmSync(config.dataDir, { recursive: true, force: true });
});

test("location tree + an npc with multiple relationships to a location", async () => {
  const lethara = await createEntity(
    EntityInputSchema.parse({ type: "location", name: "Lethara" }),
  );
  const docks = await createEntity(
    EntityInputSchema.parse({ type: "location", name: "The Docks" }),
  );
  await createRelationship(
    EntityRelationshipInputSchema.parse({
      fromEntityId: docks.id,
      toEntityId: lethara.id,
      description: "located in",
      isContainment: true,
    }),
  );
  const verity = await createEntity(
    EntityInputSchema.parse({
      type: "npc",
      name: "Verity Gille Onchon",
      aliases: ["Queen Verity", "the Queen of Andor"],
      notes: "Current Queen of Andor.",
    }),
  );
  // An npc isn't a location, so its relationships to one are never
  // containment — this is the case a single parentId column couldn't hold:
  // Verity both rules Lethara AND was born in the Docks.
  await createRelationship(
    EntityRelationshipInputSchema.parse({
      fromEntityId: verity.id,
      toEntityId: lethara.id,
      description: "leads",
    }),
  );
  await createRelationship(
    EntityRelationshipInputSchema.parse({
      fromEntityId: verity.id,
      toEntityId: docks.id,
      description: "born in",
    }),
  );

  const tree = await getLocationTree();
  const letharaNode = tree.find((n) => n.id === lethara.id);
  assert.ok(letharaNode, "Lethara should be a root of the location tree");
  assert.equal(letharaNode!.children.length, 1);
  assert.equal(letharaNode!.children[0]!.id, docks.id);
  // The npc isn't a location, so it must not show up in the location tree.
  assert.ok(!tree.some((n) => n.id === verity.id));

  const readBack = await getEntity(verity.id);
  assert.equal(readBack?.type, "npc");
  assert.deepEqual(readBack?.aliases, ["Queen Verity", "the Queen of Andor"]);

  const verityRelationships = await listRelationshipsFor(verity.id);
  assert.equal(verityRelationships.length, 2);
  assert.ok(verityRelationships.some((r) => r.description === "leads" && r.toEntityId === lethara.id));
  assert.ok(verityRelationships.some((r) => r.description === "born in" && r.toEntityId === docks.id));

  const npcs = await listEntities({ type: "npc" });
  assert.ok(npcs.some((e) => e.id === verity.id));
});

test("location tree nests to arbitrary depth (country > state > town)", async () => {
  const country = await createEntity(
    EntityInputSchema.parse({ type: "location", name: "Andor" }),
  );
  const state = await createEntity(
    EntityInputSchema.parse({ type: "location", name: "Southern Andor" }),
  );
  const town = await createEntity(
    EntityInputSchema.parse({ type: "location", name: "Falme" }),
  );
  await createRelationship(
    EntityRelationshipInputSchema.parse({
      fromEntityId: state.id,
      toEntityId: country.id,
      description: "located in",
      isContainment: true,
    }),
  );
  await createRelationship(
    EntityRelationshipInputSchema.parse({
      fromEntityId: town.id,
      toEntityId: state.id,
      description: "located in",
      isContainment: true,
    }),
  );

  const tree = await getLocationTree();
  const countryNode = tree.find((n) => n.id === country.id);
  const stateNode = countryNode?.children.find((n) => n.id === state.id);
  const townNode = stateNode?.children.find((n) => n.id === town.id);
  assert.ok(stateNode, "state should nest under country");
  assert.ok(townNode, "town should nest under state, two levels deep");
});

test("isContainment is rejected between two non-locations", async () => {
  const alice = await createEntity(EntityInputSchema.parse({ type: "npc", name: "Alice" }));
  const bob = await createEntity(EntityInputSchema.parse({ type: "npc", name: "Bob" }));
  await assert.rejects(
    () =>
      createRelationship(
        EntityRelationshipInputSchema.parse({
          fromEntityId: alice.id,
          toEntityId: bob.id,
          description: "sibling of",
          isContainment: true,
        }),
      ),
    RelationshipError,
  );
});

test("an entity can have at most one outgoing containment relationship", async () => {
  const town = await createEntity(EntityInputSchema.parse({ type: "location", name: "Two-state town" }));
  const stateA = await createEntity(EntityInputSchema.parse({ type: "location", name: "State A" }));
  const stateB = await createEntity(EntityInputSchema.parse({ type: "location", name: "State B" }));
  await createRelationship(
    EntityRelationshipInputSchema.parse({
      fromEntityId: town.id,
      toEntityId: stateA.id,
      description: "located in",
      isContainment: true,
    }),
  );
  await assert.rejects(() =>
    createRelationship(
      EntityRelationshipInputSchema.parse({
        fromEntityId: town.id,
        toEntityId: stateB.id,
        description: "located in",
        isContainment: true,
      }),
    ),
  );
});

test("entities_type_check rejects a type outside the enum", async () => {
  await assert.rejects(() =>
    db.insert(entities).values({
      // Deliberately bypassing the Zod/TS enum to prove the SQL-level
      // CHECK constraint (not just the TS type) actually enforces this.
      type: "dragon" as unknown as "npc",
      name: "should not insert",
      aliases: [],
    }),
  );
});

test("compileKeyterms sends names and aliases, never sounds-like hints (bafft-aar)", async () => {
  const fjord = await createEntity(
    EntityInputSchema.parse({ type: "character", name: "Fjord", aliases: ["Tusktooth"], soundsLike: ["fyord"] }),
  );
  assert.deepEqual((await getEntity(fjord.id))?.soundsLike, ["fyord"]);

  const keyterms = await compileKeyterms();
  assert.ok(keyterms.includes("Fjord"));
  assert.ok(keyterms.includes("Tusktooth"));
  assert.ok(!keyterms.includes("fyord"));
});

test("compileKeyterms leaves out names made of everyday words; the glossary says so (bafft-w8f.1)", async () => {
  const hold = await createEntity(
    EntityInputSchema.parse({ type: "location", name: "The keep", aliases: ["Velnar Torvale"] }),
  );
  await createEntity(EntityInputSchema.parse({ type: "npc", name: "Tavia Kelvor", aliases: ["the Warden"] }));

  const keyterms = await compileKeyterms();
  assert.ok(!keyterms.includes("The keep"));
  assert.ok(!keyterms.includes("the Warden"));
  assert.ok(keyterms.includes("Velnar Torvale"));
  assert.ok(keyterms.includes("Tavia Kelvor"));

  const row = (await listGlossary()).find((g) => g.id === hold.id);
  assert.deepEqual(row?.skipped, ["The keep"]);
  assert.deepEqual(row?.aliases, ["Velnar Torvale"]);
});

test("an NPC saved with the old four story fields reads back as one story (bafft-w8f.15)", async () => {
  const [row] = await db
    .insert(entities)
    .values({
      type: "npc",
      name: "Old-style Boran",
      aliases: [],
      profile: { hook: "a body in the cistern", helpReason: "owes the heroes", secret: "skims brandy", look: "red beard" },
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();
  const boran = await getEntity(row!.id);
  assert.deepEqual(boran?.profile, {
    look: "red beard",
    story: "Hook: a body in the cistern\nHelps if: owes the heroes\nSecret: skims brandy",
  });
});

test("Inside replaces parents atomically, rejects cycles and non-locations, and preserves ordinary links", async () => {
  const { setLocationInside } = await import("./entity-relationships.js");
  const make = (name: string, type: "location" | "npc" = "location") => createEntity(EntityInputSchema.parse({ name, type }));
  const outer = await make("Outer");
  const other = await make("Other");
  const inner = await make("Inner");
  const npc = await make("Keeper", "npc");
  await createRelationship(EntityRelationshipInputSchema.parse({ fromEntityId: inner.id, toEntityId: npc.id, description: "employs" }));
  await setLocationInside(inner.id, outer.id);
  await setLocationInside(inner.id, other.id);
  const parent = () => listRelationshipsFor(inner.id).then((rows) => rows.filter((r) => r.isContainment && r.fromEntityId === inner.id));
  assert.equal((await parent())[0]?.toEntityId, other.id);
  await setLocationInside(outer.id, inner.id);
  await assert.rejects(setLocationInside(inner.id, outer.id), RelationshipError);
  await assert.rejects(setLocationInside(inner.id, inner.id), RelationshipError);
  await assert.rejects(setLocationInside(inner.id, npc.id), RelationshipError);
  await assert.rejects(setLocationInside(npc.id, outer.id), RelationshipError);
  assert.equal((await parent())[0]?.toEntityId, other.id);
  await setLocationInside(inner.id, null);
  assert.equal((await parent()).length, 0);
  assert.ok((await listRelationshipsFor(inner.id)).some((r) => r.description === "employs"));
});

test("a location's old quirks read back as its physical description (bafft-w8f.16)", async () => {
  const hold = await createEntity(
    EntityInputSchema.parse({ type: "location", name: "The keep (old)", quirks: ["Built on the mountain.", "Steam vents."] }),
  );
  const read = await getEntity(hold.id);
  assert.deepEqual(read?.quirks, []);
  assert.equal(read?.profile?.description, "Built on the mountain.\nSteam vents.");
  const npc = await createEntity(EntityInputSchema.parse({ type: "npc", name: "Quirky", quirks: ["hums"] }));
  assert.deepEqual((await getEntity(npc.id))?.quirks, ["hums"], "other types keep their quirks");
});
