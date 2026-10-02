// External music/ambience catalogues for the sound library (bafft-c4d.6).
// Both publish their whole track list as JSON; bafft fetches it at most once
// a day, searches it locally, and only downloads a track when the owner keeps
// it. Previews stream straight from the source.
//
// - Tabletop Audio: ~500 ten-minute ambiences made for tabletop games.
//   CC BY-NC-ND 4.0 (fine at a home table; not for anything commercial or edited).
// - Incompetech (Kevin MacLeod): ~1,400 music tracks. CC BY 4.0, credit required.
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CatalogueSource, CatalogueTrack, SoundCategory } from "@bafft/shared";
import { config } from "../config.js";
import { folderTracks, loadFolderIndex } from "./folder.js";

/** The catalogues that live online; the Tower folder is local (see folder.ts). */
/** Freesound is searched live instead (see freesound.ts). */
type OnlineSource = Exclude<CatalogueSource, "folder" | "freesound">;

export const USER_AGENT = "bafft/0.1 (personal TTRPG campaign tool)";

// Tests swap this for recorded fixtures; nothing in a test touches the network.
export const catalogueDeps: { fetch: typeof fetch } = { fetch: (...args) => fetch(...args) };
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export const CATALOGUE_URLS: Record<OnlineSource, string> = {
  "tabletop-audio": "https://tabletopaudio.com/tta_data",
  incompetech: "https://incompetech.com/music/royalty-free/pieces.json",
};

type Track = Omit<CatalogueTrack, "keptAssetId">;

interface TtaTrack {
  key: number;
  track_title: string;
  track_type: string;
  track_genre: string[];
  flavor_text?: string;
  link: string;
  large_image?: string;
  tags?: string[];
}

interface IncompetechPiece {
  title: string;
  filename: string;
  length?: string;
  instruments?: string | null;
  description?: string | null;
  feel?: string | null;
}

const splitList = (s: string | null | undefined) =>
  (s ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

/** "00:05:07" -> 307000 */
export function clockToMs(clock: string | undefined): number | null {
  const parts = clock?.split(":").map(Number);
  if (!parts || parts.some(Number.isNaN)) return null;
  return parts.reduce((total, n) => total * 60 + n, 0) * 1000;
}

export function parseTabletopAudio(json: { tracks: TtaTrack[] }): Track[] {
  return json.tracks.map((t) => {
    // Their types run from "ambience" through "ambience + music" to "music";
    // whichever comes first is what the track mostly is.
    const category: SoundCategory = t.track_type.trim().startsWith("music") ? "music" : "ambience";
    return {
      source: "tabletop-audio",
      sourceId: String(t.key),
      title: t.track_title,
      description: t.flavor_text || null,
      category,
      tags: [...new Set([...t.track_genre.flatMap((g) => splitList(g)), ...(t.tags ?? [])])],
      durationMs: null,
      previewUrl: t.link,
      imageUrl: t.large_image || null,
      licence: "CC BY-NC-ND 4.0",
      attribution: `“${t.track_title}” by Tabletop Audio (tabletopaudio.com), CC BY-NC-ND 4.0`,
    };
  });
}

export function parseIncompetech(json: IncompetechPiece[]): Track[] {
  return json.map((p) => ({
    source: "incompetech",
    sourceId: p.filename,
    title: p.title,
    description: [p.description, p.instruments && `Instruments: ${p.instruments}`].filter(Boolean).join(" ") || null,
    category: "music",
    tags: splitList(p.feel),
    durationMs: clockToMs(p.length),
    previewUrl: `https://incompetech.com/music/royalty-free/mp3-royaltyfree/${encodeURIComponent(p.filename)}`,
    imageUrl: null,
    licence: "CC BY 4.0",
    // The credit line Incompetech asks for, verbatim apart from the title.
    attribution: `“${p.title}” Kevin MacLeod (incompetech.com) Licensed under Creative Commons: By Attribution 4.0 License http://creativecommons.org/licenses/by/4.0/`,
  }));
}

const PARSERS: Record<OnlineSource, (json: never) => Track[]> = {
  "tabletop-audio": parseTabletopAudio,
  incompetech: parseIncompetech,
};

const memory = new Map<OnlineSource, { at: number; tracks: Track[] }>();

/**
 * The whole catalogue, from memory, then the on-disk copy, then the source.
 * A copy older than a day is refreshed; if the source is down, a stale copy
 * still beats nothing.
 */
export async function loadCatalogue(source: CatalogueSource, fetcher: typeof fetch = catalogueDeps.fetch): Promise<Track[]> {
  if (source === "folder") return folderTracks(await loadFolderIndex());
  if (source === "freesound") return [];
  const now = Date.now();
  const cached = memory.get(source);
  if (cached && now - cached.at < MAX_AGE_MS) return cached.tracks;

  const file = join(config.dataDir, "catalogues", `${source}.json`);
  const onDisk = await stat(file).catch(() => null);
  if (onDisk && now - onDisk.mtimeMs < MAX_AGE_MS) {
    const tracks = PARSERS[source](JSON.parse(await readFile(file, "utf8")) as never);
    memory.set(source, { at: onDisk.mtimeMs, tracks });
    return tracks;
  }

  try {
    const res = await fetcher(CATALOGUE_URLS[source], { headers: { "user-agent": USER_AGENT } });
    if (!res.ok) throw new Error(`${source} catalogue: HTTP ${res.status}`);
    const raw = await res.text();
    const tracks = PARSERS[source](JSON.parse(raw) as never);
    await mkdir(join(config.dataDir, "catalogues"), { recursive: true });
    await writeFile(file, raw);
    memory.set(source, { at: now, tracks });
    return tracks;
  } catch (err) {
    if (onDisk) {
      const tracks = PARSERS[source](JSON.parse(await readFile(file, "utf8")) as never);
      memory.set(source, { at: now, tracks });
      return tracks;
    }
    throw err;
  }
}

/** Test hook: forget what's cached in memory. */
export function clearCatalogueMemory() {
  memory.clear();
}

/**
 * Tracks matching every word of `q`, best first: a title hit beats a tag hit
 * beats a description hit. No query lists everything, newest first as the
 * source orders it.
 */
export function searchCatalogue(tracks: Track[], q: string, limit = 50): Track[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return tracks.slice(0, limit);
  const scored: { track: Track; score: number }[] = [];
  for (const track of tracks) {
    const title = track.title.toLowerCase();
    const tags = track.tags.join(" ").toLowerCase();
    const description = (track.description ?? "").toLowerCase();
    let score = 0;
    for (const w of words) {
      const hit = title.includes(w) ? 3 : tags.includes(w) ? 2 : description.includes(w) ? 1 : 0;
      if (hit === 0) {
        score = 0;
        break;
      }
      score += hit;
    }
    if (score > 0) scored.push({ track, score });
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.track);
}
