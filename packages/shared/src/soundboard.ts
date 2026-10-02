// Soundboard domain model (bafft-c4d). Audio lives once in the sound library
// (uploads, or tracks kept from a catalogue); a board's clips point at
// library tracks and carry their own per-board settings. Loops repeat until
// stopped; one-shots play once.
import { z } from "zod";

export const CLIP_KINDS = ["loop", "one-shot"] as const;
export const ClipKindSchema = z.enum(CLIP_KINDS);
export type ClipKind = z.infer<typeof ClipKindSchema>;

export const SOUND_CATEGORIES = ["music", "ambience", "sfx"] as const;
export const SoundCategorySchema = z.enum(SOUND_CATEGORIES);
export type SoundCategory = z.infer<typeof SoundCategorySchema>;

// Where a library track came from (bafft-c4d.6/.8 add the catalogues).
export const SOUND_SOURCES = ["upload", "tabletop-audio", "incompetech", "freesound", "folder", "youtube"] as const;
export const SoundSourceSchema = z.enum(SOUND_SOURCES);
export type SoundSource = z.infer<typeof SoundSourceSchema>;

export const SOUND_FILE_EXTENSIONS = [".mp3", ".m4a", ".wav", ".ogg", ".flac"] as const;

// The Tower folder (bafft-c4d.9/.10): a scan indexes it once and the index is
// kept until the next scan; its tracks are then a Find more source.
export const ImportStatusSchema = z.object({
  enabled: z.boolean(),
  root: z.string().nullable(),
  packs: z.array(z.object({ pack: z.string(), files: z.number().int().nonnegative() })),
  /** When the index was built; null means never scanned. */
  scannedAt: z.string().nullable(),
});
export type ImportStatus = z.infer<typeof ImportStatusSchema>;

export const ImportScanResultSchema = z.object({
  /** Audio files found in the folder. */
  files: z.number().int().nonnegative(),
  scannedAt: z.string(),
  /** Library tracks from the folder whose details were refreshed. */
  updated: z.number().int().nonnegative(),
  removed: z.number().int().nonnegative(),
  missing: z.number().int().nonnegative(),
});
export type ImportScanResult = z.infer<typeof ImportScanResultSchema>;

export const SoundAssetSchema = z.object({
  id: z.number().int().positive(),
  campaignId: z.number().int().positive(),
  title: z.string().min(1),
  category: SoundCategorySchema,
  tags: z.array(z.string()),
  source: SoundSourceSchema,
  // The catalogue's own id, so keeping the same track twice is a no-op.
  sourceId: z.string().nullable(),
  // e.g. "CC BY 4.0"; null for the owner's own uploads.
  licence: z.string().nullable(),
  // The credit line the licence asks for, shown in the library.
  attribution: z.string().nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  audioPath: z.string(),
  createdAt: z.coerce.date(),
});
export type SoundAsset = z.infer<typeof SoundAssetSchema>;

const blankToNull = (v: unknown) => (v === "" || v === undefined ? null : v);

// Multipart fields alongside an uploaded file. A blank title falls back to the file's name.
export const SoundAssetUploadSchema = z.object({
  title: z.preprocess(blankToNull, z.string().trim().min(1).nullable()).default(null),
  category: SoundCategorySchema.default("sfx"),
  // Comma-separated in a form.
  tags: z
    .preprocess(
      (v) => (typeof v === "string" ? v.split(",").map((t) => t.trim()).filter(Boolean) : v ?? []),
      z.array(z.string()),
    )
    .default([]),
});
export type SoundAssetUpload = z.infer<typeof SoundAssetUploadSchema>;

export const SoundAssetUpdateSchema = z
  .object({
    title: z.string().trim().min(1),
    category: SoundCategorySchema,
    tags: z.array(z.string().trim().min(1)),
    // The board learns a track's length when it decodes it, and reports it back.
    durationMs: z.number().int().nonnegative(),
  })
  .partial();
export type SoundAssetUpdate = z.infer<typeof SoundAssetUpdateSchema>;

export const SoundClipSchema = z.object({
  id: z.number().int().positive(),
  boardId: z.number().int().positive(),
  assetId: z.number().int().positive(),
  name: z.string().min(1),
  kind: ClipKindSchema,
  // Heading the board groups buttons under: a scene ("The Tavern") or a type ("Crowd").
  group: z.string().nullable(),
  volume: z.number().min(0).max(1),
  // 0 = starts at full volume. Stopping is always instant ("cut it dead").
  fadeInMs: z.number().int().min(0),
  colour: z.string().nullable(),
  position: z.number().int(),
  createdAt: z.coerce.date(),
});
export type SoundClip = z.infer<typeof SoundClipSchema>;

// A clip as the board needs it: its settings plus the library track it plays.
export const BoardClipSchema = SoundClipSchema.extend({ asset: SoundAssetSchema });
export type BoardClip = z.infer<typeof BoardClipSchema>;

export const BoardScenesSchema = z.array(z.object({
  name: z.string().trim().min(1).refine((name) => !["Unsorted", "__new__"].includes(name), "Reserved scene name"),
  locationId: z.number().int().positive().nullable(),
})).refine((scenes) => new Set(scenes.map((s) => s.name)).size === scenes.length, "Scene names must be unique");
export type BoardScene = z.infer<typeof BoardScenesSchema>[number];

export const SoundboardSchema = z.object({
  scenes: BoardScenesSchema.optional(),
  id: z.number().int().positive(),
  campaignId: z.number().int().positive(),
  name: z.string().min(1),
  position: z.number().int(),
  createdAt: z.coerce.date(),
});
export type Soundboard = z.infer<typeof SoundboardSchema>;

export const SoundboardWithClipsSchema = SoundboardSchema.extend({ clips: z.array(BoardClipSchema) });
export type SoundboardWithClips = z.infer<typeof SoundboardWithClipsSchema>;

export const SoundboardInputSchema = z.object({ name: z.string().trim().min(1) });
export type SoundboardInput = z.infer<typeof SoundboardInputSchema>;

// Put a library track on a board. Name defaults to the track's title; kind
// defaults to loop for music/ambience and one-shot for sound effects.
export const SoundClipInputSchema = z.object({
  assetId: z.number().int().positive(),
  name: z.string().trim().min(1).optional(),
  kind: ClipKindSchema.optional(),
  group: z.string().trim().min(1).nullable().default(null),
  volume: z.number().min(0).max(1).default(0.8),
  fadeInMs: z.number().int().min(0).max(60_000).default(0),
  colour: z.string().nullable().default(null),
});
export type SoundClipInput = z.infer<typeof SoundClipInputSchema>;

export const SoundClipUpdateSchema = z
  .object({
    name: z.string().trim().min(1),
    kind: ClipKindSchema,
    group: z.string().trim().min(1).nullable(),
    volume: z.number().min(0).max(1),
    fadeInMs: z.number().int().min(0).max(60_000),
    colour: z.string().nullable(),
  })
  .partial();
export type SoundClipUpdate = z.infer<typeof SoundClipUpdateSchema>;

export const ClipOrderSchema = z.object({ clipIds: z.array(z.number().int().positive()) });

// A track in an external catalogue (bafft-c4d.6), before it's kept. Previews
// stream straight from the source; keeping one copies it into the library.
export const CATALOGUE_SOURCES = ["tabletop-audio", "incompetech", "folder", "freesound"] as const;
export const CatalogueSourceSchema = z.enum(CATALOGUE_SOURCES);
export type CatalogueSource = z.infer<typeof CatalogueSourceSchema>;

export const CatalogueTrackSchema = z.object({
  source: CatalogueSourceSchema,
  sourceId: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  category: SoundCategorySchema,
  tags: z.array(z.string()),
  durationMs: z.number().int().nonnegative().nullable(),
  // Absolute for the online catalogues, a bafft path for the Tower folder.
  previewUrl: z.string().min(1),
  imageUrl: z.string().url().nullable(),
  licence: z.string(),
  attribution: z.string(),
  // Set when this track is already in the library.
  keptAssetId: z.number().int().positive().nullable(),
});
export type CatalogueTrack = z.infer<typeof CatalogueTrackSchema>;

/** One search across every catalogue; a source that couldn't be reached is named, not fatal. */
export const CatalogueSearchSchema = z.object({
  tracks: z.array(CatalogueTrackSchema),
  unavailable: z.array(z.object({ source: CatalogueSourceSchema, error: z.string() })),
});
export type CatalogueSearch = z.infer<typeof CatalogueSearchSchema>;

export const KeepTrackSchema = z.object({ source: CatalogueSourceSchema, sourceId: z.string().min(1) });

// ---------- YouTube (bafft-w8f.17) ----------
// Streamed, never stored: a YouTube track's audioPath is "youtube:video:<id>"
// or "youtube:playlist:<id>" and it plays in YouTube's own embedded player.

export const YOUTUBE_KINDS = ["video", "playlist"] as const;
export type YouTubeKind = (typeof YOUTUBE_KINDS)[number];
export interface YouTubeRef {
  kind: YouTubeKind;
  id: string;
}

const VIDEO_ID = /^[\w-]{11}$/;
const PLAYLIST_ID = /^(PL|OL|UU|FL|RD|LL)[\w-]{10,}$/;

/** A YouTube or YouTube Music link (or a bare id) as a video or playlist ref.
 * A link with both a video and a list plays the playlist. */
export function parseYouTubeRef(input: string): YouTubeRef | null {
  const text = input.trim();
  if (VIDEO_ID.test(text)) return { kind: "video", id: text };
  if (PLAYLIST_ID.test(text)) return { kind: "playlist", id: text };
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www|m|music)\./, "");
  if (host !== "youtube.com" && host !== "youtu.be" && host !== "youtube-nocookie.com") return null;
  const list = url.searchParams.get("list");
  if (list && PLAYLIST_ID.test(list)) return { kind: "playlist", id: list };
  const v =
    host === "youtu.be"
      ? url.pathname.slice(1)
      : url.searchParams.get("v") ?? url.pathname.match(/^\/(?:embed|shorts|live)\/([\w-]{11})/)?.[1] ?? "";
  return VIDEO_ID.test(v) ? { kind: "video", id: v } : null;
}

export const youTubeAudioPath = (ref: YouTubeRef) => `youtube:${ref.kind}:${ref.id}`;

/** The ref inside a YouTube track's audioPath; null for any other track. */
export function youTubeRefOf(audioPath: string): YouTubeRef | null {
  const m = audioPath.match(/^youtube:(video|playlist):([\w-]+)$/);
  return m ? { kind: m[1] as YouTubeKind, id: m[2]! } : null;
}

export const YouTubeResultSchema = z.object({
  kind: z.enum(YOUTUBE_KINDS),
  id: z.string(),
  title: z.string(),
  channel: z.string(),
  thumbnailUrl: z.string().url().nullable(),
  keptAssetId: z.number().int().positive().nullable(),
});
export type YouTubeResult = z.infer<typeof YouTubeResultSchema>;

export const AddYouTubeSchema = z.object({
  // A link or id; the server looks the title up when none is given.
  url: z.string().min(1),
  title: z.string().optional(),
  category: SoundCategorySchema.default("music"),
  tags: z.array(z.string()).default([]),
});
export type AddYouTube = z.infer<typeof AddYouTubeSchema>;
