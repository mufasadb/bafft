// The Tower folder (bafft-c4d.9, c4d.10): sound packs on the NAS, mounted
// read-only at BAFFT_IMPORT_DIR. Walking hundreds of files over the network is
// slow, so a scan writes an index to disk and everything else reads that until
// the next scan. Its tracks are a Find more source like Tabletop Audio: adding
// one to the library points at the file in place, nothing is copied.
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { extname, join, relative, resolve, sep } from "node:path";
import type { CatalogueTrack, SoundCategory } from "@bafft/shared";
import { config } from "../config.js";

const EXTENSIONS = new Set([".mp3", ".m4a", ".wav", ".ogg", ".flac"]);

type Sidecar = { pack?: string; category?: SoundCategory; licence?: string | null; attribution?: string | null; tags?: string[] };

export type FolderFile = {
  relative: string;
  title: string;
  pack: string;
  category: SoundCategory;
  licence: string | null;
  attribution: string | null;
  tags: string[];
};

export type FolderIndex = { scannedAt: string; files: FolderFile[]; packs: { pack: string; files: number }[] };

const indexFile = () => join(config.dataDir, "catalogues", "folder.json");
let memory: FolderIndex | null = null;

/** Every audio file under `root`, one pack per top-level folder, described by its optional bafft-source.json. */
export async function walkFolder(root: string): Promise<Omit<FolderIndex, "scannedAt">> {
  const files: FolderFile[] = [];
  const counts = new Map<string, number>();
  for (const pack of (await readdir(root, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!pack.isDirectory()) continue;
    const packDir = join(root, pack.name);
    let sidecar: Sidecar = {};
    try {
      sidecar = JSON.parse(await readFile(join(packDir, "bafft-source.json"), "utf8")) as Sidecar;
    } catch {
      /* optional */
    }
    const packName = sidecar.pack?.trim() || pack.name;
    const visit = async (dir: string, folders: string[]) => {
      for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.name === "bafft-source.json") continue;
        const absolute = join(dir, entry.name);
        if (entry.isDirectory()) await visit(absolute, [...folders, entry.name]);
        else if (entry.isFile() && EXTENSIONS.has(extname(entry.name).toLowerCase())) {
          const title = entry.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
          files.push({
            relative: relative(root, absolute).split(sep).join("/"),
            title,
            pack: packName,
            category: sidecar.category ?? "sfx",
            licence: sidecar.licence ?? null,
            attribution: sidecar.attribution ? sidecar.attribution.replace("{title}", title) : null,
            tags: [...(sidecar.tags ?? []), ...folders].map((tag) => tag.toLowerCase()),
          });
          counts.set(packName, (counts.get(packName) ?? 0) + 1);
        }
      }
    };
    await visit(packDir, []);
  }
  return { files, packs: [...counts].map(([pack, n]) => ({ pack, files: n })) };
}

/** Walks the folder and keeps the result until the next scan. */
export async function scanFolder(root: string): Promise<FolderIndex> {
  const index: FolderIndex = { scannedAt: new Date().toISOString(), ...(await walkFolder(root)) };
  await mkdir(join(config.dataDir, "catalogues"), { recursive: true });
  await writeFile(indexFile(), JSON.stringify(index));
  memory = index;
  return index;
}

/** The last scan, or null if the folder has never been scanned. */
export async function loadFolderIndex(): Promise<FolderIndex | null> {
  if (memory) return memory;
  try {
    memory = JSON.parse(await readFile(indexFile(), "utf8")) as FolderIndex;
  } catch {
    return null;
  }
  return memory;
}

/** Test hook. */
export function clearFolderMemory() {
  memory = null;
}

export const folderPreviewUrl = (rel: string) => `/api/catalogue/folder/audio?path=${encodeURIComponent(rel)}`;

export function folderTracks(index: FolderIndex | null): Omit<CatalogueTrack, "keptAssetId">[] {
  return (index?.files ?? []).map((f) => ({
    source: "folder",
    sourceId: f.relative,
    title: f.title,
    description: null,
    category: f.category,
    tags: [f.pack.toLowerCase(), ...f.tags],
    durationMs: null,
    previewUrl: folderPreviewUrl(f.relative),
    imageUrl: null,
    licence: f.licence ?? "",
    attribution: f.attribution ?? "",
  }));
}

/** A path under the import folder, or null if it's missing or tries to leave it. */
export function importPath(rel: string): string | null {
  if (!config.importDir) return null;
  const absolute = resolve(config.importDir, rel);
  const inside = relative(config.importDir, absolute);
  return inside === "" || inside === ".." || inside.startsWith(`..${sep}`) ? null : absolute;
}
