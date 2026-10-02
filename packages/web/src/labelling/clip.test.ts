import { expect, test } from "vitest";
import { clipWindow, wordIndexAt } from "./clip.js";

test("a clip starts a little before the word and runs a few seconds", () => {
  expect(clipWindow(10_000, 500, 4000)).toEqual({ fromSec: 9.5, toSec: 13.5 });
});

test("a clip for the very first word doesn't go below zero", () => {
  expect(clipWindow(200, 500, 4000)).toEqual({ fromSec: 0, toSec: 4 });
});

test("wordIndexAt finds the word being spoken", () => {
  const starts = [0, 300, 900, 5000];
  expect(wordIndexAt(starts, 0)).toBe(0);
  expect(wordIndexAt(starts, 899)).toBe(1);
  expect(wordIndexAt(starts, 900)).toBe(2);
  expect(wordIndexAt(starts, 99_999)).toBe(3);
  expect(wordIndexAt([100], 50)).toBe(-1);
  expect(wordIndexAt([], 50)).toBe(-1);
});
