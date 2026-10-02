// The core world-entry flow through the real UI (bafft-0oz), the way the
// bafft-7c9 walkthrough did it by hand: campaign settings, places, an NPC in
// the creator, and the names reaching the glossary.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { startApp, type App } from "./harness.js";

let app: App;
before(async () => {
  app = await startApp();
});
after(async () => {
  await app?.close();
});

test("campaign settings: name and game system show in the header", async () => {
  const { page } = app;
  await page.getByRole("button", { name: "Campaign", exact: true }).click();
  await page.getByLabel("Name").fill("The Amber Road");
  await page.getByLabel("Game system").selectOption({ label: "Draw Steel" });
  await page.getByRole("button", { name: "Save" }).click();
  await page.getByText("Saved", { exact: true }).waitFor();
  assert.equal(await page.locator(".topbar .campaign").innerText(), "The Amber Road");
});

test("a location can be created and opens as a card", async () => {
  const { page } = app;
  for (const name of ["Belvarin", "The keep"]) {
    await page.getByRole("button", { name: "Locations", exact: true }).click();
    await page.getByRole("button", { name: /New location/ }).click();
    await page.getByLabel("Name", { exact: true }).fill(name);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByRole("heading", { name }).waitFor();
  }
});

test("an NPC from the creator keeps its other names, pronunciation and drive (w8f.1, w8f.4)", async () => {
  const { page } = app;
  await page.getByRole("button", { name: "NPCs", exact: true }).click();
  await page.getByRole("button", { name: "New NPC" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Tavia Kelvor");
  await page.getByLabel(/^Other names/).fill("the Warden, Kelvor");
  await page.getByLabel(/^Sounds like/).fill("kel-vor");
  await page.getByLabel("Wants", { exact: true }).fill("the captain safe and the blue jewel home");
  await page.getByRole("button", { name: "Save", exact: true }).click();

  await page.getByRole("heading", { name: "Tavia Kelvor" }).waitFor();
  await page.getByText("Also called the Warden, Kelvor").waitFor();
  await page.getByText("Said like “kel-vor”").waitFor();
  await page.getByRole("heading", { name: "What drives them" }).waitFor();
  await page.getByText("the captain safe and the blue jewel home").waitFor();
});

test("the glossary lists every name and strikes out everyday-word ones (w8f.1)", async () => {
  const { page } = app;
  await page.getByRole("button", { name: "Glossary", exact: true }).click();
  assert.equal(await page.locator(".glossary-screen .hint s").innerText(), "The keep");
  const tavia = page.getByRole("row", { name: /Tavia Kelvor/ });
  await tavia.waitFor();
  assert.equal(await tavia.locator(".term.skipped").innerText(), "the Warden");
  assert.deepEqual(await tavia.locator(".term:not(.skipped)").allInnerTexts(), ["Tavia Kelvor", "Kelvor"]);
  const hold = page.getByRole("row", { name: /The keep/ });
  assert.equal(await hold.locator(".term.skipped").innerText(), "The keep");
});

test("a faction is its own kind of thing, under World (w8f.5)", async () => {
  const { page } = app;
  await page.getByRole("button", { name: "Factions", exact: true }).click();
  await page.getByRole("button", { name: /New faction/ }).click();
  await page.getByLabel("Name", { exact: true }).fill("The Copper Company");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("heading", { name: "The Copper Company" }).waitFor();
  await page.getByText(/faction/i).first().waitFor();
});

test("a location reads: physical description, notes, story relevance (w8f.16)", async () => {
  const { page } = app;
  await page.getByRole("button", { name: "Locations", exact: true }).click();
  await page.getByRole("button", { name: /New location/ }).click();
  await page.getByLabel("Name", { exact: true }).fill("The Hall of the Dawn");
  await page.getByLabel("Physical description").fill("No roof: pillars like towers, iron beams hung with banners, then stars.");
  await page.getByLabel(/^Notes/).fill("Map: dais at one end, shaft at the other.");
  await page.getByLabel("Story relevance").fill("Where the blue jewel is stolen in session 1.");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("heading", { name: "The Hall of the Dawn" }).waitFor();
  const headings = await page.locator("article h3").allInnerTexts();
  const order = ["Physical description", "Notes", "Story relevance"].map((h) =>
    headings.findIndex((x) => x.toLowerCase().startsWith(h.toLowerCase())),
  );
  assert.ok(order.every((i) => i >= 0) && order[0] < order[1] && order[1] < order[2], `card order: ${headings.join(" | ")}`);
});
