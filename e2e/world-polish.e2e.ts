import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { startApp, type App } from "./harness.js";
let app: App;
before(async () => { app = await startApp(); });
after(async () => { await app?.close(); });

test("header shows the quill; a player links to a new hero with no AI drafter (bafft-w8f.8, w8f.12)", async () => {
  const { page } = app;
  assert.equal(await page.locator(".topbar img.seal").getAttribute("src"), "/icon.png");
  await page.getByRole("button", { name: "Players", exact: true }).click();
  await page.getByRole("heading", { name: "New player", exact: true }).waitFor();
  assert.equal(await page.getByText("Draft with AI").count(), 0);
  await page.getByLabel("Name", { exact: true }).fill("Ava");
  await page.getByLabel("Hero", { exact: true }).selectOption("new");
  await page.getByLabel("New hero's name", { exact: true }).fill("Neris");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("heading", { name: "Ava", exact: true }).waitFor();
  await page.locator(".rel-list").getByText("plays").waitFor();
  assert.match((await page.locator(".rel-list").innerText()).replace(/\s+/g, " "), /plays Neris/);
});

test("locations list alphabetically, collapse, and delete from the card (bafft-w8f.6)", async () => {
  const { page, baseUrl } = app;
  const create = async (name: string) => {
    const res = await fetch(`${baseUrl}/api/entities`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, type: "location" }) });
    return (await res.json()) as { id: number };
  };
  const zolt = await create("Zolt");
  await create("Andor");
  const bow = await create("The Bow");
  await fetch(`${baseUrl}/api/entity-relationships/${bow.id}/inside`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ parentId: zolt.id }) });
  await page.reload();
  await page.getByRole("button", { name: "Locations", exact: true }).click();
  const tree = page.locator(".tree");
  await tree.getByRole("button", { name: "The Bow", exact: true }).waitFor();
  assert.deepEqual(await tree.locator("button.item").allInnerTexts(), ["Andor", "Zolt", "The Bow"]);
  assert.equal(await tree.getByRole("button", { name: /Delete/ }).count(), 0);

  // The AI box starts folded and the type reads singular.
  assert.equal(await page.locator("details.draft-box").getAttribute("open"), null);
  assert.equal(await page.locator(".form select").first().locator("option:checked").innerText(), "Location");

  await tree.getByRole("button", { name: "Collapse Zolt", exact: true }).click();
  assert.equal(await tree.getByRole("button", { name: "The Bow", exact: true }).count(), 0);
  await tree.getByRole("button", { name: "Expand Zolt", exact: true }).click();

  await tree.getByRole("button", { name: "Andor", exact: true }).click();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await tree.getByRole("button", { name: "Andor", exact: true }).waitFor({ state: "detached" });
});
