// "Who is Speaker C?" (bafft-wg1.12): pick the player once and every turn of
// that speaker in this session says so, with their hero's portrait. The GM
// is one speaker, all NPC voices included. Saved at once, like a word fix.
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Entity, Speaker, SpeakerUpdate } from "@bafft/shared";
import { api } from "../api.js";
import { useDismiss, usePinnedTo } from "./pinned.js";

const POPOVER_WIDTH = 340;

export function SpeakerPicker({
  speaker,
  anchor,
  onSave,
  onClose,
}: {
  speaker: Speaker;
  /** CSS selector for what was clicked: a turn's speaker name, or the speaker strip. */
  anchor: string;
  onSave: (update: SpeakerUpdate) => Promise<void>;
  onClose: () => void;
}) {
  const [players, setPlayers] = useState<Entity[] | null>(null);
  // A typed-in name comes back for editing; the GM and players have their own buttons.
  const typed = speaker.entityId === null && speaker.name !== "GM" ? speaker.name : null;
  const [other, setOther] = useState(typed ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const position = usePinnedTo(anchor, ref, POPOVER_WIDTH);
  useDismiss(ref, onClose);

  useEffect(() => {
    api
      .listEntities()
      .then((all) => setPlayers(all.filter((e) => e.type === "player").sort((a, b) => a.name.localeCompare(b.name))))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  async function save(name: string | null, entityId: number | null = null) {
    setSaving(true);
    setError(null);
    try {
      await onSave({ speakerLabel: speaker.speakerLabel, name, entityId });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (other.trim()) void save(other.trim());
  }

  return (
    <div className="speaker-picker" ref={ref} role="dialog" aria-label={`Who is ${speaker.speakerLabel}?`} style={position}>
      <p className="speaker-picker-head">
        Who is <strong>{speaker.speakerLabel}</strong>? <span className="hint">{speaker.wordCount.toLocaleString()} words</span>
      </p>
      <div className="speaker-choices">
        {players?.map((p) => (
          <button
            key={p.id}
            className={speaker.entityId === p.id ? "primary" : undefined}
            aria-pressed={speaker.entityId === p.id}
            disabled={saving}
            onClick={() => void save(p.name, p.id)}
          >
            {p.name}
          </button>
        ))}
        <button
          className={speaker.entityId === null && speaker.name === "GM" ? "primary" : undefined}
          aria-pressed={speaker.entityId === null && speaker.name === "GM"}
          disabled={saving}
          onClick={() => void save("GM")}
        >
          GM
        </button>
      </div>
      {players?.length === 0 && <p className="hint">No players yet: add them under Players to pick them here.</p>}
      <form onSubmit={onSubmit} className="speaker-other">
        <input aria-label="Someone else" placeholder="Someone else…" value={other} onChange={(e) => setOther(e.target.value)} />
        <button type="submit" disabled={saving || !other.trim()}>
          Save
        </button>
      </form>
      {error && <p className="error">{error}</p>}
      <p className="hint">
        Speakers are guessed from voices, so a few lines may be someone else's.
        {speaker.name !== null && (
          <>
            {" "}
            <button className="link" disabled={saving} onClick={() => void save(null)}>
              Back to “{speaker.speakerLabel}”
            </button>
          </>
        )}
      </p>
    </div>
  );
}
