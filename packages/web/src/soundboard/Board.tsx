// A soundboard (bafft-c4d.3), in the owner's pick of the Muse's mockups
// (docs/design/mockups/soundboard/option3_scenes.png): a Now Playing strip
// with each playing clip's volume and a big Stop all, then the clips grouped
// by scene. One-shots show a play icon, loops a loop icon; each clip has a
// loop toggle; while it plays, a ring fills clockwise to show how far in it is.
//
// Music is one channel (bafft-c4d.7): starting a music track crossfades out
// whatever music was playing, and a scene with several music tracks can play
// them as a playlist that crossfades from one to the next.
import { useEffect, useMemo, useRef, useState } from "react";
import type { BoardScene, Entity, BoardClip, SoundboardWithClips } from "@bafft/shared";
import { api } from "../api.js";
import { Icon } from "../theme/Icon.js";
import type { SoundEngine } from "./engine.js";
import { ScenePicker } from "./ScenePicker.js";
import { LibraryPicker } from "./LibraryPicker.js";
import { ProgressRing } from "./ProgressRing.js";
import { useBoardEngine } from "./useBoardEngine.js";
import { YouTubeMark } from "./Library.js";

const UNGROUPED = "Unsorted";
export const CROSSFADE_S = 4;

const isMusic = (clip: BoardClip) => clip.asset.category === "music";

interface Playlist {
  scene: string;
  ids: number[];
  index: number;
}

export function Board({
  board,
  onChange,
  onError,
  createEngine,
}: {
  board: SoundboardWithClips;
  onChange: (board: SoundboardWithClips) => void;
  onError: (err: unknown) => void;
  createEngine?: () => SoundEngine;
}) {
  const { engine, failed } = useBoardEngine(board.clips, createEngine);
  const [editing, setEditing] = useState(false);
  const [locations, setLocations] = useState<Entity[]>([]);
  useEffect(() => {
    void api.listEntities().then((rows) => setLocations(rows.filter((e) => e.type === "location" && e.campaignId === board.campaignId))).catch(onError);
  }, [board.campaignId, onError]);
  const [playlist, setPlaylist] = useState<Playlist | null>(null);

  const groups = useMemo(() => {
    const byGroup = new Map<string, BoardClip[]>();
    for (const scene of board.scenes ?? []) byGroup.set(scene.name, []);
    for (const clip of board.clips) {
      const key = clip.group ?? UNGROUPED;
      byGroup.set(key, [...(byGroup.get(key) ?? []), clip]);
    }
    return [...byGroup].sort(([a], [b]) => a === UNGROUPED ? 1 : b === UNGROUPED ? -1 : 0);
  }, [board.clips, board.scenes]);

  const scenes: BoardScene[] = groups.filter(([name]) => name !== UNGROUPED).map(([name]) =>
    board.scenes?.find((scene) => scene.name === name) ?? { name, locationId: null });

  async function saveScenes(next: BoardScene[]) {
    try { onChange(await api.saveBoardScenes(board.id, next)); return true; }
    catch (err) { onError(err); return false; }
  }
  async function createScene(name: string) {
    return saveScenes([...scenes, { name, locationId: null }]);
  }
  function moveScene(name: string, direction: number) {
    const next = [...scenes];
    const index = next.findIndex((s) => s.name === name);
    [next[index], next[index + direction]] = [next[index + direction]!, next[index]!];
    void saveScenes(next);
  }
  async function moveClip(clip: BoardClip, siblings: BoardClip[], direction: number) {
    const ordered = [...board.clips];
    const index = ordered.findIndex((c) => c.id === clip.id);
    const sibling = siblings[siblings.findIndex((c) => c.id === clip.id) + direction]!;
    const target = ordered.findIndex((c) => c.id === sibling.id);
    [ordered[index], ordered[target]] = [ordered[target]!, ordered[index]!];
    try {
      await api.reorderClips(board.id, ordered.map((c) => c.id));
      onChange({ ...board, clips: ordered.map((c, position) => ({ ...c, position })) });
    } catch (err) { onError(err); }
  }

  const clipById = new Map(board.clips.map((c) => [c.id, c]));
  const nowPlaying = engine.playing().flatMap((id) => clipById.get(id) ?? []);

  /** Starts a music track, crossfading out any other music that's playing. */
  function startMusic(clip: BoardClip, once = false) {
    const outgoing = engine.playing().filter((id) => id !== clip.id && clipById.get(id) && isMusic(clipById.get(id)!));
    for (const id of outgoing) engine.fadeOut(id, CROSSFADE_S);
    engine.play({
      id: clip.id,
      // A playlist plays each track through once, then moves on.
      kind: once ? "one-shot" : clip.kind,
      volume: clip.volume,
      fadeInMs: outgoing.length > 0 ? Math.max(clip.fadeInMs, CROSSFADE_S * 1000) : clip.fadeInMs,
    });
  }

  function tap(clip: BoardClip) {
    void engine.unlock();
    if (engine.isPlaying(clip.id)) {
      engine.stop(clip.id);
      if (playlist && playlist.ids[playlist.index] === clip.id) setPlaylist(null);
    } else if (isMusic(clip)) {
      setPlaylist(null); // picking a track by hand takes over from the playlist
      startMusic(clip);
    } else {
      engine.play({ id: clip.id, kind: clip.kind, volume: clip.volume, fadeInMs: clip.fadeInMs });
    }
  }

  function playScene(scene: string, clips: BoardClip[]) {
    void engine.unlock();
    const ids = clips.filter(isMusic).map((c) => c.id);
    setPlaylist({ scene, ids, index: 0 });
    startMusic(clipById.get(ids[0]!)!, true);
  }

  function advance(from: Playlist) {
    const index = (from.index + 1) % from.ids.length;
    const next = clipById.get(from.ids[index]!);
    if (!next) return setPlaylist(null);
    setPlaylist({ ...from, index });
    startMusic(next, true);
  }

  function stopPlaylist() {
    if (playlist) engine.fadeOut(playlist.ids[playlist.index]!, CROSSFADE_S);
    setPlaylist(null);
  }

  // Move on a crossfade's length before the current track ends, so they
  // overlap; a track shorter than that just plays out (see onEnded below).
  const playlistTrack = playlist ? playlist.ids[playlist.index]! : null;
  const at = playlistTrack !== null ? engine.position(playlistTrack) : null;
  const dueToCrossfade = at !== null && at.duration > 0 && at.at >= CROSSFADE_S && at.duration - at.at <= CROSSFADE_S;
  useEffect(() => {
    if (playlist && dueToCrossfade) advance(playlist);
  });
  // ...or when it ends, if it was short or its length was never known.
  const latest = useRef({ playlist, advance });
  latest.current = { playlist, advance };
  useEffect(
    () =>
      engine.onEnded((id) => {
        const { playlist: current, advance: next } = latest.current;
        if (current && current.ids[current.index] === id) next(current);
      }),
    [engine],
  );

  async function patch(clip: BoardClip, update: Parameters<typeof api.updateClip>[1]) {
    // Optimistic: at the table the button must respond now, not after a round trip.
    onChange({ ...board, clips: board.clips.map((c) => (c.id === clip.id ? { ...c, ...update } : c)) });
    try {
      await api.updateClip(clip.id, update);
    } catch (err) {
      onError(err);
    }
  }

  function toggleLoop(clip: BoardClip) {
    const kind = clip.kind === "loop" ? "one-shot" : "loop";
    engine.setLoop(clip.id, kind === "loop");
    void patch(clip, { kind });
  }

  // Volume is live; the board remembers it once the slider stops moving.
  const saveVolume = useDebounced((clip: BoardClip, volume: number) => void patch(clip, { volume }), 500);

  async function remove(clip: BoardClip) {
    engine.stop(clip.id);
    try {
      await api.removeClip(clip.id);
      onChange({ ...board, clips: board.clips.filter((c) => c.id !== clip.id) });
    } catch (err) {
      onError(err);
    }
  }

  /** A second copy of a clip, settings and all, in another scene (bafft-c4d.11). */
  async function copyTo(clip: BoardClip, group: string | null) {
    try {
      await api.addClip(board.id, { assetId: clip.assetId, group, name: clip.name, kind: clip.kind, volume: clip.volume, fadeInMs: clip.fadeInMs });
      onChange(await api.getSoundboard(board.id));
    } catch (err) {
      onError(err);
    }
  }

  async function added() {
    try {
      onChange(await api.getSoundboard(board.id));
    } catch (err) {
      onError(err);
    }
  }

  const editToggle = (
    <button className={editing ? "primary" : ""} aria-pressed={editing} onClick={() => setEditing((e) => !e)}>
      <Icon name="quill" /> {editing ? "Done editing" : "Edit board"}
    </button>
  );

  return (
    <div className={`board${editing ? " editing" : ""}`}>
      <section className="now-playing" aria-label="Now playing">
        <h3>Now playing</h3>
        <div className="now-playing-row">
          {nowPlaying.length === 0 && <p className="hint">Nothing playing. Tap a sound below.</p>}
          {nowPlaying.map((clip) => (
            <div key={clip.id} className={`playing-card ${clip.kind}`}>
              <div className="playing-title">
                <ProgressRing fraction={engine.progress(clip.id) ?? 0} size={30} />
                {clip.asset.source === "youtube" && <YouTubeMark />}
                <span>{clip.name}</span>
              </div>
              {playlistTrack !== clip.id && (
                <div className="play-mode">
                  {clip.kind === "loop" ? <><Icon name="loop" size={14} /> Looping</> : <><Icon name="play" size={14} /> Once</>}
                </div>
              )}
              <label className="volume">
                <Icon name="speaker" size={16} />
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  aria-label={`${clip.name} volume`}
                  value={engine.volume(clip.id, clip.volume)}
                  onChange={(e) => {
                    engine.setVolume(clip.id, Number(e.target.value));
                    saveVolume(clip, Number(e.target.value));
                  }}
                />
              </label>
              <button className="ghost icon" aria-label={`Stop ${clip.name}`} onClick={() => engine.stop(clip.id)}>
                <Icon name="stop" />
              </button>
              {playlist && playlistTrack === clip.id && (
                <div className="playlist-line">
                  <span>
                    {playlist.scene} music · {playlist.index + 1} of {playlist.ids.length}
                  </span>
                  <button className="ghost" onClick={() => advance(playlist)}>
                    Next
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
        <button
          className="stop-all"
          onClick={() => {
            setPlaylist(null);
            engine.stopAll();
          }}
          disabled={nowPlaying.length === 0}
        >
          <Icon name="stop" size={22} />
          Stop all
        </button>
      </section>

      <div className="board-tools">{editToggle}</div>

      {board.clips.length === 0 && !editing && (
        <p className="hint">This board is empty. Use “Edit board” to add sounds from your library.</p>
      )}

      <div className="scene-groups">
        {groups.map(([group, clips]) => (
          <section key={group} className="scene">
            <h3>{group}</h3>
            {locations.find((e) => e.id === scenes.find((s) => s.name === group)?.locationId) &&
              <p className="hint">Location: {locations.find((e) => e.id === scenes.find((s) => s.name === group)?.locationId)?.name}</p>}
            {editing && group !== UNGROUPED && <div className="picker-controls">
              <button aria-label={`Move ${group} up`} disabled={scenes[0]?.name === group} onClick={() => moveScene(group, -1)}>↑</button>
              <button aria-label={`Move ${group} down`} disabled={scenes.at(-1)?.name === group} onClick={() => moveScene(group, 1)}>↓</button>
              <label>Location
                <select aria-label={`${group} location`} value={scenes.find((s) => s.name === group)?.locationId ?? ""}
                  onChange={(e) => void saveScenes(scenes.map((s) => s.name === group ? { ...s, locationId: e.target.value ? Number(e.target.value) : null } : s))}>
                  <option value="">No location</option>
                  {locations.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              </label>
            </div>}
            {clips.filter(isMusic).length > 1 &&
              (playlist?.scene === group ? (
                <button className="scene-music" onClick={stopPlaylist}>
                  <Icon name="stop" size={14} /> Stop {group} music
                </button>
              ) : (
                <button className="scene-music" onClick={() => playScene(group, clips)}>
                  <Icon name="note" size={14} /> Play {group} music
                </button>
              ))}
            <div className="clip-grid">
              {clips.map((clip) => {
                const playing = engine.isPlaying(clip.id);
                const loaded = engine.isLoaded(clip.id);
                return (
                  <div key={clip.id} className={`clip ${clip.kind}${playing ? " playing" : ""}`}>
                    {/* Play and loop side by side, then the name (also a tap target). */}
                    <button
                      className="clip-main"
                      onClick={() => tap(clip)}
                      disabled={!loaded}
                      aria-pressed={playing}
                      aria-label={clip.name}
                      title={failed.has(clip.id) ? "Couldn't load this sound" : playing ? "Stop" : "Play"}
                    >
                      <span className="clip-icon">
                        {playing ? (
                          <>
                            <ProgressRing fraction={engine.progress(clip.id) ?? 0} />
                            <Icon name="stop" size={14} />
                          </>
                        ) : (
                          <Icon name="play" size={18} />
                        )}
                      </span>
                    </button>
                    <button
                      className="loop-toggle"
                      aria-pressed={clip.kind === "loop"}
                      aria-label={`Loop ${clip.name}`}
                      title={clip.kind === "loop" ? "Looping: tap to play once" : "Plays once: tap to loop"}
                      onClick={() => toggleLoop(clip)}
                    >
                      <Icon name="loop" size={16} />
                    </button>
                    <span className="clip-name" onClick={() => loaded && tap(clip)} aria-hidden>
                      {clip.asset.source === "youtube" && <YouTubeMark />}
                      {clip.name}
                    </span>
                    {clip.fadeInMs > 0 && (
                      <span className="clip-fade" title={`Fades in over ${clip.fadeInMs / 1000}s`}>
                        <Icon name="fade" size={12} />
                      </span>
                    )}
                    {!loaded && <span className="hint clip-status">{failed.has(clip.id) ? "failed" : "loading…"}</span>}
                    <ClipMenu
                      clip={clip}
                      scenes={[...scenes.map((s) => s.name), ...(clip.group ? [UNGROUPED] : [])].filter((s) => s !== clip.group)}
                      onCopy={(scene) => void copyTo(clip, scene === UNGROUPED ? null : scene)}
                    />
                    {editing && <>
                      <div className="picker-controls">
                        <button aria-label={`Move ${clip.name} up`} disabled={clips[0]?.id === clip.id} onClick={() => void moveClip(clip, clips, -1)}>↑</button>
                        <button aria-label={`Move ${clip.name} down`} disabled={clips.at(-1)?.id === clip.id} onClick={() => void moveClip(clip, clips, 1)}>↓</button>
                      </div>
                      <ClipSettings clip={clip} groups={scenes.map((s) => s.name)} onCreateScene={createScene} onPatch={patch} onRemove={remove} />
                    </>}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      {editing && <LibraryPicker boardId={board.id} groups={scenes.map((s) => s.name)} addedAssetIds={board.clips.map((c) => c.assetId)} onCreateScene={createScene} onAdded={added} onError={onError} />}
      {/* A long board: Done is at the bottom too, where the editing ends. */}
      {editing && <div className="board-tools">{editToggle}</div>}
    </div>
  );
}

/** The ⋯ on a tile: per-clip actions that don't need a button of their own. */
function ClipMenu({ clip, scenes, onCopy }: { clip: BoardClip; scenes: string[]; onCopy: (scene: string) => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  return (
    <div className="clip-menu" ref={box}>
      <button className="clip-more" aria-label={`More for ${clip.name}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        ⋯
      </button>
      {open && (
        <div className="clip-menu-list" role="menu" aria-label={`${clip.name} actions`}>
          <div className="clip-menu-heading">Copy to</div>
          {scenes.length === 0 && <p className="hint">No other scenes yet. Make one under Edit board.</p>}
          {scenes.map((scene) => (
            <button key={scene} role="menuitem" onClick={() => { setOpen(false); onCopy(scene); }}>
              {scene}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ClipSettings({
  clip,
  groups,
  onCreateScene,
  onPatch,
  onRemove,
}: {
  clip: BoardClip;
  groups: string[];
  onCreateScene: (name: string) => Promise<boolean>;
  onPatch: (clip: BoardClip, update: Parameters<typeof api.updateClip>[1]) => void;
  onRemove: (clip: BoardClip) => void;
}) {
  return (
    <div className="clip-settings">
      <label>
        Name
        <input defaultValue={clip.name} onBlur={(e) => e.target.value.trim() && e.target.value !== clip.name && onPatch(clip, { name: e.target.value.trim() })} />
      </label>
      <ScenePicker groups={groups} value={clip.group ?? ""} label={`${clip.name} scene`} onCreate={onCreateScene}
        onChange={(group) => onPatch(clip, { group: group || null })} />
      <label>
        Fade in (s)
        <input
          type="number"
          min={0}
          max={60}
          step={0.5}
          defaultValue={clip.fadeInMs / 1000}
          onBlur={(e) => {
            const fadeInMs = Math.round(Math.min(60, Math.max(0, Number(e.target.value) || 0)) * 1000);
            if (fadeInMs !== clip.fadeInMs) onPatch(clip, { fadeInMs });
          }}
        />
      </label>
      <button className="ghost" onClick={() => onRemove(clip)}>
        <Icon name="trash" /> Remove
      </button>
    </div>
  );
}

function useDebounced<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  const [state] = useState(() => ({ timer: undefined as ReturnType<typeof setTimeout> | undefined, fn }));
  state.fn = fn;
  return (...args: A) => {
    clearTimeout(state.timer);
    state.timer = setTimeout(() => state.fn(...args), ms);
  };
}
