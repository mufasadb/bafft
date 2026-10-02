import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App.js";
import { api } from "./api.js";

vi.mock("./api.js", () => ({ api: { getCampaign: vi.fn(), saveCampaign: vi.fn() } }));
vi.mock("./npc/NpcSection.js", () => ({ NpcSection: () => <p>NPC content</p> }));
vi.mock("./Glossary.js", () => ({ Glossary: () => <p>World content</p> }));
vi.mock("./GlossaryScreen.js", () => ({ GlossaryScreen: () => null }));
vi.mock("./SessionUpload.js", () => ({ SessionUpload: () => null }));
vi.mock("./labelling/SessionReview.js", () => ({ SessionReview: () => null }));
vi.mock("./soundboard/SoundboardSection.js", () => ({ SoundboardSection: () => null }));

beforeEach(() => {
  vi.mocked(api.getCampaign).mockResolvedValue({ id: 1, name: "My campaign", gameSystem: "other", styleAnchor: null, settingNotes: null, createdAt: new Date(0), updatedAt: new Date(0) });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ json: async () => ({ status: "ok", service: "bafft", time: "now" }) }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

test("campaign navigation preserves edits on cancel and discards only on confirmation", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  const user = userEvent.setup();
  render(<App />);
  await screen.findByText("NPC content");
  await user.click(screen.getByRole("button", { name: "Campaign" }));
  await user.type(await screen.findByLabelText("Setting notes"), "Unfinished world");
  await user.click(screen.getByRole("button", { name: "Campaign" }));
  expect(confirm).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Locations" }));
  expect(confirm).toHaveBeenCalledWith("Leave campaign settings and discard unsaved changes?");
  expect(screen.getByLabelText("Setting notes")).toHaveValue("Unfinished world");
  confirm.mockReturnValue(true);
  await user.click(screen.getByRole("button", { name: "Locations" }));
  expect(await screen.findByText("World content")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Campaign" }));
  expect(await screen.findByLabelText("Setting notes")).toHaveValue("");
  confirm.mockClear();
  await user.click(screen.getByRole("button", { name: "NPCs" }));
  expect(confirm).not.toHaveBeenCalled();
});
