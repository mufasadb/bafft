import { useEffect, useState } from "react";
import {
  ENTITY_TYPES,
  GUIDED_FIELDS,
  type Entity,
  type EntityRelationship,
  type EntityType,
  type EntityWithChildren,
} from "@bafft/shared";
import { api } from "./api.js";
import { TYPE_LABELS, TYPE_SINGULAR, typeName } from "./labels.js";
import { LocationInside, useLocationInside } from "./LocationInside.js";
import { EntityCard } from "./EntityCard.js";
import { EntityPicker } from "./EntityPicker.js";
import { Icon } from "./theme/Icon.js";

// Glossary UI (bafft-wg1.3): the list, card and edit views for every entity
// type (NPCs have their own richer creator, see npc/). Opening an entity
// shows its card (bafft-a41); Edit switches to the form. Carries "Draft with AI"
// (a one-line description, or guided per-type questions, bafft-yh2.3) and
// "Picture this", both always an unsaved, editable/discardable result:
// approving one is the ordinary Save/Keep action, never automatic.
//
// `type` pins it to one entity type (the app shell's sidebar picks it);
// without it, the Glossary shows its own type tabs.

type FormState = {
  type: EntityType;
  name: string;
  aliases: string;
  soundsLike: string;
  tags: string;
  notes: string;
  quirks: string;
  // Locations only (bafft-w8f.16).
  description: string;
  storyRelevance: string;
  // Players only (bafft-w8f.8): the character they play, an entity id, NEW_HERO or "".
  heroId: string;
  newHeroName: string;
};

/** A player's hero is the character their "plays" relationship points at. */
const PLAYS = "plays";
const NEW_HERO = "new";

function emptyForm(type: EntityType): FormState {
  return {
    type, name: "", aliases: "", soundsLike: "", tags: "", notes: "", quirks: "",
    description: "", storyRelevance: "", heroId: "", newHeroName: "",
  };
}

function toForm(e: Entity): FormState {
  return {
    type: e.type,
    name: e.name,
    aliases: e.aliases.join(", "),
    soundsLike: e.soundsLike.join(", "),
    tags: e.tags.join(", "),
    notes: e.notes ?? "",
    quirks: e.quirks.join("\n"),
    description: e.profile?.description ?? "",
    storyRelevance: e.profile?.storyRelevance ?? "",
    heroId: "",
    newHeroName: "",
  };
}

/** Alphabetical at every level of the location tree (bafft-w8f.6). */
function sortTree(nodes: EntityWithChildren[]): EntityWithChildren[] {
  return [...nodes]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((n) => ({ ...n, children: sortTree(n.children) }));
}

function splitCsv(s: string): string[] {
  return s.split(",").map((v) => v.trim()).filter(Boolean);
}

function splitLines(s: string): string[] {
  return s.split("\n").map((v) => v.trim()).filter(Boolean);
}

export function Glossary({ type: pinnedType, openId }: { type?: EntityType; openId?: number } = {}) {
  const [entities, setEntities] = useState<Entity[] | null>(null);
  const [tree, setTree] = useState<EntityWithChildren[] | null>(null);
  const [activeType, setActiveType] = useState<EntityType>(pinnedType ?? "location");
  const [editing, setEditing] = useState<Entity | null>(null);
  // An opened entity shows as a card until Edit; new entities go straight to the form.
  const [mode, setMode] = useState<"card" | "form">("form");
  const [form, setForm] = useState<FormState>(emptyForm(pinnedType ?? "location"));
  const [draftMode, setDraftMode] = useState<"prompt" | "guided">("prompt");
  const [draftPrompt, setDraftPrompt] = useState("");
  const [guidedAnswers, setGuidedAnswers] = useState<Record<string, string>>({});
  const [drafting, setDrafting] = useState(false);
  // The player's current "plays" link, so Save can tell whether the hero changed.
  const [heroLink, setHeroLink] = useState<EntityRelationship | null>(null);
  const [status, setStatus] = useState<{ kind: "idle" | "saving" | "error" | "done"; message?: string }>({
    kind: "idle",
  });
  const editingId = editing?.id ?? null;

  function showError(err: unknown) {
    setStatus({ kind: "error", message: err instanceof Error ? err.message : String(err) });
  }

  const inside = useLocationInside(form.type === "location" ? editingId : null, showError);

  function loadEntities() {
    api.listEntities().then(setEntities).catch(showError);
  }

  function loadTree() {
    api.getLocationTree().then(setTree).catch(showError);
  }

  function reload() {
    loadEntities();
    loadTree();
  }

  useEffect(reload, []);

  // The shell switching types is the same as clicking a type tab.
  useEffect(() => {
    if (pinnedType && pinnedType !== activeType) {
      setActiveType(pinnedType);
      startNew(pinnedType);
    }
  }, [pinnedType]);

  // Following a link from elsewhere (e.g. an NPC's relationship) opens it here.
  useEffect(() => {
    const target = openId && entities?.find((e) => e.id === openId);
    if (target) startEdit(target);
  }, [openId, entities]);

  function clearDraftInputs() {
    setDraftPrompt("");
    setGuidedAnswers({});
  }

  function startNew(type: EntityType = activeType) {
    inside.reset();
    setHeroLink(null);
    setEditing(null);
    setMode("form");
    setForm(emptyForm(type));
    clearDraftInputs();
    setStatus({ kind: "idle" });
  }

  /** Opens an entity as its card. */
  function startEdit(entity: Entity) {
    setEditing(entity);
    setMode("card");
    setActiveType(entity.type);
    setForm(toForm(entity));
    setHeroLink(null);
    if (entity.type === "player") {
      api
        .listRelationships(entity.id)
        .then((links) => {
          const link = links.find((r) => r.fromEntityId === entity.id && r.description === PLAYS) ?? null;
          setHeroLink(link);
          setForm((f) => (f.name === entity.name ? { ...f, heroId: link ? String(link.toEntityId) : "" } : f));
        })
        .catch(showError);
    }
    clearDraftInputs();
    setStatus({ kind: "idle" });
  }

  // Browsing a type while creating something new means "make one of these":
  // the form follows the tab (asking for an innkeeper on the NPCs tab used
  // to draft a location).
  function selectType(t: EntityType) {
    setActiveType(t);
    if (editingId === null) {
      inside.reset();
      setForm((f) => ({ ...f, type: t }));
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus({ kind: "saving" });
    try {
      const saved = await api.saveEntity(editingId, {
        type: form.type,
        name: form.name,
        aliases: splitCsv(form.aliases),
        soundsLike: splitCsv(form.soundsLike),
        tags: splitCsv(form.tags),
        notes: form.notes.trim() || null,
        ...(form.type === "location"
          ? {
              quirks: [],
              profile: {
                description: form.description.trim() || undefined,
                storyRelevance: form.storyRelevance.trim() || undefined,
              },
            }
          : { quirks: splitLines(form.quirks) }),
      });
      if (form.type === "player") await saveHero(saved.id);
      if (form.type === "location") {
        try {
          await inside.save(saved.id);
        } catch (err) {
          // The entity itself was saved: keep its id so retrying cannot create a duplicate.
          setEditing(saved);
          reload();
          throw err;
        }
      }
      startEdit(saved);
      setStatus({ kind: "done" });
      reload();
    } catch (err) {
      showError(err);
    }
  }

  /** Points the player's "plays" link at the chosen hero, making the hero first if it's new. */
  async function saveHero(playerId: number) {
    const creating = form.heroId === NEW_HERO && form.newHeroName.trim() !== "";
    const wanted = creating ? null : form.heroId ? Number(form.heroId) : null;
    if (!creating && (heroLink?.toEntityId ?? null) === wanted) return;
    if (heroLink) await api.deleteRelationship(heroLink.id);
    const heroId = creating
      ? (await api.saveEntity(null, { type: "character", name: form.newHeroName.trim() })).id
      : wanted;
    if (heroId !== null) {
      await api.createRelationship({ fromEntityId: playerId, toEntityId: heroId, description: PLAYS, isContainment: false, gmOnly: false });
    }
  }

  async function onDelete(id: number) {
    if (!confirm("Delete this? There's no undo.")) return;
    try {
      await api.deleteEntity(id);
      if (editingId === id) startNew();
      reload();
    } catch (err) {
      showError(err);
    }
  }

  const guidedFields = GUIDED_FIELDS[form.type];
  // Only this type's questions, and only the ones actually answered.
  const guided = Object.fromEntries(
    guidedFields.map((f) => [f.key, (guidedAnswers[f.key] ?? "").trim()]).filter(([, v]) => v),
  );
  const canDraft = draftMode === "prompt" ? Boolean(draftPrompt.trim()) : Object.keys(guided).length > 0;

  async function onDraft() {
    if (!canDraft) return;
    setDrafting(true);
    try {
      const draft = await api.draftEntity(
        draftMode === "prompt" ? { type: form.type, prompt: draftPrompt } : { type: form.type, guided },
      );
      // Pre-fills the form only — still just a normal editable form until Save.
      setForm((f) => ({
        ...f,
        name: draft.name,
        aliases: draft.aliases.join(", "),
        tags: draft.tags.join(", "),
        // A drafted location's colour lines become its physical description.
        ...(f.type === "location" ? { description: draft.quirks.join("\n") } : { quirks: draft.quirks.join("\n") }),
      }));
    } catch (err) {
      showError(err);
    } finally {
      setDrafting(false);
    }
  }

  const visibleEntities = (entities ?? [])
    .filter((e) => e.type === activeType)
    .sort((a, b) => a.name.localeCompare(b.name));
  const isPlayer = form.type === "player";
  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  return (
    <div className="world">
      <section>
        {!pinnedType && (
          <div className="row" style={{ marginBottom: "0.75rem" }}>
            {ENTITY_TYPES.map((t) => (
              <button key={t} onClick={() => selectType(t)} aria-pressed={activeType === t}>
                {TYPE_LABELS[t]}
              </button>
            ))}
          </div>
        )}
        <button className="primary" onClick={() => startNew()} style={{ marginBottom: "0.75rem" }}>
          <Icon name="plus" size={16} />
          New {TYPE_SINGULAR[activeType]}
        </button>

        {activeType === "location" ? (
          <LocationTree nodes={sortTree(tree ?? [])} currentId={editingId} onSelect={startEdit} />
        ) : (
          <div className="list">
            {visibleEntities.length === 0 && <p className="hint">None yet.</p>}
            {visibleEntities.map((e) => (
              <button key={e.id} className="item" onClick={() => startEdit(e)} aria-current={e.id === editingId}>
                <span>
                  <strong>{e.name}</strong>
                  {e.aliases.length > 0 && <span className="sub"> — aka {e.aliases.join(", ")}</span>}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      {editing && mode === "card" ? (
        <section>
        {status.kind === "error" && <p className="error">{status.message}</p>}
        <EntityCard
          entity={editing}
          entities={entities ?? []}
          onEdit={() => setMode("form")}
          onDelete={() => onDelete(editing.id)}
          onOpen={startEdit}
          onChanged={(updated) => {
            if (updated) startEdit(updated);
            reload();
          }}
          onError={showError}
        />
        </section>
      ) : (
      <section className="panel">
        <h2>{editing ? `Edit: ${form.name || "…"}` : `New ${TYPE_SINGULAR[form.type]}`}</h2>

        {!isPlayer && (
        <details className="draft-box">
          <summary>
            <Icon name="sparkle" size={16} />
            Draft with AI
          </summary>
          <div role="group" aria-label="Draft mode" className="row">
            {(["prompt", "guided"] as const).map((mode) => (
              <button key={mode} type="button" aria-pressed={draftMode === mode} onClick={() => setDraftMode(mode)}>
                {mode === "prompt" ? "Describe it" : "Pick options"}
              </button>
            ))}
          </div>
          {draftMode === "guided" && (
            <div className="guided">
              {guidedFields.map((f) => (
                <label key={f.key} style={{ display: "contents" }}>
                  <span>{f.label}</span>
                  <input
                    type="text"
                    list={`guided-${form.type}-${f.key}`}
                    value={guidedAnswers[f.key] ?? ""}
                    onChange={(e) => setGuidedAnswers((a) => ({ ...a, [f.key]: e.target.value }))}
                  />
                  <datalist id={`guided-${form.type}-${f.key}`}>
                    {f.suggestions.map((v) => (
                      <option key={v} value={v} />
                    ))}
                  </datalist>
                </label>
              ))}
            </div>
          )}
          <div className="row">
            {draftMode === "prompt" && (
              <input
                type="text"
                placeholder="Describe it in a sentence…"
                value={draftPrompt}
                onChange={(e) => setDraftPrompt(e.target.value)}
                style={{ flex: 1 }}
              />
            )}
            <button className="accent" onClick={onDraft} disabled={drafting || !canDraft}>
              <Icon name="sparkle" size={16} />
              {drafting ? "Drafting…" : "Draft with AI"}
            </button>
          </div>
          <small>Fills the fields below — still a draft until you hit Save.</small>
        </details>
        )}

        <form onSubmit={onSubmit} className="form">
          {!isPlayer && <label>
            Type
            <select
              value={form.type}
              onChange={(e) => {
                const type = e.target.value as EntityType;
                inside.reset();
                set({ type });
                if (editingId === null) setActiveType(type);
              }}
            >
              {ENTITY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {typeName(t)}
                </option>
              ))}
            </select>
          </label>}
          <label>
            Name
            <input type="text" value={form.name} onChange={(e) => set({ name: e.target.value })} required />
          </label>
          {isPlayer && (
            <div className="field">
              <span>Hero</span>
              <EntityPicker
                entities={(entities ?? []).filter((e) => e.type === "character")}
                value={form.heroId}
                onChange={(heroId) => set({ heroId })}
                label="Hero"
                allowNew
              />
              {form.heroId === NEW_HERO && (
                <input type="text" aria-label="New hero's name" placeholder="the hero's name" value={form.newHeroName}
                  onChange={(e) => set({ newHeroName: e.target.value })} />
              )}
              <small>The character this player plays.</small>
            </div>
          )}
          {form.type === "location" && <LocationInside key={editingId ?? "new"} entities={entities ?? []}
            entityId={editingId} value={inside.parentId} onChange={inside.setParentId} disabled={!inside.ready} />}
          <label>
            Other names (comma separated)
            <input type="text" value={form.aliases} onChange={(e) => set({ aliases: e.target.value })} />
            <small>Real spellings and nicknames. Transcription writes these out exactly as typed.</small>
          </label>
          <label>
            Sounds like (comma separated)
            <input
              type="text"
              value={form.soundsLike}
              onChange={(e) => set({ soundsLike: e.target.value })}
              placeholder="e.g. fyord"
            />
            <small>How it's said at the table. A pronunciation guide only; never sent to transcription.</small>
          </label>
          {!isPlayer && <label>
            Tags (comma separated)
            <input type="text" value={form.tags} onChange={(e) => set({ tags: e.target.value })} />
          </label>}
          {form.type === "location" ? (
            <>
              <label>
                Physical description
                <textarea
                  value={form.description}
                  onChange={(e) => set({ description: e.target.value })}
                  rows={5}
                  placeholder="What the heroes see, hear and smell when they arrive"
                />
              </label>
              <NotesField value={form.notes} onChange={(notes) => set({ notes })} />
              <label>
                Story relevance
                <textarea
                  value={form.storyRelevance}
                  onChange={(e) => set({ storyRelevance: e.target.value })}
                  rows={4}
                  placeholder="Why it matters: what happens here, what's hidden here, who comes here"
                />
              </label>
            </>
          ) : (
            <>
              {!isPlayer && <label>
                Details (one per line)
                <textarea value={form.quirks} onChange={(e) => set({ quirks: e.target.value })} rows={5} />
              </label>}
              <NotesField value={form.notes} onChange={(notes) => set({ notes })} />
            </>
          )}
          <div className="row">
            <button type="submit" className="primary" disabled={status.kind === "saving" || (form.type === "location" && !inside.ready)}>
              {status.kind === "saving" ? "Saving…" : "Save"}
            </button>
            {status.kind === "done" && <span className="ok">Saved</span>}
          </div>
          {status.kind === "error" && <p className="error">{status.message}</p>}
        </form>

        {editing && (
          <button type="button" onClick={() => setMode("card")} style={{ marginTop: "0.75rem" }}>
            Back to card
          </button>
        )}
      </section>
      )}
    </div>
  );
}

/** GM-only notes: one label everywhere (bafft-w8f.6). */
function NotesField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label>
      Notes <span className="gm-only">GM only</span>
      <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={3} />
      <small>Never sent to the AI.</small>
    </label>
  );
}

function LocationTree({
  nodes,
  currentId,
  onSelect,
}: {
  nodes: EntityWithChildren[];
  currentId: number | null;
  onSelect: (e: Entity) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  if (nodes.length === 0) return <p className="hint">No locations yet.</p>;
  const toggle = (id: number) =>
    setCollapsed((c) => {
      const next = new Set(c);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  return (
    <ul className="tree">
      {nodes.map((n) => {
        const open = !collapsed.has(n.id);
        return (
          <li key={n.id}>
            <div className="row" style={{ flexWrap: "nowrap", gap: "0.25rem" }}>
              {n.children.length > 0 ? (
                <button className="ghost icon twisty" onClick={() => toggle(n.id)} aria-expanded={open}
                  aria-label={`${open ? "Collapse" : "Expand"} ${n.name}`}>
                  {open ? "▾" : "▸"}
                </button>
              ) : (
                <span className="twisty" aria-hidden />
              )}
              <button className="item" onClick={() => onSelect(n)} aria-current={n.id === currentId}>
                {n.name}
              </button>
            </div>
            {n.children.length > 0 && open && <LocationTree nodes={n.children} currentId={currentId} onSelect={onSelect} />}
          </li>
        );
      })}
    </ul>
  );
}
