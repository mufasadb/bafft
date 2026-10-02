import { useEffect, useState } from "react";
import type { Entity } from "@bafft/shared";
import { api } from "../api.js";
import { Icon } from "../theme/Icon.js";
import { NpcCard } from "./NpcCard.js";
import { NpcCreator } from "./NpcCreator.js";

// NPCs: a list on the left, and on the right either the NPC's card (the
// default, read view) or the creator (new or edit).
type View = { mode: "card"; id: number } | { mode: "edit"; id: number } | { mode: "new" } | { mode: "none" };

export function NpcSection({
  drawSteel,
  onOpenOther,
}: {
  drawSteel: boolean;
  /** A relationship pointed at something that isn't an NPC. */
  onOpenOther: (e: Entity) => void;
}) {
  const [entities, setEntities] = useState<Entity[]>([]);
  const [view, setView] = useState<View>({ mode: "none" });
  const [error, setError] = useState<string | null>(null);

  const fail = (err: unknown) => setError(err instanceof Error ? err.message : String(err));

  function load() {
    return api.listEntities().then(setEntities).catch(fail);
  }

  useEffect(() => {
    load();
  }, []);

  const npcs = entities.filter((e) => e.type === "npc").sort((a, b) => a.name.localeCompare(b.name));
  const current = "id" in view ? entities.find((e) => e.id === view.id) : undefined;

  function open(e: Entity) {
    if (e.type === "npc") setView({ mode: "card", id: e.id });
    else onOpenOther(e);
  }

  async function remove(id: number) {
    if (!confirm("Delete this NPC? There's no undo.")) return;
    try {
      await api.deleteEntity(id);
      setView({ mode: "none" });
      load();
    } catch (err) {
      fail(err);
    }
  }

  return (
    <div className="world">
      <section>
        <button className="primary" onClick={() => setView({ mode: "new" })} style={{ marginBottom: "0.75rem" }}>
          <Icon name="plus" size={16} />
          New NPC
        </button>
        <div className="list">
          {npcs.length === 0 && <p className="hint">No NPCs yet.</p>}
          {npcs.map((e) => (
            <button
              key={e.id}
              className="item"
              aria-current={"id" in view && view.id === e.id}
              onClick={() => setView({ mode: "card", id: e.id })}
            >
              <span>
                <strong>{e.name}</strong>
                {e.profile?.occupation && <div className="sub">{e.profile.occupation}</div>}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section>
        {error && <p className="error">{error}</p>}
        {view.mode === "new" && (
          <NpcCreator
            entity={null}
            drawSteel={drawSteel}
            onCancel={() => setView({ mode: "none" })}
            onSaved={(saved) => {
              load();
              setView({ mode: "card", id: saved.id });
            }}
          />
        )}
        {view.mode === "edit" && current && (
          <NpcCreator
            key={current.id}
            entity={current}
            drawSteel={drawSteel}
            onCancel={() => setView({ mode: "card", id: current.id })}
            onSaved={(saved) => {
              load();
              setView({ mode: "card", id: saved.id });
            }}
          />
        )}
        {view.mode === "card" && current && (
          <NpcCard
            npc={current}
            entities={entities}
            onEdit={() => setView({ mode: "edit", id: current.id })}
            onDelete={() => remove(current.id)}
            onOpen={open}
            onChanged={() => load()}
            onError={fail}
          />
        )}
        {view.mode === "none" && (
          <div className="panel empty">
            <p className="prose">Pick an NPC, or make a new one: start from a quick idea, roll the dice, or fill in what you know.</p>
          </div>
        )}
      </section>
    </div>
  );
}
