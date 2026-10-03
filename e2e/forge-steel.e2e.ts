import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp, type App } from "./harness.js";
let app: App;
before(async () => { app = await startApp(); });
after(async () => { await app?.close(); });

// A 1x1 PNG, as Forge Steel stores an uploaded portrait.
const PORTRAIT = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

test("a hero imported from a Forge Steel .ds-hero file keeps its summary, portrait and link (bafft-cb6)", async () => {
  const { page, baseUrl } = app;
  const file = join(mkdtempSync(join(tmpdir(), "bafft-fs-")), "Brannoc Ashhelm.ds-hero");
  writeFileSync(file, JSON.stringify({
    id: "fs-1",
    name: "Brannoc Ashhelm",
    picture: PORTRAIT,
    folder: "",
    ancestry: { id: "ancestry-dwarf", name: "Dwarf" },
    culture: { name: "Mountain hold" },
    career: { name: "Soldier" },
    class: { name: "Fury", level: 2, subclasses: [{ name: "Berserker", selected: true }, { name: "Reaver", selected: false }] },
    complication: null,
    features: [],
  }));

  await page.getByRole("button", { name: "Characters", exact: true }).click();
  await page.getByRole("heading", { name: "New character", exact: true }).waitFor();
  await page.getByLabel(/^Import a .ds-hero file/).setInputFiles(file);
  await page.getByTestId("forge-steel-summary").getByText("Level 2 Dwarf Fury (Berserker) · with portrait").waitFor();
  assert.equal(await page.getByLabel("Name", { exact: true }).inputValue(), "Brannoc Ashhelm");
  await page.getByLabel(/^Forge Steel link/).fill("https://forgesteel.net/#/hero/view/fs-1");
  await page.getByRole("button", { name: "Save", exact: true }).click();

  await page.getByRole("heading", { name: "Brannoc Ashhelm", exact: true }).waitFor();
  const line = page.locator(".forge-steel-line");
  assert.match(await line.innerText(), /Level 2 Dwarf Fury \(Berserker\) · Soldier · Mountain hold/);
  assert.equal(await line.getByRole("link", { name: "Open in Forge Steel" }).getAttribute("href"), "https://forgesteel.net/#/hero/view/fs-1");
  const src = await page.getByAltText("Brannoc Ashhelm portrait").getAttribute("src");
  assert.match(src ?? "", /\/data\/images\/\d+\/portrait\.png/);
  assert.equal((await fetch(`${baseUrl}${src}`)).status, 200);

  // Reopening the form shows the saved link, and the profile survived the round trip.
  const heroes = (await (await fetch(`${baseUrl}/api/entities`)).json()) as { name: string; profile: { forgeSteel?: Record<string, unknown> } | null }[];
  assert.deepEqual(heroes.find((h) => h.name === "Brannoc Ashhelm")?.profile?.forgeSteel, {
    url: "https://forgesteel.net/#/hero/view/fs-1",
    ancestry: "Dwarf", className: "Fury", subclass: "Berserker", level: 2, career: "Soldier", culture: "Mountain hold",
    importedAt: (heroes.find((h) => h.name === "Brannoc Ashhelm")?.profile?.forgeSteel as { importedAt: string }).importedAt,
  });
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  assert.equal(await page.getByLabel(/^Forge Steel link/).inputValue(), "https://forgesteel.net/#/hero/view/fs-1");
});
