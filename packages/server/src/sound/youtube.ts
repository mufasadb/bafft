// YouTube as a music source (bafft-w8f.17): search with the YouTube Data API,
// and look up a pasted link's title with oEmbed (no key needed). Nothing is
// downloaded: the board plays YouTube tracks in YouTube's embedded player.
import type { YouTubeRef, YouTubeResult } from "@bafft/shared";
import { catalogueDeps } from "./catalogues.js";

/** The Data API key: its own, or the Gemini one (both are Google Cloud keys). */
export const youTubeApiKey = () => process.env.YOUTUBE_API_KEY || process.env.GEMINI_API_KEY || "";

export class YouTubeSearchUnavailable extends Error {}

type SearchItem = {
  id: { kind: string; videoId?: string; playlistId?: string };
  snippet: { title: string; channelTitle: string; thumbnails?: { medium?: { url: string }; default?: { url: string } } };
};

// The API returns titles HTML-escaped.
const unescape = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

/** Videos and playlists matching `q`, best first. Throws YouTubeSearchUnavailable
 * (with a message the GM can act on) when there's no key or the API is off. */
export async function searchYouTube(q: string, fetcher: typeof fetch = catalogueDeps.fetch): Promise<Omit<YouTubeResult, "keptAssetId">[]> {
  const key = youTubeApiKey();
  if (!key) throw new YouTubeSearchUnavailable("YouTube search needs a Google API key (YOUTUBE_API_KEY or GEMINI_API_KEY). Pasting a link still works.");
  const url = new URL("https://www.googleapis.com/youtube/v3/search");
  url.search = new URLSearchParams({ part: "snippet", type: "video,playlist", maxResults: "20", q, key }).toString();
  const res = await fetcher(url);
  const body = (await res.json()) as { items?: SearchItem[]; error?: { message?: string; errors?: { reason?: string }[] } };
  if (!res.ok) {
    const reason = body.error?.errors?.[0]?.reason;
    if (reason === "accessNotConfigured") {
      const link = body.error?.message?.match(/https:\/\/console\.developers\.google\.com\S+?(?=\s|$)/)?.[0];
      throw new YouTubeSearchUnavailable(
        `YouTube search is switched off for this Google key. Enable the YouTube Data API v3${link ? ` here: ${link}` : ""}, then try again. Pasting a link still works.`,
      );
    }
    if (res.status === 403) {
      // Usually an API-restricted key (e.g. one limited to Gemini).
      throw new YouTubeSearchUnavailable(
        `YouTube search is blocked for this Google key (${body.error?.message ?? "HTTP 403"}). In Google Cloud Console > Credentials, add "YouTube Data API v3" to the key's API restrictions, or set a separate YOUTUBE_API_KEY. Pasting a link still works.`,
      );
    }
    throw new Error(`YouTube search failed: HTTP ${res.status}`);
  }
  return (body.items ?? []).flatMap((item) => {
    const kind = item.id.kind === "youtube#playlist" ? "playlist" : item.id.kind === "youtube#video" ? "video" : null;
    const id = item.id.videoId ?? item.id.playlistId;
    if (!kind || !id) return [];
    return [
      {
        kind,
        id,
        title: unescape(item.snippet.title),
        channel: unescape(item.snippet.channelTitle),
        thumbnailUrl: item.snippet.thumbnails?.medium?.url ?? item.snippet.thumbnails?.default?.url ?? null,
      },
    ];
  });
}

export const youTubeWatchUrl = (ref: YouTubeRef) =>
  ref.kind === "video" ? `https://www.youtube.com/watch?v=${ref.id}` : `https://www.youtube.com/playlist?list=${ref.id}`;

/** Title and channel for a link, via oEmbed. Null when YouTube doesn't know it
 * (private, deleted) or it can't be embedded. */
export async function lookUpYouTube(ref: YouTubeRef, fetcher: typeof fetch = catalogueDeps.fetch): Promise<{ title: string; channel: string } | null> {
  const url = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(youTubeWatchUrl(ref))}`;
  const res = await fetcher(url);
  if (!res.ok) return null;
  const body = (await res.json()) as { title?: string; author_name?: string };
  return body.title ? { title: body.title, channel: body.author_name ?? "YouTube" } : null;
}
