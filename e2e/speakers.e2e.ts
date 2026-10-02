// Who's talking (bafft-wg1.12), against the real server: the mock ASR
// transcript is one speaker, "Speaker 1".
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { startApp, type App } from "./harness.js";
let app: App;
before(async () => { app = await startApp(); });
after(async () => { await app?.close(); });

async function post(url: string, body: object) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  assert.ok(res.ok, `POST ${url} -> ${res.status}`);
  return (await res.json()) as { id: number };
}

test("picking a player for a speaker names their turns with their hero, and it stays after a reload", async () => {
  const { page, baseUrl } = app;
  const ava = await post(`${baseUrl}/api/entities`, { type: "player", name: "Ava" });
  const neris = await post(`${baseUrl}/api/entities`, { type: "character", name: "Neris" });
  await post(`${baseUrl}/api/entity-relationships`, { fromEntityId: ava.id, toEntityId: neris.id, description: "plays" });
  const form = new FormData();
  form.set("title", "Who's who");
  form.set("sessionDate", "2026-10-02");
  form.set("audio", new Blob([new Uint8Array(10)]), "clip.wav");
  const res = await fetch(`${baseUrl}/api/sessions`, { method: "POST", body: form });
  const session = (await res.json()) as { id: number };
  assert.ok((await fetch(`${baseUrl}/api/sessions/${session.id}/transcribe`, { method: "POST" })).ok);

  const open = async () => {
    await page.reload();
    await page.getByRole("button", { name: "Sessions", exact: true }).click();
    await page.getByRole("button", { name: "Who's who", exact: true }).click();
  };
  await open();
  await page.locator(".turn .speaker").first().click();
  const picker = page.getByRole("dialog", { name: "Who is Speaker 1?" });
  await picker.getByText("guessed from voices", { exact: false }).waitFor();
  await picker.getByRole("button", { name: "Ava", exact: true }).click();
  await picker.waitFor({ state: "detached" });
  assert.equal(await page.locator(".turn .speaker").first().innerText(), "Ava · Neris");
  assert.match(await page.locator(".speaker-chip").innerText(), /Ava · Neris$/); // after its badge initial

  await open();
  await page.locator(".turn .speaker", { hasText: "Ava · Neris" }).first().waitFor();
  // The words keep their diarisation label underneath.
  const words = (await (await fetch(`${baseUrl}/api/sessions/${session.id}/words`)).json()) as { speakerLabel: string }[];
  assert.deepEqual([...new Set(words.map((w) => w.speakerLabel))], ["Speaker 1"]);
});
