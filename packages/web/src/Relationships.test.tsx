import { beforeEach, expect, test, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Entity, EntityRelationship } from "@bafft/shared";
import { Relationships } from "./Relationships.js";
import { LocationInside, useLocationInside } from "./LocationInside.js";
import { api } from "./api.js";
vi.mock("./api.js", () => ({ api: { listRelationships: vi.fn(), listRelationshipLabels: vi.fn(), createRelationship: vi.fn(), saveEntity: vi.fn(), deleteRelationship: vi.fn(), setRelationshipGmOnly: vi.fn(), setLocationInside: vi.fn() } }));
const mocked = vi.mocked(api);
const entity = (id: number, name: string, type: Entity["type"] = "location", aliases: string[] = []): Entity => ({ id, name, type, aliases, campaignId: 1, soundsLike: [], notes: null, tags: [], quirks: [], imagePath: null, profile: null, createdAt: new Date(), updatedAt: new Date() });
const town = entity(1, "Town");
const entities = [town, entity(2, "Zara", "npc", ["Warden"]), entity(3, "Andor"), entity(4, "Alice", "npc"), entity(5, "Belvarin"), entity(7, "Silver Guild", "faction")];
const rel = (patch: Partial<EntityRelationship> = {}): EntityRelationship => ({ id: 10, fromEntityId: 1, toEntityId: 3, description: "is inside", isContainment: true, gmOnly: false, createdAt: new Date(), ...patch });
beforeEach(() => {
  vi.resetAllMocks();
  mocked.listRelationships.mockResolvedValue([]);
  mocked.listRelationshipLabels.mockResolvedValue(["secretly serves", "is owner of"]);
  mocked.createRelationship.mockResolvedValue(rel({ description: "secretly serves", isContainment: false, toEntityId: 2 }));
});
function show() { render(<Relationships entity={town} entities={entities} onOpen={vi.fn()} onChanged={vi.fn()} onError={vi.fn()} />); }

test("searches names and aliases, groups by type, sorts names, and saves an editable verb phrase", async () => {
  const user = userEvent.setup();
  show();
  await waitFor(() => expect(mocked.listRelationshipLabels).toHaveBeenCalled());
  const picker = screen.getByRole("combobox", { name: "Related to" });
  expect(within(picker).getByRole("group", { name: "NPCs" }).textContent).toBe("AliceZara");
  expect(within(picker).getByRole("group", { name: "Locations" }).textContent).toBe("AndorBelvarin");
  expect(within(picker).getByRole("group", { name: "Factions" })).toHaveTextContent("Silver Guild");
  expect(within(picker).queryByRole("option", { name: "Town" })).toBeNull();
  await user.type(screen.getByLabelText("Search related to"), "ward");
  expect(within(picker).getByRole("option", { name: "Zara" })).toBeInTheDocument();
  expect(within(picker).queryByRole("option", { name: "Alice" })).toBeNull();
  await user.selectOptions(picker, "2");
  await user.type(screen.getByLabelText("Relationship"), "secretly serves");
  await user.click(screen.getByRole("button", { name: "Add" }));
  await waitFor(() => expect(mocked.createRelationship).toHaveBeenCalledWith({ fromEntityId: 1, toEntityId: 2, description: "secretly serves", isContainment: false, gmOnly: false }));
  expect(screen.queryByText("Town is")).toBeNull();
  const list = document.getElementById(screen.getByLabelText("Relationship").getAttribute("list")!);
  expect(list?.querySelector('option[value="is owner of"]')).not.toBeNull();
});

test("new targets can still be created from the picker", async () => {
  const user = userEvent.setup();
  mocked.saveEntity.mockResolvedValue(entity(6, "Keep"));
  show();
  await user.selectOptions(screen.getByLabelText("Related to"), "new");
  await user.type(screen.getByLabelText("New thing's name"), "Keep");
  await user.type(screen.getByLabelText("Relationship"), "guards");
  await user.click(screen.getByRole("button", { name: "Add" }));
  await waitFor(() => expect(mocked.createRelationship).toHaveBeenCalledWith(expect.objectContaining({ toEntityId: 6, description: "guards" })));
});

test("incoming relationships don't add a forced is or a redundant containment suffix", async () => {
  mocked.listRelationships.mockResolvedValue([rel({ fromEntityId: 3, toEntityId: 1, description: "secretly serves", isContainment: false })]);
  show();
  expect(await screen.findByText(/secretly serves this/)).toHaveTextContent("Andor secretly serves this");
  expect(screen.queryByText(/part of/)).toBeNull();
});

function InsideForm({ id }: { id: number | null }) {
  const inside = useLocationInside(id, vi.fn());
  return <><LocationInside entities={entities} entityId={id} value={inside.parentId} onChange={inside.setParentId} disabled={!inside.ready} />
    <button disabled={!inside.ready} onClick={() => inside.save(id ?? 6)}>Save location</button></>;
}

test("Inside supports nesting a new location on save and offers only locations", async () => {
  const user = userEvent.setup();
  render(<InsideForm id={null} />);
  const picker = screen.getByRole("combobox", { name: "Inside" });
  expect(within(picker).queryByRole("option", { name: "Zara" })).toBeNull();
  await user.type(screen.getByLabelText("Search inside"), "and");
  await user.selectOptions(picker, "3");
  expect(mocked.setLocationInside).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Save location" }));
  await waitFor(() => expect(mocked.setLocationInside).toHaveBeenCalledWith(6, 3));
});

test("Inside loads existing containment, excludes self, and can return to top level", async () => {
  mocked.listRelationships.mockResolvedValue([rel(), rel({ id: 11, fromEntityId: 5, toEntityId: 1 })]);
  const user = userEvent.setup();
  render(<InsideForm id={1} />);
  const picker = screen.getByRole("combobox", { name: "Inside" });
  await waitFor(() => expect(picker).toHaveValue("3"));
  expect(within(picker).queryByRole("group", { name: "Factions" })).toBeNull();
  expect(within(picker).queryByRole("option", { name: "Town" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Save location" }));
  expect(mocked.setLocationInside).not.toHaveBeenCalled();
  await user.selectOptions(picker, "");
  await user.click(screen.getByRole("button", { name: "Save location" }));
  await waitFor(() => expect(mocked.setLocationInside).toHaveBeenCalledWith(1, null));
});

test("creates GM-only links and resets the draft visibility after saving", async () => {
  const user = userEvent.setup();
  show();
  await user.selectOptions(screen.getByLabelText("Related to"), "2");
  await user.type(screen.getByLabelText("Relationship"), "secretly serves");
  await user.click(screen.getByLabelText("New relationship GM only"));
  await user.click(screen.getByRole("button", { name: "Add" }));
  await waitFor(() => expect(mocked.createRelationship).toHaveBeenCalledWith(expect.objectContaining({ gmOnly: true })));
  expect(screen.getByLabelText("New relationship GM only")).not.toBeChecked();
});

test("existing incoming links show the GM badge and can become public", async () => {
  const secret = rel({ fromEntityId: 3, toEntityId: 1, description: "secretly serves", gmOnly: true });
  mocked.listRelationships.mockResolvedValue([secret]);
  mocked.setRelationshipGmOnly.mockResolvedValue({ ...secret, gmOnly: false });
  const user = userEvent.setup();
  show();
  const toggle = await screen.findByLabelText("GM only: secretly serves");
  expect(toggle).toBeChecked();
  expect(document.querySelector(".gm-only")).toHaveTextContent("GM only");
  await user.click(toggle);
  await waitFor(() => expect(mocked.setRelationshipGmOnly).toHaveBeenCalledWith(10, false));
  await waitFor(() => expect(toggle).not.toBeChecked());
  expect(document.querySelector(".gm-only")).toBeNull();
});

test("player views omit secret links in both directions and editing controls", async () => {
  mocked.listRelationships.mockResolvedValue([
    rel({ description: "outgoing secret", gmOnly: true }),
    rel({ id: 11, fromEntityId: 3, toEntityId: 1, description: "incoming secret", gmOnly: true }),
    rel({ id: 12, description: "visits", isContainment: false }),
  ]);
  render(<Relationships entity={town} entities={entities} audience="player" onOpen={vi.fn()} onChanged={vi.fn()} onError={vi.fn()} />);
  expect(await screen.findByText(/visits/)).toBeInTheDocument();
  expect(mocked.listRelationships).toHaveBeenCalledWith(1, "player");
  expect(screen.queryByText(/outgoing secret|incoming secret/)).toBeNull();
  expect(screen.queryByRole("button", { name: "Add" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
  expect(screen.queryByRole("checkbox")).toBeNull();
  expect(mocked.listRelationshipLabels).not.toHaveBeenCalled();
});
