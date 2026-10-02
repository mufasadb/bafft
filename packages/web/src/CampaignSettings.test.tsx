import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Campaign } from "@bafft/shared";
import { CampaignSettings } from "./CampaignSettings.js";
import { api } from "./api.js";

vi.mock("./api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api.js")>();
  return {
    ApiError: actual.ApiError,
    api: Object.fromEntries(Object.keys(actual.api).map((k) => [k, vi.fn()])),
  };
});

const mocked = vi.mocked(api);

const campaign: Campaign = {
  id: 1,
  name: "My campaign",
  gameSystem: "other",
  styleAnchor: null,
  settingNotes: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

beforeEach(() => {
  vi.resetAllMocks();
  mocked.getCampaign.mockResolvedValue(campaign);
});

test("edits and saves the campaign's system and image style", async () => {
  mocked.saveCampaign.mockImplementation(async (_id, body) => ({ ...campaign, ...body }));
  const onSaved = vi.fn();
  const user = userEvent.setup();
  render(<CampaignSettings onSaved={onSaved} />);

  const name = await screen.findByLabelText("Name");
  await user.clear(name);
  await user.type(name, "The Amber Road");
  await user.selectOptions(screen.getByLabelText("Game system"), "Shadowdark");
  await user.type(screen.getByLabelText(/Image style/), "woodcut print");
  await user.click(screen.getByRole("button", { name: "Save" }));

  expect(await screen.findByText("Saved")).toBeInTheDocument();
  expect(mocked.saveCampaign).toHaveBeenCalledWith(1, {
    name: "The Amber Road",
    gameSystem: "shadowdark",
    styleAnchor: "woodcut print",
    settingNotes: null,
  });
  expect(onSaved).toHaveBeenCalled();
});


afterEach(() => vi.restoreAllMocks());

function leavingPage() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

test("previews Markdown, keeps edits, and grows the full-width notes editor", async () => {
  mocked.getCampaign.mockResolvedValue({ ...campaign, settingNotes: "# The world\n\nA **dark** place." });
  const user = userEvent.setup();
  render(<CampaignSettings />);
  const notes = await screen.findByLabelText("Setting notes");
  expect(notes).toHaveStyle({ width: "100%", "min-height": "288px" });
  Object.defineProperty(notes, "scrollHeight", { configurable: true, value: 800 });
  fireEvent.change(notes, { target: { value: "# The world\n\nA **dark** place.\nMore lore." } });
  expect(notes).toHaveStyle({ height: "800px" });
  await user.click(screen.getByRole("button", { name: "Preview Markdown" }));
  expect(screen.getByRole("heading", { name: "The world" })).toBeInTheDocument();
  expect(screen.getByText("dark").tagName).toBe("STRONG");
  await user.click(screen.getByRole("button", { name: "Edit notes" }));
  expect(screen.getByLabelText("Setting notes")).toHaveValue("# The world\n\nA **dark** place.\nMore lore.");
});

test("warns only while dirty, including failed saves, and cleans up on unmount", async () => {
  mocked.saveCampaign.mockRejectedValueOnce(new Error("Save failed"));
  mocked.saveCampaign.mockImplementationOnce(async (_id, body) => ({ ...campaign, ...body }));
  const onDirtyChange = vi.fn();
  const user = userEvent.setup();
  const { unmount } = render(<CampaignSettings onDirtyChange={onDirtyChange} />);
  const notes = await screen.findByLabelText("Setting notes");
  expect(leavingPage()).toBe(false);
  await user.type(notes, "Lore");
  expect(onDirtyChange).toHaveBeenLastCalledWith(true);
  expect(leavingPage()).toBe(true);
  await user.clear(notes);
  expect(leavingPage()).toBe(false);
  await user.type(notes, "Lore");
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByText("Save failed")).toBeInTheDocument();
  expect(leavingPage()).toBe(true);
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByText("Saved")).toBeInTheDocument();
  await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
  expect(leavingPage()).toBe(false);
  expect(mocked.saveCampaign).toHaveBeenLastCalledWith(1, expect.objectContaining({ settingNotes: "Lore" }));
  await user.type(notes, " again");
  expect(screen.queryByText("Saved")).not.toBeInTheDocument();
  unmount();
  expect(leavingPage()).toBe(false);
});
