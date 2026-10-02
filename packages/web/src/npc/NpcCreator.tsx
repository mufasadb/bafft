import { useState } from "react";
import {
  ATTITUDES,
  DRAW_STEEL_ANCESTRIES,
  MOTIVATIONS,
  negotiationStart,
  type Attitude,
  type Entity,
  type Motivation,
  type Negotiation,
  type NpcProfile,
  type NpcTextField,
} from "@bafft/shared";
import { api } from "../api.js";
import { Icon } from "../theme/Icon.js";
import { Pips } from "../theme/Pips.js";

// NPC creator (bafft-vm8.4). Three ways in, mixed freely:
//   type a blurb, roll dice for any unlocked field, or fill fields yourself;
//   then "Flesh out with AI" fills whatever is still empty.
// Every field shows who filled it (you, the dice, the AI). Typing into a
// field locks it; the dice never touch a locked field, and the AI only ever
// fills empty ones. Nothing is saved until Save.

type Source = "gm" | "dice" | "ai";
type FieldKey = "name" | NpcTextField | "negotiation";

// noDice: the roll tables don't cover it; the GM or the AI writes it.
const GROUPS: {
  title: string;
  fields: { key: NpcTextField; label: string; long?: boolean; noDice?: boolean; placeholder?: string }[];
}[] = [
  {
    title: "Who",
    fields: [
      { key: "ancestry", label: "Ancestry" },
      { key: "occupation", label: "Occupation" },
    ],
  },
  {
    title: "At the table",
    fields: [
      { key: "look", label: "Look" },
      { key: "voice", label: "Voice", placeholder: "Accent + one feature, e.g. Irish, high-pitched Walken cadence" },
      { key: "behaviour", label: "Behaviour" },
      { key: "flaw", label: "Flaw" },
    ],
  },
  {
    // The director's prep format (bafft-w8f.4): run an NPC from what they want.
    title: "What drives them",
    fields: [
      { key: "wants", label: "Wants", long: true, noDice: true, placeholder: "What they want most right now" },
      { key: "can", label: "Can", long: true, noDice: true, placeholder: "Power, skills, resources, people" },
      { key: "plan", label: "Plan", long: true, noDice: true, placeholder: "The steps they're taking" },
      { key: "sideways", label: "If it goes sideways", long: true, noDice: true, placeholder: "What they do when it goes wrong" },
    ],
  },
  {
    title: "Story",
    // One open text area (owner, bafft-w8f.15).
    fields: [
      {
        key: "story",
        label: "Story",
        long: true,
        noDice: true,
        placeholder: "Their part in the story: why they'd help or refuse, hooks, secrets. Anything.",
      },
    ],
  },
];

const SEED_FIELDS: FieldKey[] = ["name", "ancestry", "occupation", "look", "voice", "behaviour", "flaw"];

const SOURCE_LABEL: Record<Source, string> = { gm: "you", dice: "dice", ai: "AI" };

function initialSources(entity: Entity | null): Partial<Record<FieldKey, Source>> {
  if (!entity) return {};
  const sources: Partial<Record<FieldKey, Source>> = { name: "gm" };
  for (const [k, v] of Object.entries(entity.profile ?? {})) if (v) sources[k as FieldKey] = "gm";
  return sources;
}

const splitCsv = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

function isBlank(key: FieldKey, name: string, profile: NpcProfile): boolean {
  if (key === "name") return !name.trim();
  if (key === "negotiation") return !profile.negotiation;
  return !profile[key]?.trim();
}

export function NpcCreator({
  entity,
  drawSteel,
  onSaved,
  onCancel,
}: {
  /** Editing an existing NPC, or null for a new one. */
  entity: Entity | null;
  /** Draw Steel campaigns get the negotiation panel. */
  drawSteel: boolean;
  onSaved: (saved: Entity) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(entity?.name ?? "");
  const [profile, setProfile] = useState<NpcProfile>(entity?.profile ?? {});
  const [quirks, setQuirks] = useState((entity?.quirks ?? []).join("\n"));
  const [tags, setTags] = useState<string[]>(entity?.tags ?? []);
  const [aliases, setAliases] = useState((entity?.aliases ?? []).join(", "));
  const [soundsLike, setSoundsLike] = useState((entity?.soundsLike ?? []).join(", "));
  const [notes, setNotes] = useState(entity?.notes ?? "");
  const [blurb, setBlurb] = useState("");
  // "Keep to my notes" (bafft-w8f.10): the AI adds colour, never story.
  const [colourOnly, setColourOnly] = useState(false);
  const [sources, setSources] = useState(initialSources(entity));
  const [locked, setLocked] = useState<Partial<Record<FieldKey, boolean>>>(() =>
    Object.fromEntries(Object.keys(initialSources(entity)).map((k) => [k, true])),
  );
  const [busy, setBusy] = useState<null | "roll" | "ai" | "save" | FieldKey>(null);
  const [error, setError] = useState<string | null>(null);

  const fail = (err: unknown) => setError(err instanceof Error ? err.message : String(err));

  function markFilled(keys: FieldKey[], source: Source) {
    setSources((s) => ({ ...s, ...Object.fromEntries(keys.map((k) => [k, source])) }));
  }

  // Typing is the GM taking a field: it's theirs, and locked from the dice.
  function typed(key: FieldKey, value: string) {
    if (key === "name") setName(value);
    else if (key !== "negotiation") setProfile((p) => ({ ...p, [key]: value }));
    setSources((s) => ({ ...s, [key]: "gm" }));
    setLocked((l) => ({ ...l, [key]: Boolean(value.trim()) }));
  }

  function editNegotiation(update: (n: Negotiation) => Negotiation) {
    setProfile((p) => ({ ...p, negotiation: update(p.negotiation ?? { motivations: [], pitfalls: [] }) }));
    setSources((s) => ({ ...s, negotiation: "gm" }));
    setLocked((l) => ({ ...l, negotiation: true }));
  }

  /** Re-rolls every unlocked seed field (who they are, how they come across),
   * keeping locked ones. Story fields are left for "Flesh out" to write so
   * they fit the seeds; each still has its own die. */
  async function rollAll() {
    const keys: FieldKey[] = [...SEED_FIELDS];
    if (drawSteel) keys.push("negotiation");
    const toRoll = keys.filter((k) => !locked[k]);
    const cleared: NpcProfile = { ...profile };
    for (const k of toRoll) if (k !== "name") delete cleared[k];
    setBusy("roll");
    setError(null);
    try {
      const rolled = await api.rollNpc({
        name: toRoll.includes("name") ? undefined : name,
        profile: cleared,
        fields: toRoll,
      });
      setName(rolled.name);
      setProfile(rolled.profile);
      markFilled(toRoll, "dice");
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  }

  /** One offer per Interest level; clearing the text removes it. */
  function setOffer(interest: number, offer: string) {
    editNegotiation((neg) => {
      const rest = (neg.offers ?? []).filter((o) => o.interest !== interest);
      const offers = offer ? [...rest, { interest, offer }].sort((a, b) => b.interest - a.interest) : rest;
      return { ...neg, offers: offers.length ? offers : undefined };
    });
  }

  async function rollOne(key: FieldKey) {
    setBusy(key);
    setError(null);
    try {
      const rolled = await api.rollNpc({ name, profile, only: key });
      if (key === "name") setName(rolled.name);
      else setProfile((p) => ({ ...p, [key]: rolled.profile[key] }));
      markFilled([key], "dice");
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  }

  /** The AI fills only what's empty; everything already there is sent as given. */
  async function fleshOut() {
    const keys: FieldKey[] = ["name", ...GROUPS.flatMap((g) => g.fields.map((f) => f.key))];
    if (drawSteel) keys.push("negotiation");
    const empty = keys.filter((k) => isBlank(k, name, profile));
    setBusy("ai");
    setError(null);
    try {
      const draft = await api.draftNpc({
        blurb: blurb.trim() || undefined,
        name: name.trim() || undefined,
        profile,
        aliases: splitCsv(aliases),
        tags,
        quirks: quirks.split("\n").map((q) => q.trim()).filter(Boolean),
        entityId: entity?.id,
        colourOnly: colourOnly || undefined,
      });
      setName(draft.name);
      setProfile(draft.profile);
      if (!quirks.trim()) setQuirks(draft.quirks.join("\n"));
      if (tags.length === 0) setTags(draft.tags);
      markFilled(empty.filter((k) => !isBlank(k, draft.name, draft.profile)), "ai");
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy("save");
    setError(null);
    try {
      const saved = await api.saveEntity(entity?.id ?? null, {
        type: "npc",
        name: name.trim(),
        tags,
        aliases: splitCsv(aliases),
        soundsLike: splitCsv(soundsLike),
        quirks: quirks.split("\n").map((q) => q.trim()).filter(Boolean),
        notes: notes.trim() || null,
        profile,
      });
      onSaved(saved);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  }

  const controls = (key: FieldKey, label: string, noDice = false) => (
    <span className="field-controls">
      {sources[key] && <span className={`by by-${sources[key]}`}>{SOURCE_LABEL[sources[key]!]}</span>}
      {!noDice && (
        <button
          type="button"
          className="ghost icon"
          disabled={Boolean(locked[key]) || busy !== null}
          onClick={() => rollOne(key)}
          title={`Re-roll ${label}`}
          aria-label={`Re-roll ${label}`}
        >
          <Icon name="die" size={16} />
        </button>
      )}
      <button
        type="button"
        className="ghost icon"
        aria-pressed={Boolean(locked[key])}
        onClick={() => setLocked((l) => ({ ...l, [key]: !l[key] }))}
        title={locked[key] ? `Unlock ${label}` : `Lock ${label}`}
        aria-label={locked[key] ? `Unlock ${label}` : `Lock ${label}`}
      >
        <Icon name={locked[key] ? "lock" : "unlock"} size={16} />
      </button>
    </span>
  );

  const fieldClass = (key: FieldKey) => `field ${sources[key] ? `by-${sources[key]}` : ""}`;
  const n = profile.negotiation;
  const start = negotiationStart(n?.attitude);
  const usedKinds = new Set([...(n?.motivations ?? []), ...(n?.pitfalls ?? [])].map((m) => m.kind));

  return (
    <form className="npc-creator panel ornate" onSubmit={save}>
      <div className="row">
        <h2 style={{ margin: 0 }}>{entity ? `Edit ${entity.name}` : "Create an NPC"}</h2>
        <span className="spacer" />
        <span className="legend">
          <span className="by by-gm">you</span>
          <span className="by by-dice">dice</span>
          <span className="by by-ai">AI</span>
        </span>
      </div>

      <div className="blurb row">
        <input
          type="text"
          aria-label="Quick idea"
          placeholder="Quick idea, e.g. a wary dwarven innkeeper who owes the thieves guild…"
          value={blurb}
          onChange={(e) => setBlurb(e.target.value)}
          style={{ flex: 1 }}
        />
        <button type="button" onClick={rollAll} disabled={busy !== null}>
          <Icon name="die" />
          {busy === "roll" ? "Rolling…" : "Roll"}
        </button>
        <button type="button" className="accent" onClick={fleshOut} disabled={busy !== null}>
          <Icon name="sparkle" />
          {busy === "ai" ? "Writing…" : "Flesh out with AI"}
        </button>
      </div>
      <label className="check">
        <input type="checkbox" checked={colourOnly} onChange={(e) => setColourOnly(e.target.checked)} />
        Keep to my notes: the AI adds colour (look, voice, quirks) but leaves the story to you
      </label>
      <small>
        Roll deals out who they are and how they come across. Flesh out writes the rest around it, and never changes
        what's already there. Lock anything you want to keep.
      </small>

      <div className="npc-columns">
        <div>
          <div className={fieldClass("name")}>
            <div className="field-head">
              <label htmlFor="npc-name">Name</label>
              {controls("name", "Name")}
            </div>
            <input id="npc-name" type="text" value={name} onChange={(e) => typed("name", e.target.value)} required />
          </div>
          <div className="field-grid">
            <div className="field">
              <label htmlFor="npc-aliases">Other names (comma separated)</label>
              <input id="npc-aliases" type="text" value={aliases} onChange={(e) => setAliases(e.target.value)} />
              <small>Real spellings and nicknames. Transcription writes these out exactly as typed.</small>
            </div>
            <div className="field">
              <label htmlFor="npc-sounds-like">Sounds like (comma separated)</label>
              <input
                id="npc-sounds-like"
                type="text"
                placeholder="e.g. throw-ken-shield"
                value={soundsLike}
                onChange={(e) => setSoundsLike(e.target.value)}
              />
              <small>How it's said at the table. A pronunciation guide only; never sent to transcription.</small>
            </div>
          </div>

          {GROUPS.map((group) => (
            <fieldset key={group.title}>
              <legend>{group.title}</legend>
              <div className={group.fields.some((f) => f.long) ? undefined : "field-grid"}>
              {group.fields.map((f) => (
                <div key={f.key} className={fieldClass(f.key)}>
                  <div className="field-head">
                    <label htmlFor={`npc-${f.key}`}>
                      {f.label}
                    </label>
                    {controls(f.key, f.label, f.noDice)}
                  </div>
                  <textarea
                    id={`npc-${f.key}`}
                    rows={f.key === "story" ? 6 : f.long ? 2 : 1}
                    placeholder={f.placeholder}
                    value={profile[f.key] ?? ""}
                    onChange={(e) => typed(f.key, e.target.value)}
                  />
                  {f.key === "ancestry" && !profile.ancestry && (
                    <div className="suggest row">
                      {DRAW_STEEL_ANCESTRIES.map((a) => (
                        <button key={a} type="button" className="ghost" onClick={() => typed("ancestry", a)}>
                          {a}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              </div>
            </fieldset>
          ))}

          <fieldset>
            <legend>Extra colour</legend>
            <label>
              Details (one per line)
              <textarea rows={3} value={quirks} onChange={(e) => setQuirks(e.target.value)} />
            </label>
            <label>
              Notes <span className="gm-only">GM only</span>
              <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
              <small>Never sent to the AI.</small>
            </label>
          </fieldset>
        </div>

        {drawSteel && (
          <aside className={`negotiation ${fieldClass("negotiation")}`}>
            <div className="field-head">
              <h3 style={{ margin: 0 }}>Negotiation</h3>
              {controls("negotiation", "Negotiation")}
            </div>
            <label>
              Attitude
              <select
                value={n?.attitude ?? ""}
                onChange={(e) =>
                  editNegotiation((neg) => ({ ...neg, attitude: (e.target.value || undefined) as Attitude | undefined }))
                }
              >
                <option value="">—</option>
                {ATTITUDES.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </label>
            <div className="meter">
              <span>Interest</span>
              <Pips value={start?.interest ?? 0} label="Interest" title="Set by attitude" />
            </div>
            <div className="meter">
              <span>Patience</span>
              <Pips value={start?.patience ?? 0} label="Patience" title="Set by attitude" />
            </div>
            <small>Starting values, set by attitude.</small>
            <div className="row">
              <label style={{ flex: 1 }}>
                Impression
                <input
                  type="number"
                  min={1}
                  max={12}
                  value={n?.impression ?? ""}
                  onChange={(e) =>
                    editNegotiation((neg) => ({ ...neg, impression: e.target.value ? Number(e.target.value) : undefined }))
                  }
                />
              </label>
              <label style={{ flex: 2 }}>
                Language
                <input
                  type="text"
                  value={n?.language ?? ""}
                  onChange={(e) => editNegotiation((neg) => ({ ...neg, language: e.target.value || undefined }))}
                />
              </label>
            </div>
            {(["motivations", "pitfalls"] as const).map((list) => (
              <div key={list} className="picks">
                {(n?.[list].length ?? 0) < 2 && (
                  <small className="needs">
                    Needs at least 2 {list === "motivations" ? "motivations" : "pitfalls"}
                    {n?.[list].length ? ` (1 more)` : ""}. Flesh out fills the rest.
                  </small>
                )}
                <div className="field-head">
                  <strong>{list === "motivations" ? "Motivations" : "Pitfalls"}</strong>
                  <select
                    aria-label={`Add ${list === "motivations" ? "motivation" : "pitfall"}`}
                    value=""
                    onChange={(e) => {
                      const kind = e.target.value as Motivation;
                      if (kind) editNegotiation((neg) => ({ ...neg, [list]: [...neg[list], { kind, reason: "" }] }));
                    }}
                  >
                    <option value="">+ add</option>
                    {MOTIVATIONS.filter((k) => !usedKinds.has(k)).map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </select>
                </div>
                {(n?.[list] ?? []).map((m, i) => (
                  <div key={m.kind} className="pick">
                    <span className={`chip ${list === "motivations" ? "motivation" : "pitfall"}`}>
                      {m.kind}
                      <button
                        type="button"
                        className="ghost icon"
                        aria-label={`Remove ${m.kind}`}
                        onClick={() => editNegotiation((neg) => ({ ...neg, [list]: neg[list].filter((_, j) => j !== i) }))}
                      >
                        ✕
                      </button>
                    </span>
                    <textarea
                      rows={1}
                      aria-label={`Why ${m.kind}`}
                      placeholder={list === "motivations" ? "The argument that works on them" : "What loses them"}
                      value={m.reason}
                      onChange={(e) =>
                        editNegotiation((neg) => ({
                          ...neg,
                          [list]: neg[list].map((x, j) => (j === i ? { ...x, reason: e.target.value } : x)),
                        }))
                      }
                    />
                  </div>
                ))}
              </div>
            ))}
            <div className="offers">
              <strong>Offers by interest</strong>
              <small>What they give as the heroes win them over.</small>
              {[5, 4, 3, 2, 1, 0].map((level) => (
                <label key={level} className="offer-row">
                  <span className="offer-level">{level}</span>
                  <input
                    type="text"
                    aria-label={`Offer at interest ${level}`}
                    value={n?.offers?.find((o) => o.interest === level)?.offer ?? ""}
                    onChange={(e) => setOffer(level, e.target.value)}
                  />
                </label>
              ))}
            </div>
          </aside>
        )}
      </div>

      <div className="row" style={{ marginTop: "1rem" }}>
        <button type="submit" className="primary" disabled={busy !== null || !name.trim()}>
          {busy === "save" ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        {error && <span className="error">{error}</span>}
      </div>
    </form>
  );
}
