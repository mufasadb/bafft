import { test } from "node:test";
import assert from "node:assert/strict";
import type { TranscriptWord } from "@bafft/shared";
import { findCorrectionOccurrences } from "./correction-occurrences.js";

function words(texts: string[]): TranscriptWord[] {
  return texts.map((text, i) => ({ id: i + 1, sessionId: 1, speakerLabel: "Speaker A", text,
    startMs: i * 500, endMs: i * 500 + 400, confidence: 0.9, isUncertain: false, corrected: false, heardText: null }));
}

test("single words match case and edge punctuation, with time and surrounding words", () => {
  const transcript = words(["visit", "MISTVALE,", "then", "mistvale.", "again", "mistvales"]);
  const matches = findCorrectionOccurrences(transcript, '“Mistvale!”');
  assert.deepEqual(matches.map((m) => m.wordIds), [[2], [4]]);
  assert.equal(matches[0]!.startMs, 500);
  assert.equal(matches[0]!.heard, "MISTVALE,");
  assert.equal(matches[0]!.context, "visit MISTVALE, then mistvale. again");
});

test("multiword heard text matches adjacent runs and a single row with multiple words", () => {
  const transcript = words(["to", "Mist", "Vale,", "and", "MIST VALE.", "again"]);
  assert.deepEqual(findCorrectionOccurrences(transcript, "mist vale").map((m) => m.wordIds), [[2, 3], [5]]);
  assert.deepEqual(findCorrectionOccurrences(transcript, "mistvale").map((m) => m.wordIds), []);
});

test("already corrected words and runs containing a correction are skipped", () => {
  const transcript = words(["mist", "vale", "mist", "vale", "mist", "vale"]);
  transcript[0] = { ...transcript[0]!, corrected: true, heardText: "mist" };
  transcript[3] = { ...transcript[3]!, corrected: true, heardText: "vale" };
  assert.deepEqual(findCorrectionOccurrences(transcript, "mist vale").map((m) => m.wordIds), [[5, 6]]);
});

test("runs cannot cross a speaker change or a long pause", () => {
  const transcript = words(["mist", "vale", "mist", "vale"]);
  transcript[1] = { ...transcript[1]!, speakerLabel: "Speaker B" };
  transcript[3] = { ...transcript[3]!, startMs: 6000, endMs: 6400 };
  assert.deepEqual(findCorrectionOccurrences(transcript, "mist vale"), []);
});

test("internal punctuation stays significant; empty text and punctuation do not match", () => {
  const transcript = words(["mist-vale", "mistvale", "!!!", "O'vale"]);
  assert.deepEqual(findCorrectionOccurrences(transcript, "mist-vale").map((m) => m.wordIds), [[1]]);
  assert.deepEqual(findCorrectionOccurrences(transcript, "'o'vale,'").map((m) => m.wordIds), [[4]]);
  assert.deepEqual(findCorrectionOccurrences(transcript, "!!!"), []);
  assert.deepEqual(findCorrectionOccurrences(transcript, ""), []);
});

test("repeated multiword matches never overlap", () => {
  assert.deepEqual(findCorrectionOccurrences(words(["ha", "ha", "ha", "ha"]), "ha ha").map((m) => m.wordIds), [[1, 2], [3, 4]]);
});
