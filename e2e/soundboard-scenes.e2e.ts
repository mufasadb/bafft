import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { startApp, type App } from "./harness.js";

let app: App;
before(async () => { app = await startApp(); });
after(async () => { await app?.close(); });

test("soundboard scenes can be selected, ordered, linked to locations, and restored after reload (w8f.9)", async () => {
  const { page, baseUrl } = app;
  async function post(path: string, body: unknown) {
    const response = await fetch(baseUrl + '/api' + path, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    assert.equal(response.status, 201);
    return response.json() as Promise<{ id: number }>;
  }
  await page.getByRole('button', { name: 'Soundboard', exact: true }).click();
  await page.getByPlaceholder('Name your first board, e.g. The Amber Road — Act 1', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'NPCs', exact: true }).click();
  await post('/entities', { name: 'Tower', type: 'location' });
  const board = await post('/soundboards', { name: 'Scenes browser test' });
  const wav = Buffer.alloc(844);
  wav.write('RIFF'); wav.writeUInt32LE(836, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(800, 40);
  async function upload(name: string) {
    const form = new FormData();
    form.set('audio', new Blob([wav]), name);
    const uploaded = await fetch(baseUrl + '/api/sound-assets', { method: 'POST', body: form });
    assert.equal(uploaded.status, 201);
    return await uploaded.json() as { id: number };
  }
  const asset = await upload('Bell.wav');
  await upload('Gong.wav');
  await post('/soundboards/' + board.id + '/clips', { assetId: asset.id, group: 'The Keep' });
  await post('/soundboards/' + board.id + '/clips', { assetId: asset.id, group: 'The Riot', name: 'Second bell' });
  // Refresh the board list after seeding through the API: it was loaded
  // when checking the empty-board placeholder above.
  await page.reload();
  const scenes = page.locator('.scene h3');
  await page.getByRole('button', { name: 'Soundboard', exact: true }).click();
  await page.getByRole('button', { name: 'Edit board', exact: true }).click();
  // A sound already on the board can't be added again (bafft-c4d.10).
  const bellRow = page.locator('.picker-results li').filter({ hasText: 'Bell' });
  await bellRow.getByText('On this board').waitFor();
  assert.equal(await bellRow.getByRole('button').count(), 0);
  assert.equal(await page.getByRole('button', { name: /Done editing/ }).count(), 2);
  await page.getByLabel('The Keep location').selectOption({ label: 'Tower' });
  await page.getByText('Location: Tower').waitFor();
  await page.getByLabel('Move The Riot up', { exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.scene h3')?.textContent === 'The Riot');
  await page.getByLabel('Scene to add into').selectOption('__new__');
  await page.getByLabel('New scene name').fill('The Finale');
  await page.getByRole('button', { name: 'Create scene', exact: true }).click();
  await page.getByRole('heading', { name: 'The Finale', exact: true }).waitFor();
  await page.locator('.picker-results li').filter({ hasText: 'Gong' }).getByRole('button', { name: 'Add' }).click();
  const finale = page.locator('.scene').filter({ has: page.getByRole('heading', { name: 'The Finale', exact: true }) });
  await finale.locator('.clip').waitFor();
  await page.reload();
  await page.getByRole('button', { name: 'Soundboard', exact: true }).click();
  await page.getByRole('heading', { name: 'The Finale', exact: true }).waitFor();
  assert.deepEqual(await scenes.allTextContents(), ['The Riot', 'The Keep', 'The Finale']);
  assert.equal(await finale.locator('.clip-name').textContent(), 'Gong');
  await page.getByText('Location: Tower').waitFor();
  assert.equal(await page.locator('.scene-groups').evaluate((e) => getComputedStyle(e).gridTemplateColumns.split(' ').length), 2); // two scenes a row (bafft-c4d.12)

  // ⋯ › Copy to puts a second copy in another scene, and it survives a reload (bafft-c4d.11).
  await finale.getByRole('button', { name: 'More for Gong' }).click();
  await page.getByRole('menu', { name: 'Gong actions' }).getByRole('menuitem', { name: 'The Keep', exact: true }).click();
  const hold = page.locator('.scene').filter({ has: page.getByRole('heading', { name: 'The Keep', exact: true }) });
  await hold.locator('.clip-name', { hasText: 'Gong' }).waitFor();
  await page.reload();
  await page.getByRole('button', { name: 'Soundboard', exact: true }).click();
  await hold.locator('.clip-name', { hasText: 'Gong' }).waitFor();
  assert.equal(await finale.locator('.clip-name', { hasText: 'Gong' }).count(), 1);
});

test("board tiles are equal, with play then loop on the left; Now Playing says how it plays; the library folds away (bafft-c4d.10)", async () => {
  const { page } = app;
  await page.reload();
  await page.getByRole('button', { name: 'Soundboard', exact: true }).click();
  const tiles = page.locator('.clip');
  await tiles.first().waitFor();
  const widths = new Set(await tiles.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().width))));
  assert.equal(widths.size, 1, `tiles differ in width: ${[...widths]}`);
  const first = tiles.first();
  const order = await first.evaluate((e) => [...e.children].map((c) => c.className));
  assert.deepEqual(order.slice(0, 3), ['clip-main', 'loop-toggle', 'clip-name']);

  const play = first.locator('.clip-main');
  await play.waitFor();
  await page.waitForFunction(() => !(document.querySelector('.clip-main') as HTMLButtonElement).disabled);
  // The test clip is 50ms: loop it so it's still playing when we look.
  const loop = first.locator('.loop-toggle');
  if ((await loop.getAttribute('aria-pressed')) !== 'true') await loop.click();
  await play.click();
  const strip = page.getByRole('region', { name: 'Now playing' });
  await strip.locator('.play-mode').getByText('Looping').waitFor();
  await page.getByRole('button', { name: /Stop all/ }).click();
  // Editing on the MacBook screen mustn't push the page sideways (bafft-c4d.12).
  await page.getByRole('button', { name: 'Edit board', exact: true }).click();
  await page.locator('.clip-settings').first().waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await page.getByRole('button', { name: /Done editing/ }).first().click();

  await page.getByRole('tab', { name: /Library/ }).click();
  await page.getByRole('tab', { name: 'Your library', exact: true }).waitFor();
  assert.equal(await page.locator('details.upload-sounds').getAttribute('open'), null);
  await page.getByRole('tab', { name: 'Find more', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Search for more sounds' }).waitFor();
  await page.getByRole('combobox', { name: 'Kind' }).waitFor();
});
