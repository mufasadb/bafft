// Typed query helpers over the entities table.
import { eq } from "drizzle-orm";
import type { Entity, EntityInput, EntityUpdate, GlossaryEntry } from "@bafft/shared";
import { buildEntityTree, foldLegacyStory, foldLocationQuirks, type EntityWithChildren } from "@bafft/shared";
import { db } from "./client.js";
import { entities } from "./schema.js";
import { listContainmentEdges } from "./entity-relationships.js";
import { isPlainPhrase } from "../asr/plain-words.js";

function toEntity(row: typeof entities.$inferSelect): Entity {
  return foldLocationQuirks({
    ...row,
    aliases: row.aliases as string[],
    soundsLike: row.soundsLike as string[],
    tags: row.tags as string[],
    quirks: row.quirks as string[],
    profile: row.profile ? foldLegacyStory(row.profile) : row.profile,
  });
}

export async function createEntity(input: EntityInput): Promise<Entity> {
  const [row] = await db.insert(entities).values(input).returning();
  return toEntity(row);
}

export async function getEntity(id: number): Promise<Entity | undefined> {
  const [row] = await db.select().from(entities).where(eq(entities.id, id));
  return row ? toEntity(row) : undefined;
}

export async function updateEntity(id: number, input: EntityUpdate): Promise<Entity | undefined> {
  const [row] = await db
    .update(entities)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(entities.id, id))
    .returning();
  return row ? toEntity(row) : undefined;
}

/** Returns true if a row was actually deleted. */
export async function deleteEntity(id: number): Promise<boolean> {
  const deleted = await db.delete(entities).where(eq(entities.id, id)).returning({ id: entities.id });
  return deleted.length > 0;
}

export async function listEntities(filter?: { type?: Entity["type"] }): Promise<Entity[]> {
  const rows = filter?.type
    ? await db.select().from(entities).where(eq(entities.type, filter.type))
    : await db.select().from(entities);
  return rows.map(toEntity);
}

/** All `location` entities, nested by containment relationship into a hierarchy. */
export async function getLocationTree(audience: "gm" | "player" = "gm"): Promise<EntityWithChildren[]> {
  const [locations, containmentEdges] = await Promise.all([
    listEntities({ type: "location" }),
    listContainmentEdges(audience),
  ]);
  return buildEntityTree(locations, containmentEdges);
}

/**
 * The current glossary snapshot compiled into an ASR keyterm/dictionary
 * payload — every entity name plus all its aliases, deduped. soundsLike
 * hints are deliberately left out: vendors output keyterms verbatim (bafft-aar). This table
 * *is* the glossary (see design spec); this is the one place that fact
 * turns into what actually gets sent to a TranscriptionProvider.
 */
export async function compileKeyterms(): Promise<string[]> {
  const all = await listEntities();
  const terms = all.flatMap((e) => [e.name, ...e.aliases]).filter((t) => !isPlainPhrase(t));
  return [...new Set(terms)];
}

/** Every entity's names for the glossary screen, flagging the ones
 * compileKeyterms leaves out as everyday words (bafft-w8f.1). */
export async function listGlossary(): Promise<GlossaryEntry[]> {
  const all = await listEntities();
  return all.map((e) => ({
    id: e.id,
    type: e.type,
    name: e.name,
    aliases: e.aliases,
    soundsLike: e.soundsLike,
    skipped: [e.name, ...e.aliases].filter(isPlainPhrase),
  }));
}
