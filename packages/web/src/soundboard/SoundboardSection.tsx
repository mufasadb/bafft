// Soundboard section (bafft-c4d): the table-side board and the sound library
// behind it. Boards belong to the campaign; pick one, or start a new one.
import { useCallback, useEffect, useState } from "react";
import type { Soundboard, SoundboardWithClips } from "@bafft/shared";
import { api } from "../api.js";
import { Icon } from "../theme/Icon.js";
import { Board } from "./Board.js";
import type { SoundEngine } from "./engine.js";
import { Library } from "./Library.js";

export function SoundboardSection({ createEngine }: { createEngine?: () => SoundEngine }) {
  const [tab, setTab] = useState<"board" | "library">("board");
  const [boards, setBoards] = useState<Soundboard[] | null>(null);
  const [current, setCurrent] = useState<SoundboardWithClips | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");

  const onError = useCallback((err: unknown) => setError(err instanceof Error ? err.message : String(err)), []);

  const open = useCallback(
    (id: number) => {
      setError(null);
      api.getSoundboard(id).then(setCurrent).catch(onError);
    },
    [onError],
  );

  useEffect(() => {
    api
      .listSoundboards()
      .then((list) => {
        setBoards(list);
        if (list[0]) open(list[0].id);
      })
      .catch(onError);
  }, [open, onError]);

  async function create() {
    const name = newName.trim();
    if (!name) return;
    try {
      const board = await api.createSoundboard(name);
      setBoards((b) => [...(b ?? []), board]);
      setNewName("");
      open(board.id);
      setTab("board");
    } catch (err) {
      onError(err);
    }
  }

  return (
    <section className="soundboard">
      <header className="soundboard-head">
        <h2>{tab === "board" && current ? current.name : "Soundboard"}</h2>
        <div className="soundboard-tabs" role="tablist">
          <button
            role="tab"
            aria-selected={tab === "board"}
            onClick={() => {
              setTab("board");
              // Pick up anything added from the Library tab; the board (and what's playing) stays.
              if (current) api.getSoundboard(current.id).then(setCurrent).catch(onError);
            }}
          >
            <Icon name="speaker" /> Board
          </button>
          <button role="tab" aria-selected={tab === "library"} onClick={() => setTab("library")}>
            <Icon name="note" /> Library
          </button>
        </div>
      </header>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {/* Stays mounted behind the Library tab: switching tabs mustn't stop the music. */}
      {boards && (
        <div hidden={tab !== "board"}>
          <div className="board-picker">
            {boards.length > 1 && (
              <select value={current?.id ?? ""} onChange={(e) => open(Number(e.target.value))} aria-label="Board">
                {boards.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            )}
            <input
              placeholder={boards.length === 0 ? "Name your first board, e.g. The Amber Road — Act 1" : "New board name"}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void create()}
              aria-label="New board name"
            />
            <button onClick={create} disabled={!newName.trim()}>
              <Icon name="plus" /> New board
            </button>
          </div>
          {current && <Board key={current.id} board={current} onChange={setCurrent} onError={onError} createEngine={createEngine} />}
        </div>
      )}
      {tab === "library" && <Library onError={onError} />}
    </section>
  );
}
