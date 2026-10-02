// Transcript render (bafft-wg1.9): speaker turns, uncertain words,
// possible misheard names (wg1.15) and corrected words (wg1.11) marked.
// Every word carries its start/end ms as data attributes; one delegated click
// handler turns a click on any word into a seek (wg1.10). A click on a marked
// word, or a double-click on any word, also opens it for fixing (wg1.11).
// A click on a speaker's name or portrait asks who they are (wg1.12).
//
// Fast on a full session (~40k words): turns are memoised so a later
// per-word edit re-renders one turn, not the transcript (useStableTurns), and the CSS gives
// each turn `content-visibility: auto`, so the browser only lays out what's
// on screen. No virtualisation library: every word stays in the DOM, so
// browser find (Ctrl+F) and seek-by-element keep working.
import { forwardRef, memo, useMemo, useRef, type CSSProperties, type MouseEvent } from "react";
import type { NameMatch, Speaker, TranscriptWord } from "@bafft/shared";
import { formatClock, groupTurns, type Turn } from "./turns.js";

export const Transcript = forwardRef<
  HTMLDivElement,
  {
    words: TranscriptWord[];
    nameMatches?: NameMatch[];
    onWordClick?: (startMs: number) => void;
    onWordOpen?: (wordId: number) => void;
    speakers?: Map<string, Speaker>;
    onSpeakerOpen?: (speakerLabel: string, turnKey: number) => void;
  }
>(function Transcript({ words, nameMatches = NO_MATCHES, onWordClick, onWordOpen, speakers = NO_SPEAKERS, onSpeakerOpen }, ref) {
  const turns = useStableTurns(words);
  const matchFor = useMemo(
    () => new Map(nameMatches.flatMap((m) => m.wordIds.map((id) => [id, m] as const))),
    [nameMatches],
  );
  function onClick(e: MouseEvent<HTMLDivElement>) {
    const who = (e.target as HTMLElement).closest<HTMLElement>("[data-speaker-label]");
    if (who) {
      onSpeakerOpen?.(who.dataset.speakerLabel!, Number(who.closest<HTMLElement>(".turn")!.dataset.turnKey));
      return;
    }
    const word = (e.target as HTMLElement).closest<HTMLElement>(".word");
    if (!word) return;
    onWordClick?.(Number(word.dataset.startMs));
    if (MARKED.some((c) => word.classList.contains(c))) onWordOpen?.(Number(word.dataset.wordId));
  }
  function onDoubleClick(e: MouseEvent<HTMLDivElement>) {
    const word = (e.target as HTMLElement).closest<HTMLElement>(".word");
    if (word) onWordOpen?.(Number(word.dataset.wordId));
  }
  return (
    <div
      className={onWordClick ? "transcript seekable" : "transcript"}
      ref={ref}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
    >
      {turns.map((turn) => (
        <TurnBlock key={turn.key} turn={turn} matchFor={matchFor} speaker={speakers.get(turn.speakerLabel)} />
      ))}
    </div>
  );
});

const NO_MATCHES: NameMatch[] = [];
const NO_SPEAKERS = new Map<string, Speaker>();
const MARKED = ["possible-name", "uncertain", "corrected"];

/**
 * groupTurns, but a turn whose words are all the same objects as last time
 * is the same Turn object, so its memoised block skips re-rendering: a fix
 * to one word redraws one turn, not 40k words.
 */
function useStableTurns(words: TranscriptWord[]): Turn[] {
  const previous = useRef(new Map<number, Turn>());
  return useMemo(() => {
    const turns = groupTurns(words).map((turn) => {
      const old = previous.current.get(turn.key);
      return old && old.words.length === turn.words.length && old.words.every((w, i) => w === turn.words[i]) ? old : turn;
    });
    previous.current = new Map(turns.map((t) => [t.key, t]));
    return turns;
  }, [words]);
}

/** "Ava · Neris" once named and linked to a player with a hero; the raw label until then. */
export function speakerName(label: string, speaker: Speaker | undefined): string {
  if (!speaker?.name) return label;
  return speaker.hero && speaker.hero.name !== speaker.name ? `${speaker.name} · ${speaker.hero.name}` : speaker.name;
}

// The hero's picture when there is one (wg1.12); otherwise a coloured
// initial: "Speaker B" -> "B", "Ava" -> "A". The colour follows the raw
// label, so it doesn't change when the speaker is named.
export function Portrait({ label, speaker }: { label: string; speaker?: Speaker }) {
  const hero = speaker?.hero;
  if (hero?.imagePath) {
    return <img className="speaker-badge" alt="" data-speaker-label={label} src={`/data/${hero.imagePath}?v=${hero.updatedAt.getTime()}`} />;
  }
  const initial = ((speaker?.name ?? label.replace(/^Speaker\s+/i, ""))[0] ?? "?").toUpperCase();
  let hash = 0;
  for (const ch of label) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return (
    <span className="speaker-badge" aria-hidden="true" data-speaker-label={label} style={{ "--tone": PORTRAIT_TONES[hash % PORTRAIT_TONES.length] } as CSSProperties}>
      {initial}
    </span>
  );
}

// Earthy tones that sit on parchment; "Speaker A".."Speaker H" each get a different one.
const PORTRAIT_TONES = ["#3f6b4a", "#8b3a2b", "#4a5d7a", "#7a5a2b", "#5e3f6b", "#2f6b6b", "#6b4a3f", "#556b2f"];

function wordMark(w: TranscriptWord, match: NameMatch | undefined): { className: string; title?: string } {
  if (w.corrected) return { className: "word corrected", title: `Corrected (heard "${w.heardText ?? w.text}")` };
  if (match) return { className: "word possible-name", title: `Possibly "${match.suggestion}"? (heard "${match.heard}")` };
  if (w.isUncertain) return { className: "word uncertain", title: `Unsure (${Math.round(w.confidence * 100)}% confident)` };
  return { className: "word" };
}

interface TurnProps {
  turn: Turn;
  matchFor: Map<number, NameMatch>;
  speaker: Speaker | undefined;
}

const TurnBlock = memo(function TurnBlock({ turn, matchFor, speaker }: TurnProps) {
  return (
    <section className="turn" data-turn-key={turn.key}>
      <time className="turn-time">{formatClock(turn.startMs)}</time>
      <Portrait label={turn.speakerLabel} speaker={speaker} />
      <p className="turn-text">
        <button type="button" className="speaker" data-speaker-label={turn.speakerLabel} title={`${turn.speakerLabel}: who is this?`}>
          {speakerName(turn.speakerLabel, speaker)}
        </button>{" "}
        {turn.words.map((w) => (
          <span
            key={w.id}
            {...wordMark(w, matchFor.get(w.id))}
            data-word-id={w.id}
            data-start-ms={w.startMs}
            data-end-ms={w.endMs}
          >
            {w.text}{" "}
          </span>
        ))}
      </p>
    </section>
  );
}, sameTurn);

// Name matches are refetched after every fix, as new objects: a turn only
// redraws when one of its own words' marks actually changed.
function sameTurn(a: TurnProps, b: TurnProps) {
  if (a.turn !== b.turn || a.speaker !== b.speaker) return false;
  if (a.matchFor === b.matchFor) return true;
  return a.turn.words.every((w) => {
    const x = a.matchFor.get(w.id);
    const y = b.matchFor.get(w.id);
    return x === y || (x !== undefined && y !== undefined && x.suggestion === y.suggestion && x.heard === y.heard);
  });
}
