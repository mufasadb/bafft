// CLI: runs a TranscriptionProvider against every fixture in data/fixtures/
// and prints WER, glossary-term recall, speaker attribution and how well
// confidence separates right from wrong words. `npm run fixtures:run`
// (optionally `-- --provider <name>`, `-- --diffs` for per-word errors,
// `-- --no-glossary` to withhold the keyterms, `-- --save` to write each readable
// transcript to <fixture>/transcripts/<provider>.txt).
// This is what wg1.5 (ASR vendor research) scores candidates with.
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

// Vendor keys live in the repo-root .env, same as the server (see index.ts).
try {
  process.loadEnvFile(resolve(import.meta.dirname, "../../../../.env"));
} catch {
  // no .env: only the mock provider will work
}

// Dynamic so they read the environment after .env is loaded.
const { config } = await import("../config.js");
const { getActiveProvider } = await import("./providers.js");
const { CONFIDENCE_SWEEP, formatTranscript, loadFixtures, parseClockMs, runFixture } = await import("./fixtures.js");
type FixtureResult = import("./fixtures.js").FixtureResult;

const argValue = (flag: string) => {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
};
const providerName = argValue("--provider");
const showDiffs = process.argv.includes("--diffs");
const sendGlossary = !process.argv.includes("--no-glossary");
const save = process.argv.includes("--save");

const fixturesDir = resolve(config.dataDir, "fixtures");
const fixtures = await loadFixtures(fixturesDir);

if (fixtures.length === 0) {
  console.log(`No fixtures found under ${fixturesDir} (each needs a <name>/expected.json).`);
  process.exit(0);
}

const provider = getActiveProvider(providerName);
console.log(`Provider: ${provider.name}${sendGlossary ? "" : " (glossary withheld)"}\n`);

const pct = (n: number, d: number) => (d === 0 ? "n/a" : `${((n / d) * 100).toFixed(1)}%`);

function report(label: string, r: Omit<FixtureResult, "fixture" | "diffs" | "score">) {
  console.log(`${label}`);
  console.log(
    `  WER ${pct(r.substitutions + r.deletions + r.insertions, r.total)} ` +
      `(${r.substitutions} sub, ${r.deletions} missing, ${r.insertions} extra, of ${r.total} words)`,
  );
  console.log(`  glossary terms heard: ${r.keyterms.found}/${r.keyterms.expected} (${pct(r.keyterms.found, r.keyterms.expected)})`);
  console.log(`  speaker attribution: ${pct(r.speakers.matched, r.speakers.compared)} of aligned words`);
  console.log(
    `  possible-name flags: ${r.nameFlags.onWrong + r.nameFlags.onRight} ` +
      `(${r.nameFlags.onWrong} on misheard words, ${r.nameFlags.onRight} on words heard right)`,
  );
  const withConfidence = r.confidence.filter((c) => c.wrong + c.right > 0);
  if (withConfidence.length > 0) {
    console.log("  confidence threshold → share of wrong words flagged / share of right words flagged:");
    for (const c of withConfidence) {
      console.log(`    < ${c.threshold}: ${pct(c.wrongFlagged, c.wrong)} / ${pct(c.rightFlagged, c.right)}`);
    }
  }
}

const results: FixtureResult[] = [];
for (const fixture of fixtures) {
  if (provider.name !== "mock" && !existsSync(resolve(fixture.dir, fixture.manifest.audioPath))) {
    console.log(`${fixture.name}: skipped (no audio file)\n`);
    continue;
  }
  const result = await runFixture(fixture, provider, { sendGlossary });
  results.push(result);
  if (save) {
    const outDir = join(fixture.dir, "transcripts");
    await mkdir(outDir, { recursive: true });
    const file = join(outDir, `${provider.name}${sendGlossary ? "" : "-no-glossary"}.txt`);
    await writeFile(file, formatTranscript(result.words, parseClockMs(fixture.manifest.sourceStart)));
    console.log(`  saved ${file}`);
  }
  report(fixture.name, result);
  if (showDiffs) for (const diff of result.diffs) console.log(diff);
  console.log();
}

if (results.length > 1) {
  const sum = (f: (r: FixtureResult) => number) => results.reduce((a, r) => a + f(r), 0);
  report("OVERALL", {
    total: sum((r) => r.total),
    correct: sum((r) => r.correct),
    substitutions: sum((r) => r.substitutions),
    deletions: sum((r) => r.deletions),
    insertions: sum((r) => r.insertions),
    wer: 0,
    keyterms: { expected: sum((r) => r.keyterms.expected), found: sum((r) => r.keyterms.found) },
    speakers: { compared: sum((r) => r.speakers.compared), matched: sum((r) => r.speakers.matched) },
    confidence: CONFIDENCE_SWEEP.map((threshold, i) => ({
      threshold,
      wrong: sum((r) => r.confidence[i]!.wrong),
      wrongFlagged: sum((r) => r.confidence[i]!.wrongFlagged),
      right: sum((r) => r.confidence[i]!.right),
      rightFlagged: sum((r) => r.confidence[i]!.rightFlagged),
    })),
    nameFlags: { onWrong: sum((r) => r.nameFlags.onWrong), onRight: sum((r) => r.nameFlags.onRight) },
  });
}
