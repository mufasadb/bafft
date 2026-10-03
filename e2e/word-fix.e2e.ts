// Fixing words on the labelling screen (bafft-wg1.11), against the real
// server: the mock ASR transcript is "The party enters the tavern".
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { startApp, type App } from "./harness.js";
let app: App;
before(async () => { app = await startApp(); });
after(async () => { await app?.close(); });

async function json(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  assert.ok(res.ok, `${init?.method ?? "GET"} ${url} -> ${res.status}`);
  return res.json();
}

test("a fix saves at once, a known name suggests itself, an unknown one goes into the glossary", async () => {
  const { page, baseUrl } = app;
  await json(`${baseUrl}/api/entities`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "location", name: "Taverne" }),
  });
  const form = new FormData();
  form.set("title", "Fixing words");
  form.set("sessionDate", "2026-10-02");
  form.set("audio", new Blob([new Uint8Array(10)]), "clip.wav");
  const session = (await json(`${baseUrl}/api/sessions`, { method: "POST", body: form })) as { id: number };
  await json(`${baseUrl}/api/sessions/${session.id}/transcribe`, { method: "POST" });

  await page.reload();
  await page.getByRole("button", { name: "Sessions", exact: true }).click();
  await page.getByRole("button", { name: "Fixing words", exact: true }).click();

  // "tavern" is one letter off a glossary name: Check names offers it.
  await page.getByRole("button", { name: "Check names (1)", exact: true }).click();
  await page.locator(".check-row.name").click();
  const fix = page.getByRole("dialog", { name: "Fix word" });
  await fix.waitFor();
  // The suggestion is filled in: one click saves it.
  assert.equal(await fix.getByRole("textbox", { name: "Correct text" }).inputValue(), "Taverne");
  await fix.getByRole("button", { name: "Save", exact: true }).click();
  await fix.waitFor({ state: "detached" });
  const status = page.locator(".fix-notice");
  assert.match(await status.innerText(), /everyday word/);
  await page.getByRole("button", { name: "Check names (0)", exact: true }).waitFor();

  // An ordinary word, double-clicked, and a name nobody has entered.
  await page.keyboard.press("Escape");
  await page.locator(".word", { hasText: "party" }).dblclick();
  const input = fix.getByRole("textbox", { name: "Correct text" });
  await input.fill("Zarovich");
  await input.press("Enter");
  await fix.getByText("isn't in the glossary yet", { exact: false }).waitFor();
  // The select sits inside its label, so getByLabel would see the option text too.
  await fix.locator(".add-to-glossary select").first().selectOption("npc");
  await fix.getByRole("button", { name: "Add to glossary", exact: true }).click();
  await fix.waitFor({ state: "detached" });
  assert.equal(await status.innerText().then((t) => t.includes("Added Zarovich to the glossary (NPC).")), true);

  // Both fixes survive a reload, marked as corrected; no save button anywhere.
  await page.reload();
  await page.getByRole("button", { name: "Sessions", exact: true }).click();
  await page.getByRole("button", { name: "Fixing words", exact: true }).click();
  await page.locator(".word.corrected").first().waitFor();
  assert.deepEqual(
    (await page.locator(".word").allInnerTexts()).map((t) => t.trim()),
    ["The", "Zarovich", "enters", "the", "Taverne"],
  );
  assert.equal(await page.locator(".word.corrected").count(), 2);
  assert.equal(await page.getByRole("button", { name: /^save/i }).count(), 0);

  const entities = (await json(`${baseUrl}/api/entities`)) as { name: string; type: string; soundsLike: string[] }[];
  assert.deepEqual(
    entities.map((e) => [e.name, e.type, e.soundsLike]),
    [["Taverne", "location", []], ["Zarovich", "npc", []]],
  );
});

test("a fix offers other occurrences, applies the selected correction and persists both", async () => {
  const { page, baseUrl } = app;
  const form = new FormData();
  form.set("title", "Repeated words");
  form.set("sessionDate", "2026-10-03");
  form.set("audio", new Blob([new Uint8Array(10)]), "clip.wav");
  const session = (await json(`${baseUrl}/api/sessions`, { method: "POST", body: form })) as { id: number };
  await json(`${baseUrl}/api/sessions/${session.id}/transcribe`, { method: "POST" });
  await page.reload();
  await page.getByRole("button", { name: "Sessions", exact: true }).click();
  await page.getByRole("button", { name: "Repeated words", exact: true }).click();
  await page.locator(".word").first().dblclick();
  const fix = page.getByRole("dialog", { name: "Fix word" });
  await fix.getByRole("textbox", { name: "Correct text" }).fill("thee");
  await fix.getByRole("button", { name: "Save", exact: true }).click();
  await fix.waitFor({ state: "detached" });
  const offer = page.getByRole("region", { name: "Other occurrences" });
  await offer.waitFor();
  assert.match(await offer.innerText(), /Also fix 1 other/);
  const checkbox = offer.getByRole("checkbox");
  assert.equal(await checkbox.isChecked(), true);
  assert.match(await offer.innerText(), /party enters the tavern/);
  await checkbox.uncheck();
  assert.equal(await offer.getByRole("button", { name: "Apply", exact: true }).isDisabled(), true);
  await checkbox.check();
  await offer.getByRole("button", { name: "Apply", exact: true }).click();
  await offer.waitFor({ state: "detached" });
  await page.reload();
  await page.getByRole("button", { name: "Sessions", exact: true }).click();
  await page.getByRole("button", { name: "Repeated words", exact: true }).click();
  await page.locator(".word.corrected").first().waitFor();
  assert.deepEqual((await page.locator(".word").allInnerTexts()).map((t) => t.trim()), ["thee", "party", "enters", "thee", "tavern"]);
  assert.equal(await page.locator(".word.corrected").count(), 2);
  const stored = await json(`${baseUrl}/api/sessions/${session.id}/words`) as { heardText: string | null }[];
  assert.equal(stored[0]!.heardText, "The");
  assert.equal(stored[3]!.heardText, "the");
});
