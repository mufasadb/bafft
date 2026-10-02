// Drives the labelling screen's single <audio> element (bafft-wg1.10): play a
// clip around a clicked word, stop at the clip's end, replay with Space, and
// mark the word being spoken. The marker is set on the DOM directly rather
// than through React state, so following playback never re-renders the
// transcript's ~40k words.
import { useCallback, useEffect, useMemo, useRef, type RefObject } from "react";
import type { TranscriptWord } from "@bafft/shared";
import { clipWindow, wordIndexAt } from "./clip.js";

export function useClipPlayer(
  audioRef: RefObject<HTMLAudioElement | null>,
  transcriptRef: RefObject<HTMLElement | null>,
  words: TranscriptWord[],
) {
  const starts = useMemo(() => words.map((w) => w.startMs), [words]);
  const stopAtSec = useRef(Infinity);
  const lastStartMs = useRef<number | null>(null);
  const marked = useRef<Element | null>(null);

  const mark = useCallback(
    (wordId: number | null) => {
      const next = wordId === null ? null : (transcriptRef.current?.querySelector(`[data-word-id="${wordId}"]`) ?? null);
      if (next === marked.current) return;
      marked.current?.classList.remove("playing");
      next?.classList.add("playing");
      marked.current = next;
    },
    [transcriptRef],
  );

  // While audio plays (a clip, or the native controls), follow it every frame.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    let frame = 0;
    const follow = () => {
      if (audio.currentTime >= stopAtSec.current) audio.pause();
      if (audio.paused) return;
      const i = wordIndexAt(starts, audio.currentTime * 1000);
      mark(i >= 0 ? words[i]!.id : null);
      frame = requestAnimationFrame(follow);
    };
    const onPlay = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(follow);
    };
    const onPause = () => {
      cancelAnimationFrame(frame);
      stopAtSec.current = Infinity;
      mark(null);
    };
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    return () => {
      cancelAnimationFrame(frame);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
    };
  }, [audioRef, starts, words, mark]);

  const playFrom = useCallback(
    (startMs: number) => {
      const audio = audioRef.current;
      if (!audio) return;
      const { fromSec, toSec } = clipWindow(startMs);
      lastStartMs.current = startMs;
      audio.currentTime = fromSec;
      stopAtSec.current = toSec;
      void audio.play().catch(() => {
        // Autoplay refusal or a missing file: the native controls show the problem.
      });
    },
    [audioRef],
  );

  // Space replays the last clip, unless the owner is typing somewhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== " " || lastStartMs.current === null) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, button, [contenteditable]")) return;
      e.preventDefault();
      playFrom(lastStartMs.current);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [playFrom]);

  return { playFrom };
}
