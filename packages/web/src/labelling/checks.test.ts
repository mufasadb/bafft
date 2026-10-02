import { expect, test } from "vitest";
import type { TranscriptWord } from "@bafft/shared";
import { buildChecks } from "./checks.js";

const w = (id: number, text: string, isUncertain = false): TranscriptWord => ({
  id, sessionId: 1, speakerLabel: "Speaker A", text, startMs: id * 1000, endMs: id * 1000 + 500,
  confidence: isUncertain ? 0.3 : 0.95, isUncertain, corrected: false, heardText: null,
});

test("lists name matches and very low confidence words in time order, with context", () => {
  const words = [w(1, "we"), w(2, "go"), w(3, "umm", true), w(4, "through"), w(5, "Hooper"), w(6, "Duke."), w(7, "today")];
  const checks = buildChecks(words, [
    { wordIds: [5, 6], heard: "Hooper Duke.", entityId: 9, suggestion: "Hupperdook", via: "sound" },
  ]);
  expect(checks).toEqual([
    { kind: "low-confidence", wordId: 3, startMs: 3000, heard: "umm", before: "we go", after: "through Hooper Duke. today" },
    { kind: "name", wordId: 5, startMs: 5000, heard: "Hooper Duke.", suggestion: "Hupperdook", before: "we go umm through", after: "today" },
  ]);
});

test("a word that's both a possible name and low confidence is listed once, as a name", () => {
  const checks = buildChecks([w(1, "Barelbin", true)], [
    { wordIds: [1], heard: "Barelbin", entityId: 2, suggestion: "Berleben", via: "sound" },
  ]);
  expect(checks.map((c) => c.kind)).toEqual(["name"]);
});

test("corrected words drop out of the low confidence list", () => {
  expect(buildChecks([{ ...w(1, "umm", true), corrected: true }], [])).toEqual([]);
});
