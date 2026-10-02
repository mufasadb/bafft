import { test } from "node:test";
import assert from "node:assert/strict";
import { findNameMatches, type GlossaryName } from "./name-matches.js";

const glossary: GlossaryName[] = [
  { entityId: 1, name: "Hupperdook", aliases: [], soundsLike: [] },
  { entityId: 2, name: "Silberquel Ridge", aliases: [], soundsLike: [] },
  { entityId: 3, name: "Berleben", aliases: [], soundsLike: [] },
  { entityId: 4, name: "Trent Ikithon", aliases: ["Trent"], soundsLike: [] },
  { entityId: 5, name: "Yasha", aliases: [], soundsLike: ["the acid"] },
  { entityId: 6, name: "Beauregard", aliases: ["Beau"], soundsLike: [] },
];
const words = (text: string) => text.split(" ").map((t) => ({ text: t }));
const found = (text: string) =>
  findNameMatches(words(text), glossary).map((m) => `${m.heard} -> ${m.suggestion} (${m.via})`);

// All of these came out of AssemblyAI on the Critical Role fixtures, glossary withheld.
test("flags near-miss spellings with the name they probably meant", () => {
  assert.deepEqual(found("the Silverquell ridge"), ["Silverquell -> Silberquel (spelling)"]);
  assert.deepEqual(found("we go to Hupperduke."), ["Hupperduke. -> Hupperdook (sound)"]);
  assert.deepEqual(found("exiting Barelbin, leaving"), ["Barelbin, -> Berleben (sound)"]);
});

test("a name split over two words is flagged as one match", () => {
  const [m] = findNameMatches(words("through Hooper Duke. There"), glossary);
  assert.deepEqual(m?.wordIndices, [1, 2]);
  assert.equal(m?.suggestion, "Hupperdook");
});

test("the joined check doesn't swallow a neighbouring word", () => {
  assert.deepEqual(found("by Hupperduke."), ["Hupperduke. -> Hupperdook (sound)"]);
});

test("names heard right, including possessives, are not flagged", () => {
  assert.deepEqual(found("Hupperdook and Berleben and Trent's tower"), []);
});

test("ordinary words that merely sound close are not flagged", () => {
  // Each of these matched a name under looser rules on the fixtures.
  assert.deepEqual(found("don't go around your cart, it's different, turn yet, I'll cast"), []);
});

test("a sounds-like hint flags the exact phrase, even when it's real words", () => {
  assert.deepEqual(found("the acid was surprisingly effective"), ["the acid -> Yasha (sounds-like)"]);
});

test("short names are never fuzzy-matched", () => {
  // "Beau" (4 letters) vs "bow": too many everyday collisions to be useful.
  assert.deepEqual(found("take a bow"), []);
});
