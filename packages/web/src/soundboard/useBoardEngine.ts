// Connects a board's clips to a SoundEngine (bafft-c4d.3): loads each clip
// (sound effects decoded up front, music and ambience streamed), re-renders
// on engine changes, and ticks while anything plays so progress rings move.
import { useEffect, useReducer, useState } from "react";
import type { BoardClip } from "@bafft/shared";
import { SoundEngine } from "./engine.js";

export const audioUrl = (assetId: number) => `/api/sound-assets/${assetId}/audio`;

export function useBoardEngine(clips: BoardClip[], createEngine: () => SoundEngine = () => new SoundEngine()) {
  const [engine] = useState(createEngine);
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const [failed, setFailed] = useState<Set<number>>(new Set());

  useEffect(() => engine.subscribe(rerender), [engine]);
  useEffect(() => () => void engine.close(), [engine]);

  useEffect(() => {
    for (const clip of clips) {
      if (engine.isLoaded(clip.id)) continue;
      const youtube = clip.asset.source === "youtube";
      const mode = youtube ? "youtube" : clip.asset.category === "sfx" ? "buffer" : "stream";
      const url = youtube ? clip.asset.audioPath : audioUrl(clip.assetId);
      engine.load(clip.id, url, mode).catch(() => setFailed((f) => new Set(f).add(clip.id)));
    }
  }, [engine, clips]);

  // ~12 frames a second is plenty for a progress ring, and cheap.
  const anyPlaying = engine.playing().length > 0;
  useEffect(() => {
    if (!anyPlaying) return;
    const timer = setInterval(rerender, 80);
    return () => clearInterval(timer);
  }, [anyPlaying]);

  return { engine, failed };
}
