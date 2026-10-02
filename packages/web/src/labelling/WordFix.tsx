// Fixing a word on the labelling screen (bafft-wg1.11): a small editor that
// opens on the word itself. Each fix is saved the moment it's made; there is
// no batch save. A fix to a name nobody has entered turns the editor into a
// short "add it to the glossary?" question.
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ENTITY_TYPES, type Entity, type EntityType, type GlossaryOutcome, type WordCorrectionResult } from "@bafft/shared";
import { api } from "../api.js";
import { EntityPicker } from "../EntityPicker.js";
import { typeName } from "../labels.js";
import { useDismiss, usePinnedTo } from "./pinned.js";

export interface FixTarget {
  /** One word, or a run that becomes one word ("Hooper Duke" -> Hupperdook). */
  wordIds: number[];
  /** As the transcript shows it now. */
  current: string;
  /** What the ASR wrote, once a word has been corrected. */
  heard: string | null;
  suggestion?: string;
}

type Unknown = Extract<GlossaryOutcome, { kind: "unknown" }>;

const POPOVER_WIDTH = 360;

export function WordFix({
  target,
  onSave,
  onReplay,
  onAddedToGlossary,
  onClose,
}: {
  target: FixTarget;
  onSave: (text: string) => Promise<WordCorrectionResult>;
  onReplay: () => void;
  onAddedToGlossary: (message: string) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(target.suggestion ?? target.current);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unknown, setUnknown] = useState<Unknown | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const position = usePinnedTo(`[data-word-id="${target.wordIds[0]}"]`, ref, POPOVER_WIDTH);

  useEffect(() => {
    inputRef.current?.select();
  }, []);

  // Clicking elsewhere closes it, unsaved; a click on another word opens that one.
  useDismiss(ref, onClose);

  async function save(value: string) {
    const fixed = value.trim();
    if (!fixed) return;
    setSaving(true);
    setError(null);
    try {
      const result = await onSave(fixed);
      if (result.glossary.kind === "unknown") setUnknown(result.glossary);
      else onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void save(text);
  }

  return (
    <div className="word-fix" ref={ref} role="dialog" aria-label="Fix word" style={position}>
      {unknown ? (
        <AddToGlossary outcome={unknown} onDone={(message) => { onAddedToGlossary(message); onClose(); }} onSkip={onClose} />
      ) : (
        <form onSubmit={onSubmit}>
          <div className="word-fix-head">
            <span>
              Heard <q>{target.heard ?? target.current}</q>
            </span>
            <button type="button" className="link" onClick={onReplay}>
              ▶ Replay
            </button>
          </div>
          <input
            ref={inputRef}
            aria-label="Correct text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={saving}
          />
          {error && <p className="error">{error}</p>}
          <div className="word-fix-actions">
            {target.suggestion && target.suggestion !== text.trim() && (
              <button type="button" onClick={() => void save(target.suggestion!)} disabled={saving}>
                Use {target.suggestion}
              </button>
            )}
            <button type="submit" className="primary" disabled={saving || !text.trim()}>
              Save
            </button>
            <button type="button" onClick={onClose}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

const ANOTHER_NAME = "another-name";

/**
 * "Zarovich isn't in the glossary": add it as a new entry (with where it is,
 * for a place), as another name for an existing one, or leave it.
 */
function AddToGlossary({
  outcome,
  onDone,
  onSkip,
}: {
  outcome: Unknown;
  onDone: (message: string) => void;
  onSkip: () => void;
}) {
  const [entities, setEntities] = useState<Entity[]>([]);
  const [kind, setKind] = useState<EntityType | typeof ANOTHER_NAME>("npc");
  const [parentId, setParentId] = useState("");
  const [existingId, setExistingId] = useState("");
  // An everyday heard word ("acid") as a hint would flag every "acid".
  const [flagHeard, setFlagHeard] = useState(!outcome.heardIsPlain);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hint = outcome.heard.replace(/[^\p{L}\p{N}' ]/gu, "").trim();

  useEffect(() => {
    api.listEntities().then(setEntities).catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  async function add(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const soundsLike = flagHeard && hint ? [hint] : [];
      if (kind === ANOTHER_NAME) {
        const entity = entities.find((x) => String(x.id) === existingId);
        if (!entity) throw new Error("Choose which entry it's another name for.");
        await api.saveEntity(entity.id, {
          aliases: [...entity.aliases, outcome.name],
          soundsLike: [...entity.soundsLike, ...soundsLike.filter((s) => !entity.soundsLike.includes(s))],
        });
        onDone(`Added "${outcome.name}" as another name for ${entity.name}.`);
      } else {
        const created = await api.saveEntity(null, { type: kind, name: outcome.name, soundsLike });
        if (kind === "location" && parentId) await api.setLocationInside(created.id, Number(parentId));
        onDone(`Added ${outcome.name} to the glossary (${typeName(kind)}).`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  }

  return (
    <form onSubmit={add} className="add-to-glossary">
      <p>
        Saved. <strong>{outcome.name}</strong> isn't in the glossary yet. Add it?
      </p>
      <label>
        As
        <select value={kind} onChange={(e) => setKind(e.target.value as EntityType | typeof ANOTHER_NAME)}>
          {ENTITY_TYPES.map((t) => (
            <option key={t} value={t}>
              {typeName(t)}
            </option>
          ))}
          <option value={ANOTHER_NAME}>Another name for…</option>
        </select>
      </label>
      {kind === "location" && (
        <div className="picker-row">
          <span>Inside</span>
          <EntityPicker entities={entities.filter((x) => x.type === "location")} value={parentId} onChange={setParentId} label="Inside" />
        </div>
      )}
      {kind === ANOTHER_NAME && (
        <EntityPicker entities={entities} value={existingId} onChange={setExistingId} label="Another name for" />
      )}
      {hint && (
        <label className="check">
          <input type="checkbox" checked={flagHeard} onChange={(e) => setFlagHeard(e.target.checked)} />
          <span>
            Flag <q>{hint}</q> as {outcome.name} in other sessions
          </span>
        </label>
      )}
      {error && <p className="error">{error}</p>}
      <div className="word-fix-actions">
        <button type="submit" className="primary" disabled={saving}>
          Add to glossary
        </button>
        <button type="button" onClick={onSkip}>
          Not a name
        </button>
      </div>
    </form>
  );
}
