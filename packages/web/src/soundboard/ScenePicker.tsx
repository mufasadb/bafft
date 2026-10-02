import { useState } from "react";

export function ScenePicker({ groups, value, onChange, onCreate, label }: {
  groups: string[];
  value: string;
  onChange: (value: string) => void;
  onCreate: (name: string) => Promise<boolean>;
  label: string;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  return <div>
    <label>{label}
      <select aria-label={label} value={creating ? "__new__" : value} onChange={(e) => {
        setCreating(e.target.value === "__new__");
        if (e.target.value !== "__new__") onChange(e.target.value);
      }}>
        <option value="">Unsorted</option>
        {groups.map((group) => <option key={group} value={group}>{group}</option>)}
        <option value="__new__">Create new scene…</option>
      </select>
    </label>
    {creating && <div className="picker-controls">
      <input aria-label="New scene name" value={name} onChange={(e) => setName(e.target.value)} />
      <button disabled={!name.trim() || saving} onClick={async () => {
        const existing = groups.find((g) => g.toLocaleLowerCase() === name.trim().toLocaleLowerCase());
        const selected = existing ?? name.trim();
        setSaving(true);
        try {
          if (existing || await onCreate(selected)) { onChange(selected); setCreating(false); setName(""); }
        } finally { setSaving(false); }
      }}>Create scene</button>
      <button onClick={() => setCreating(false)}>Cancel</button>
    </div>}
  </div>;
}
