// Typed query helpers over the entity_relationships table — any entity can
// relate to any other, any number of times. See schema.ts's comment on
// entityRelationships for the full reasoning.
import { and, eq, or } from "drizzle-orm";
import type { EntityRelationship, EntityRelationshipInput } from "@bafft/shared";
import { db } from "./client.js";
import { entities, entityRelationships } from "./schema.js";

export class RelationshipError extends Error {}

function toRelationship(row: typeof entityRelationships.$inferSelect): EntityRelationship {
  return row;
}

/**
 * isContainment is only meaningful between two locations (see schema.ts) —
 * enforced here rather than as a DB CHECK, since SQLite can't cleanly
 * cross-reference entities.type from inside entity_relationships' own
 * constraint. The DB's partial unique index still enforces the one-parent
 * limit once a row is allowed through.
 */
export async function createRelationship(input: EntityRelationshipInput): Promise<EntityRelationship> {
  if (input.fromEntityId === input.toEntityId) {
    throw new RelationshipError("an entity can't have a relationship with itself");
  }
  if (input.isContainment) {
    const [[from], [to]] = await Promise.all([
      db.select().from(entities).where(eq(entities.id, input.fromEntityId)),
      db.select().from(entities).where(eq(entities.id, input.toEntityId)),
    ]);
    if (from?.type !== "location" || to?.type !== "location") {
      throw new RelationshipError("isContainment relationships must be between two locations");
    }
    // A containment loop drops every location in it out of the tree
    // (buildEntityTree finds no root), making them unreachable in the UI.
    const parentOf = new Map((await listContainmentEdges()).map((e) => [e.fromEntityId, e.toEntityId]));
    const seen = new Set<number>();
    for (let id: number | undefined = input.toEntityId; id != null && !seen.has(id); id = parentOf.get(id)) {
      seen.add(id);
      if (id === input.fromEntityId) {
        throw new RelationshipError("that would put a location inside itself");
      }
    }
  }
  const [row] = await db.insert(entityRelationships).values(input).returning();
  return toRelationship(row);
}

/** Every relationship touching an entity, either as the source or the target. */
export async function listRelationshipsFor(entityId: number, audience: "gm" | "player" = "gm"): Promise<EntityRelationship[]> {
  const rows = await db
    .select()
    .from(entityRelationships)
    .where(and(
      or(eq(entityRelationships.fromEntityId, entityId), eq(entityRelationships.toEntityId, entityId)),
      audience === "player" ? eq(entityRelationships.gmOnly, false) : undefined,
    ));
  return rows.map(toRelationship);
}

/** All containment edges (the location hierarchy) — feeds buildEntityTree. */
export async function listContainmentEdges(audience: "gm" | "player" = "gm"): Promise<EntityRelationship[]> {
  const rows = await db.select().from(entityRelationships).where(and(eq(entityRelationships.isContainment, true), audience === "player" ? eq(entityRelationships.gmOnly, false) : undefined));
  return rows.map(toRelationship);
}

/** Returns true if a row was actually deleted. */
export async function deleteRelationship(id: number): Promise<boolean> {
  const deleted = await db
    .delete(entityRelationships)
    .where(eq(entityRelationships.id, id))
    .returning({ id: entityRelationships.id });
  return deleted.length > 0;
}

/** Previously used verb phrases, de-duplicated for the label picker. */
export async function listRelationshipLabels(audience: "gm" | "player" = "gm"): Promise<string[]> {
  const rows = await db.selectDistinct({ description: entityRelationships.description }).from(entityRelationships)
    .where(audience === "player" ? eq(entityRelationships.gmOnly, false) : undefined);
  return [...new Set(rows.map((row) => row.description.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

/** Replace a location's parent atomically; rejected moves preserve the old parent. */
export async function setLocationInside(entityId: number, parentId: number | null): Promise<void> {
  await db.transaction(async (tx) => {
    const [entity] = await tx.select().from(entities).where(eq(entities.id, entityId));
    if (entity?.type !== "location") throw new RelationshipError("Inside is only available for locations");
    if (parentId !== null) {
      const [parent] = await tx.select().from(entities).where(eq(entities.id, parentId));
      if (parent?.type !== "location") throw new RelationshipError("Inside must name a location");
      const edges = await tx.select().from(entityRelationships).where(eq(entityRelationships.isContainment, true));
      const parentOf = new Map(edges.map((edge) => [edge.fromEntityId, edge.toEntityId]));
      const seen = new Set<number>();
      for (let id: number | undefined = parentId; id != null && !seen.has(id); id = parentOf.get(id)) {
        if (id === entityId) throw new RelationshipError("that would put a location inside itself");
        seen.add(id);
      }
    }
    await tx.delete(entityRelationships).where(and(eq(entityRelationships.fromEntityId, entityId), eq(entityRelationships.isContainment, true)));
    if (parentId !== null) {
      await tx.insert(entityRelationships).values({ fromEntityId: entityId, toEntityId: parentId, description: "is inside", isContainment: true });
    }
  });
}

/** Visibility belongs to the link, so both endpoints see the same setting. */
export async function setRelationshipGmOnly(id: number, gmOnly: boolean): Promise<EntityRelationship | undefined> {
  const [row] = await db.update(entityRelationships).set({ gmOnly })
    .where(eq(entityRelationships.id, id)).returning();
  return row ? toRelationship(row) : undefined;
}
