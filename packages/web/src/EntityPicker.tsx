import { useId, useState } from "react";
import { ENTITY_TYPES, type Entity } from "@bafft/shared";
import { TYPE_LABELS } from "./labels.js";

/** Native keyboard selection, narrowed by name or alias and grouped by type. */
export function EntityPicker({ entities, value, onChange, label = "Related to", allowNew = false }: {
  entities: Entity[];
  value: string;
  onChange: (value: string) => void;
  label?: string;
  allowNew?: boolean;
}) {
  const [query, setQuery] = useState("");
  const id = useId();
  const search = query.trim().toLocaleLowerCase();
  const matches = entities.filter((e) => [e.name, ...e.aliases].some((name) => name.toLocaleLowerCase().includes(search)));
  // Keep the selection visible when a new search hides it.
  const selected = entities.find((e) => String(e.id) === value);
  const options = selected && !matches.includes(selected) ? [...matches, selected] : matches;
  return (
    <div className="entity-picker">
      <input type="search" aria-label={`Search ${label.toLowerCase()}`} aria-controls={id}
        placeholder="Search names…" value={query} onChange={(e) => setQuery(e.target.value)} />
      <select id={id} aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{label === "Inside" ? "Nowhere (top level)" : "Choose a name…"}</option>
        {allowNew && <option value="new">+ something new…</option>}
        {ENTITY_TYPES.map((type) => {
          const group = options.filter((e) => e.type === type).sort((a, b) => a.name.localeCompare(b.name));
          return group.length > 0 && <optgroup key={type} label={TYPE_LABELS[type]}>
            {group.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </optgroup>;
        })}
      </select>
      {search && matches.length === 0 && <small role="status">No matching names.</small>}
    </div>
  );
}
