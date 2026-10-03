import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Entity, EntityWithChildren } from "@bafft/shared";
import { Glossary } from "./Glossary.js";
import { api, ApiError } from "./api.js";

vi.mock("./api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api.js")>();
  return {
    ApiError: actual.ApiError,
    api: Object.fromEntries(Object.keys(actual.api).map((k) => [k, vi.fn()])),
  };
});

const mocked = vi.mocked(api);

function entity(id: number, name: string, extra: Partial<Entity> = {}): Entity {
  return {
    id,
    campaignId: 1,
    type: "location",
    name,
    aliases: [],
    soundsLike: [],
    notes: null,
    tags: [],
    quirks: [],
    imagePath: null,
    profile: null,
    createdAt: new Date(0),
    updatedAt: new Date(1000),
    ...extra,
  };
}

function node(e: Entity, children: EntityWithChildren[] = []): EntityWithChildren {
  return { ...e, children };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocked.listEntities.mockResolvedValue([]);
  mocked.getLocationTree.mockResolvedValue([]);
  mocked.listRelationships.mockResolvedValue([]);
  mocked.listRelationshipLabels.mockResolvedValue([]);
});

describe("pictures", () => {
  test("an entity's saved picture is shown, with a cache-busting version", async () => {
    const npc = entity(5, "Mira", { type: "npc", imagePath: "images/5/portrait.svg" });
    mocked.listEntities.mockResolvedValue([npc]);
    const user = userEvent.setup();
    render(<Glossary />);

    await user.click(screen.getByRole("button", { name: "NPCs" }));
    await user.click(await screen.findByRole("button", { name: /Mira/ }));

    expect(screen.getByAltText("Mira portrait")).toHaveAttribute("src", "/data/images/5/portrait.svg?v=1000");
  });

  test("keeping a new picture swaps the preview for the saved image, at a new URL", async () => {
    const before = entity(5, "Mira", { type: "npc", imagePath: "images/5/portrait.svg" });
    const after = { ...before, updatedAt: new Date(2000) };
    mocked.listEntities.mockResolvedValueOnce([before]).mockResolvedValue([after]);
    mocked.generatePicture.mockResolvedValue({ tempId: "t.svg", dataUrl: "data:image/svg+xml;base64,AA==" });
    mocked.acceptPicture.mockResolvedValue(after);
    const user = userEvent.setup();
    render(<Glossary />);

    await user.click(screen.getByRole("button", { name: "NPCs" }));
    await user.click(await screen.findByRole("button", { name: /Mira/ }));
    await user.click(screen.getByRole("button", { name: "Picture this" }));
    expect(await screen.findByAltText("generated preview")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Keep it" }));

    expect(mocked.acceptPicture).toHaveBeenCalledWith(5, "t.svg");
    await waitFor(() =>
      expect(screen.getByAltText("Mira portrait")).toHaveAttribute("src", "/data/images/5/portrait.svg?v=2000"),
    );
    expect(screen.queryByAltText("generated preview")).not.toBeInTheDocument();
  });

  test("discarding a generated picture saves nothing", async () => {
    mocked.listEntities.mockResolvedValue([entity(5, "Mira", { type: "npc" })]);
    mocked.generatePicture.mockResolvedValue({ tempId: "t.svg", dataUrl: "data:image/svg+xml;base64,AA==" });
    const user = userEvent.setup();
    render(<Glossary />);

    await user.click(screen.getByRole("button", { name: "NPCs" }));
    await user.click(await screen.findByRole("button", { name: /Mira/ }));
    await user.click(screen.getByRole("button", { name: "Picture this" }));
    await user.click(await screen.findByRole("button", { name: "Discard" }));

    expect(screen.queryByAltText("generated preview")).not.toBeInTheDocument();
    expect(mocked.acceptPicture).not.toHaveBeenCalled();
  });
});

describe("location tree", () => {
  test("delete lives on the card, not beside every row, and asks first", async () => {
    const region = entity(1, "The Region");
    const town = entity(2, "Lethara");
    mocked.listEntities.mockResolvedValue([region, town]);
    mocked.getLocationTree.mockResolvedValue([node(region, [node(town)])]);
    mocked.deleteEntity.mockResolvedValue();
    const confirmSpy = vi.spyOn(window, "confirm");
    const user = userEvent.setup();
    render(<Glossary />);

    await user.click(await screen.findByRole("button", { name: "Lethara" }));
    expect(screen.getAllByRole("button", { name: /Delete/ })).toHaveLength(1);

    confirmSpy.mockReturnValueOnce(false);
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(mocked.deleteEntity).not.toHaveBeenCalled();

    confirmSpy.mockReturnValueOnce(true);
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(mocked.deleteEntity).toHaveBeenCalledWith(2);
  });

  test("a failed delete shows the server's error instead of failing silently", async () => {
    const region = entity(1, "The Region");
    mocked.listEntities.mockResolvedValue([region]);
    mocked.getLocationTree.mockResolvedValue([node(region)]);
    mocked.deleteEntity.mockRejectedValue(new ApiError("entity not found", 404));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    render(<Glossary />);

    await user.click(await screen.findByRole("button", { name: "The Region" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(await screen.findByText("entity not found")).toBeInTheDocument();
  });

  test("places are alphabetical at every level, and a branch collapses (bafft-w8f.6)", async () => {
    const region = entity(1, "Zolt");
    const a = entity(2, "Andor");
    const hold = entity(3, "The Keep");
    const bow = entity(4, "The Bow");
    mocked.listEntities.mockResolvedValue([region, a, hold, bow]);
    mocked.getLocationTree.mockResolvedValue([node(region, [node(hold), node(bow)]), node(a)]);
    const user = userEvent.setup();
    render(<Glossary type="location" />);

    await screen.findByRole("button", { name: "The Bow" });
    const names = screen.getAllByRole("listitem").map((li) => li.querySelector("button.item")?.textContent);
    expect(names).toEqual(["Andor", "Zolt", "The Bow", "The Keep"]);

    await user.click(screen.getByRole("button", { name: "Collapse Zolt" }));
    expect(screen.queryByRole("button", { name: "The Bow" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Expand Zolt" }));
    expect(screen.getByRole("button", { name: "The Bow" })).toBeInTheDocument();
  });
});

describe("form wording (bafft-w8f.6)", () => {
  test("types are singular, AI drafting starts folded away, and fields share the card's names", async () => {
    render(<Glossary type="item" />);

    const type = await screen.findByRole("combobox", { name: "Type" });
    expect(screen.getByRole("option", { name: "Item" })).toBeInTheDocument();
    expect(type).toHaveValue("item");
    expect(screen.getByText("Draft with AI", { selector: "summary" }).closest("details")).not.toHaveAttribute("open");
    expect(screen.getByLabelText(/^Details/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Notes/)).toBeInTheDocument();
    expect(screen.getByText("GM only")).toBeInTheDocument();
  });
});

describe("players (bafft-w8f.8)", () => {
  test("a new player gets a hero picker instead of AI drafting, and saving links the hero", async () => {
    const hero = entity(7, "Gorm", { type: "character" });
    mocked.listEntities.mockResolvedValue([hero]);
    const saved = entity(9, "Ava", { type: "player" });
    mocked.saveEntity.mockResolvedValue(saved);
    mocked.createRelationship.mockResolvedValue({} as never);
    const user = userEvent.setup();
    render(<Glossary type="player" />);

    await screen.findByRole("heading", { name: "New player" });
    expect(screen.queryByText("Draft with AI")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Type" })).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("Name"), "Ava");
    await user.selectOptions(await screen.findByRole("combobox", { name: "Hero" }), "7");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(mocked.createRelationship).toHaveBeenCalledWith({
        fromEntityId: 9, toEntityId: 7, description: "plays", isContainment: false, gmOnly: false,
      }),
    );
  });

  test("changing a player's hero replaces the old link, and a new hero can be made on the spot", async () => {
    const player = entity(9, "Ava", { type: "player" });
    mocked.listEntities.mockResolvedValue([player, entity(7, "Gorm", { type: "character" })]);
    mocked.listRelationships.mockResolvedValue([
      { id: 50, fromEntityId: 9, toEntityId: 7, description: "plays", isContainment: false, gmOnly: false } as never,
    ]);
    mocked.saveEntity.mockImplementation(async (id, input) =>
      id === 9 ? player : entity(11, input.name ?? "", { type: "character" }),
    );
    mocked.deleteRelationship.mockResolvedValue();
    mocked.createRelationship.mockResolvedValue({} as never);
    const user = userEvent.setup();
    render(<Glossary type="player" openId={9} />);

    await user.click(await screen.findByRole("button", { name: /Edit/ }));
    const picker = screen.getByRole("combobox", { name: "Hero" });
    await waitFor(() => expect(picker).toHaveValue("7"));
    await user.selectOptions(picker, "new");
    await user.type(screen.getByLabelText("New hero's name"), "Neris");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mocked.createRelationship).toHaveBeenCalled());
    expect(mocked.deleteRelationship).toHaveBeenCalledWith(50);
    expect(mocked.saveEntity).toHaveBeenCalledWith(null, { type: "character", name: "Neris" });
    expect(mocked.createRelationship).toHaveBeenCalledWith(expect.objectContaining({ fromEntityId: 9, toEntityId: 11, description: "plays" }));
  });
});

describe("relationships", () => {
  test("a rejected relationship shows the server's reason, e.g. a containment loop", async () => {
    const region = entity(1, "The Region");
    const town = entity(2, "Lethara");
    mocked.listEntities.mockResolvedValue([region, town]);
    mocked.getLocationTree.mockResolvedValue([node(region, [node(town)])]);
    mocked.createRelationship.mockRejectedValue(new ApiError("that would put a location inside itself", 422));
    const user = userEvent.setup();
    render(<Glossary />);

    await user.click(await screen.findByRole("button", { name: "The Region" }));
    await user.selectOptions(screen.getByLabelText("Related to"), "2");
    await user.type(screen.getByPlaceholderText(/owner of/), "part of");
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(mocked.createRelationship).toHaveBeenCalledWith({
      fromEntityId: 1,
      toEntityId: 2,
      description: "part of",
      isContainment: false,
      gmOnly: false,
    });
    expect(await screen.findByText("that would put a location inside itself")).toBeInTheDocument();
  });
});

describe("draft with AI", () => {
  test("fills the form but saves nothing until Save is pressed", async () => {
    mocked.draftEntity.mockResolvedValue({
      name: "Drafted Location",
      aliases: ["DL"],
      tags: ["settlement"],
      quirks: ["Smells of low tide."],
    });
    const user = userEvent.setup();
    render(<Glossary />);

    await user.type(screen.getByPlaceholderText(/Describe it/), "a foggy harbour town");
    await user.click(screen.getByRole("button", { name: "Draft with AI" }));

    expect(await screen.findByDisplayValue("Drafted Location")).toBeInTheDocument();
    expect(screen.getByDisplayValue("settlement")).toBeInTheDocument();
    expect(mocked.draftEntity).toHaveBeenCalledWith({ type: "location", prompt: "a foggy harbour town" });
    expect(mocked.saveEntity).not.toHaveBeenCalled();
  });

  test("guided mode sends only the answered questions for the form's type", async () => {
    mocked.draftEntity.mockResolvedValue({ name: "Saltmarsh", aliases: [], tags: [], quirks: [] });
    const user = userEvent.setup();
    render(<Glossary />);

    await user.click(screen.getByRole("button", { name: "Pick options" }));
    const draftButton = screen.getByRole("button", { name: "Draft with AI" });
    expect(draftButton).toBeDisabled();

    await user.type(screen.getByLabelText("Kind"), "village");
    await user.type(screen.getByLabelText("Mood"), "tense");
    await user.click(draftButton);

    expect(await screen.findByDisplayValue("Saltmarsh")).toBeInTheDocument();
    expect(mocked.draftEntity).toHaveBeenCalledWith({
      type: "location",
      guided: { kind: "village", mood: "tense" },
    });
  });
});

describe("first-time walkthrough fixes (bafft-a41)", () => {
  test("picking the NPCs tab makes a new draft an NPC, not a location", async () => {
    mocked.draftEntity.mockResolvedValue({ name: "Boran", aliases: [], tags: [], quirks: [] });
    const user = userEvent.setup();
    render(<Glossary />);

    await user.click(screen.getByRole("button", { name: "NPCs" }));
    expect(screen.getByRole("heading", { name: "New NPC" })).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText(/Describe it/), "a wary dwarven innkeeper");
    await user.click(screen.getByRole("button", { name: "Draft with AI" }));

    expect(mocked.draftEntity).toHaveBeenCalledWith({ type: "npc", prompt: "a wary dwarven innkeeper" });
  });

  test("the last draft prompt doesn't follow you to another entity", async () => {
    const tavern = entity(3, "The Drowned Anvil");
    mocked.listEntities.mockResolvedValue([tavern]);
    mocked.getLocationTree.mockResolvedValue([node(tavern)]);
    const user = userEvent.setup();
    render(<Glossary />);

    await user.type(screen.getByPlaceholderText(/Describe it/), "a wary dwarven innkeeper");
    await user.click(await screen.findByRole("button", { name: "The Drowned Anvil" }));
    await user.click(screen.getByRole("button", { name: "Edit" }));

    expect(screen.getByPlaceholderText(/Describe it/)).toHaveValue("");
  });

  test("a relationship can create the thing it points at", async () => {
    const boran = entity(1, "Boran", { type: "npc" });
    mocked.listEntities.mockResolvedValue([boran]);
    mocked.saveEntity.mockResolvedValue(entity(9, "The Drowned Anvil"));
    mocked.createRelationship.mockResolvedValue({
      id: 1,
      fromEntityId: 1,
      toEntityId: 9,
      description: "owner of",
      isContainment: false,
      gmOnly: false,
      createdAt: new Date(0),
    });
    const user = userEvent.setup();
    render(<Glossary />);

    await user.click(screen.getByRole("button", { name: "NPCs" }));
    await user.click(await screen.findByRole("button", { name: /Boran/ }));
    await user.type(screen.getByLabelText("Relationship"), "owner of");
    await user.selectOptions(screen.getByLabelText("Related to"), "new");
    await user.type(screen.getByLabelText("New thing's name"), "The Drowned Anvil");
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() =>
      expect(mocked.createRelationship).toHaveBeenCalledWith({
        fromEntityId: 1,
        toEntityId: 9,
        description: "owner of",
        isContainment: false,
        gmOnly: false,
      }),
    );
    expect(mocked.saveEntity).toHaveBeenCalledWith(null, { type: "location", name: "The Drowned Anvil" });
  });

  test("a related thing's name opens it", async () => {
    const boran = entity(1, "Boran", { type: "npc" });
    const tavern = entity(9, "The Drowned Anvil");
    mocked.listEntities.mockResolvedValue([boran, tavern]);
    mocked.listRelationships.mockResolvedValue([
      { id: 1, fromEntityId: 1, toEntityId: 9, description: "owner of", isContainment: false, gmOnly: false, createdAt: new Date(0) },
    ]);
    const user = userEvent.setup();
    render(<Glossary />);

    await user.click(screen.getByRole("button", { name: "NPCs" }));
    await user.click(await screen.findByRole("button", { name: /Boran/ }));
    await user.click(await screen.findByRole("button", { name: "The Drowned Anvil" }));

    expect(screen.getByRole("heading", { name: "The Drowned Anvil" })).toBeInTheDocument();
  });
});

describe("entity cards (bafft-a41)", () => {
  test("opening a location shows a readable card; Edit opens the form, Back returns", async () => {
    const tavern = entity(3, "The Drowned Anvil", { tags: ["tavern"], quirks: ["Floods at high tide."], notes: "Smuggler den" });
    mocked.listEntities.mockResolvedValue([tavern]);
    mocked.getLocationTree.mockResolvedValue([node(tavern)]);
    const user = userEvent.setup();
    render(<Glossary type="location" />);

    await user.click(await screen.findByRole("button", { name: "The Drowned Anvil" }));
    expect(screen.getByRole("heading", { name: "The Drowned Anvil" })).toBeInTheDocument();
    expect(screen.getByText("location · tavern")).toBeInTheDocument();
    expect(screen.getByText("Floods at high tide.")).toBeInTheDocument();
    expect(screen.getByText("GM only", { selector: ".gm-only" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByLabelText("Name")).toHaveValue("The Drowned Anvil");

    await user.click(screen.getByRole("button", { name: "Back to card" }));
    expect(screen.getByText("Floods at high tide.")).toBeInTheDocument();
  });

  test("saving an edit returns to the card", async () => {
    const tavern = entity(3, "The Drowned Anvil");
    mocked.listEntities.mockResolvedValue([tavern]);
    mocked.getLocationTree.mockResolvedValue([node(tavern)]);
    mocked.saveEntity.mockResolvedValue({ ...tavern, name: "The Sunken Anvil" });
    const user = userEvent.setup();
    render(<Glossary type="location" />);

    await user.click(await screen.findByRole("button", { name: "The Drowned Anvil" }));
    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "The Sunken Anvil");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("heading", { name: "The Sunken Anvil" })).toBeInTheDocument();
  });
});

test("a new location's Inside field saves its parent and refreshes the nested tree (bafft-w8f.2)", async () => {
  const country = entity(1, "Andor");
  const town = entity(2, "Lethara");
  mocked.listEntities.mockResolvedValueOnce([country]).mockResolvedValue([country, town]);
  mocked.getLocationTree.mockResolvedValueOnce([node(country)]).mockResolvedValue([node(country, [node(town)])]);
  mocked.saveEntity.mockResolvedValue(town);
  mocked.setLocationInside.mockResolvedValue();
  const user = userEvent.setup();
  render(<Glossary type="location" />);
  await screen.findByRole("button", { name: "Andor" });
  await user.type(screen.getByRole("textbox", { name: "Name" }), "Lethara");
  await user.type(screen.getByLabelText("Search inside"), "and");
  await user.selectOptions(screen.getByRole("combobox", { name: "Inside" }), "1");
  expect(mocked.setLocationInside).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(mocked.setLocationInside).toHaveBeenCalledWith(2, 1));
  const countryButton = await screen.findByRole("button", { name: "Andor" });
  const countryNode = countryButton.closest("li")!;
  await waitFor(() => expect(countryNode.querySelector(":scope > ul > li button.item")).toHaveTextContent("Lethara"));
  expect(await screen.findByRole("heading", { name: "Lethara" })).toBeInTheDocument();
});

test("a rejected Inside move displays the server error and keeps the form", async () => {
  const region = entity(1, "The Region");
  const town = entity(2, "Lethara");
  mocked.listEntities.mockResolvedValue([region, town]);
  mocked.getLocationTree.mockResolvedValue([node(region, [node(town)])]);
  mocked.saveEntity.mockResolvedValue(region);
  mocked.setLocationInside.mockRejectedValue(new ApiError("that would put a location inside itself", 422));
  const user = userEvent.setup();
  render(<Glossary type="location" />);
  await user.click(await screen.findByRole("button", { name: "The Region" }));
  await user.click(screen.getByRole("button", { name: "Edit" }));
  await user.selectOptions(screen.getByRole("combobox", { name: "Inside" }), "2");
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByText("that would put a location inside itself")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Edit: The Region" })).toBeInTheDocument();
});

describe("location fields (bafft-w8f.16)", () => {
  test("a location's form is physical description, notes, story relevance, and saves them to the profile", async () => {
    mocked.saveEntity.mockImplementation(async (_id, body) => entity(5, "The Hall", body as Partial<Entity>));
    const user = userEvent.setup();
    render(<Glossary type="location" />);
    await user.click(await screen.findByRole("button", { name: /New location/ }));

    expect(screen.queryByLabelText(/^Quirks/)).toBeNull();
    const fields = ["Physical description", "Notes", "Story relevance"].map((l) => screen.getByLabelText(new RegExp(`^${l}`)));
    // Document order: each field comes after the one before it.
    for (let i = 1; i < fields.length; i++)
      expect(fields[i - 1]!.compareDocumentPosition(fields[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await user.type(screen.getByLabelText("Name"), "The Hall");
    await user.type(fields[0]!, "No roof, just stars");
    await user.type(fields[2]!, "The blue jewel is stolen here");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mocked.saveEntity).toHaveBeenCalled());
    const body = mocked.saveEntity.mock.calls[0]![1];
    expect(body).toMatchObject({
      quirks: [],
      profile: { description: "No roof, just stars", storyRelevance: "The blue jewel is stolen here" },
    });
  });
});

describe("Forge Steel heroes (bafft-cb6)", () => {
  const dsHero = {
    id: "fs-1",
    name: "Brannoc Ashhelm",
    picture: "data:image/png;base64,iVBORw0KGgo=",
    ancestry: { name: "Dwarf" },
    culture: null,
    career: { name: "Soldier" },
    class: { name: "Fury", level: 2, subclasses: [{ name: "Berserker", selected: true }] },
    complication: null,
  };

  test("importing a .ds-hero fills the name, and Save keeps the link, summary and portrait", async () => {
    const saved = entity(9, "Brannoc Ashhelm", { type: "character" });
    mocked.saveEntity.mockResolvedValue(saved);
    mocked.uploadPicture.mockResolvedValue({ ...saved, imagePath: "images/9/portrait.png" });
    const user = userEvent.setup();
    render(<Glossary type="character" />);

    const file = new File([JSON.stringify(dsHero)], "Brannoc Ashhelm.ds-hero", { type: "application/octet-stream" });
    await user.upload(screen.getByLabelText(/Import a .ds-hero file/), file);
    expect(await screen.findByTestId("forge-steel-summary")).toHaveTextContent("Level 2 Dwarf Fury (Berserker) · with portrait");
    expect(screen.getByLabelText("Name")).toHaveValue("Brannoc Ashhelm");

    await user.type(screen.getByLabelText(/^Forge Steel link/), "https://forgesteel.net/#/hero/view/fs-1");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mocked.uploadPicture).toHaveBeenCalledWith(9, expect.any(Blob)));
    const body = mocked.saveEntity.mock.calls[0]![1];
    expect(body.profile?.forgeSteel).toMatchObject({
      url: "https://forgesteel.net/#/hero/view/fs-1",
      ancestry: "Dwarf",
      className: "Fury",
      subclass: "Berserker",
      level: 2,
      career: "Soldier",
    });
  });

  test("an imported portrait never replaces a picture the hero already has", async () => {
    const hero = entity(9, "Brannoc Ashhelm", { type: "character", imagePath: "images/9/portrait.png" });
    mocked.listEntities.mockResolvedValue([hero]);
    mocked.saveEntity.mockResolvedValue(hero);
    const user = userEvent.setup();
    render(<Glossary type="character" />);

    await user.click(await screen.findByRole("button", { name: /Brannoc/ }));
    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.upload(screen.getByLabelText(/Import a .ds-hero file/), new File([JSON.stringify(dsHero)], "h.ds-hero"));
    await screen.findByTestId("forge-steel-summary");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mocked.saveEntity).toHaveBeenCalled());
    expect(mocked.uploadPicture).not.toHaveBeenCalled();
  });

  test("a file that isn't a hero says so and changes nothing", async () => {
    const user = userEvent.setup();
    render(<Glossary type="character" />);
    await user.upload(screen.getByLabelText(/Import a .ds-hero file/), new File(["{\"name\":\"A sword\"}"], "x.ds-hero"));
    expect(await screen.findByText(/isn't a Forge Steel hero/)).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("");
  });

  test("a link that isn't a web address is refused before saving", async () => {
    const user = userEvent.setup();
    render(<Glossary type="character" />);
    await user.type(screen.getByLabelText("Name"), "Brannoc");
    await user.type(screen.getByLabelText(/^Forge Steel link/), "forgesteel hero 12");
    await user.click(screen.getByRole("button", { name: "Save" }));
    // The browser's own check on a url field stops it first; ours backs it up.
    expect(screen.getByLabelText(/^Forge Steel link/)).toBeInvalid();
    expect(mocked.saveEntity).not.toHaveBeenCalled();
  });

  test("the card shows the hero line and opens the sheet in Forge Steel", async () => {
    const hero = entity(9, "Brannoc Ashhelm", {
      type: "character",
      profile: { forgeSteel: { url: "https://forgesteel.net/#/hero/view/fs-1", level: 2, ancestry: "Dwarf", className: "Fury", career: "Soldier" } },
    });
    mocked.listEntities.mockResolvedValue([hero]);
    const user = userEvent.setup();
    render(<Glossary type="character" />);
    await user.click(await screen.findByRole("button", { name: /Brannoc/ }));
    expect(screen.getByText(/Level 2 Dwarf Fury/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open in Forge Steel" })).toHaveAttribute("href", "https://forgesteel.net/#/hero/view/fs-1");
  });
});
