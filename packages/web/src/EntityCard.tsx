import type { Entity } from "@bafft/shared";
import { TYPE_SINGULAR } from "./labels.js";
import { Picture } from "./Picture.js";
import { Relationships } from "./Relationships.js";
import { Icon } from "./theme/Icon.js";

// The read view for locations, items, characters and players (bafft-a41),
// same shape as the NPC card: framed picture, who/what in one line,
// scannable bullets, clickable relationships. Edit opens the form.
export function EntityCard({
  entity,
  entities,
  onEdit,
  onDelete,
  onOpen,
  onChanged,
  onError,
}: {
  entity: Entity;
  entities: Entity[];
  onEdit: () => void;
  onDelete: () => void;
  onOpen: (e: Entity) => void;
  onChanged: (updated?: Entity) => void;
  onError: (err: unknown) => void;
}) {
  const subtitle = [TYPE_SINGULAR[entity.type], ...entity.tags].join(" · ");

  return (
    <article className="entity-card panel ornate">
      <div className="card-head">
        <Picture key={entity.id} entity={entity} framed onSaved={onChanged} onError={onError} />
        <div className="card-title">
          <h2 className="npc-name">{entity.name}</h2>
          <div className="who">{subtitle}</div>
          {entity.aliases.length > 0 && <p className="hint">Also called {entity.aliases.join(", ")}</p>}
          {entity.soundsLike.length > 0 && <p className="hint">Said like “{entity.soundsLike.join("”, “")}”</p>}
          <div className="row">
            <button onClick={onEdit}>
              <Icon name="quill" />
              Edit
            </button>
            <button className="ghost danger" onClick={onDelete}>
              <Icon name="trash" size={16} />
              Delete
            </button>
          </div>
        </div>
      </div>

      <hr className="divider" />

      {entity.profile?.description && (
        <>
          <h3>Physical description</h3>
          <p className="prose story">{entity.profile.description}</p>
        </>
      )}
      {entity.quirks.length > 0 && (
        <>
          <h3>Details</h3>
          <ul className="bullets">
            {entity.quirks.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </>
      )}
      {entity.notes && (
        <>
          <h3>
            Notes <span className="gm-only">GM only</span>
          </h3>
          <p className="prose">{entity.notes}</p>
        </>
      )}
      {entity.profile?.storyRelevance && (
        <>
          <h3>Story relevance</h3>
          <p className="prose story">{entity.profile.storyRelevance}</p>
        </>
      )}
      {entity.quirks.length === 0 && !entity.notes && !entity.profile?.description && !entity.profile?.storyRelevance && (
        <p className="hint">
          Nothing written yet.{entity.type !== "player" && " Edit it, or use Draft with AI there."}
        </p>
      )}

      <h3>Relationships</h3>
      <Relationships entity={entity} entities={entities} onOpen={onOpen} onChanged={() => onChanged()} onError={onError} />
    </article>
  );
}
