// Sound library + soundboard API (bafft-c4d.1 / .5). Audio is uploaded once
// into the library (mp3/m4a/wav, the same staging pattern as session audio);
// a board's clips point at library tracks.
import { createWriteStream } from "node:fs";
import { extname, join, resolve } from "node:path";
import { mkdir, rename, rm, unlink } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Router } from "express";
import {
  BoardScenesSchema,
  CATALOGUE_SOURCES,
  CatalogueSearchSchema,
  CatalogueSourceSchema,
  type CatalogueSource,
  ClipOrderSchema,
  KeepTrackSchema,
  SOUND_FILE_EXTENSIONS,
  SoundAssetSchema,
  SoundAssetUpdateSchema,
  SoundAssetUploadSchema,
  SoundCategorySchema,
  SoundClipInputSchema,
  SoundClipSchema,
  SoundClipUpdateSchema,
  SoundboardInputSchema,
  SoundboardSchema,
  SoundboardWithClipsSchema,
} from "@bafft/shared";
import { config } from "../config.js";
import {
  createSoundAsset,
  createSoundClip,
  createSoundboard,
  deleteSoundAsset,
  findSoundAssetBySource,
  deleteSoundClip,
  deleteSoundboard,
  getSoundAsset,
  getSoundboard,
  listSoundAssets,
  listSoundboards,
  renameSoundboard,
  reorderSoundClips,
  updateSoundAsset,
  updateSoundClip,
} from "../db/soundboards.js";
import { db } from "../db/client.js";
import { entities, soundboards, soundAssets, soundClips } from "../db/schema.js";
import { ImportScanResultSchema, ImportStatusSchema } from "@bafft/shared";
import type { ImportScanResult } from "@bafft/shared";
import { eq as dbEq } from "drizzle-orm";
import { catalogueDeps, loadCatalogue, searchCatalogue, USER_AGENT } from "../sound/catalogues.js";
import { importPath, loadFolderIndex, scanFolder } from "../sound/folder.js";
import { freesoundKey, getFreesound, searchFreesound } from "../sound/freesound.js";
import { lookUpYouTube, searchYouTube, YouTubeSearchUnavailable } from "../sound/youtube.js";
import { AddYouTubeSchema, parseYouTubeRef, youTubeAudioPath, YouTubeResultSchema } from "@bafft/shared";
import { requirePositiveIntId } from "./params.js";
import { sanitizeFilename, stagedUpload } from "./uploads.js";

export const assetDir = (assetId: number) => join(config.soundsDir, String(assetId));

// ---------- /api/sound-assets: the library ----------

export const soundAssetsRouter = Router();
soundAssetsRouter.param("id", requirePositiveIntId);

soundAssetsRouter.get("/", async (req, res, next) => {
  try {
    const category = SoundCategorySchema.safeParse(req.query.category);
    const q = typeof req.query.q === "string" && req.query.q.trim() ? req.query.q.trim() : undefined;
    const pack = typeof req.query.pack === "string" && req.query.pack.trim() ? req.query.pack.trim() : undefined;
    res.json(SoundAssetSchema.array().parse(await listSoundAssets({ q, pack, category: category.success ? category.data : undefined })));
  } catch (err) {
    next(err);
  }
});

// The Tower folder (bafft-c4d.9/.10). Status reads the last scan's index; a
// scan re-walks the folder, refreshes library tracks that came from it, and
// drops the ones whose file has gone (unless a board still uses them).
soundAssetsRouter.get("/import-status", async (_req, res, next) => {
  try {
    if (!config.importDir) { res.json(ImportStatusSchema.parse({ enabled: false, root: null, packs: [], scannedAt: null })); return; }
    const index = await loadFolderIndex();
    res.json(ImportStatusSchema.parse({ enabled: true, root: config.importDir, packs: index?.packs ?? [], scannedAt: index?.scannedAt ?? null }));
  } catch (err) { next(err); }
});

soundAssetsRouter.post("/import-scan", async (_req, res, next) => {
  try {
    if (!config.importDir) { res.status(404).json({ error: "folder import is disabled" }); return; }
    const index = await scanFolder(config.importDir);
    const byPath = new Map(index.files.map((file) => [file.relative, file]));
    const inLibrary = await db.select().from(soundAssets).where(dbEq(soundAssets.source, "folder"));
    const result: ImportScanResult = { files: index.files.length, scannedAt: index.scannedAt, updated: 0, removed: 0, missing: 0 };
    await db.transaction(async (tx) => {
      for (const asset of inLibrary) {
        const file = asset.sourceId ? byPath.get(asset.sourceId) : undefined;
        if (file) {
          await tx.update(soundAssets).set({ title: file.title, category: file.category, tags: file.tags, licence: file.licence, attribution: file.attribution, audioPath: `import:${file.relative}` }).where(dbEq(soundAssets.id, asset.id));
          result.updated++;
        } else {
          const used = await tx.select({ id: soundClips.id }).from(soundClips).where(dbEq(soundClips.assetId, asset.id));
          if (used.length) { result.missing++; } else { await tx.delete(soundAssets).where(dbEq(soundAssets.id, asset.id)); result.removed++; }
        }
      }
    });
    res.json(ImportScanResultSchema.parse(result));
  } catch (err) { next(err); }
});

soundAssetsRouter.post("/", stagedUpload.single("audio"), async (req, res, next) => {
  const cleanupTemp = () => (req.file ? unlink(req.file.path).catch(() => {}) : undefined);
  try {
    if (!req.file) {
      res.status(400).json({ error: "audio file is required" });
      return;
    }
    const ext = extname(req.file.originalname).toLowerCase();
    if (!(SOUND_FILE_EXTENSIONS as readonly string[]).includes(ext)) {
      await cleanupTemp();
      res.status(400).json({ error: `audio must be ${SOUND_FILE_EXTENSIONS.join(", ")}` });
      return;
    }
    const parsed = SoundAssetUploadSchema.safeParse(req.body);
    if (!parsed.success) {
      await cleanupTemp();
      res.status(400).json({ error: "invalid upload", details: parsed.error.flatten() });
      return;
    }

    const asset = await createSoundAsset({
      title: parsed.data.title ?? req.file.originalname.slice(0, -ext.length),
      category: parsed.data.category,
      tags: parsed.data.tags,
      source: "upload",
      sourceId: null,
      licence: null,
      attribution: null,
    });
    const file = sanitizeFilename(req.file.originalname);
    await mkdir(assetDir(asset.id), { recursive: true });
    await rename(req.file.path, join(assetDir(asset.id), file));
    const saved = await updateSoundAsset(asset.id, { audioPath: join("sounds", String(asset.id), file) });
    res.status(201).json(SoundAssetSchema.parse(saved));
  } catch (err) {
    await cleanupTemp();
    next(err);
  }
});

soundAssetsRouter.get("/:id", async (req, res, next) => {
  try {
    const asset = await getSoundAsset(Number(req.params.id));
    if (!asset) {
      res.status(404).json({ error: "sound not found" });
      return;
    }
    res.json(SoundAssetSchema.parse(asset));
  } catch (err) {
    next(err);
  }
});

soundAssetsRouter.patch("/:id", async (req, res, next) => {
  try {
    const parsed = SoundAssetUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid sound update", details: parsed.error.flatten() });
      return;
    }
    const asset = await updateSoundAsset(Number(req.params.id), parsed.data);
    if (!asset) {
      res.status(404).json({ error: "sound not found" });
      return;
    }
    res.json(SoundAssetSchema.parse(asset));
  } catch (err) {
    next(err);
  }
});

soundAssetsRouter.delete("/:id", async (req, res, next) => {
  try {
    const result = await deleteSoundAsset(Number(req.params.id));
    if (!result) {
      res.status(404).json({ error: "sound not found" });
      return;
    }
    if ("usedOn" in result) {
      res.status(409).json({ error: `still on a board: ${result.usedOn.join(", ")}`, usedOn: result.usedOn });
      return;
    }
    await rm(assetDir(result.deleted.id), { recursive: true, force: true });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// The board fetches and decodes clips up front; long music streams. sendFile
// answers range requests for both.
soundAssetsRouter.get("/:id/audio", async (req, res, next) => {
  try {
    const asset = await getSoundAsset(Number(req.params.id));
    if (!asset) {
      res.status(404).json({ error: "sound not found" });
      return;
    }
    if (asset.source === "youtube") {
      res.status(409).json({ error: "YouTube tracks play in YouTube's player; there's no file to serve" });
      return;
    }
    const filePath = asset.audioPath.startsWith("import:")
      ? importPath(asset.audioPath.slice("import:".length))
      : resolve(config.dataDir, asset.audioPath);
    if (!filePath) {
      res.status(404).json({ error: "audio file missing" }); return;
    }
    res.sendFile(filePath, (err) => {
      if (err && !res.headersSent) res.status(404).json({ error: "audio file missing on disk" });
    });
  } catch (err) {
    next(err);
  }
});

// ---------- /api/soundboards ----------

export const soundboardsRouter = Router();
soundboardsRouter.param("id", requirePositiveIntId);

soundboardsRouter.get("/", async (_req, res, next) => {
  try {
    res.json(SoundboardSchema.array().parse(await listSoundboards()));
  } catch (err) {
    next(err);
  }
});

soundboardsRouter.post("/", async (req, res, next) => {
  try {
    const parsed = SoundboardInputSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid soundboard input", details: parsed.error.flatten() });
      return;
    }
    res.status(201).json(SoundboardSchema.parse(await createSoundboard(parsed.data.name)));
  } catch (err) {
    next(err);
  }
});

soundboardsRouter.get("/:id", async (req, res, next) => {
  try {
    const board = await getSoundboard(Number(req.params.id));
    if (!board) {
      res.status(404).json({ error: "soundboard not found" });
      return;
    }
    res.json(SoundboardWithClipsSchema.parse(board));
  } catch (err) {
    next(err);
  }
});

soundboardsRouter.put("/:id/scenes", async (req, res, next) => {
  try {
    const parsed = BoardScenesSchema.safeParse(req.body.scenes);
    if (!parsed.success) { res.status(400).json({ error: "invalid scenes" }); return; }
    const board = await getSoundboard(Number(req.params.id));
    if (!board) { res.status(404).json({ error: "soundboard not found" }); return; }
    for (const scene of parsed.data) {
      if (scene.locationId === null) continue;
      const [location] = await db.select().from(entities).where(dbEq(entities.id, scene.locationId));
      if (!location || location.type !== "location" || location.campaignId !== board.campaignId) {
        res.status(400).json({ error: "scene location must be a location in this campaign" }); return;
      }
    }
    await db.update(soundboards).set({ scenes: parsed.data }).where(dbEq(soundboards.id, board.id));
    res.json(SoundboardWithClipsSchema.parse(await getSoundboard(board.id)));
  } catch (err) { next(err); }
});

soundboardsRouter.patch("/:id", async (req, res, next) => {
  try {
    const parsed = SoundboardInputSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid soundboard input", details: parsed.error.flatten() });
      return;
    }
    const board = await renameSoundboard(Number(req.params.id), parsed.data.name);
    if (!board) {
      res.status(404).json({ error: "soundboard not found" });
      return;
    }
    res.json(SoundboardSchema.parse(board));
  } catch (err) {
    next(err);
  }
});

soundboardsRouter.delete("/:id", async (req, res, next) => {
  try {
    if (!(await deleteSoundboard(Number(req.params.id)))) {
      res.status(404).json({ error: "soundboard not found" });
      return;
    }
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

soundboardsRouter.post("/:id/clips", async (req, res, next) => {
  try {
    const parsed = SoundClipInputSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid clip input", details: parsed.error.flatten() });
      return;
    }
    const clip = await createSoundClip(Number(req.params.id), parsed.data);
    if (!clip) {
      res.status(404).json({ error: "soundboard or sound not found" });
      return;
    }
    res.status(201).json(SoundClipSchema.parse(clip));
  } catch (err) {
    next(err);
  }
});

soundboardsRouter.put("/:id/clip-order", async (req, res, next) => {
  try {
    const parsed = ClipOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid clip order", details: parsed.error.flatten() });
      return;
    }
    const boardId = Number(req.params.id);
    if (!(await reorderSoundClips(boardId, parsed.data.clipIds))) {
      res.status(409).json({ error: "clipIds must be exactly this board's clips" });
      return;
    }
    res.json(SoundboardWithClipsSchema.parse(await getSoundboard(boardId)));
  } catch (err) {
    next(err);
  }
});

// ---------- /api/sound-clips ----------

export const soundClipsRouter = Router();
soundClipsRouter.param("id", requirePositiveIntId);

soundClipsRouter.patch("/:id", async (req, res, next) => {
  try {
    const parsed = SoundClipUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid clip update", details: parsed.error.flatten() });
      return;
    }
    const clip = await updateSoundClip(Number(req.params.id), parsed.data);
    if (!clip) {
      res.status(404).json({ error: "clip not found" });
      return;
    }
    res.json(SoundClipSchema.parse(clip));
  } catch (err) {
    next(err);
  }
});

// Takes the clip off its board; the library track stays.
soundClipsRouter.delete("/:id", async (req, res, next) => {
  try {
    if (!(await deleteSoundClip(Number(req.params.id)))) {
      res.status(404).json({ error: "clip not found" });
      return;
    }
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// ---------- /api/catalogue: Tabletop Audio + Incompetech (bafft-c4d.6) ----------

export const catalogueRouter = Router();

// YouTube (bafft-w8f.17): search, and add a video or playlist to the library.
// Registered before GET / so "youtube" isn't read as a catalogue source.
catalogueRouter.get("/youtube", async (req, res, next) => {
  try {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (!q) {
      res.json([]);
      return;
    }
    let found;
    try {
      found = await searchYouTube(q);
    } catch (err) {
      if (err instanceof YouTubeSearchUnavailable) {
        res.status(503).json({ error: err.message });
        return;
      }
      res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
      return;
    }
    const withKept = await Promise.all(
      found.map(async (r) => ({
        ...r,
        keptAssetId: (await findSoundAssetBySource("youtube", `${r.kind}:${r.id}`))?.id ?? null,
      })),
    );
    res.json(YouTubeResultSchema.array().parse(withKept));
  } catch (err) {
    next(err);
  }
});

catalogueRouter.post("/youtube", async (req, res, next) => {
  try {
    const parsed = AddYouTubeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid YouTube track", details: parsed.error.flatten() });
      return;
    }
    const ref = parseYouTubeRef(parsed.data.url);
    if (!ref) {
      res.status(400).json({ error: "that isn't a YouTube video or playlist link" });
      return;
    }
    const sourceId = `${ref.kind}:${ref.id}`;
    const existing = await findSoundAssetBySource("youtube", sourceId);
    if (existing) {
      res.json(SoundAssetSchema.parse(existing));
      return;
    }
    const found = await lookUpYouTube(ref);
    if (!found && !parsed.data.title) {
      res.status(404).json({ error: "YouTube doesn't know that link, or it can't be embedded" });
      return;
    }
    const asset = await createSoundAsset({
      title: parsed.data.title?.trim() || found!.title,
      category: parsed.data.category,
      tags: [...new Set(["youtube", ...parsed.data.tags])],
      source: "youtube",
      sourceId,
      licence: "Streamed from YouTube (not stored)",
      attribution: found ? `${found.title} (${found.channel}, YouTube)` : null,
      durationMs: null,
    });
    const saved = await updateSoundAsset(asset.id, { audioPath: youTubeAudioPath(ref) });
    res.status(201).json(SoundAssetSchema.parse(saved));
  } catch (err) {
    next(err);
  }
});

// One search across every catalogue (bafft-c4d.10), or just `source`. A
// source that can't be reached is reported alongside the rest, not fatal.
catalogueRouter.get("/", async (req, res, next) => {
  try {
    const only = CatalogueSourceSchema.safeParse(req.query.source);
    if (req.query.source !== undefined && !only.success) {
      res.status(400).json({ error: `source must be one of ${CATALOGUE_SOURCES.join(", ")}` });
      return;
    }
    const category = SoundCategorySchema.safeParse(req.query.category);
    const q = typeof req.query.q === "string" ? req.query.q : "";
    const sources = (only.success ? [only.data] : CATALOGUE_SOURCES).filter(
      (s) => (s !== "folder" || config.importDir) && (s !== "freesound" || freesoundKey()),
    );
    // The folder's first search builds its index; after that it's kept until a rescan.
    if (sources.includes("folder") && config.importDir && !(await loadFolderIndex())) await scanFolder(config.importDir);
    const unavailable: { source: CatalogueSource; error: string }[] = [];
    const bySource = await Promise.all(
      sources.map(async (source) => {
        try {
          if (source === "freesound") return await searchFreesound(q, category.success ? category.data : undefined);
          const tracks = await loadCatalogue(source);
          return category.success ? tracks.filter((t) => t.category === category.data) : tracks;
        } catch (err) {
          unavailable.push({ source, error: err instanceof Error ? err.message : String(err) });
          return [];
        }
      }),
    );
    // With nothing typed, a taste of each source; otherwise the best matches from all of them.
    const local = bySource.filter((_, i) => sources[i] !== "freesound");
    const live = bySource[sources.indexOf("freesound")] ?? [];
    const ranked = q.trim() ? searchCatalogue(local.flat(), q, 80) : local.flatMap((tracks) => tracks.slice(0, 25));
    // Freesound ranks its own results; take them turn about with the rest.
    const found = interleave(ranked, live);
    const tracks = await Promise.all(
      found.map(async (t) => ({ ...t, keptAssetId: (await findSoundAssetBySource(t.source, t.sourceId))?.id ?? null })),
    );
    res.json(CatalogueSearchSchema.parse({ tracks, unavailable }));
  } catch (err) {
    next(err);
  }
});

function interleave<T>(a: T[], b: T[]): T[] {
  const out: T[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (i < a.length) out.push(a[i]!);
    if (i < b.length) out.push(b[i]!);
  }
  return out;
}

// A Tower folder track, streamed for previewing before it's in the library.
catalogueRouter.get("/folder/audio", (req, res) => {
  const filePath = typeof req.query.path === "string" ? importPath(req.query.path) : null;
  if (!filePath) {
    res.status(404).json({ error: "audio file missing" });
    return;
  }
  res.sendFile(filePath, (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: "audio file missing on disk" });
  });
});

// Copies a catalogue track into the library, with its licence and credit
// line. Keeping one that's already there just returns it.
catalogueRouter.post("/keep", async (req, res, next) => {
  try {
    const parsed = KeepTrackSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid keep request", details: parsed.error.flatten() });
      return;
    }
    const { source, sourceId } = parsed.data;
    const existing = await findSoundAssetBySource(source, sourceId);
    if (existing) {
      res.json(SoundAssetSchema.parse(existing));
      return;
    }
    const track = source === "freesound" ? await getFreesound(sourceId) : (await loadCatalogue(source)).find((t) => t.sourceId === sourceId);
    if (!track) {
      res.status(404).json({ error: "no such track in that catalogue" });
      return;
    }

    // A Tower folder track stays where it is; the library just points at it.
    if (source === "folder") {
      const asset = await createSoundAsset({
        title: track.title,
        category: track.category,
        tags: track.tags,
        source,
        sourceId,
        licence: track.licence || null,
        attribution: track.attribution || null,
        durationMs: null,
      });
      res.status(201).json(SoundAssetSchema.parse(await updateSoundAsset(asset.id, { audioPath: `import:${sourceId}` })));
      return;
    }
    const asset = await createSoundAsset({
      title: track.title,
      category: track.category,
      tags: track.tags,
      source,
      sourceId,
      licence: track.licence,
      attribution: track.attribution,
      durationMs: track.durationMs,
    });
    const file = sanitizeFilename(decodeURIComponent(new URL(track.previewUrl).pathname.split("/").pop() ?? "track.mp3"));
    try {
      const download = await catalogueDeps.fetch(track.previewUrl, { headers: { "user-agent": USER_AGENT } });
      if (!download.ok || !download.body) throw new Error(`download failed: HTTP ${download.status}`);
      await mkdir(assetDir(asset.id), { recursive: true });
      await pipeline(Readable.fromWeb(download.body as never), createWriteStream(join(assetDir(asset.id), file)));
    } catch (err) {
      // No half-kept tracks: the row and any partial file go.
      await deleteSoundAsset(asset.id);
      await rm(assetDir(asset.id), { recursive: true, force: true });
      res.status(502).json({ error: `couldn't download “${track.title}”: ${err instanceof Error ? err.message : err}` });
      return;
    }
    const saved = await updateSoundAsset(asset.id, { audioPath: join("sounds", String(asset.id), file) });
    res.status(201).json(SoundAssetSchema.parse(saved));
  } catch (err) {
    next(err);
  }
});
