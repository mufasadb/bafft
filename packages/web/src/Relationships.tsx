import { useEffect, useId, useState } from "react";
import { ENTITY_TYPES, type Entity, type EntityRelationship, type EntityType } from "@bafft/shared";
import { api } from "./api.js";
import { TYPE_SINGULAR } from "./labels.js";
import { EntityPicker } from "./EntityPicker.js";
import { Icon } from "./theme/Icon.js";

// The editable label supplies the whole verb phrase; related names open the entity.
const NEW_TARGET = "new";
const EMPTY = { toEntityId: "", description: "", isContainment: false, gmOnly: false, newName: "", newType: "location" as EntityType };

export function Relationships({
  entity,
  entities,
  onOpen,
  onChanged,
  onError,
  audience = "gm",
}: {
  audience?: "gm" | "player";
  entity: Entity;
  entities: Entity[];
  onOpen: (e: Entity) => void;
  /** Called after anything that could change the entity list or location tree. */
  onChanged: () => void;
  onError: (err: unknown) => void;
}) {
  const [relationships, setRelationships] = useState<EntityRelationship[]>([]);
  const [draft, setDraft] = useState(EMPTY);
  const [labels, setLabels] = useState<string[]>([]);
  const labelListId = useId();

  function load() {
    api.listRelationships(entity.id, audience).then(setRelationships).catch(onError);
    if (audience === "gm") api.listRelationshipLabels().then(setLabels).catch(onError);
  }

  useEffect(() => {
    setDraft(EMPTY);
    load();
  }, [entity.id, audience]);

  async function add() {
    if (!draft.toEntityId || !draft.description.trim()) return;
    const creating = draft.toEntityId === NEW_TARGET;
    if (creating && !draft.newName.trim()) return;
    try {
      const toEntityId = creating
        ? (await api.saveEntity(null, { type: draft.newType, name: draft.newName.trim() })).id
        : Number(draft.toEntityId);
      await api.createRelationship({
        fromEntityId: entity.id,
        toEntityId,
        description: draft.description.trim(),
        isContainment: draft.isContainment,
        gmOnly: draft.gmOnly,
      });
      setDraft(EMPTY);
      load();
      onChanged();
    } catch (err) {
      onError(err);
    }
  }

  async function remove(id: number) {
    try {
      await api.deleteRelationship(id);
      load();
      onChanged();
    } catch (err) {
      onError(err);
    }
  }

  async function toggleVisibility(r: EntityRelationship) {
    try {
      const updated = await api.setRelationshipGmOnly(r.id, !r.gmOnly);
      setRelationships((links) => links.map((link) => link.id === updated.id ? updated : link));
      onChanged();
    } catch (err) {
      onError(err);
    }
  }

  const visible = relationships.filter((r) => audience === "gm" || !r.gmOnly);
  const others = entities.filter((e) => e.id !== entity.id);
  const link = (id: number) => {
    const other = entities.find((e) => e.id === id);
    return other ? (
      <button type="button" className="link" onClick={() => onOpen(other)}>
        {other.name}
      </button>
    ) : (
      <>#{id}</>
    );
  };

  return (
    <div className="relationships">
      {visible.length === 0 ? (
        <p className="hint">None yet.</p>
      ) : (
        <ul className="rel-list">
          {visible.map((r) => (
            <li key={r.id} className="chip">
              <Icon name="link" size={14} />
              {r.fromEntityId === entity.id ? (
                <>
                  {r.description} {link(r.toEntityId)}
                </>
              ) : (
                <>
                  {link(r.fromEntityId)} {r.description} this
                </>
              )}
              {r.gmOnly && <span className="gm-only">GM only</span>}
              {audience === "gm" && <label>
                <input type="checkbox" checked={r.gmOnly}
                  aria-label={`GM only: ${r.description}`}
                  onChange={() => toggleVisibility(r)} />
                GM only
              </label>}
              {audience === "gm" && <button className="ghost icon" onClick={() => remove(r.id)} title="Remove" aria-label="Remove">
                ✕
              </button>}
            </li>
          ))}
        </ul>
      )}
      {audience === "gm" && <div className="row rel-add">
        <span>{entity.name || "This"}</span>
        <input
          type="text"
          aria-label="Relationship"
          placeholder='"is owner of", "secretly serves", …'
          list={labelListId}
          value={draft.description}
          onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
        />
        <datalist id={labelListId}>
          {labels.map((label) => <option key={label} value={label} />)}
        </datalist>
        <EntityPicker key={entity.id} entities={others} value={draft.toEntityId} allowNew
          onChange={(toEntityId) => setDraft((d) => ({ ...d, toEntityId }))} />
        {draft.toEntityId === NEW_TARGET && (
          <>
            <input
              type="text"
              aria-label="New thing's name"
              placeholder="its name"
              value={draft.newName}
              onChange={(e) => setDraft((d) => ({ ...d, newName: e.target.value }))}
            />
            <select
              aria-label="New thing's type"
              value={draft.newType}
              onChange={(e) => setDraft((d) => ({ ...d, newType: e.target.value as EntityType }))}
            >
              {ENTITY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_SINGULAR[t]}
                </option>
              ))}
            </select>
          </>
        )}
        <label>
          <input type="checkbox" aria-label="New relationship GM only" checked={draft.gmOnly}
            onChange={(e) => setDraft((d) => ({ ...d, gmOnly: e.target.checked }))} />
          GM only
        </label>
        <button onClick={add}>
          <Icon name="plus" size={16} />
          Add
        </button>
      </div>}
    </div>
  );
}
