import { beforeEach, expect, test, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { BoardClip, SoundAsset, SoundboardWithClips } from "@bafft/shared";
import { SoundboardSection } from "./SoundboardSection.js";
import { SoundEngine } from "./engine.js";
import { FakeAudio, FakeContext } from "./test-fakes.js";
import { api } from "../api.js";

vi.mock("../api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api.js")>();
  return { ApiError: actual.ApiError, api: Object.fromEntries(Object.keys(actual.api).map((k) => [k, vi.fn()])) };
});
const mocked = vi.mocked(api);

const asset = (id: number, title: string, category: SoundAsset["category"]): SoundAsset => ({
  id, campaignId: 1, title, category, tags: [], source: "upload", sourceId: null, licence: null, attribution: null,
  durationMs: null, audioPath: `sounds/${id}/a.mp3`, createdAt: new Date(0),
});
const clip = (id: number, a: SoundAsset, extra: Partial<BoardClip> = {}): BoardClip => ({
  id, boardId: 1, assetId: a.id, name: a.title, kind: a.category === "sfx" ? "one-shot" : "loop", group: "The Speech",
  volume: 0.8, fadeInMs: 0, colour: null, position: id, createdAt: new Date(0), asset: a, ...extra,
});

const song = asset(1, "The Amber Road", "music");
const jeers = asset(2, "Crowd jeers", "sfx");
const board = (clips: BoardClip[]): SoundboardWithClips => ({ id: 1, campaignId: 1, name: "The Amber Road — Act 1", position: 0, createdAt: new Date(0), clips });

let ctx: FakeContext;
let audios: FakeAudio[];
function engine() {
  return new SoundEngine({
    createContext: () => ctx as unknown as AudioContext,
    createAudio: (url) => {
      const a = new FakeAudio(url);
      audios.push(a);
      return a as unknown as HTMLAudioElement;
    },
    fetcher: (async () => new Response(new Uint8Array([4]))) as typeof fetch,
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  ctx = new FakeContext();
  audios = [];
  mocked.listSoundboards.mockResolvedValue([board([])]);
  mocked.updateClip.mockImplementation(async (id, update) => ({ ...clip(id, song), ...update }));
  mocked.listSounds.mockResolvedValue([]);
  mocked.listEntities.mockResolvedValue([]);
  mocked.saveBoardScenes.mockImplementation(async (_id, scenes) => ({ ...board([]), scenes }));
});

async function showBoard(clips: BoardClip[]) {
  mocked.getSoundboard.mockResolvedValue(board(clips));
  render(<SoundboardSection createEngine={engine} />);
  expect(await screen.findByRole("heading", { name: "The Amber Road — Act 1" })).toBeInTheDocument();
}

test("music streams, sound effects are decoded; buttons show play or loop icons by kind", async () => {
  await showBoard([clip(10, song), clip(11, jeers)]);
  const songButton = await screen.findByRole("button", { name: /^The Amber Road/, pressed: false });
  await vi.waitFor(() => expect(songButton).toBeEnabled());
  expect(audios.map((a) => a.src)).toEqual(["/api/sound-assets/1/audio"]); // only the music streams
  expect(screen.getByRole("heading", { name: "The Speech" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Loop The Amber Road" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "Loop Crowd jeers" })).toHaveAttribute("aria-pressed", "false");
});

test("tap plays, shows it in Now Playing with a progress ring and volume; tap again stops", async () => {
  await showBoard([clip(11, jeers)]);
  const button = await screen.findByRole("button", { name: /^Crowd jeers/, pressed: false });
  await vi.waitFor(() => expect(button).toBeEnabled());

  await userEvent.click(button);
  expect(button).toHaveAttribute("aria-pressed", "true");
  expect(button.querySelector(".progress-ring")).not.toBeNull();
  const strip = screen.getByRole("region", { name: "Now playing" });
  expect(within(strip).getByText("Crowd jeers")).toBeInTheDocument();
  expect(within(strip).getByRole("slider", { name: "Crowd jeers volume" })).toHaveValue("0.8");
  expect(within(strip).getByText("Once")).toBeInTheDocument(); // how it's playing (bafft-c4d.10)

  await userEvent.click(button);
  expect(button).toHaveAttribute("aria-pressed", "false");
  expect(within(strip).getByText(/Nothing playing/)).toBeInTheDocument();
});

test("the ring fills clockwise with the clip's progress", async () => {
  await showBoard([clip(11, jeers)]);
  const button = await screen.findByRole("button", { name: /^Crowd jeers/ });
  await vi.waitFor(() => expect(button).toBeEnabled());
  await userEvent.click(button);
  const fill = () => button.querySelector(".progress-ring .fill")!;
  const circumference = Number(fill().getAttribute("stroke-dasharray"));
  expect(Number(fill().getAttribute("stroke-dashoffset"))).toBeCloseTo(circumference); // empty at the start
  act(() => {
    ctx.currentTime += 3; // 3s into a 4s clip
  });
  await vi.waitFor(() => expect(Number(fill().getAttribute("stroke-dashoffset"))).toBeCloseTo(circumference * 0.25));
});

test("the loop toggle saves the clip and changes a playing one on the spot", async () => {
  await showBoard([clip(11, jeers)]);
  const button = await screen.findByRole("button", { name: /^Crowd jeers/ });
  await vi.waitFor(() => expect(button).toBeEnabled());
  await userEvent.click(button);
  await userEvent.click(screen.getByRole("button", { name: "Loop Crowd jeers" }));
  expect(mocked.updateClip).toHaveBeenCalledWith(11, { kind: "loop" });
  expect(ctx.sources[0]!.loop).toBe(true);
  expect(screen.getByRole("button", { name: "Loop Crowd jeers" })).toHaveAttribute("aria-pressed", "true");
  expect(within(screen.getByRole("region", { name: "Now playing" })).getByText("Looping")).toBeInTheDocument();
});

test("Stop all silences everything", async () => {
  await showBoard([clip(10, song), clip(11, jeers)]);
  for (const name of [/^The Amber Road/, /^Crowd jeers/]) {
    const b = await screen.findByRole("button", { name, pressed: false });
    await vi.waitFor(() => expect(b).toBeEnabled());
    await userEvent.click(b);
  }
  await userEvent.click(screen.getByRole("button", { name: /Stop all/ }));
  expect(screen.queryAllByRole("button", { pressed: true }).filter((b) => b.classList.contains("clip-main"))).toEqual([]);
});

test("edit mode adds a library sound into a scene", async () => {
  await showBoard([clip(10, song)]);
  mocked.listSounds.mockResolvedValue([jeers]);
  mocked.addClip.mockResolvedValue(clip(11, jeers));
  await userEvent.click(screen.getByRole("button", { name: /Edit board/ }));
  const picker = screen.getByRole("region", { name: "Add sounds" });
  await userEvent.selectOptions(within(picker).getByRole("combobox", { name: "Scene to add into" }), "__new__");
  await userEvent.type(within(picker).getByRole("textbox", { name: "New scene name" }), "The Riot");
  await userEvent.click(within(picker).getByRole("button", { name: "Create scene" }));
  mocked.getSoundboard.mockResolvedValue(board([clip(10, song), clip(11, jeers, { group: "The Riot" })]));
  await userEvent.click(await within(picker).findByRole("button", { name: /Add/ }));
  expect(mocked.addClip).toHaveBeenCalledWith(1, { assetId: 2, group: "The Riot" });
  expect(await screen.findByRole("heading", { name: "The Riot" })).toBeInTheDocument();
});

test("with no boards yet, it asks for the first board's name", async () => {
  mocked.listSoundboards.mockResolvedValue([]);
  mocked.createSoundboard.mockResolvedValue(board([]));
  mocked.getSoundboard.mockResolvedValue(board([]));
  render(<SoundboardSection createEngine={engine} />);
  await userEvent.type(await screen.findByPlaceholderText(/Name your first board/), "The Amber Road — Act 1{Enter}");
  expect(mocked.createSoundboard).toHaveBeenCalledWith("The Amber Road — Act 1");
  expect(await screen.findByRole("heading", { name: "The Amber Road — Act 1" })).toBeInTheDocument();
});

const tavern1 = asset(3, "The Britons", "music");
const tavern2 = asset(4, "Celtic Impulse", "music");
const tavern3 = asset(5, "Skye Cuillin", "music");

async function ready(name: RegExp) {
  const b = await screen.findByRole("button", { name, pressed: false });
  await vi.waitFor(() => expect(b).toBeEnabled());
  return b;
}

test("music is one channel: starting a track crossfades out the one playing", async () => {
  await showBoard([clip(20, tavern1, { group: "The Tavern" }), clip(21, tavern2, { group: "The Tavern" })]);
  await userEvent.click(await ready(/^The Britons/));
  await userEvent.click(await ready(/^Celtic Impulse/));
  expect(screen.getByRole("button", { name: /^The Britons/ })).toHaveAttribute("aria-pressed", "false");
  expect(screen.getByRole("button", { name: /^Celtic Impulse/ })).toHaveAttribute("aria-pressed", "true");
  // The outgoing track fades over the crossfade, the incoming one fades in.
  expect(ctx.gains[0]!.gain.events.at(-1)).toEqual(["ramp", 0, 10 + 4]);
  expect(ctx.gains[1]!.gain.events.at(-1)).toEqual(["ramp", 0.8, 10 + 4]);
});

test("sound effects and ambience don't interrupt the music", async () => {
  await showBoard([clip(20, tavern1), clip(11, jeers)]);
  await userEvent.click(await ready(/^The Britons/));
  await userEvent.click(await ready(/^Crowd jeers/));
  expect(screen.getByRole("button", { name: /^The Britons/ })).toHaveAttribute("aria-pressed", "true");
});

test("a scene playlist plays each track once and crossfades into the next near the end", async () => {
  await showBoard([20, 21, 22].map((id, i) => clip(id, [tavern1, tavern2, tavern3][i]!, { group: "The Tavern" })));
  await ready(/^Skye Cuillin/);
  await userEvent.click(screen.getByRole("button", { name: "Play The Tavern music" }));
  expect(audios[0]).toMatchObject({ paused: false, loop: false }); // once through, not looped
  const strip = screen.getByRole("region", { name: "Now playing" });
  expect(within(strip).getByText("The Tavern music · 1 of 3")).toBeInTheDocument();

  // 597s into a 600s track: inside the crossfade window.
  act(() => {
    audios[0]!.currentTime = 597;
  });
  await vi.waitFor(() => expect(within(strip).getByText("The Tavern music · 2 of 3")).toBeInTheDocument());
  expect(screen.getByRole("button", { name: /^Celtic Impulse/ })).toHaveAttribute("aria-pressed", "true");

  await userEvent.click(within(strip).getByRole("button", { name: "Next" }));
  expect(within(strip).getByText("The Tavern music · 3 of 3")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Stop The Tavern music" }));
  await vi.waitFor(() => expect(within(strip).getByText(/Nothing playing/)).toBeInTheDocument());
});

test("a playlist track that ends early moves straight on", async () => {
  await showBoard([clip(20, tavern1, { group: "The Tavern" }), clip(21, tavern2, { group: "The Tavern" })]);
  await ready(/^Celtic Impulse/);
  await userEvent.click(screen.getByRole("button", { name: "Play The Tavern music" }));
  act(() => audios[0]!.fire("ended"));
  await vi.waitFor(() => expect(screen.getByRole("button", { name: /^Celtic Impulse/ })).toHaveAttribute("aria-pressed", "true"));
});


test("scene and track order, location links, and existing track labels survive editing", async () => {
  const clips = [clip(10, song), clip(11, jeers, { group: "The Keep" }), clip(12, jeers)];
  const initial = { ...board(clips), scenes: [{ name: "The Keep", locationId: null }, { name: "The Speech", locationId: null }] };
  mocked.getSoundboard.mockResolvedValue(initial);
  const bell = asset(3, "Bell", "sfx");
  mocked.listSounds.mockResolvedValue([song, bell]);
  mocked.listEntities.mockResolvedValue([{ id: 42, campaignId: 1, type: "location", name: "Tower" } as never]);
  mocked.saveBoardScenes.mockImplementation(async (_id, scenes) => ({ ...initial, scenes }));
  render(<SoundboardSection createEngine={engine} />);
  await screen.findByRole("heading", { name: "The Keep" });
  expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["Now playing", "The Keep", "The Speech"]);
  await userEvent.click(screen.getByRole("button", { name: "Edit board" }));
  // Already on the board: no Add, so it can't go on twice (bafft-c4d.10).
  const picker = screen.getByRole("region", { name: "Add sounds" });
  const onBoard = (await within(picker).findByText("On this board")).closest("li")!;
  expect(within(onBoard).queryByRole("button", { name: /Add/ })).not.toBeInTheDocument();
  // Done editing sits at the top and the bottom of a long board.
  expect(screen.getAllByRole("button", { name: /Done editing/ })).toHaveLength(2);
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Scene to add into" }), "The Keep");
  await userEvent.click(within(picker).getByRole("button", { name: "Add" }));
  expect(mocked.addClip).toHaveBeenCalledWith(1, { assetId: 3, group: "The Keep" });
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "The Keep location" }), "42");
  expect(mocked.saveBoardScenes).toHaveBeenLastCalledWith(1, [{ name: "The Keep", locationId: 42 }, { name: "The Speech", locationId: null }]);
  await userEvent.click(screen.getByRole("button", { name: "Move The Speech up" }));
  expect(mocked.saveBoardScenes).toHaveBeenLastCalledWith(1, [{ name: "The Speech", locationId: null }, { name: "The Keep", locationId: 42 }]);
  const speech = screen.getByRole("heading", { name: "The Speech" }).closest("section")!;
  await userEvent.click(within(speech).getByRole("button", { name: "Move Crowd jeers up" }));
  expect(mocked.reorderClips).toHaveBeenCalledWith(1, [12, 11, 10]);
});

test("the ⋯ menu copies a clip, with its settings, into another scene (bafft-c4d.11)", async () => {
  const clips = [clip(11, jeers, { group: "The Keep", volume: 0.5, kind: "loop" })];
  const initial = { ...board(clips), scenes: [{ name: "The Keep", locationId: null }, { name: "The Speech", locationId: null }] };
  mocked.getSoundboard.mockResolvedValue(initial);
  mocked.addClip.mockResolvedValue({} as never);
  render(<SoundboardSection createEngine={engine} />);
  await screen.findByRole("heading", { name: "The Keep" });

  await userEvent.click(screen.getByRole("button", { name: "More for Crowd jeers" }));
  const menu = screen.getByRole("menu", { name: "Crowd jeers actions" });
  // Only the other places it could go: not the scene it's already in.
  expect(within(menu).getAllByRole("menuitem").map((b) => b.textContent)).toEqual(["The Speech", "Unsorted"]);
  await userEvent.click(within(menu).getByRole("menuitem", { name: "The Speech" }));

  expect(mocked.addClip).toHaveBeenCalledWith(1, { assetId: 2, group: "The Speech", name: "Crowd jeers", kind: "loop", volume: 0.5, fadeInMs: 0 });
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
});
