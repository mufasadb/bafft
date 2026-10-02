import { beforeEach, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Entity } from "@bafft/shared";
import { NpcCreator } from "./NpcCreator.js";
import { api } from "../api.js";

vi.mock("../api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api.js")>();
  return {
    ApiError: actual.ApiError,
    api: Object.fromEntries(Object.keys(actual.api).map((k) => [k, vi.fn()])),
  };
});

const mocked = vi.mocked(api);

beforeEach(() => {
  vi.resetAllMocks();
});

function renderCreator(entity: Entity | null = null, onSaved = vi.fn()) {
  render(<NpcCreator entity={entity} drawSteel onSaved={onSaved} onCancel={vi.fn()} />);
  return { user: userEvent.setup(), onSaved };
}

test("Roll deals only unlocked seed fields; what the GM typed is kept and sent", async () => {
  mocked.rollNpc.mockImplementation(async ({ profile }) => ({
    name: "Kragan",
    profile: { ...profile, occupation: profile.occupation ?? "grave digger", look: "red lips" },
  }));
  const { user } = renderCreator();

  await user.type(screen.getByLabelText("Ancestry"), "dwarf");
  await user.click(screen.getByRole("button", { name: "Roll" }));

  await waitFor(() => expect(screen.getByLabelText("Name")).toHaveValue("Kragan"));
  const call = mocked.rollNpc.mock.calls[0][0];
  expect(call.profile.ancestry).toBe("dwarf");
  expect(call.fields).not.toContain("ancestry");
  expect(call.fields).toContain("look");
  expect(call.fields).not.toContain("story");
  expect(screen.getByLabelText("Ancestry")).toHaveValue("dwarf");
  // The field's origin is shown: the dice filled Look.
  expect(screen.getByLabelText("Look").closest(".field")).toHaveClass("by-dice");
  expect(screen.getByLabelText("Ancestry").closest(".field")).toHaveClass("by-gm");
});

test("a locked field can't be re-rolled", async () => {
  const { user } = renderCreator();
  await user.type(screen.getByLabelText("Voice"), "whispers");
  expect(screen.getByRole("button", { name: "Re-roll Voice" })).toBeDisabled();

  await user.click(screen.getByRole("button", { name: "Unlock Voice" }));
  expect(screen.getByRole("button", { name: "Re-roll Voice" })).toBeEnabled();
});

test("Flesh out sends the blurb and everything filled, and marks only the gaps as AI", async () => {
  mocked.draftNpc.mockResolvedValue({
    name: "Kragan",
    tags: ["dwarf"],
    quirks: ["chews betel nut"],
    profile: { ancestry: "dwarf", story: "a dead smuggler in the cistern" },
  });
  const { user } = renderCreator();

  await user.type(screen.getByLabelText("Quick idea"), "wary innkeeper");
  await user.type(screen.getByLabelText("Ancestry"), "dwarf");
  await user.click(screen.getByRole("button", { name: "Flesh out with AI" }));

  await waitFor(() => expect(screen.getByLabelText("Story")).toHaveValue("a dead smuggler in the cistern"));
  expect(mocked.draftNpc).toHaveBeenCalledWith(
    expect.objectContaining({ blurb: "wary innkeeper", name: undefined, profile: { ancestry: "dwarf" } }),
  );
  expect(screen.getByLabelText("Story").closest(".field")).toHaveClass("by-ai");
  expect(screen.getByLabelText("Ancestry").closest(".field")).toHaveClass("by-gm");
});

test("negotiation picks can't repeat a kind, and Save sends the whole profile", async () => {
  mocked.saveEntity.mockImplementation(async (_id, body) => ({ id: 7, ...body }) as unknown as Entity);
  const { user, onSaved } = renderCreator();

  await user.type(screen.getByLabelText("Name"), "Boran");
  await user.selectOptions(screen.getByLabelText("Attitude"), "suspicious");
  await user.selectOptions(screen.getByLabelText("Add motivation"), "greed");
  expect(screen.getByLabelText("Add pitfall")).not.toHaveTextContent("greed");
  await user.selectOptions(screen.getByLabelText("Add pitfall"), "justice");
  await user.type(screen.getByLabelText("Why greed"), "debts");
  await user.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() => expect(onSaved).toHaveBeenCalled());
  expect(mocked.saveEntity).toHaveBeenCalledWith(null, {
    type: "npc",
    name: "Boran",
    tags: [],
    aliases: [],
    soundsLike: [],
    quirks: [],
    notes: null,
    profile: {
      negotiation: {
        attitude: "suspicious",
        motivations: [{ kind: "greed", reason: "debts" }],
        pitfalls: [{ kind: "justice", reason: "" }],
      },
    },
  });
});

test("other names and sounds-like are saved with the NPC (bafft-w8f.1)", async () => {
  mocked.saveEntity.mockImplementation(async (_id, body) => ({ id: 7, ...body }) as Entity);
  const { user, onSaved } = renderCreator();

  await user.type(screen.getByLabelText("Name"), "Orven Vellrune");
  await user.type(screen.getByLabelText(/^Other names/), "the captain, Vellrune");
  await user.type(screen.getByLabelText(/^Sounds like/), "vell-roon");
  await user.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() => expect(onSaved).toHaveBeenCalled());
  const body = mocked.saveEntity.mock.calls[0][1];
  expect(body.aliases).toEqual(["the captain", "Vellrune"]);
  expect(body.soundsLike).toEqual(["vell-roon"]);
});

test("what drives them and offers by interest are saved; drive fields have no dice (bafft-w8f.4)", async () => {
  mocked.saveEntity.mockImplementation(async (_id, body) => ({ id: 9, ...body }) as Entity);
  const { user, onSaved } = renderCreator();

  await user.type(screen.getByLabelText("Name"), "Zevra");
  await user.type(screen.getByLabelText("Wants"), "her husband safe and home");
  await user.type(screen.getByLabelText("If it goes sideways"), "protects him first");
  expect(screen.queryByRole("button", { name: "Re-roll Wants" })).toBeNull();
  expect(screen.getByRole("button", { name: "Re-roll Look" })).toBeInTheDocument();

  await user.type(screen.getByLabelText("Offer at interest 2"), "It's real. The door.");
  await user.type(screen.getByLabelText("Offer at interest 5"), "She comes with them");
  await user.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() => expect(onSaved).toHaveBeenCalled());
  const profile = mocked.saveEntity.mock.calls[0][1].profile!;
  expect(profile.wants).toBe("her husband safe and home");
  expect(profile.sideways).toBe("protects him first");
  expect(profile.negotiation?.offers).toEqual([
    { interest: 5, offer: "She comes with them" },
    { interest: 2, offer: "It's real. The door." },
  ]);
});

test("keep to my notes is sent with the flesh-out, along with the NPC being edited (bafft-w8f.10)", async () => {
  mocked.draftNpc.mockResolvedValue({ name: "Pip", tags: [], quirks: [], profile: { look: "soot-smudged" } });
  const pip = { id: 12, type: "npc", name: "Pip", aliases: [], soundsLike: [], tags: [], quirks: [], notes: null, profile: {} } as unknown as Entity;
  render(<NpcCreator entity={pip} drawSteel onSaved={vi.fn()} onCancel={vi.fn()} />);
  const user = userEvent.setup();

  await user.click(screen.getByLabelText(/Keep to my notes/));
  await user.click(screen.getByRole("button", { name: "Flesh out with AI" }));

  await waitFor(() => expect(mocked.draftNpc).toHaveBeenCalled());
  expect(mocked.draftNpc.mock.calls[0][0]).toMatchObject({ entityId: 12, colourOnly: true });
  await waitFor(() => expect(screen.getByLabelText("Look")).toHaveValue("soot-smudged"));
  // Only what the AI actually filled is marked as AI; the empty Story isn't.
  expect(screen.getByLabelText("Look").closest(".field")).toHaveClass("by-ai");
  expect(screen.getByLabelText("Story").closest(".field")).not.toHaveClass("by-ai");
});

test("negotiation nudges toward 2 motivations and 2 pitfalls; flesh-out sends everything filled (bafft-w8f.13)", async () => {
  mocked.draftNpc.mockResolvedValue({ name: "Zevra", tags: [], quirks: [], profile: {} });
  const { user } = renderCreator();
  await user.selectOptions(screen.getByLabelText("Attitude"), "suspicious");
  expect(screen.getByText(/Needs at least 2 motivations/)).toBeInTheDocument();
  expect(screen.getByText(/Needs at least 2 pitfalls/)).toBeInTheDocument();

  await user.selectOptions(screen.getByLabelText("Add motivation"), "protection");
  await user.type(screen.getByLabelText("Why protection"), "Daven is her charge");
  expect(screen.getByText(/Needs at least 2 motivations \(1 more\)/)).toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText("Add motivation"), "peace");
  expect(screen.queryByText(/Needs at least 2 motivations/)).toBeNull();

  await user.type(screen.getByLabelText(/^Other names/), "Daven's wife");
  await user.type(screen.getByLabelText(/^Details/), "hums while she mends");
  await user.click(screen.getByRole("button", { name: "Flesh out with AI" }));
  await waitFor(() => expect(mocked.draftNpc).toHaveBeenCalled());
  const req = mocked.draftNpc.mock.calls[0][0];
  expect(req.aliases).toEqual(["Daven's wife"]);
  expect(req.quirks).toEqual(["hums while she mends"]);
  expect(req.profile.negotiation?.motivations).toEqual([
    { kind: "protection", reason: "Daven is her charge" },
    { kind: "peace", reason: "" },
  ]);
});
