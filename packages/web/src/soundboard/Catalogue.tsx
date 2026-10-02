// "Find more" (bafft-c4d.6, c4d.10): one search across Tabletop Audio,
// Incompetech and the Tower folder, narrowed by kind. Preview straight from
// the source, then add a track: the online ones are copied into the library
// with their licence and credit line, so the table never depends on their
// servers (or the wifi) mid-scene; a folder track is used where it is.
// YouTube is its own finder below: it's streamed, and searching costs quota.
import { useEffect, useState } from "react";
import { SOUND_CATEGORIES, type CatalogueSearch, type CatalogueSource, type CatalogueTrack, type ImportStatus, type SoundCategory } from "@bafft/shared";
import { api } from "../api.js";
import { Icon } from "../theme/Icon.js";
import { YouTubeFinder } from "./YouTubeFinder.js";

export const SOURCE_LABELS: Record<CatalogueSource, string> = {
  "tabletop-audio": "Tabletop Audio",
  incompetech: "Incompetech",
  folder: "Your folder",
  freesound: "Freesound",
};

export const CATEGORY_FILTERS: Record<SoundCategory, string> = { music: "Music", ambience: "Ambience", sfx: "Sound effects" };

export interface Preview {
  playing: string | null;
  toggle: (key: string, url: string) => void;
}

const minutes = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.round(ms / 1000) % 60).padStart(2, "0")}`;

export function Catalogue({ preview, onKept, onError }: { preview: Preview; onKept: () => void; onError: (err: unknown) => void }) {
  const [q, setQ] = useState("");
  const [category, setCategory] = useState<SoundCategory | "">("");
  const [found, setFound] = useState<CatalogueSearch | null>(null);
  const [keeping, setKeeping] = useState<Set<string>>(new Set());
  // Bumped by a rescan of the Tower folder, so its new files show up.
  const [version, setVersion] = useState(0);

  useEffect(() => {
    setFound(null);
    // A slow earlier search mustn't land on top of a newer one.
    let current = true;
    const timer = setTimeout(
      () =>
        api
          .searchCatalogue({ q, category: category || undefined })
          .then((result) => current && setFound(result))
          .catch((err) => current && onError(err)),
      250,
    );
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [q, category, version, onError]);

  const keyOf = (t: CatalogueTrack) => `${t.source}:${t.sourceId}`;

  async function keep(track: CatalogueTrack) {
    const key = keyOf(track);
    setKeeping((k) => new Set(k).add(key));
    try {
      const asset = await api.keepTrack(track.source, track.sourceId);
      setFound((f) => f && { ...f, tracks: f.tracks.map((t) => (keyOf(t) === key ? { ...t, keptAssetId: asset.id } : t)) });
      onKept();
    } catch (err) {
      onError(err);
    } finally {
      setKeeping((k) => {
        const next = new Set(k);
        next.delete(key);
        return next;
      });
    }
  }

  return (
    <section className="catalogue" aria-label="Find more">
      <TowerFolder onScanned={() => setVersion((v) => v + 1)} onError={onError} />
      <div className="library-filters">
        <input
          type="search"
          placeholder="Search everything, e.g. festival, dwarves, tavern, rockslide"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search for more sounds"
        />
        <CategoryFilter value={category} onChange={setCategory} />
      </div>
      {found?.unavailable.map((u) => (
        <p key={u.source} className="hint">
          Couldn't reach {SOURCE_LABELS[u.source]} just now: {u.error}
        </p>
      ))}
      {found === null && <p className="hint">Searching…</p>}
      {found?.tracks.length === 0 && <p className="hint">Nothing matches.</p>}
      <ul className="library-list">
        {found?.tracks.map((t) => {
          const key = keyOf(t);
          return (
            <li key={key}>
              <button
                className="icon"
                aria-label={preview.playing === key ? `Stop preview of ${t.title}` : `Preview ${t.title}`}
                onClick={() => preview.toggle(key, t.previewUrl)}
              >
                <Icon name={preview.playing === key ? "stop" : "play"} />
              </button>
              <div className="library-item">
                <span className="title">
                  {t.title}
                  {t.durationMs !== null && <span className="length"> · {minutes(t.durationMs)}</span>}
                </span>
                {t.description && <span className="description">{t.description}</span>}
                <span className="meta">
                  <span className="source">{SOURCE_LABELS[t.source]}</span>
                  <span className={`category ${t.category}`}>{CATEGORY_FILTERS[t.category]}</span>
                  {t.tags.slice(0, 6).map((tag) => (
                    <span key={tag} className="tag">
                      {tag}
                    </span>
                  ))}
                  {t.licence && <span className="licence">{t.licence}</span>}
                </span>
              </div>
              {t.keptAssetId !== null ? (
                <span className="kept">In library</span>
              ) : (
                <button onClick={() => keep(t)} disabled={keeping.has(key)}>
                  {keeping.has(key) ? "Adding…" : "Add to library"}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <p className="hint">
        Tabletop Audio is CC BY-NC-ND: fine at your table, not for anything commercial. Incompetech is CC BY: credit Kevin
        MacLeod if a session is ever streamed or recorded. Freesound sounds each carry their own licence (CC0, CC BY or CC
        BY-NC) and credit line. Freesound is searched only once you type something.
      </p>

      <details className="panel fold">
        <summary>
          <Icon name="play" /> YouTube
        </summary>
        <YouTubeFinder preview={preview} onKept={onKept} onError={onError} />
      </details>
    </section>
  );
}

export function CategoryFilter({ value, onChange }: { value: SoundCategory | ""; onChange: (c: SoundCategory | "") => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as SoundCategory | "")} aria-label="Kind">
      <option value="">Everything</option>
      {SOUND_CATEGORIES.map((c) => (
        <option key={c} value={c}>
          {CATEGORY_FILTERS[c]}
        </option>
      ))}
    </select>
  );
}

const scannedWhen = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/** One folded line: how many files, when it was last scanned, and Rescan. Opens while scanning. */
function TowerFolder({ onScanned, onError }: { onScanned: () => void; onError: (err: unknown) => void }) {
  const [status, setStatus] = useState<ImportStatus | null>(null);
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    api.importStatus().then(setStatus).catch(onError);
  }, [onError]);

  if (!status?.enabled) return null;
  const files = status.packs.reduce((n, p) => n + p.files, 0);

  async function scan() {
    setScanning(true);
    try {
      const r = await api.scanSoundImport();
      setResult(`Found ${r.files} files.${r.removed ? ` ${r.removed} gone from the folder, taken out of the library.` : ""}${r.missing ? ` ${r.missing} gone but still on a board.` : ""}`);
      setStatus(await api.importStatus());
      onScanned();
    } catch (err) {
      onError(err);
    } finally {
      setScanning(false);
    }
  }

  return (
    <details className="panel fold tower-import" open={scanning || undefined} aria-label="Your folder">
      <summary>
        <Icon name="folder" /> Your folder
        <span className="hint">
          {status.scannedAt ? `${files} files · last scanned ${scannedWhen(status.scannedAt)}` : "not scanned yet"}
        </span>
      </summary>
      <p className="hint">{status.packs.length ? status.packs.map((p) => `${p.pack} (${p.files})`).join(" · ") : "No sound packs found."}</p>
      <button onClick={() => void scan()} disabled={scanning}>
        {scanning ? "Scanning…" : "Rescan folder"}
      </button>
      {result && <span className="hint"> {result}</span>}
    </details>
  );
}
