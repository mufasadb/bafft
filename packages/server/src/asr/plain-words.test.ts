import { test } from "node:test";
import assert from "node:assert/strict";
import { isPlainPhrase } from "./plain-words.js";

test("names made of everyday words are plain (bafft-w8f.1)", () => {
  for (const t of ["The keep", "The market square", "The Hall of the Dawn", "The guide", "The Copper Company", "The mines", "The Silver Circle"])
    assert.equal(isPlainPhrase(t), true, t);
});

test("anything with an invented or rare word is not plain", () => {
  for (const t of ["Orven Vellrune", "Tavia Kelvor", "Zevra", "Big Zavra", "The Velnor's Gate", "Orlaven", "Old Man Veltrin", "Fjord", "Pip"])
    assert.equal(isPlainPhrase(t), false, t);
});

test("empty or symbol-only terms are not plain", () => {
  assert.equal(isPlainPhrase(""), false);
  assert.equal(isPlainPhrase("--"), false);
});
