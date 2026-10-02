// "Add sounds" while editing a board (bafft-c4d.3): search the library and
// put a track on this board, into a scene.
import { useEffect, useState } from "react";
import type { SoundAsset } from "@bafft/shared";
import { api } from "../api.js";
import { ScenePicker } from "./ScenePicker.js";
import { Icon } from "../theme/Icon.js";

export function LibraryPicker({
  boardId,
  groups,
  onCreateScene,
  addedAssetIds = [],
  onAdded,
  onError,
}: {
  boardId: number;
  groups: string[];
  onCreateScene: (name: string) => Promise<boolean>;
  addedAssetIds?: number[];
  onAdded: () => void;
  onError: (err: unknown) => void;
}) {
  const [q, setQ] = useState("");
  const [group, setGroup] = useState("");
  const [results, setResults] = useState<SoundAsset[] | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => api.listSounds({ q }).then(setResults).catch(onError), 200);
    return () => clearTimeout(timer);
  }, [q, onError]);

  async function add(asset: SoundAsset) {
    try {
      await api.addClip(boardId, { assetId: asset.id, group: group.trim() || null });
      onAdded();
    } catch (err) {
      onError(err);
    }
  }

  return (
    <section className="panel library-picker" aria-label="Add sounds">
      <h3>Add sounds from the library</h3>
      <div className="picker-controls">
        <input type="search" placeholder="Search title or tag" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the library" />
        <ScenePicker groups={groups} value={group} onChange={setGroup} onCreate={onCreateScene} label="Scene to add into" />
      </div>
      {results?.length === 0 && <p className="hint">Nothing in the library matches. Upload sounds in the Library tab.</p>}
      <ul className="picker-results">
        {results?.map((asset) => (
          <li key={asset.id}>
            <span className={`category ${asset.category}`}>{asset.category}</span>
            <span className="title">{asset.title}</span>
            {addedAssetIds.includes(asset.id) ? (
              <span className="hint">On this board</span>
            ) : (
              <button onClick={() => add(asset)}>
                <Icon name="plus" /> Add
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
