// Typed query helpers over the sound library, soundboards and their clips
// (bafft-c4d.1 / .5).
import { and, asc, desc, eq, like, max, or } from "drizzle-orm";
import type {
  BoardClip,
  SoundAsset,
  SoundAssetUpdate,
  SoundCategory,
  SoundClip,
  SoundClipInput,
  SoundClipUpdate,
  Soundboard,
  SoundboardWithClips,
  SoundSource,
} from "@bafft/shared";
import { db } from "./client.js";
import { soundAssets, soundClips, soundboards } from "./schema.js";

// ---------- library ----------

export async function listSoundAssets(filter: { q?: string; category?: SoundCategory; pack?: string } = {}): Promise<SoundAsset[]> {
  const conditions = [];
  if (filter.category) conditions.push(eq(soundAssets.category, filter.category));
  if (filter.q) {
    const pattern = `%${filter.q.replace(/[%_]/g, "")}%`;
    conditions.push(or(like(soundAssets.title, pattern), like(soundAssets.tags, pattern))!);
  }
  if (filter.pack) conditions.push(like(soundAssets.sourceId, `${filter.pack}/%`));
  return db
    .select()
    .from(soundAssets)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(soundAssets.id));
}

export async function createSoundAsset(
  values: Omit<SoundAsset, "id" | "campaignId" | "createdAt" | "audioPath" | "durationMs"> & { durationMs?: number | null },
): Promise<SoundAsset> {
  // The file's final home needs the asset id, so the path is set just after.
  const [row] = await db
    .insert(soundAssets)
    .values({ ...values, audioPath: "" })
    .returning();
  return row!;
}

export async function getSoundAsset(id: number): Promise<SoundAsset | undefined> {
  const [row] = await db.select().from(soundAssets).where(eq(soundAssets.id, id));
  return row;
}

export async function findSoundAssetBySource(source: SoundSource, sourceId: string): Promise<SoundAsset | undefined> {
  const [row] = await db
    .select()
    .from(soundAssets)
    .where(and(eq(soundAssets.source, source), eq(soundAssets.sourceId, sourceId)));
  return row;
}

export async function updateSoundAsset(
  id: number,
  update: SoundAssetUpdate & { audioPath?: string },
): Promise<SoundAsset | undefined> {
  if (Object.keys(update).length === 0) return getSoundAsset(id);
  const [row] = await db.update(soundAssets).set(update).where(eq(soundAssets.id, id)).returning();
  return row;
}

/**
 * Deletes a library track, unless a board still uses it: then nothing is
 * deleted and the names of those boards come back instead.
 */
export async function deleteSoundAsset(
  id: number,
): Promise<{ deleted: SoundAsset } | { usedOn: string[] } | undefined> {
  return db.transaction(async (tx) => {
    const [asset] = await tx.select().from(soundAssets).where(eq(soundAssets.id, id));
    if (!asset) return undefined;
    const usedOn = await tx
      .selectDistinct({ name: soundboards.name })
      .from(soundClips)
      .innerJoin(soundboards, eq(soundClips.boardId, soundboards.id))
      .where(eq(soundClips.assetId, id));
    if (usedOn.length > 0) return { usedOn: usedOn.map((b) => b.name) };
    await tx.delete(soundAssets).where(eq(soundAssets.id, id));
    return { deleted: asset };
  });
}

// ---------- boards ----------

export async function listSoundboards(): Promise<Soundboard[]> {
  return db.select().from(soundboards).orderBy(asc(soundboards.position), asc(soundboards.id));
}

export async function createSoundboard(name: string): Promise<Soundboard> {
  const [{ last }] = await db.select({ last: max(soundboards.position) }).from(soundboards);
  const [row] = await db
    .insert(soundboards)
    .values({ name, position: (last ?? -1) + 1 })
    .returning();
  return row!;
}

export async function getSoundboard(id: number): Promise<SoundboardWithClips | undefined> {
  const [board] = await db.select().from(soundboards).where(eq(soundboards.id, id));
  if (!board) return undefined;
  const rows = await db
    .select({ clip: soundClips, asset: soundAssets })
    .from(soundClips)
    .innerJoin(soundAssets, eq(soundClips.assetId, soundAssets.id))
    .where(eq(soundClips.boardId, id))
    .orderBy(asc(soundClips.position), asc(soundClips.id));
  const clips: BoardClip[] = rows.map(({ clip, asset }) => ({ ...clip, asset }));
  return { ...board, clips };
}

export async function renameSoundboard(id: number, name: string): Promise<Soundboard | undefined> {
  const [row] = await db.update(soundboards).set({ name }).where(eq(soundboards.id, id)).returning();
  return row;
}

/** Deletes the board and its clips. The library tracks they used stay. */
export async function deleteSoundboard(id: number): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [board] = await tx.select().from(soundboards).where(eq(soundboards.id, id));
    if (!board) return false;
    await tx.delete(soundClips).where(eq(soundClips.boardId, id));
    await tx.delete(soundboards).where(eq(soundboards.id, id));
    return true;
  });
}

// ---------- clips ----------

/** Puts a library track on a board. Undefined if the board or track doesn't exist. */
export async function createSoundClip(boardId: number, input: SoundClipInput): Promise<SoundClip | undefined> {
  const [board] = await db.select().from(soundboards).where(eq(soundboards.id, boardId));
  const asset = await getSoundAsset(input.assetId);
  if (!board || !asset) return undefined;
  const [{ last }] = await db
    .select({ last: max(soundClips.position) })
    .from(soundClips)
    .where(eq(soundClips.boardId, boardId));
  const [row] = await db
    .insert(soundClips)
    .values({
      ...input,
      boardId,
      name: input.name ?? asset.title,
      // Music and ambience are background: they loop until stopped.
      kind: input.kind ?? (asset.category === "sfx" ? "one-shot" : "loop"),
      position: (last ?? -1) + 1,
    })
    .returning();
  return row!;
}

export async function updateSoundClip(id: number, update: SoundClipUpdate): Promise<SoundClip | undefined> {
  if (Object.keys(update).length === 0) {
    const [row] = await db.select().from(soundClips).where(eq(soundClips.id, id));
    return row;
  }
  const [row] = await db.update(soundClips).set(update).where(eq(soundClips.id, id)).returning();
  return row;
}

export async function deleteSoundClip(id: number): Promise<boolean> {
  const rows = await db.delete(soundClips).where(eq(soundClips.id, id)).returning();
  return rows.length > 0;
}

/**
 * Sets the board's clip order to `clipIds`. Returns false (changing nothing)
 * unless `clipIds` is exactly the board's clips, so a stale client can't
 * drop or duplicate one.
 */
export async function reorderSoundClips(boardId: number, clipIds: number[]): Promise<boolean> {
  return db.transaction(async (tx) => {
    const current = await tx.select({ id: soundClips.id }).from(soundClips).where(eq(soundClips.boardId, boardId));
    const have = new Set(current.map((c) => c.id));
    if (clipIds.length !== have.size || new Set(clipIds).size !== clipIds.length || !clipIds.every((id) => have.has(id))) {
      return false;
    }
    for (const [position, id] of clipIds.entries()) {
      await tx.update(soundClips).set({ position }).where(eq(soundClips.id, id));
    }
    return true;
  });
}
