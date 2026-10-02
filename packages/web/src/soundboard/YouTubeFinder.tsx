// YouTube in "Find more" (bafft-w8f.17): search, or paste a link, then add it
// to the library. YouTube tracks are streamed, never stored: they need the
// internet at the table and play in YouTube's own player, without crossfades.
import { useEffect, useState } from "react";
import { youTubeAudioPath, type SoundCategory, type YouTubeRef, type YouTubeResult } from "@bafft/shared";
import { api } from "../api.js";
import { Icon } from "../theme/Icon.js";
import type { Preview } from "./Catalogue.js";

export const youTubeEmbedUrl = (ref: YouTubeRef) =>
  ref.kind === "video"
    ? `https://www.youtube-nocookie.com/embed/${ref.id}?autoplay=1`
    : `https://www.youtube-nocookie.com/embed/videoseries?list=${ref.id}&autoplay=1`;

const watchUrl = (ref: YouTubeRef) =>
  ref.kind === "video" ? `https://www.youtube.com/watch?v=${ref.id}` : `https://www.youtube.com/playlist?list=${ref.id}`;

const CATEGORIES: { id: SoundCategory; label: string }[] = [
  { id: "music", label: "Music" },
  { id: "ambience", label: "Ambience" },
];

export function YouTubeFinder({ preview, onKept, onError }: { preview: Preview; onKept: () => void; onError: (err: unknown) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<YouTubeResult[] | null>([]);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [category, setCategory] = useState<SoundCategory>("music");
  const [link, setLink] = useState("");
  // A pasted link can be named and tagged as it goes in (bafft-c4d.10).
  const [linkName, setLinkName] = useState("");
  const [linkTags, setLinkTags] = useState("");
  const [adding, setAdding] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!q.trim()) {
      setResults([]);
      return;
    }
    setResults(null);
    let current = true;
    // YouTube search costs API quota: wait for a pause in typing.
    const timer = setTimeout(
      () =>
        api
          .searchYouTube(q)
          .then((found) => {
            if (!current) return;
            setUnavailable(null);
            setResults(found);
          })
          .catch((err) => {
            if (!current) return;
            setResults([]);
            setUnavailable(err instanceof Error ? err.message : String(err));
          }),
      600,
    );
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [q]);

  async function add(key: string, url: string, title?: string, tags?: string[]) {
    setAdding((a) => new Set(a).add(key));
    try {
      const asset = await api.addYouTube({ url, title, category, ...(tags?.length ? { tags } : {}) });
      setResults((rs) => rs?.map((r) => (`${r.kind}:${r.id}` === key ? { ...r, keptAssetId: asset.id } : r)) ?? null);
      if (key === "link") {
        setLink("");
        setLinkName("");
        setLinkTags("");
      }
      onKept();
    } catch (err) {
      onError(err);
    } finally {
      setAdding((a) => {
        const next = new Set(a);
        next.delete(key);
        return next;
      });
    }
  }

  return (
    <div className="youtube-finder">
      <div className="catalogue-controls">
        <input
          type="search"
          placeholder="Search YouTube, e.g. dwarven festival music, epic battle"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search YouTube"
        />
        <select value={category} onChange={(e) => setCategory(e.target.value as SoundCategory)} aria-label="Add as">
          {CATEGORIES.map((c) => (
            <option key={c.id} value={c.id}>
              Add as {c.label.toLowerCase()}
            </option>
          ))}
        </select>
      </div>
      <form
        className="catalogue-controls"
        onSubmit={(e) => {
          e.preventDefault();
          const tags = linkTags.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
          if (link.trim()) void add("link", link.trim(), linkName.trim() || undefined, tags);
        }}
      >
        <input
          type="url"
          placeholder="…or paste a YouTube or YouTube Music link (video or playlist)"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          aria-label="YouTube link"
        />
        {link.trim() && (
          <>
            <input placeholder="Name (optional: YouTube's title otherwise)" value={linkName}
              onChange={(e) => setLinkName(e.target.value)} aria-label="Name" />
            <input placeholder="Tags, comma separated" value={linkTags}
              onChange={(e) => setLinkTags(e.target.value)} aria-label="Tags" />
          </>
        )}
        <button type="submit" disabled={!link.trim() || adding.has("link")}>
          {adding.has("link") ? "Adding…" : "Add link"}
        </button>
      </form>
      <p className="hint">
        Streamed from YouTube, not stored: it needs the internet at the table, plays in a small YouTube player in the
        corner, and starts and stops without a crossfade. Ads play unless this browser is signed in to YouTube Premium.
      </p>
      {unavailable && <p className="error">{unavailable}</p>}
      {results === null && <p className="hint">Searching…</p>}
      {q.trim() && results?.length === 0 && !unavailable && <p className="hint">Nothing matches.</p>}
      <ul className="library-list">
        {results?.map((r) => {
          const key = `${r.kind}:${r.id}`;
          const previewKey = `youtube:${key}`;
          return (
            <li key={key}>
              <button
                className="icon"
                aria-label={preview.playing === previewKey ? `Stop preview of ${r.title}` : `Preview ${r.title}`}
                onClick={() => preview.toggle(previewKey, youTubeAudioPath(r))}
              >
                <Icon name={preview.playing === previewKey ? "stop" : "play"} />
              </button>
              {r.thumbnailUrl && <img className="yt-thumb" src={r.thumbnailUrl} alt="" />}
              <div className="library-item">
                <span className="title">{r.title}</span>
                <span className="meta">
                  <span className="tag">{r.kind === "playlist" ? "playlist" : "video"}</span>
                  <span className="attribution">{r.channel}</span>
                </span>
              </div>
              {r.keptAssetId !== null ? (
                <span className="kept">In library</span>
              ) : (
                <button onClick={() => add(key, watchUrl(r), r.title)} disabled={adding.has(key)}>
                  {adding.has(key) ? "Adding…" : "Add to library"}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
