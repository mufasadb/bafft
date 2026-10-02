import { expect, test } from "vitest";
import type { TranscriptWord } from "@bafft/shared";
import { formatClock, groupTurns } from "./turns.js";

let nextId = 1;
function word(speakerLabel: string, startMs: number, text = "w"): TranscriptWord {
  return {
    id: nextId++, sessionId: 1, speakerLabel, text, startMs, endMs: startMs + 300,
    confidence: 0.9, isUncertain: false, corrected: false, heardText: null,
  };
}

test("consecutive words from one speaker form one turn; a speaker change starts a new one", () => {
  const turns = groupTurns([word("A", 0), word("A", 400), word("B", 800), word("A", 1200)]);
  expect(turns.map((t) => [t.speakerLabel, t.words.length])).toEqual([["A", 2], ["B", 1], ["A", 1]]);
  expect(turns[1]!.startMs).toBe(800);
});

test("a long pause inside one speaker's run starts a new turn", () => {
  const turns = groupTurns([word("A", 0), word("A", 400), word("A", 10_000)], 4000);
  expect(turns.map((t) => t.words.length)).toEqual([2, 1]);
});

test("turn keys are the first word's id, so they stay stable", () => {
  const words = [word("A", 0), word("B", 400)];
  expect(groupTurns(words).map((t) => t.key)).toEqual([words[0]!.id, words[1]!.id]);
});

test("no words, no turns", () => {
  expect(groupTurns([])).toEqual([]);
});

test("formatClock", () => {
  expect(formatClock(0)).toBe("0:00:00");
  expect(formatClock(9_494_000)).toBe("2:38:14");
});
