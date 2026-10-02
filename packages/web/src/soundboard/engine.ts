// Soundboard playback (bafft-c4d.2), on the Web Audio API so several clips
// can play at once, each with its own volume, fade-in and a hard stop.
//
// Two ways to hold a clip:
// - "buffer": fetched and decoded when the board opens. For sound effects:
//   they fire instantly and never wait on the network mid-scene.
// - "stream": an <audio> element routed through Web Audio. For music and
//   ambience, which run to ten minutes: decoded whole, a single track is
//   ~200MB of raw audio. bafft serves the file itself (same origin), so
//   gain, fades and the hard stop still work.
//
// - "youtube" (bafft-w8f.17): YouTube's embedded player, docked in a corner.
//   Its audio can't go through Web Audio, so it uses the player's own volume
//   and starts and stops without fades.
//
// The sound comes out of whatever device has the board open. Deliberately
// free of React: the board screen subscribes for changes.
import { youTubeRefOf, type ClipKind, type YouTubeRef } from "@bafft/shared";
import { youTubePlayer, type YtFactory, type YtPlayer } from "./youtube-player.js";

export interface EngineClip {
  id: number;
  kind: ClipKind;
  volume: number;
  fadeInMs: number;
}

export type LoadMode = "buffer" | "stream" | "youtube";

// "Cut it dead": stopping isn't a fade, but a hard stop mid-waveform clicks,
// so it ramps down over a few ms first. Too short to hear as a fade.
export const DECLICK_S = 0.015;

interface Voice {
  /** Web Audio clips; a YouTube clip has none and uses setVolume instead. */
  gain?: GainNode;
  setVolume?(volume: number): void;
  startedAt: number;
  /** Silence it for good, `delayS` from now. */
  stopAt(whenS: number): void;
  /** Seconds into the current pass, and the clip's length (0 if unknown). */
  position(): { at: number; duration: number };
  setLoop(loop: boolean): void;
}

interface Streamed {
  element: HTMLAudioElement;
  gain: GainNode;
}

interface Tubed {
  ref: YouTubeRef;
  player?: Promise<YtPlayer>;
  loop: boolean;
  host?: HTMLElement;
}

type Listener = () => void;
type EndListener = (clipId: number) => void;

export interface EngineDeps {
  createContext?: () => AudioContext;
  createAudio?: (url: string) => HTMLAudioElement;
  fetcher?: typeof fetch;
  createYouTube?: YtFactory;
  /** Where YouTube players dock; defaults to a corner of the page. */
  youTubeDock?: () => HTMLElement;
}

export class SoundEngine {
  private ctx: AudioContext | null = null;
  private readonly buffers = new Map<number, AudioBuffer>();
  private readonly streams = new Map<number, Streamed>();
  private readonly tubes = new Map<number, Tubed>();
  private readonly createYouTube: YtFactory;
  private readonly youTubeDock: () => HTMLElement;
  private dock: HTMLElement | null = null;
  private readonly voices = new Map<number, Voice>();
  private readonly volumes = new Map<number, number>();
  private readonly listeners = new Set<Listener>();
  private readonly endListeners = new Set<EndListener>();
  private readonly createContext: () => AudioContext;
  private readonly createAudio: (url: string) => HTMLAudioElement;
  private readonly fetcher: typeof fetch;

  constructor(deps: EngineDeps = {}) {
    this.createContext = deps.createContext ?? (() => new AudioContext());
    this.createAudio =
      deps.createAudio ??
      ((url) => {
        const audio = new Audio(url);
        audio.preload = "auto";
        return audio;
      });
    this.fetcher = deps.fetcher ?? ((...args) => fetch(...args));
    this.createYouTube = deps.createYouTube ?? youTubePlayer;
    this.youTubeDock =
      deps.youTubeDock ??
      (() => {
        if (!this.dock) {
          this.dock = document.createElement("div");
          this.dock.className = "yt-dock";
          this.dock.setAttribute("aria-label", "YouTube player");
          document.body.append(this.dock);
        }
        return this.dock;
      });
  }

  private context(): AudioContext {
    this.ctx ??= this.createContext();
    return this.ctx;
  }

  /**
   * Browsers (Safari especially) keep audio suspended until a user gesture.
   * Called from every tap, so the first tap on the board is enough.
   */
  async unlock(): Promise<void> {
    const ctx = this.context();
    if (ctx.state === "suspended") await ctx.resume();
  }

  async load(clipId: number, url: string, mode: LoadMode = "buffer"): Promise<void> {
    if (mode === "youtube") {
      // url is the track's audioPath, "youtube:video:<id>". The player itself
      // is made on first play: an iframe per track is heavy.
      const ref = youTubeRefOf(url);
      if (!ref) throw new Error(`not a YouTube track: ${url}`);
      this.tubes.set(clipId, { ref, loop: false });
    } else if (mode === "stream") {
      const element = this.createAudio(url);
      const ctx = this.context();
      const gain = ctx.createGain();
      gain.gain.value = 0;
      ctx.createMediaElementSource(element).connect(gain);
      gain.connect(ctx.destination);
      element.addEventListener("ended", () => this.ended(clipId));
      this.streams.set(clipId, { element, gain });
    } else {
      const res = await this.fetcher(url);
      if (!res.ok) throw new Error(`couldn't load clip ${clipId} (${res.status})`);
      this.buffers.set(clipId, await this.context().decodeAudioData(await res.arrayBuffer()));
    }
    this.emit();
  }

  isLoaded(clipId: number): boolean {
    return this.buffers.has(clipId) || this.streams.has(clipId) || this.tubes.has(clipId);
  }

  isPlaying(clipId: number): boolean {
    return this.voices.has(clipId);
  }

  /** Ids of every clip playing now, in the order they started. */
  playing(): number[] {
    return [...this.voices.keys()];
  }

  /** 0..1 through the clip (for a loop, through the current pass); null when stopped. */
  progress(clipId: number): number | null {
    const voice = this.voices.get(clipId);
    if (!voice) return null;
    const { at, duration } = voice.position();
    return duration > 0 ? Math.min(1, at / duration) : 0;
  }

  /** Tap: start it if it's silent, stop it if it's playing. Returns whether it's now playing. */
  toggle(clip: EngineClip): boolean {
    if (this.voices.has(clip.id)) {
      this.stop(clip.id);
      return false;
    }
    return this.play(clip);
  }

  play(clip: EngineClip): boolean {
    if (!this.isLoaded(clip.id)) return false;
    this.stop(clip.id);
    const ctx = this.context();
    const now = ctx.currentTime;
    const volume = this.volumes.get(clip.id) ?? clip.volume;
    this.volumes.set(clip.id, volume);

    const voice = this.tubes.has(clip.id)
      ? this.tubeVoice(clip, now, volume)
      : this.streams.has(clip.id)
        ? this.streamVoice(clip, now)
        : this.bufferVoice(clip, now);
    if (voice.gain) {
      const g = voice.gain.gain;
      g.cancelScheduledValues(now);
      if (clip.fadeInMs > 0) {
        g.setValueAtTime(0, now);
        g.linearRampToValueAtTime(volume, now + clip.fadeInMs / 1000);
      } else {
        g.setValueAtTime(volume, now);
      }
    }
    this.voices.set(clip.id, voice);
    this.emit();
    return true;
  }

  private bufferVoice(clip: EngineClip, now: number): Voice {
    const ctx = this.context();
    const buffer = this.buffers.get(clip.id)!;
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = clip.kind === "loop";
    source.connect(gain);
    const voice: Voice = {
      gain,
      startedAt: now,
      stopAt: (when) => source.stop(when),
      position: () => ({ at: (ctx.currentTime - now) % buffer.duration, duration: buffer.duration }),
      setLoop: (loop) => {
        source.loop = loop;
      },
    };
    source.onended = () => {
      this.ended(clip.id, voice);
      gain.disconnect();
    };
    source.start(now);
    return voice;
  }

  private streamVoice(clip: EngineClip, now: number): Voice {
    const { element, gain } = this.streams.get(clip.id)!;
    element.loop = clip.kind === "loop";
    element.currentTime = 0;
    void element.play().catch(() => this.ended(clip.id));
    return {
      gain,
      startedAt: now,
      stopAt: (when) => {
        const ms = Math.max(0, (when - this.context().currentTime) * 1000);
        setTimeout(() => {
          // Unless it was started again in the meantime.
          if (!this.voices.has(clip.id)) element.pause();
        }, ms);
      },
      position: () => ({ at: element.currentTime, duration: Number.isFinite(element.duration) ? element.duration : 0 }),
      setLoop: (loop) => {
        element.loop = loop;
      },
    };
  }

  private tubeVoice(clip: EngineClip, now: number, volume: number): Voice {
    const tube = this.tubes.get(clip.id)!;
    tube.loop = clip.kind === "loop";
    if (!tube.host) {
      tube.host = document.createElement("div");
      tube.host.className = "yt-slot";
      this.youTubeDock().append(tube.host);
    }
    tube.host.hidden = false;
    let last: YtPlayer | null = null;
    tube.player ??= this.createYouTube(tube.ref, tube.host, {
      onEnded: () => {
        const current = this.voices.get(clip.id);
        if (!current) return;
        if (tube.loop) void tube.player?.then((p) => p.restart());
        else this.ended(clip.id, current);
      },
      onError: () => this.ended(clip.id),
    });
    const voice: Voice = {
      startedAt: now,
      setVolume: (v) => void tube.player?.then((p) => p.setVolume(v)),
      stopAt: () => {
        void tube.player?.then((p) => {
          // Unless it was started again in the meantime.
          if (this.voices.get(clip.id) === voice) return;
          p.pause();
          if (tube.host) tube.host.hidden = true;
        });
      },
      position: () => ({ at: last?.currentTime() ?? 0, duration: last?.duration() ?? 0 }),
      setLoop: (loop) => {
        tube.loop = loop;
        void tube.player?.then((p) => p.setLoop(loop));
      },
    };
    tube.player
      .then((p) => {
        last = p;
        if (this.voices.get(clip.id) !== voice) return;
        p.setVolume(volume);
        p.setLoop(tube.loop);
        p.restart();
        this.emit();
      })
      .catch(() => {
        // A failed player can be tried again on the next tap.
        tube.player = undefined;
        this.ended(clip.id, voice);
      });
    return voice;
  }

  /** A clip ran out (or failed to start). Ignores a stale voice a restart already replaced. */
  private ended(clipId: number, voice?: Voice) {
    const current = this.voices.get(clipId);
    if (!current || (voice && current !== voice)) return;
    this.voices.delete(clipId);
    this.emit();
    for (const l of this.endListeners) l(clipId);
  }

  /** Called when a clip plays out on its own (not when it's stopped). */
  onEnded(listener: EndListener): () => void {
    this.endListeners.add(listener);
    return () => this.endListeners.delete(listener);
  }

  /** Seconds into the current pass and the clip's length (0 if unknown); null when stopped. */
  position(clipId: number): { at: number; duration: number } | null {
    return this.voices.get(clipId)?.position() ?? null;
  }

  /** Cut it dead. */
  stop(clipId: number): void {
    this.fadeOut(clipId, DECLICK_S);
  }

  /**
   * Fade to silence over `seconds`, then stop: the outgoing half of a music
   * crossfade. It counts as stopped straight away, so the board shows only
   * what's coming in.
   */
  fadeOut(clipId: number, seconds: number): void {
    const voice = this.voices.get(clipId);
    if (!voice) return;
    this.voices.delete(clipId);
    const now = this.context().currentTime;
    if (!voice.gain) {
      // YouTube: no fades, it just stops.
      voice.stopAt(now);
      this.emit();
      return;
    }
    const g = voice.gain.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0, now + seconds);
    voice.stopAt(now + seconds);
    this.emit();
  }

  stopAll(): void {
    for (const id of [...this.voices.keys()]) this.stop(id);
  }

  /** The loop toggle: applies to a playing clip at once (a one-shot finishes its pass). */
  setLoop(clipId: number, loop: boolean): void {
    this.voices.get(clipId)?.setLoop(loop);
  }

  volume(clipId: number, fallback: number): number {
    return this.volumes.get(clipId) ?? fallback;
  }

  /** Live volume: applies to the clip now if it's playing, and to its next start. */
  setVolume(clipId: number, volume: number): void {
    this.volumes.set(clipId, volume);
    const voice = this.voices.get(clipId);
    if (voice?.gain) {
      const now = this.context().currentTime;
      // Overrides a fade-in still in progress: the GM's hand wins.
      voice.gain.gain.cancelScheduledValues(now);
      voice.gain.gain.setTargetAtTime(volume, now, 0.03);
    } else {
      voice?.setVolume?.(volume);
    }
    this.emit();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit() {
    for (const l of this.listeners) l();
  }

  /** Board closed: silence everything and release the audio device. */
  async close(): Promise<void> {
    this.stopAll();
    for (const { element } of this.streams.values()) {
      element.pause();
      element.removeAttribute("src");
    }
    this.streams.clear();
    this.buffers.clear();
    for (const tube of this.tubes.values()) void tube.player?.then((p) => p.destroy()).catch(() => {});
    this.tubes.clear();
    this.dock?.remove();
    this.dock = null;
    await this.ctx?.close();
    this.ctx = null;
  }
}
