import { beforeEach, expect, test, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CatalogueTrack } from "@bafft/shared";
import { Catalogue } from "./Catalogue.js";
import { api } from "../api.js";

vi.mock("../api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api.js")>();
  return { ApiError: actual.ApiError, api: Object.fromEntries(Object.keys(actual.api).map((k) => [k, vi.fn()])) };
});
const mocked = vi.mocked(api);

const track = (extra: Partial<CatalogueTrack> = {}): CatalogueTrack => ({
  source: "tabletop-audio", sourceId: "500", title: "Village Festival", description: "The whole town is out celebrating",
  category: "ambience", tags: ["fantasy", "festival"], durationMs: null, previewUrl: "https://sounds.tabletopaudio.com/500_Village_Festival.mp3",
  imageUrl: null, licence: "CC BY-NC-ND 4.0", attribution: "…", keptAssetId: null, ...extra,
});

const search = (tracks: CatalogueTrack[], unavailable: { source: CatalogueTrack["source"]; error: string }[] = []) => ({ tracks, unavailable });

beforeEach(() => {
  vi.resetAllMocks();
  mocked.importStatus.mockResolvedValue({ enabled: false, root: null, packs: [], scannedAt: null });
});

test("one search covers every source, previews from the source, and adds a track (bafft-c4d.10)", async () => {
  mocked.searchCatalogue.mockResolvedValue(search([track(), track({ source: "folder", sourceId: "Nakarada/Night.ogg", title: "Night Song", category: "music", licence: "", previewUrl: "/api/catalogue/folder/audio?path=x" }), track({ source: "freesound", sourceId: "77931", title: "Rockslide", category: "sfx", licence: "CC BY 4.0" })]));
  mocked.keepTrack.mockResolvedValue({ id: 42 } as never);
  const toggle = vi.fn();
  const onKept = vi.fn();
  render(<Catalogue preview={{ playing: null, toggle }} onKept={onKept} onError={() => {}} />);

  await userEvent.type(screen.getByRole("searchbox", { name: "Search for more sounds" }), "festival");
  const row = (await screen.findByText("Village Festival")).closest("li")!;
  expect(mocked.searchCatalogue).toHaveBeenLastCalledWith({ q: "festival", category: undefined });
  expect(within(row).getByText("Tabletop Audio")).toBeInTheDocument();
  expect(within(row).getByText("CC BY-NC-ND 4.0")).toBeInTheDocument();
  expect(within(screen.getByText("Night Song").closest("li")!).getByText("Your folder")).toBeInTheDocument();
  expect(within(screen.getByText("Rockslide").closest("li")!).getByText("Freesound")).toBeInTheDocument();

  await userEvent.click(within(row).getByRole("button", { name: "Preview Village Festival" }));
  expect(toggle).toHaveBeenCalledWith("tabletop-audio:500", "https://sounds.tabletopaudio.com/500_Village_Festival.mp3");

  await userEvent.click(within(row).getByRole("button", { name: "Add to library" }));
  expect(mocked.keepTrack).toHaveBeenCalledWith("tabletop-audio", "500");
  expect(await within(row).findByText("In library")).toBeInTheDocument();
  expect(onKept).toHaveBeenCalled();
});

test("the kind filter narrows the search, lengths show, and an unreachable source says so", async () => {
  mocked.searchCatalogue.mockResolvedValue(search(
    [track({ source: "incompetech", sourceId: "The Britons.mp3", title: "The Britons", category: "music", durationMs: 307_000, licence: "CC BY 4.0" })],
    [{ source: "tabletop-audio", error: "HTTP 503" }],
  ));
  render(<Catalogue preview={{ playing: null, toggle: vi.fn() }} onKept={() => {}} onError={() => {}} />);
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Kind" }), "sfx");
  await vi.waitFor(() => expect(mocked.searchCatalogue).toHaveBeenLastCalledWith({ q: "", category: "sfx" }));
  expect(await screen.findByText(/5:07/)).toBeInTheDocument();
  expect(screen.getByText(/Couldn't reach Tabletop Audio just now: HTTP 503/)).toBeInTheDocument();
});

test("your folder is one folded line with its last scan, and a rescan searches again", async () => {
  mocked.importStatus.mockResolvedValue({ enabled: true, root: "/import", packs: [{ pack: "Nakarada", files: 700 }, { pack: "Matyas", files: 14 }], scannedAt: "2026-09-30T11:00:00.000Z" });
  mocked.scanSoundImport.mockResolvedValue({ files: 715, scannedAt: "2026-10-01T11:00:00.000Z", updated: 0, removed: 0, missing: 0 });
  mocked.searchCatalogue.mockResolvedValue(search([]));
  const user = userEvent.setup();
  render(<Catalogue preview={{ playing: null, toggle: vi.fn() }} onKept={() => {}} onError={() => {}} />);

  const folder = (await screen.findByText(/714 files · last scanned/)).closest("details")!;
  expect(folder).not.toHaveAttribute("open");
  await user.click(within(folder).getByText("Your folder"));
  await vi.waitFor(() => expect(mocked.searchCatalogue).toHaveBeenCalledTimes(1));
  await user.click(within(folder).getByRole("button", { name: "Rescan folder" }));
  expect(await within(folder).findByText(/Found 715 files/)).toBeInTheDocument();
  await vi.waitFor(() => expect(mocked.searchCatalogue).toHaveBeenCalledTimes(2));
});

test("YouTube: search, preview in YouTube's player, add as music; or paste a link (bafft-w8f.17)", async () => {
  mocked.searchCatalogue.mockResolvedValue(search([]));
  mocked.searchYouTube.mockResolvedValue([
    { kind: "playlist", id: "PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG", title: "Epic Battle Music", channel: "Mix", thumbnailUrl: null, keptAssetId: null },
  ]);
  mocked.addYouTube.mockResolvedValue({ id: 77 } as never);
  const toggle = vi.fn();
  const onKept = vi.fn();
  const user = userEvent.setup();
  render(<Catalogue preview={{ playing: null, toggle }} onKept={onKept} onError={() => {}} />);

  await user.click(screen.getByText("YouTube", { selector: "summary" }));
  await user.type(screen.getByRole("searchbox", { name: "Search YouTube" }), "battle");
  const row = (await screen.findByText("Epic Battle Music", {}, { timeout: 2000 })).closest("li")!;
  expect(within(row).getByText("playlist")).toBeInTheDocument();

  await user.click(within(row).getByRole("button", { name: "Preview Epic Battle Music" }));
  expect(toggle).toHaveBeenCalledWith("youtube:playlist:PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG", "youtube:playlist:PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG");

  await user.click(within(row).getByRole("button", { name: "Add to library" }));
  expect(mocked.addYouTube).toHaveBeenCalledWith({
    url: "https://www.youtube.com/playlist?list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG",
    title: "Epic Battle Music",
    category: "music",
  });
  expect(await within(row).findByText("In library")).toBeInTheDocument();

  await user.selectOptions(screen.getByLabelText("Add as"), "ambience");
  await user.type(screen.getByLabelText("YouTube link"), "https://youtu.be/abcdefghijk");
  await user.type(screen.getByLabelText("Name"), "Mine ambience");
  await user.type(screen.getByLabelText("Tags"), "Mines, Dark");
  await user.click(screen.getByRole("button", { name: "Add link" }));
  expect(mocked.addYouTube).toHaveBeenLastCalledWith({ url: "https://youtu.be/abcdefghijk", title: "Mine ambience", category: "ambience", tags: ["mines", "dark"] });
  expect(onKept).toHaveBeenCalledTimes(2);
});

test("YouTube search that's switched off shows how to switch it on", async () => {
  mocked.searchCatalogue.mockResolvedValue(search([]));
  mocked.searchYouTube.mockRejectedValue(new Error("YouTube search is switched off for this Google key. Enable the YouTube Data API v3 here: https://x"));
  const user = userEvent.setup();
  render(<Catalogue preview={{ playing: null, toggle: vi.fn() }} onKept={vi.fn()} onError={() => {}} />);
  await user.click(screen.getByText("YouTube", { selector: "summary" }));
  await user.type(screen.getByRole("searchbox", { name: "Search YouTube" }), "battle");
  expect(await screen.findByText(/Enable the YouTube Data API v3/, {}, { timeout: 2000 })).toBeInTheDocument();
});
