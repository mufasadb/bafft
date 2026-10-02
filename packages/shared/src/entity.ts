// Entity domain model — the polymorphic glossary/graph-node table (bafft-wg1.2).
// Zod is the single source of truth: server derives its Drizzle column
// constraints from these same enums, web gets the same types for free.
import { z } from "zod";
// Package path, not "./npc.js": see the note at the top of npc.ts.
import { NpcProfileSchema } from "@bafft/shared/npc";

export const ENTITY_TYPES = [
  "player",
  "character",
  "npc",
  "item",
  "location",
  // A group rather than a person: a company, guild, cult (bafft-w8f.5).
  "faction",
] as const;
export const EntityTypeSchema = z.enum(ENTITY_TYPES);
export type EntityType = z.infer<typeof EntityTypeSchema>;

/** The full row shape, as read back from the database. */
export const EntitySchema = z.object({
  id: z.number().int().positive(),
  campaignId: z.number().int().positive(),
  type: EntityTypeSchema,
  name: z.string().min(1),
  // Other real names/spellings (nicknames, alternate spellings). Compiled
  // into the ASR keyterm list, which vendors treat as spellings to *output*,
  // so pronunciation hints must not go here (bafft-aar).
  aliases: z.array(z.string()),
  // How the name is said ("fyord"). Never sent as ASR keyterms — it would be
  // written into transcripts. Shown to the GM as a pronunciation guide.
  soundsLike: z.array(z.string()),
  notes: z.string().nullable(),
  // Loose, filterable labels — not a fixed vocabulary. See bafft-yh2 design doc.
  tags: z.array(z.string()),
  // AI-offered "color and quirks" bullets — always arrives as an editable
  // draft; nothing here is written without the owner approving it first.
  quirks: z.array(z.string()),
  // Set once a "picture this" generation is accepted.
  imagePath: z.string().nullable(),
  // Structured NPC details (bafft-vm8.1); null for other types.
  profile: NpcProfileSchema.nullable(),
  // coerce: this schema validates both raw DB rows (real Date objects) and
  // parsed HTTP JSON responses (ISO date strings, since JSON has no Date type).
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Entity = z.infer<typeof EntitySchema>;

/** Shape for creating a new entity — id/timestamps are server-assigned. */
export const EntityInputSchema = EntitySchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  campaignId: z.number().int().positive().default(1),
  aliases: z.array(z.string()).default([]),
  soundsLike: z.array(z.string()).default([]),
  notes: z.string().nullable().default(null),
  tags: z.array(z.string()).default([]),
  quirks: z.array(z.string()).default([]),
  imagePath: z.string().nullable().default(null),
  profile: NpcProfileSchema.nullable().default(null),
});
export type EntityInput = z.infer<typeof EntityInputSchema>;

/** Shape for editing an existing entity — every field optional, id fixed by the route param. */
export const EntityUpdateSchema = EntityInputSchema.omit({ campaignId: true }).partial();
export type EntityUpdate = z.infer<typeof EntityUpdateSchema>;

/**
 * A relationship between any two entities, of any types — replaces an
 * earlier single parentId+relationType pair on Entity, which could only
 * hold one relationship per entity. `description` is free text ("owner of",
 * "born in", "located in", ...), deliberately not a fixed enum. isContainment
 * marks the one relation kind that's inheritable — the location-hierarchy
 * "part of" family, meaningful only between two type="location" entities —
 * so filtering by a location can also surface everything nested inside it.
 * See the 2026-09-19/20 design conversation for the full reasoning.
 */
export const EntityRelationshipSchema = z.object({
  id: z.number().int().positive(),
  fromEntityId: z.number().int().positive(),
  toEntityId: z.number().int().positive(),
  description: z.string().min(1),
  isContainment: z.boolean(),
  // A private link is visible only to the GM, from either endpoint.
  gmOnly: z.boolean().default(false),
  createdAt: z.coerce.date(),
});
export type EntityRelationship = z.infer<typeof EntityRelationshipSchema>;

export const EntityRelationshipInputSchema = EntityRelationshipSchema.omit({
  id: true,
  createdAt: true,
}).extend({
  isContainment: z.boolean().default(false),
  gmOnly: z.boolean().optional(),
});
export type EntityRelationshipInput = z.infer<typeof EntityRelationshipInputSchema>;

export type EntityWithChildren = Entity & { children: EntityWithChildren[] };

// z.lazy + an explicit type annotation, since a recursive type can't be
// inferred back from the schema the way EntitySchema's Entity is. Input is
// `unknown` because profile defaults make the input shape looser than Entity.
export const EntityWithChildrenSchema: z.ZodType<EntityWithChildren, z.ZodTypeDef, unknown> = EntitySchema.extend({
  children: z.lazy(() => EntityWithChildrenSchema.array()),
});

/**
 * Nests entities into a tree by walking containment relationships (rather
 * than a parentId column) — roots are entities with no containment edge
 * pointing out of them, or whose target isn't in the given set. Pure/DB-free
 * so both server and the web glossary UI can reuse it: e.g. server-side,
 * `buildEntityTree(locations, await listContainmentEdges())`, or client-side
 * over an already-fetched list + edge set.
 */
export function buildEntityTree(
  entities: Entity[],
  containmentEdges: Pick<EntityRelationship, "fromEntityId" | "toEntityId">[],
): EntityWithChildren[] {
  const parentIdOf = new Map<number, number>(
    containmentEdges.map((edge) => [edge.fromEntityId, edge.toEntityId]),
  );
  const byId = new Map<number, EntityWithChildren>(
    entities.map((e) => [e.id, { ...e, children: [] }]),
  );
  const roots: EntityWithChildren[] = [];
  for (const entity of byId.values()) {
    const parentId = parentIdOf.get(entity.id);
    const parent = parentId != null ? byId.get(parentId) : undefined;
    if (parent) {
      parent.children.push(entity);
    } else {
      roots.push(entity);
    }
  }
  return roots;
}

/**
 * One row of the glossary screen (bafft-w8f.1): an entity's names, and which
 * of them are left out of the transcription vocabulary because they're made
 * of everyday words the vendor already spells right.
 */
export const GlossaryEntrySchema = z.object({
  id: z.number().int().positive(),
  type: EntityTypeSchema,
  name: z.string(),
  aliases: z.array(z.string()),
  soundsLike: z.array(z.string()),
  skipped: z.array(z.string()),
});
export type GlossaryEntry = z.infer<typeof GlossaryEntrySchema>;
