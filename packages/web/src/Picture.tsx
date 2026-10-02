import { useState } from "react";
import type { Entity } from "@bafft/shared";
import { api } from "./api.js";
import { Icon } from "./theme/Icon.js";

// "Picture this" (bafft-yh2.2): generate a preview, then Keep it or Discard.
// Nothing is saved until Keep it. Shared by the NPC card and the glossary.
export function Picture({
  entity,
  onSaved,
  onError,
  framed = false,
}: {
  entity: Entity;
  onSaved: (updated: Entity) => void;
  onError: (err: unknown) => void;
  framed?: boolean;
}) {
  const [preview, setPreview] = useState<{ tempId: string; dataUrl: string } | null>(null);
  const [generating, setGenerating] = useState(false);

  async function generate() {
    setGenerating(true);
    try {
      setPreview(await api.generatePicture(entity.id));
    } catch (err) {
      onError(err);
    } finally {
      setGenerating(false);
    }
  }

  async function keep() {
    if (!preview) return;
    try {
      onSaved(await api.acceptPicture(entity.id, preview.tempId));
      setPreview(null);
    } catch (err) {
      onError(err);
    }
  }

  const saved = entity.imagePath ? `/data/${entity.imagePath}?v=${entity.updatedAt.getTime()}` : null;

  return (
    <div className="picture">
      <div className={framed ? "portrait framed" : "portrait"}>
        {preview ? (
          <img src={preview.dataUrl} alt="generated preview" />
        ) : saved ? (
          <img src={saved} alt={`${entity.name} portrait`} />
        ) : (
          <div className="portrait-empty">
            <Icon name="camera" size={36} />
          </div>
        )}
      </div>
      <div className="row picture-actions">
        {preview ? (
          <>
            <button className="accent" onClick={keep}>
              Keep it
            </button>
            <button onClick={() => setPreview(null)}>Discard</button>
          </>
        ) : (
          <button onClick={generate} disabled={generating}>
            <Icon name="camera" />
            {generating ? "Painting…" : "Picture this"}
          </button>
        )}
      </div>
    </div>
  );
}
