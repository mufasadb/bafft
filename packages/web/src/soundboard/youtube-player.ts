// YouTube's embedded player for board clips (bafft-w8f.17). The page can't
// route YouTube's audio through Web Audio (it's cross-origin), so these clips
// use the player's own volume and start and stop without a crossfade.
// YouTube's terms want the player visible while it plays: it docks in the
// corner of the screen.
import type { YouTubeRef } from "@bafft/shared";

export interface YtPlayer {
  play(): void;
  pause(): void;
  restart(): void;
  /** 0..1 */
  setVolume(volume: number): void;
  setLoop(loop: boolean): void;
  currentTime(): number;
  duration(): number;
  destroy(): void;
}

export interface YtEvents {
  onEnded(): void;
  onError(): void;
}

export type YtFactory = (ref: YouTubeRef, host: HTMLElement, events: YtEvents) => Promise<YtPlayer>;

// The slice of the IFrame API this uses.
interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  playVideoAt(index: number): void;
  setVolume(volume: number): void;
  setLoop(loop: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  destroy(): void;
}
interface YTNamespace {
  Player: new (el: HTMLElement, options: object) => YTPlayer;
  PlayerState: { ENDED: number };
}
declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let api: Promise<YTNamespace> | undefined;

function loadApi(): Promise<YTNamespace> {
  api ??= new Promise((resolve, reject) => {
    if (window.YT?.Player) return resolve(window.YT);
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve(window.YT!);
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.onerror = () => {
      api = undefined;
      reject(new Error("couldn't load YouTube's player (offline?)"));
    };
    document.head.append(script);
  });
  return api;
}

export const youTubePlayer: YtFactory = async (ref, host, events) => {
  const YT = await loadApi();
  const el = document.createElement("div");
  host.append(el);
  return new Promise((resolve, reject) => {
    const player: YTPlayer = new YT.Player(el, {
      width: 240,
      height: 135,
      host: "https://www.youtube-nocookie.com",
      ...(ref.kind === "video" ? { videoId: ref.id } : {}),
      playerVars: {
        playsinline: 1,
        rel: 0,
        ...(ref.kind === "playlist" ? { listType: "playlist", list: ref.id } : {}),
      },
      events: {
        onReady: () =>
          resolve({
            play: () => player.playVideo(),
            pause: () => player.pauseVideo(),
            restart: () => (ref.kind === "playlist" ? player.playVideoAt(0) : (player.seekTo(0, true), player.playVideo())),
            setVolume: (v) => player.setVolume(Math.round(Math.max(0, Math.min(1, v)) * 100)),
            setLoop: (loop) => player.setLoop(loop),
            currentTime: () => player.getCurrentTime?.() ?? 0,
            duration: () => player.getDuration?.() ?? 0,
            destroy: () => player.destroy(),
          }),
        onStateChange: (e: { data: number }) => {
          if (e.data === YT.PlayerState.ENDED) events.onEnded();
        },
        onError: () => {
          events.onError();
          reject(new Error("YouTube couldn't play that (removed, private, or not embeddable)"));
        },
      },
    });
  });
};
