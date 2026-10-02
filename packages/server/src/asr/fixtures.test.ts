import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mockProvider, MOCK_WORDS } from "./mock-provider.js";
import { getActiveProvider } from "./providers.js";
import {
  FixtureManifestSchema,
  loadFixtures,
  normalizeTokens,
  parseTranscript,
  runFixture,
  scoreWords,
} from "./fixtures.js";
import type { Word } from "@bafft/shared";

test("mock provider returns deterministic canned words regardless of input", async () => {
  const a = await mockProvider.transcribe("anything.wav", ["ignored"]);
  const b = await mockProvider.transcribe("something-else.wav", []);
  assert.deepEqual(a, MOCK_WORDS);
  assert.deepEqual(b, MOCK_WORDS);
});

test("getActiveProvider defaults to mock and rejects unknown names", () => {
  assert.equal(getActiveProvider().name, "mock");
  assert.equal(getActiveProvider("mock").name, "mock");
  assert.throws(() => getActiveProvider("not-a-real-vendor"));
});

test("scoreWords: perfect match scores 1, mismatches are reported", () => {
  const perfect = scoreWords(MOCK_WORDS, MOCK_WORDS);
  assert.equal(perfect.score, 1);
  assert.equal(perfect.diffs.length, 0);

  const wrong = scoreWords(MOCK_WORDS, [{ ...MOCK_WORDS[0]!, text: "A" }, ...MOCK_WORDS.slice(1)]);
  assert.equal(wrong.correct, MOCK_WORDS.length - 1);
  assert.equal(wrong.diffs.length, 1);
});

test("loadFixtures + runFixture against a scratch fixture dir", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bafft-fixtures-"));
  try {
    await mkdir(join(dir, "sample"), { recursive: true });
    await writeFile(
      join(dir, "sample", "expected.json"),
      JSON.stringify({ audioPath: "x.wav", keyterms: [], words: MOCK_WORDS }),
    );

    const fixtures = await loadFixtures(dir);
    assert.equal(fixtures.length, 1);
    assert.equal(fixtures[0]!.name, "sample");

    const result = await runFixture(fixtures[0]!, mockProvider);
    assert.equal(result.score, 1);
    assert.equal(result.correct, MOCK_WORDS.length);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadFixtures returns [] for a missing directory", async () => {
  assert.deepEqual(await loadFixtures("/no/such/dir/at/all"), []);
});

test("the committed mock-smoke-test fixture scores 100% against the mock provider", async () => {
  const fixtures = await loadFixtures(new URL("../../../../data/fixtures", import.meta.url).pathname);
  const smoke = fixtures.find((f) => f.name === "mock-smoke-test");
  assert.ok(smoke, "mock-smoke-test fixture should exist");
  const result = await runFixture(smoke!, mockProvider);
  assert.equal(result.score, 1);
});

function hyp(text: string, speakerLabel = "Speaker 1", confidence = 0.95): Word[] {
  return text.split(" ").map((t, i) => ({ text: t, startMs: i * 100, endMs: i * 100 + 90, confidence, speakerLabel }));
}

test("scoreWords: one extra word costs one insertion, not every word after it", () => {
  const r = scoreWords(parseTranscript("GM: the party enters the tavern"), hyp("um the party enters the tavern"));
  assert.equal(r.correct, 5);
  assert.equal(r.insertions, 1);
  assert.equal(r.substitutions + r.deletions, 0);
  assert.equal(r.wer, 1 / 5);
});

test("scoreWords: case and punctuation don't count as errors", () => {
  const r = scoreWords(parseTranscript("GM: The party enters the tavern."), hyp("the Party, enters THE tavern"));
  assert.equal(r.wer, 0);
});

test("scoreWords: keyterm recall counts glossary-name occurrences, including multi-word ones", () => {
  const ref = parseTranscript("GM: Belvarin Vale is north of Lethara\nMira: Lethara again");
  const r = scoreWords(ref, hyp("Dairy Mvale is north of Lethara Lethara again"), ["Belvarin Vale", "Lethara"]);
  assert.deepEqual(r.keyterms, { expected: 3, found: 2 });
});

test("scoreWords: vendor speaker labels are matched to reference speakers by best fit", () => {
  const ref = parseTranscript("GM: you enter the inn\nMira: I order a drink");
  const perfect = scoreWords(ref, [...hyp("you enter the inn", "Speaker 2"), ...hyp("I order a drink", "Speaker 1")]);
  assert.deepEqual(perfect.speakers, { compared: 8, matched: 8 });

  // vendor gives "a drink" to the GM's speaker too
  const drift = scoreWords(ref, [
    ...hyp("you enter the inn", "Speaker 2"),
    ...hyp("I order", "Speaker 1"),
    ...hyp("a drink", "Speaker 2"),
  ]);
  assert.deepEqual(drift.speakers, { compared: 8, matched: 6 });
});

test("scoreWords: confidence sweep shows how many wrong words a threshold would flag", () => {
  const actual = [...hyp("the party enters the", "Speaker 1", 0.95), ...hyp("cavern", "Speaker 1", 0.4)];
  const r = scoreWords(parseTranscript("GM: the party enters the tavern"), actual);
  const at07 = r.confidence.find((c) => c.threshold === 0.7)!;
  assert.deepEqual(at07, { threshold: 0.7, wrong: 1, wrongFlagged: 1, right: 4, rightFlagged: 0 });
});

test("fixture manifests need exactly one of words or transcript", () => {
  assert.ok(FixtureManifestSchema.safeParse({ audioPath: "a.wav", transcript: "GM: hi" }).success);
  assert.ok(!FixtureManifestSchema.safeParse({ audioPath: "a.wav" }).success);
  assert.ok(!FixtureManifestSchema.safeParse({ audioPath: "a.wav", transcript: "GM: hi", words: [] }).success);
});

test("parseTranscript rejects a line with no speaker", () => {
  assert.throws(() => parseTranscript("GM: fine\nno speaker here"), /line 2/);
});

test("normalizeTokens spells out numbers so digits and words compare equal", () => {
  assert.deepEqual(normalizeTokens("That is 20."), ["that", "is", "twenty"]);
  assert.deepEqual(normalizeTokens("roll 1,500 gold, 21st time"), ["roll", "one", "thousand", "five", "hundred", "gold", "twenty", "first", "time"]);
  assert.deepEqual(normalizeTokens("the 3rd and 40th and 12th"), ["the", "third", "and", "fortieth", "and", "twelfth"]);
  assert.deepEqual(normalizeTokens("twenty-five"), normalizeTokens("25"));
  const r = scoreWords(parseTranscript("Matt: you take ten points"), hyp("You take 10 points."));
  assert.equal(r.wer, 0);
});
