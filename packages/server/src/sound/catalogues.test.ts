import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { clockToMs, parseIncompetech, parseTabletopAudio, searchCatalogue } from "./catalogues.js";

const fixture = (name: string) => JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", name), "utf8"));
const tta = parseTabletopAudio(fixture("tta_data.json"));
const inc = parseIncompetech(fixture("incompetech-pieces.json"));

test("Tabletop Audio tracks: ambience, genre and tags merged, CC BY-NC-ND credit", () => {
  const festival = tta.find((t) => t.title === "Village Festival")!;
  assert.equal(festival.source, "tabletop-audio");
  assert.equal(festival.category, "ambience");
  assert.match(festival.previewUrl, /^https:\/\/sounds\.tabletopaudio\.com\/.+\.mp3$/);
  assert.ok(festival.tags.includes("fantasy"));
  assert.equal(festival.licence, "CC BY-NC-ND 4.0");
  assert.match(festival.attribution, /Village Festival.*Tabletop Audio/);
});

test("Incompetech pieces: music, feel as tags, length, the credit line they ask for", () => {
  const britons = inc.find((t) => t.title === "The Britons")!;
  assert.deepEqual(
    [britons.category, britons.tags, britons.durationMs, britons.sourceId],
    ["music", ["Ren Faire", "Medieval"], 307_000, "The Britons.mp3"],
  );
  assert.equal(britons.previewUrl, "https://incompetech.com/music/royalty-free/mp3-royaltyfree/The%20Britons.mp3");
  assert.match(britons.attribution, /Kevin MacLeod \(incompetech\.com\) Licensed under Creative Commons: By Attribution 4\.0/);
});

test("search needs every word, and ranks title over tag over description", () => {
  const all = [...tta, ...inc];
  assert.deepEqual(searchCatalogue(all, "dwarven").map((t) => t.title), ["Dwarven City"]);
  assert.deepEqual(searchCatalogue(all, "epic somber").map((t) => t.title).sort(), ["Crusade - Heavy Industry", "The Ice Giants"]);
  assert.deepEqual(searchCatalogue(all, "dwarven lighthouse"), []);
  assert.equal(searchCatalogue(all, "").length, all.length);
});

test("clock lengths", () => {
  assert.equal(clockToMs("00:09:17"), 557_000);
  assert.equal(clockToMs(undefined), null);
});
