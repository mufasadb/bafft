import { useEffect, useState } from "react";
import type { Entity } from "@bafft/shared";
import { api } from "./api.js";
import { EntityPicker } from "./EntityPicker.js";

/** Form state: parent changes are saved only when the location itself is saved. */
export function useLocationInside(entityId: number | null, onError: (err: unknown) => void) {
  const [parentId, setParentId] = useState("");
  const [loadedId, setLoadedId] = useState<number | null>(null);
  const [original, setOriginal] = useState("");
  useEffect(() => {
    let cancelled = false;
    setParentId("");
    setOriginal("");
    setLoadedId(null);
    if (entityId !== null) {
      api.listRelationships(entityId).then((rows) => {
        if (cancelled) return;
        const parent = rows.find((r) => r.isContainment && r.fromEntityId === entityId);
        const value = parent ? String(parent.toEntityId) : "";
        setParentId(value);
        setOriginal(value);
        setLoadedId(entityId);
      }).catch((err) => { if (!cancelled) onError(err); });
    }
    return () => { cancelled = true; };
  }, [entityId]);
  const ready = entityId === null || loadedId === entityId;
  return {
    parentId, setParentId, ready,
    reset() { setParentId(""); setOriginal(""); },
    async save(savedId: number) {
      if (!ready) throw new Error("The location's Inside field has not loaded. Please retry.");
      if (parentId !== original) await api.setLocationInside(savedId, parentId ? Number(parentId) : null);
    },
  };
}

export function LocationInside({ entities, entityId, value, onChange, disabled = false }: {
  entities: Entity[]; entityId: number | null; value: string; onChange: (value: string) => void; disabled?: boolean;
}) {
  return <fieldset disabled={disabled}>
    <legend>Inside</legend>
    <EntityPicker entities={entities.filter((e) => e.type === "location" && e.id !== entityId)}
      value={value} onChange={onChange} label="Inside" />
    <small>The containing location. Leave empty for a top-level location.</small>
  </fieldset>;
}
