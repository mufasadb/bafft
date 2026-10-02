// Freesound as a sound-effects source (bafft-c4d.8): rock slides, screams,
// door slams. Unlike the other catalogues it's searched live through
// APIv2 with a token (no OAuth: previews are enough at the table), limited
// to Creative Commons licences. Adding one copies its high-quality mp3
// preview into the library with the credit line its licence asks for.
import type { CatalogueTrack, SoundCategory } from "@bafft/shared";
import { catalogueDeps, USER_AGENT } from "./catalogues.js";

export const freesoundKey = () => process.env.FREESOUND_API_KEY ?? "";

type Track = Omit<CatalogueTrack, "keptAssetId">;

interface FreesoundSound {
  id: number;
  name: string;
  tags: string[];
  description?: string;
  license: string;
  username: string;
  duration: number;
  previews: Record<string, string>;
}

const FIELDS = "id,name,tags,description,license,username,duration,previews";
const LICENCES = 'license:("Creative Commons 0" OR "Attribution" OR "Attribution NonCommercial")';
/** Longer than this it's a soundscape, not a one-shot. */
const AMBIENCE_S = 30;

/** "https://creativecommons.org/licenses/by-nc/4.0/" -> "CC BY-NC 4.0"; CC0 -> "CC0 1.0". */
export function licenceName(url: string): string {
  if (/publicdomain\/zero/.test(url)) return "CC0 1.0";
  const m = /licenses\/([a-z-]+)\/(\d\.\d)/.exec(url);
  return m ? `CC ${m[1]!.toUpperCase()} ${m[2]}` : url;
}

export function toTrack(s: FreesoundSound): Track {
  const title = s.name.replace(/\.(wav|mp3|ogg|flac|aiff?|m4a)$/i, "").replace(/[_]+/g, " ").trim() || s.name;
  const licence = licenceName(s.license);
  return {
    source: "freesound",
    sourceId: String(s.id),
    title,
    description: s.description ? s.description.replace(/<[^>]+>/g, "").slice(0, 200) : null,
    category: s.duration > AMBIENCE_S ? "ambience" : "sfx",
    tags: s.tags.slice(0, 12),
    durationMs: Math.round(s.duration * 1000),
    previewUrl: s.previews["preview-hq-mp3"] ?? s.previews["preview-lq-mp3"]!,
    imageUrl: null,
    licence,
    attribution: `“${title}” by ${s.username} (freesound.org/s/${s.id}), ${licence}`,
  };
}

async function call<T>(path: string, params: Record<string, string>, fetcher: typeof fetch): Promise<T> {
  const url = new URL(`https://freesound.org/apiv2/${path}`);
  url.search = new URLSearchParams({ ...params, token: freesoundKey() }).toString();
  const res = await fetcher(url, { headers: { "user-agent": USER_AGENT } });
  if (!res.ok) throw new Error(`Freesound: HTTP ${res.status}`);
  return (await res.json()) as T;
}

// Searching is live and rate-limited (60 a minute), so the same search within
// the hour is answered from memory.
const recent = new Map<string, { at: number; tracks: Track[] }>();
const MAX_AGE_MS = 60 * 60 * 1000;

/** Sounds matching `q`, best first; music isn't Freesound's thing, so asking for music finds nothing. */
export async function searchFreesound(q: string, category?: SoundCategory, fetcher: typeof fetch = catalogueDeps.fetch): Promise<Track[]> {
  if (!freesoundKey() || !q.trim() || category === "music") return [];
  const key = `${category ?? ""}|${q.trim().toLowerCase()}`;
  const hit = recent.get(key);
  if (hit && Date.now() - hit.at < MAX_AGE_MS) return hit.tracks;
  const duration = category === "sfx" ? ` duration:[0 TO ${AMBIENCE_S}]` : category === "ambience" ? ` duration:[${AMBIENCE_S} TO *]` : "";
  const body = await call<{ results: FreesoundSound[] }>(
    "search/text/",
    { query: q.trim(), filter: LICENCES + duration, fields: FIELDS, page_size: "30" },
    fetcher,
  );
  const tracks = body.results.map(toTrack);
  recent.set(key, { at: Date.now(), tracks });
  return tracks;
}

/** One sound by id, for adding it to the library. */
export async function getFreesound(id: string, fetcher: typeof fetch = catalogueDeps.fetch): Promise<Track | null> {
  if (!/^\d+$/.test(id)) return null;
  try {
    return toTrack(await call<FreesoundSound>(`sounds/${id}/`, { fields: FIELDS }, fetcher));
  } catch {
    return null;
  }
}

/** Test hook. */
export function clearFreesoundMemory() {
  recent.clear();
}
