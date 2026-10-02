import { beforeEach, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Entity } from "@bafft/shared";
import { NpcSection } from "./NpcSection.js";
import { api } from "../api.js";

vi.mock("../api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api.js")>();
  return {
    ApiError: actual.ApiError,
    api: Object.fromEntries(Object.keys(actual.api).map((k) => [k, vi.fn()])),
  };
});

const mocked = vi.mocked(api);

const boran: Entity = {
  id: 1,
  campaignId: 1,
  type: "npc",
  name: "Boran",
  aliases: [],
  soundsLike: [],
  notes: null,
  tags: [],
  quirks: ["chews betel nut"],
  imagePath: null,
  profile: {
    ancestry: "dwarf",
    occupation: "innkeeper",
    story: "A dead smuggler in the cistern.\nSecret: skims the guild's brandy",
    negotiation: {
      attitude: "suspicious",
      impression: 2,
      motivations: [{ kind: "greed", reason: "debts" }],
      pitfalls: [{ kind: "justice", reason: "hates the watch" }],
    },
  },
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

beforeEach(() => {
  vi.resetAllMocks();
  mocked.listEntities.mockResolvedValue([boran]);
  mocked.listRelationships.mockResolvedValue([]);
  mocked.listRelationshipLabels.mockResolvedValue([]);
});

test("an NPC opens as a readable card, and Edit switches to the creator", async () => {
  const user = userEvent.setup();
  render(<NpcSection drawSteel onOpenOther={vi.fn()} />);

  await user.click(await screen.findByRole("button", { name: /^Boran/ }));

  expect(screen.getByRole("heading", { name: "Boran" })).toBeInTheDocument();
  expect(screen.getByText("dwarf · innkeeper")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Story" })).toBeInTheDocument();
  expect(screen.getByText(/Secret: skims the guild's brandy/)).toBeInTheDocument();
  expect(screen.getByRole("img", { name: "Interest 2 of 5" })).toBeInTheDocument();
  expect(screen.getByText("chews betel nut")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Edit" }));
  expect(screen.getByRole("heading", { name: "Edit Boran" })).toBeInTheDocument();
  expect(screen.getByLabelText("Story")).toHaveValue("A dead smuggler in the cistern.\nSecret: skims the guild's brandy");
});

test("the card shows other names, what drives them and the offers table (bafft-w8f.1, w8f.4)", async () => {
  mocked.listEntities.mockResolvedValue([
    {
      ...boran,
      aliases: ["Old Boran"],
      soundsLike: ["bore-an"],
      profile: {
        ...boran.profile,
        wants: "the guild debt gone",
        plan: "sell the smuggler's map",
        negotiation: { ...boran.profile!.negotiation!, offers: [{ interest: 4, offer: "the cistern key" }] },
      },
    },
  ]);
  const user = userEvent.setup();
  render(<NpcSection drawSteel onOpenOther={vi.fn()} />);
  await user.click(await screen.findByRole("button", { name: /^Boran/ }));

  expect(screen.getByText("Also called Old Boran")).toBeInTheDocument();
  expect(screen.getByText("Said like “bore-an”")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "What drives them" })).toBeInTheDocument();
  expect(screen.getByText("the guild debt gone")).toBeInTheDocument();
  expect(screen.getByText("sell the smuggler's map")).toBeInTheDocument();
  expect(screen.getByRole("row", { name: "4 the cistern key" })).toBeInTheDocument();
});
