import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { startApp, type App } from "./harness.js";
let app: App;
before(async () => { app = await startApp(); });
after(async () => { await app?.close(); });

test("Inside creates a nested location; relationship search and saved labels work through the real UI (bafft-w8f.2)", async () => {
  const { page, baseUrl } = app;
  await page.getByRole("button", { name: "Locations", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Andor");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("heading", { name: "Andor", exact: true }).waitFor();
  await page.getByRole("button", { name: "New location", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Lethara");
  await page.getByLabel("Search inside", { exact: true }).fill("and");
  await page.getByLabel("Inside", { exact: true }).selectOption({ label: "Andor" });
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("heading", { name: "Lethara", exact: true }).waitFor();
  const nested = page.locator(".tree > li").filter({ has: page.getByRole("button", { name: "Andor", exact: true }) }).locator("ul").getByRole("button", { name: "Lethara", exact: true });
  await nested.waitFor();

  // Seed an NPC and another location to verify the grouped picker, including aliases.
  const create = async (name: string, type: string, aliases: string[] = []) => {
    const res = await fetch(`${baseUrl}/api/entities`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, type, aliases }) });
    assert.equal(res.status, 201);
    return await res.json() as { id: number };
  };
  const npc = await create("Zara", "npc", ["Warden"]);
  await create("Belvarin", "location");
  await create("Silver Guild", "faction");
  await page.reload();
  await page.getByRole("button", { name: "Locations", exact: true }).click();
  await page.locator(".tree").getByRole("button", { name: "Lethara", exact: true }).click();
  const picker = page.getByLabel("Related to", { exact: true });
  assert.equal(await picker.locator('optgroup[label="NPCs"]').textContent(), "Zara");
  assert.equal(await picker.locator('optgroup[label="Locations"]').textContent(), "AndorBelvarin");
  assert.equal(await picker.locator('optgroup[label="Factions"]').textContent(), "Silver Guild");
  await page.getByLabel("Search related to", { exact: true }).fill("ward");
  assert.equal(await picker.locator("optgroup option").count(), 1);
  await picker.selectOption(String(npc.id));
  await page.getByLabel("Relationship", { exact: true }).fill("secretly serves");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.locator(".rel-list").getByText("secretly serves").waitFor();
  assert.equal((await page.locator(".rel-list").innerText()).replace(/\s+/g, " ").trim(), "is inside Andor GM only ✕ secretly serves Zara GM only ✕");
  // The phrase is reusable from another entity and remains freely editable.
  await page.locator(".tree").getByRole("button", { name: "Andor", exact: true }).click();
  const labelInput = page.getByLabel("Relationship", { exact: true });
  const listId = await labelInput.getAttribute("list");
  await page.locator(`[id="${listId}"] option[value="secretly serves"]`).waitFor({ state: "attached" });
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("Inside", { exact: true }).selectOption({ label: "Lethara" });
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByText("that would put a location inside itself").waitFor();
  await nested.waitFor();
});
