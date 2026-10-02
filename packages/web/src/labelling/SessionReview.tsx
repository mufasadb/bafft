// The labelling screen (bafft-wg1.9): one session's transcript. Seek (wg1.10),
// correction (wg1.11, WordFix), speaker renaming (wg1.12) and
// "Finish labelling" (wg1.13) build on this. Layout is the owner's pick of the
// Muse's widescreen mockups (wg1.14): full-width script, a "Check names"
// dropdown, the player docked at the bottom.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GlossaryOutcome, NameMatch, Session, Speaker, SpeakerUpdate, TranscriptWord } from "@bafft/shared";
import { api } from "../api.js";
import { buildChecks, type Check } from "./checks.js";
import { CheckList } from "./CheckList.js";
import { Portrait, speakerName, Transcript } from "./Transcript.js";
import { SpeakerPicker } from "./SpeakerPicker.js";
import { useClipPlayer } from "./useClipPlayer.js";
import { WordFix, type FixTarget } from "./WordFix.js";

interface Notice {
  text: string;
  action?: { label: string; run: () => Promise<void> };
}

const NO_WORDS: TranscriptWord[] = [];

export function SessionReview({ sessionId, onBack }: { sessionId: number; onBack: () => void }) {
  const [session, setSession] = useState<Session | null>(null);
  const [words, setWords] = useState<TranscriptWord[] | null>(null);
  const [nameMatches, setNameMatches] = useState<NameMatch[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  const [checkListOpen, setCheckListOpen] = useState(false);
  const closeCheckList = useCallback(() => setCheckListOpen(false), []);
  const [fixing, setFixing] = useState<FixTarget | null>(null);
  const closeFix = useCallback(() => setFixing(null), []);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [speakers, setSpeakers] = useState<Speaker[]>([]);
  const speakerMap = useMemo(() => new Map(speakers.map((sp) => [sp.speakerLabel, sp])), [speakers]);
  const [picking, setPicking] = useState<{ speakerLabel: string; anchor: string } | null>(null);
  const closePicker = useCallback(() => setPicking(null), []);
  const audioRef = useRef<HTMLAudioElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const { playFrom } = useClipPlayer(audioRef, transcriptRef, words ?? NO_WORDS);

  function showError(err: unknown) {
    setError(err instanceof Error ? err.message : String(err));
  }

  function load() {
    setError(null);
    Promise.all([api.getSession(sessionId), api.listWords(sessionId)])
      .then(([s, w]) => {
        setSession(s);
        setWords(w);
      })
      .catch(showError);
    // Separate so a long session's transcript never waits on the glossary check.
    refreshNameMatches();
    api.listSpeakers(sessionId).then(setSpeakers).catch(showError);
  }

  async function saveSpeaker(update: SpeakerUpdate) {
    const saved = await api.setSpeaker(sessionId, update);
    // Only the renamed speaker's object changes, so only its turns redraw.
    setSpeakers((prev) => prev.map((sp) => (sp.speakerLabel === saved.speakerLabel ? saved : sp)));
  }

  function refreshNameMatches() {
    api.listNameMatches(sessionId).then(setNameMatches).catch(showError);
  }

  useEffect(load, [sessionId]);

  async function onTranscribe() {
    setTranscribing(true);
    setError(null);
    try {
      await api.transcribe(sessionId);
    } catch (err) {
      showError(err);
    } finally {
      setTranscribing(false);
      load();
    }
  }

  // Opens the fixer on a word, or on the whole run of a possible misheard
  // name it belongs to ("Hooper Duke"), with the suggested spelling ready.
  const openFix = useCallback(
    (wordId: number) => {
      if (!words) return;
      const match = nameMatches.find((m) => m.wordIds.includes(wordId));
      const ids = match?.wordIds ?? [wordId];
      const run = ids.map((id) => words.find((w) => w.id === id)).filter((w) => w !== undefined);
      if (run.length === 0) return;
      setFixing({
        wordIds: ids,
        current: run.map((w) => w.text).join(" "),
        heard: run.length === 1 ? run[0]!.heardText : null,
        suggestion: match?.suggestion,
      });
    },
    [words, nameMatches],
  );

  async function saveFix(target: FixTarget, text: string) {
    const result = await api.correctWords(sessionId, { wordIds: target.wordIds, text });
    const removed = new Set(result.removedIds);
    setWords((prev) => prev && prev.filter((w) => !removed.has(w.id)).map((w) => (w.id === result.word.id ? result.word : w)));
    setNotice(noticeFor(result.glossary, refreshNameMatches));
    refreshNameMatches();
    return result;
  }

  const checks = useMemo(() => buildChecks(words ?? NO_WORDS, nameMatches), [words, nameMatches]);

  const back = (
    <button className="link" onClick={onBack}>
      ← All sessions
    </button>
  );

  if (!session || !words) {
    return (
      <section>
        {back}
        {error ? <p className="error">{error}</p> : <p>Loading…</p>}
      </section>
    );
  }

  const nameChecks = checks.filter((c) => c.kind === "name").length;

  function jumpTo(check: Check) {
    const el = transcriptRef.current?.querySelector<HTMLElement>(`[data-word-id="${check.wordId}"]`);
    // Centre it first (a far-off turn isn't laid out until it's near the
    // viewport), then nudge it to two-thirds down, clear of the open list.
    el?.scrollIntoView({ block: "center" });
    const scroller = el?.closest(".main");
    if (el && scroller) {
      scroller.scrollBy({ top: el.getBoundingClientRect().top - scroller.getBoundingClientRect().top - scroller.clientHeight * 0.66 });
    }
    el?.classList.remove("flash");
    void el?.offsetWidth; // restart the animation on a second jump to the same word
    el?.classList.add("flash");
    playFrom(check.startMs);
    openFix(check.wordId);
  }

  return (
    <section className="review">
      {back}
      <header className="review-head">
        <div>
          <h2>{session.title}</h2>
          <div className="who">
            {session.sessionDate} · <em>{session.status}</em>
          </div>
        </div>
        {words.length > 0 && (
          <div className="check-anchor">
            <button
              className="primary"
              aria-expanded={checkListOpen}
              onClick={() => setCheckListOpen((open) => !open)}
            >
              Check names ({nameChecks})
            </button>
            {checkListOpen && <CheckList checks={checks} onJump={jumpTo} onClose={closeCheckList} />}
          </div>
        )}
      </header>
      {error && <p className="error">{error}</p>}
      {speakers.length > 0 && (
        <div className="speaker-strip">
          <span className="hint">Who's talking:</span>
          {speakers.map((sp, i) => (
            <button
              key={sp.speakerLabel}
              className={sp.name ? "speaker-chip" : "speaker-chip unnamed"}
              data-chip-index={i}
              onClick={() => setPicking({ speakerLabel: sp.speakerLabel, anchor: `[data-chip-index="${i}"]` })}
            >
              <Portrait label={sp.speakerLabel} speaker={sp} />
              {speakerName(sp.speakerLabel, sp)}
            </button>
          ))}
        </div>
      )}
      {notice && <FixNotice notice={notice} onDismiss={() => setNotice(null)} onError={showError} />}

      {words.length > 0 ? (
        <>
          <Transcript
            ref={transcriptRef}
            words={words}
            nameMatches={nameMatches}
            onWordClick={playFrom}
            onWordOpen={openFix}
            speakers={speakerMap}
            onSpeakerOpen={(speakerLabel, turnKey) =>
              setPicking({ speakerLabel, anchor: `[data-turn-key="${turnKey}"] .speaker` })
            }
          />
          {picking && speakerMap.get(picking.speakerLabel) && (
            <SpeakerPicker
              key={picking.anchor}
              speaker={speakerMap.get(picking.speakerLabel)!}
              anchor={picking.anchor}
              onSave={saveSpeaker}
              onClose={closePicker}
            />
          )}
          {fixing && (
            <WordFix
              key={fixing.wordIds.join(",")}
              target={fixing}
              onSave={(text) => saveFix(fixing, text)}
              onReplay={() => {
                const first = words.find((w) => w.id === fixing.wordIds[0]);
                if (first) playFrom(first.startMs);
              }}
              onAddedToGlossary={(text) => {
                setNotice({ text });
                refreshNameMatches();
              }}
              onClose={closeFix}
            />
          )}
          {session.audioPath && (
            <div className="player">
              <audio ref={audioRef} controls preload="metadata" src={`/api/sessions/${session.id}/audio`} />
              <span className="hint">Click any word to hear it · double-click to fix it · Space replays</span>
            </div>
          )}
        </>
      ) : session.status === "transcribing" || transcribing ? (
        <p className="hint">Transcribing… a full session can take a few minutes.</p>
      ) : session.status === "uploaded" ? (
        <div className="panel">
          <p>Not transcribed yet.</p>
          {session.transcriptionError && <p className="error">Last attempt failed: {session.transcriptionError}</p>}
          <button onClick={onTranscribe}>{session.transcriptionError ? "Try again" : "Run transcription"}</button>
        </div>
      ) : (
        <p className="hint">Transcription finished but found no speech.</p>
      )}
    </section>
  );
}

/** What the last fix did, in a line under the header. Saved is always said: every fix is saved at once. */
function noticeFor(outcome: GlossaryOutcome, onGlossaryChanged: () => void): Notice | null {
  if (outcome.kind === "unknown") return null; // the fixer asks about it instead
  if (outcome.kind === "none" || outcome.hint === "already") return { text: "Saved." };
  if (outcome.hint === "added") {
    return { text: `Saved. "${outcome.heard}" now flags as ${outcome.name} in other sessions.` };
  }
  return {
    text: `Saved. "${outcome.heard}" is an everyday word, so it isn't flagged as ${outcome.name} elsewhere.`,
    action: {
      label: `Flag every "${outcome.heard}" anyway`,
      async run() {
        const entity = (await api.listEntities()).find((e) => e.id === outcome.entityId);
        if (!entity) throw new Error(`${outcome.name} is no longer in the glossary.`);
        const hint = outcome.heard.replace(/[^\p{L}\p{N}' ]/gu, "").trim();
        await api.saveEntity(entity.id, { soundsLike: [...entity.soundsLike, hint] });
        onGlossaryChanged();
      },
    },
  };
}

function FixNotice({ notice, onDismiss, onError }: { notice: Notice; onDismiss: () => void; onError: (err: unknown) => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="fix-notice" role="status">
      <span>{notice.text}</span>
      {notice.action && (
        <button
          disabled={busy}
          onClick={() => {
            setBusy(true);
            notice.action!.run().then(onDismiss, (err) => {
              setBusy(false);
              onError(err);
            });
          }}
        >
          {notice.action.label}
        </button>
      )}
      <button className="link" aria-label="Dismiss" onClick={onDismiss}>
        ✕
      </button>
    </div>
  );
}
