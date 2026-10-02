// Keeps data/images-tmp/ and data/images/ from collecting files nothing
// points at (bafft-ea7): discarded "picture this" generations, and picture
// folders left behind by deleted entities.
import { join } from "node:path";
import { readdir, rm, stat } from "node:fs/promises";
import { config } from "../config.js";

/** Staged generations older than this are assumed abandoned. Long enough
 * that a review in progress in an open tab survives a server restart. */
const STALE_TEMP_MS = 24 * 60 * 60 * 1000;

/** Removes an entity's whole picture folder. Missing folder is fine. */
export async function removeEntityImages(entityId: number): Promise<void> {
  await rm(join(config.imagesDir, String(entityId)), { recursive: true, force: true });
}

/** Deletes staged generations that were never accepted. Returns how many. */
export async function sweepStaleImageTemps(now: number = Date.now()): Promise<number> {
  let removed = 0;
  for (const name of await readdir(config.imagesTmpDir)) {
    const path = join(config.imagesTmpDir, name);
    if (now - (await stat(path)).mtimeMs > STALE_TEMP_MS) {
      await rm(path, { force: true });
      removed++;
    }
  }
  return removed;
}

/** Deletes picture folders whose entity no longer exists. Returns how many. */
export async function sweepOrphanedEntityImages(existingIds: Iterable<number>): Promise<number> {
  const keep = new Set([...existingIds].map(String));
  let removed = 0;
  for (const name of await readdir(config.imagesDir)) {
    if (!keep.has(name)) {
      await rm(join(config.imagesDir, name), { recursive: true, force: true });
      removed++;
    }
  }
  return removed;
}
