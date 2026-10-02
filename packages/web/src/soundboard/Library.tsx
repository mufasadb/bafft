// The sound library (bafft-c4d.5): everything uploaded (and, later, kept from
// Tabletop Audio / Incompetech / Freesound), stored once and usable on any
// board. Preview, search, upload, delete.
import { useEffect, useRef, useState } from "react";
import { SOUND_CATEGORIES, type SoundAsset, type SoundCategory } from "@bafft/shared";
import { api, ApiError } from "../api.js";
import { Icon } from "../theme/Icon.js";
import { Catalogue, CategoryFilter, type Preview } from "./Catalogue.js";
import { audioUrl } from "./useBoardEngine.js";
import { youTubeEmbedUrl } from "./YouTubeFinder.js";
import { youTubeRefOf } from "@bafft/shared";

const CATEGORY_LABELS: Record<SoundCategory, string> = { music: "Music", ambience: "Ambience", sfx: "Sound effect" };

export function Library({ onError }: { onError: (err: unknown) => void }) {
  const [tab, setTab] = useState<"mine" | "more">("mine");
  const [q, setQ] = useState("");
  const [category, setCategory] = useState<SoundCategory | "">("");
  const [sounds, setSounds] = useState<SoundAsset[] | null>(null);
  const [previewing, setPreviewing] = useState<string | null>(null);
  // A YouTube preview plays in YouTube's own player (bafft-w8f.17).
  const [ytPreview, setYtPreview] = useState<string | null>(null);
  const preview = useRef<HTMLAudioElement>(null);

  const [version, setVersion] = useState(0);
  const reload = () => setVersion((v) => v + 1);
  useEffect(() => {
    const timer = setTimeout(() => api.listSounds({ q, category: category || undefined }).then(setSounds).catch(onError), 200);
    return () => clearTimeout(timer);
  }, [q, category, version, onError]);

  // One preview at a time, whether it's a library track or a catalogue one.
  const previewer: Preview = {
    playing: previewing,
    toggle(key, url) {
      const audio = preview.current;
      if (!audio) return;
      if (previewing === key) {
        audio.pause();
        setYtPreview(null);
        setPreviewing(null);
        return;
      }
      const tube = youTubeRefOf(url);
      if (tube) {
        audio.pause();
        setYtPreview(youTubeEmbedUrl(tube));
        setPreviewing(key);
        return;
      }
      setYtPreview(null);
      audio.src = url;
      void audio.play().catch(() => setPreviewing(null));
      setPreviewing(key);
    },
  };

  async function remove(asset: SoundAsset) {
    try {
      await api.deleteSound(asset.id);
      reload();
    } catch (err) {
      // 409: still on a board; the server's message names which.
      onError(err instanceof ApiError && err.status === 409 ? new Error(`“${asset.title}” is ${err.message}. Take it off first.`) : err);
    }
  }

  return (
    <div className="library">
      <div className="soundboard-tabs library-tabs" role="tablist" aria-label="Library">
        <button role="tab" aria-selected={tab === "mine"} onClick={() => setTab("mine")}>
          Your library
        </button>
        <button role="tab" aria-selected={tab === "more"} onClick={() => setTab("more")}>
          Find more
        </button>
      </div>

      <audio ref={preview} onEnded={() => setPreviewing(null)} />
      {ytPreview && (
        <div className="yt-preview">
          <iframe src={ytPreview} title="YouTube preview" allow="autoplay; encrypted-media" />
          <button className="ghost" onClick={() => previewer.toggle(previewing!, "")}>
            Close preview
          </button>
        </div>
      )}

      {tab === "more" && <Catalogue preview={previewer} onKept={reload} onError={onError} />}

      {tab === "mine" && (
        <>
          <Upload onUploaded={reload} onError={onError} />
          <div className="library-filters">
            <input type="search" placeholder="Search title or tag" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the library" />
            <CategoryFilter value={category} onChange={setCategory} />
          </div>
          {sounds?.length === 0 && (
            <p className="hint">{q || category ? "Nothing matches." : "The library is empty. Add your own, or use Find more."}</p>
          )}
          <ul className="library-list">
            {sounds?.map((asset) => (
              <li key={asset.id}>
                <button
                  className="icon"
                  aria-label={previewing === `asset:${asset.id}` ? `Stop preview of ${asset.title}` : `Preview ${asset.title}`}
                  onClick={() => previewer.toggle(`asset:${asset.id}`, asset.source === "youtube" ? asset.audioPath : audioUrl(asset.id))}
                >
                  <Icon name={previewing === `asset:${asset.id}` ? "stop" : "play"} />
                </button>
                <div className="library-item">
                  <span className="title">
                    {asset.source === "youtube" && <YouTubeMark />}
                    {asset.title}
                  </span>
                  <span className="meta">
                    <span className={`category ${asset.category}`}>{CATEGORY_LABELS[asset.category]}</span>
                    {asset.source === "folder" && <span className="source">Your folder</span>}
                    {asset.tags.map((t) => (
                      <span key={t} className="tag">
                        {t}
                      </span>
                    ))}
                    {asset.attribution && <span className="attribution">{asset.attribution}</span>}
                  </span>
                </div>
                <button className="ghost icon" aria-label={`Delete ${asset.title}`} onClick={() => remove(asset)}>
                  <Icon name="trash" />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/** The small YouTube play mark, on anything that streams from YouTube. */
export function YouTubeMark() {
  return (
    <svg className="yt-mark" viewBox="0 0 28 20" width="18" height="13" role="img" aria-label="YouTube">
      <rect width="28" height="20" rx="5" fill="#ff0000" />
      <path d="M11 5.5v9l8-4.5-8-4.5Z" fill="#fff" />
    </svg>
  );
}

function Upload({ onUploaded, onError }: { onUploaded: () => void; onError: (err: unknown) => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [category, setCategory] = useState<SoundCategory>("sfx");
  const [tags, setTags] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function upload() {
    try {
      for (const [i, file] of files.entries()) {
        setBusy(`Uploading ${i + 1} of ${files.length}…`);
        await api.uploadSound(file, { category, tags });
      }
      setFiles([]);
      setTags("");
      if (input.current) input.current.value = "";
      onUploaded();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(null);
    }
  }

  return (
    <details className="panel fold upload-sounds" aria-label="Upload sounds">
      <summary>
        <Icon name="upload" /> Add your own
      </summary>
      <div className="upload-row">
        <input
          ref={input}
          type="file"
          multiple
          accept=".mp3,.m4a,.wav,.ogg,.flac,audio/mpeg,audio/mp4,audio/wav,audio/ogg,audio/flac"
          aria-label="Audio files"
          onChange={(e) => setFiles([...(e.target.files ?? [])])}
        />
        <select value={category} onChange={(e) => setCategory(e.target.value as SoundCategory)} aria-label="Upload as">
          {SOUND_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>
        <input placeholder="Tags, comma separated" value={tags} onChange={(e) => setTags(e.target.value)} aria-label="Tags" />
        <button className="primary" disabled={files.length === 0 || busy !== null} onClick={upload}>
          {busy ?? (files.length > 1 ? `Upload ${files.length} files` : "Upload")}
        </button>
      </div>
      <p className="hint">mp3, m4a, wav, ogg or flac. Named after the file; music and ambience loop on a board, sound effects play once.</p>
    </details>
  );
}
