// Fixture format + scoring (bafft-wg1.4, reworked for vendor benchmarking in
// bafft-wg1.5). One fixture = a directory under data/fixtures/ containing
// expected.json, with the reference transcript in exactly one of two forms:
//
//   { "audioPath": "audio.wav",                     // relative to this fixture's own directory
//     "keyterms": ["Belvarin", "Lethara"],            // optional, defaults to []
//     "words": [ { "text": "The", "startMs": 0, "endMs": 200, "confidence": 0.98, "speakerLabel": "Speaker 1" } ] }
//
//   { "audioPath": "...", "keyterms": [...],
//     "transcript": "GM: The party enters the tavern.\nMira: I order a drink." }
//
// `transcript` is the easy one to hand-write for real clips: one "Speaker: text"
// line per turn, no timings. Speaker names only need to be consistent within a
// fixture — they're matched to the vendor's "Speaker 1"/"A" labels by best fit.
//
// audio.* itself is gitignored (see .gitignore) — expected.json is what's committed.
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import { WordSchema, type Word, type TranscriptionProvider } from "@bafft/shared";
import { findNameMatches } from "../labelling/name-matches.js";

export const FixtureManifestSchema = z
  .object({
    audioPath: z.string(),
    keyterms: z.array(z.string()).default([]),
    words: z.array(WordSchema).optional(),
    transcript: z.string().optional(),
    /** where the clip starts in its source recording ("h:mm:ss.sss"), so saved transcripts show source times */
    sourceStart: z.string().optional(),
  })
  .refine((m) => (m.words === undefined) !== (m.transcript === undefined), {
    message: "provide exactly one of words or transcript",
  });
export type FixtureManifest = z.infer<typeof FixtureManifestSchema>;

export interface Fixture {
  name: string;
  /** absolute path of the fixture directory; relative audioPaths resolve against it */
  dir: string;
  manifest: FixtureManifest;
}

/** A reference word: only text and speaker matter for scoring. */
export type RefWord = Pick<Word, "text" | "speakerLabel">;

export const CONFIDENCE_SWEEP = [0.5, 0.6, 0.7, 0.8, 0.9] as const;

export interface ConfidenceCounts {
  threshold: number;
  /** hypothesis words that are wrong (substituted or inserted) / how many of those fell below threshold */
  wrong: number;
  wrongFlagged: number;
  right: number;
  rightFlagged: number;
}

export interface FixtureResult {
  fixture: string;
  /** reference token count */
  total: number;
  correct: number;
  substitutions: number;
  deletions: number;
  insertions: number;
  /** word error rate: (S + D + I) / total */
  wer: number;
  /** max(0, 1 - wer), kept so a single headline number still reads "higher is better" */
  score: number;
  keyterms: { expected: number; found: number };
  /** over aligned word pairs, after mapping vendor speaker labels to reference speakers one-to-one by best fit */
  speakers: { compared: number; matched: number };
  confidence: ConfidenceCounts[];
  /** glossary near-match flags (bafft-wg1.15) over hypothesis tokens: on wrong words vs on right ones */
  nameFlags: { onWrong: number; onRight: number };
  diffs: string[];
}

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven",
  "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const SCALES: [number, string][] = [[1e9, "billion"], [1e6, "million"], [1e3, "thousand"], [100, "hundred"]];
const ORDINAL_OF: Record<string, string> = { one: "first", two: "second", three: "third", five: "fifth",
  eight: "eighth", nine: "ninth", twelve: "twelfth" };

/** 20 → "twenty", 1500 → "one thousand five hundred" — so "20" and "twenty" score as the same word. */
export function numberToWords(n: number): string[] {
  if (n < 20) return [ONES[n]!];
  if (n < 100) return n % 10 ? [TENS[Math.floor(n / 10)]!, ONES[n % 10]!] : [TENS[n / 10]!];
  for (const [size, name] of SCALES) {
    if (n >= size) {
      const rest = n % size;
      return [...numberToWords(Math.floor(n / size)), name, ...(rest ? numberToWords(rest) : [])];
    }
  }
  return [String(n)];
}

function ordinalWords(n: number): string[] {
  const words = numberToWords(n);
  const last = words.pop()!;
  const ordinal = ORDINAL_OF[last] ?? (last.endsWith("y") ? `${last.slice(0, -1)}ieth` : `${last}th`);
  return [...words, ordinal];
}

/**
 * Lowercases, strips punctuation (so "Tavern," and "tavern" compare equal) and
 * spells out numbers (so "20" and "twenty" do): vendors format numbers as
 * digits while human transcripts mix both.
 */
export function normalizeTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/(\d),(?=\d{3}\b)/g, "$1")
    .replace(/[^\p{L}\p{N}']+/gu, " ")
    .split(" ")
    .map((t) => t.replace(/^'+|'+$/g, ""))
    .filter(Boolean)
    .flatMap((t) => {
      const cardinal = /^\d{1,12}$/.exec(t);
      if (cardinal) return numberToWords(Number(t));
      const ordinal = /^(\d{1,12})(st|nd|rd|th)$/.exec(t);
      if (ordinal) return ordinalWords(Number(ordinal[1]));
      return [t];
    });
}

/** Parses the hand-written `transcript` form: "Speaker: text" per line, blank lines ignored. */
export function parseTranscript(transcript: string): RefWord[] {
  const words: RefWord[] = [];
  for (const [i, raw] of transcript.split("\n").entries()) {
    const line = raw.trim();
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon <= 0) throw new Error(`transcript line ${i + 1} has no "Speaker:" prefix: ${JSON.stringify(line)}`);
    const speakerLabel = line.slice(0, colon).trim();
    for (const text of line.slice(colon + 1).trim().split(/\s+/).filter(Boolean)) {
      words.push({ text, speakerLabel });
    }
  }
  return words;
}

export function referenceWords(manifest: FixtureManifest): RefWord[] {
  return manifest.words ?? parseTranscript(manifest.transcript!);
}

interface Token {
  text: string;
  speaker: string;
  confidence?: number;
  nameFlag?: boolean;
}

function tokenize(words: (RefWord & { confidence?: number })[], nameFlagged = new Set<number>()): Token[] {
  return words.flatMap((w, i) =>
    normalizeTokens(w.text).map((text) => ({
      text,
      speaker: w.speakerLabel,
      confidence: w.confidence,
      nameFlag: nameFlagged.has(i),
    })),
  );
}

type Op =
  | { kind: "ok" | "sub"; ref: Token; hyp: Token }
  | { kind: "del"; ref: Token }
  | { kind: "ins"; hyp: Token };

/** Minimum-edit-distance alignment of reference vs hypothesis tokens (Levenshtein, unit costs). */
function align(ref: Token[], hyp: Token[]): Op[] {
  const n = ref.length;
  const m = hyp.length;
  const cost = Array.from({ length: n + 1 }, (_, i) => {
    const row = new Uint32Array(m + 1);
    row[0] = i;
    return row;
  });
  for (let j = 0; j <= m; j++) cost[0]![j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const same = ref[i - 1]!.text === hyp[j - 1]!.text ? 0 : 1;
      cost[i]![j] = Math.min(cost[i - 1]![j - 1]! + same, cost[i - 1]![j]! + 1, cost[i]![j - 1]! + 1);
    }
  }
  const ops: Op[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0) {
      const same = ref[i - 1]!.text === hyp[j - 1]!.text;
      if (cost[i]![j] === cost[i - 1]![j - 1]! + (same ? 0 : 1)) {
        ops.push({ kind: same ? "ok" : "sub", ref: ref[i - 1]!, hyp: hyp[j - 1]! });
        i--;
        j--;
        continue;
      }
    }
    if (i > 0 && cost[i]![j] === cost[i - 1]![j]! + 1) {
      ops.push({ kind: "del", ref: ref[--i]! });
    } else {
      ops.push({ kind: "ins", hyp: hyp[--j]! });
    }
  }
  return ops.reverse();
}

function countOccurrences(tokens: string[], phrase: string[]): number {
  if (phrase.length === 0) return 0;
  let count = 0;
  for (let i = 0; i + phrase.length <= tokens.length; i++) {
    if (phrase.every((p, k) => tokens[i + k] === p)) count++;
  }
  return count;
}

/** Maps each hypothesis speaker to at most one reference speaker, greedily by how many aligned words they share. */
function mapSpeakers(pairs: { ref: Token; hyp: Token }[]): Map<string, string> {
  const together = new Map<string, number>();
  for (const { ref, hyp } of pairs) {
    const key = `${hyp.speaker}\u0000${ref.speaker}`;
    together.set(key, (together.get(key) ?? 0) + 1);
  }
  const mapping = new Map<string, string>();
  const usedRef = new Set<string>();
  for (const [key] of [...together].sort((a, b) => b[1] - a[1])) {
    const [hypSpeaker, refSpeaker] = key.split("\u0000") as [string, string];
    if (mapping.has(hypSpeaker) || usedRef.has(refSpeaker)) continue;
    mapping.set(hypSpeaker, refSpeaker);
    usedRef.add(refSpeaker);
  }
  return mapping;
}

const MAX_DIFFS = 50;

export function scoreWords(
  expected: RefWord[],
  actual: Word[],
  keyterms: string[] = [],
): Omit<FixtureResult, "fixture"> {
  const ref = tokenize(expected);
  // The fixture's keyterms stand in for the glossary, one entry each.
  const glossary = keyterms.map((name, i) => ({ entityId: i + 1, name, aliases: [], soundsLike: [] }));
  const hyp = tokenize(actual, new Set(findNameMatches(actual, glossary).flatMap((m) => m.wordIndices)));
  const ops = align(ref, hyp);

  const count = (kind: Op["kind"]) => ops.filter((o) => o.kind === kind).length;
  const correct = count("ok");
  const substitutions = count("sub");
  const deletions = count("del");
  const insertions = count("ins");
  const errors = substitutions + deletions + insertions;
  const total = ref.length;
  const wer = total === 0 ? (hyp.length === 0 ? 0 : 1) : errors / total;

  const refTexts = ref.map((t) => t.text);
  const hypTexts = hyp.map((t) => t.text);
  const keytermCounts = { expected: 0, found: 0 };
  for (const term of new Set(keyterms)) {
    const phrase = normalizeTokens(term);
    const inRef = countOccurrences(refTexts, phrase);
    keytermCounts.expected += inRef;
    keytermCounts.found += Math.min(inRef, countOccurrences(hypTexts, phrase));
  }

  const pairs = ops.filter((o): o is Extract<Op, { kind: "ok" | "sub" }> => o.kind === "ok" || o.kind === "sub");
  const mapping = mapSpeakers(pairs);
  const speakers = {
    compared: pairs.length,
    matched: pairs.filter((p) => mapping.get(p.hyp.speaker) === p.ref.speaker).length,
  };

  const confidence = CONFIDENCE_SWEEP.map((threshold) => {
    const c: ConfidenceCounts = { threshold, wrong: 0, wrongFlagged: 0, right: 0, rightFlagged: 0 };
    for (const op of ops) {
      if (op.kind === "del" || op.hyp.confidence === undefined) continue;
      const flagged = op.hyp.confidence < threshold;
      if (op.kind === "ok") {
        c.right++;
        if (flagged) c.rightFlagged++;
      } else {
        c.wrong++;
        if (flagged) c.wrongFlagged++;
      }
    }
    return c;
  });

  const nameFlags = { onWrong: 0, onRight: 0 };
  for (const op of ops) {
    if (op.kind === "del" || !op.hyp.nameFlag) continue;
    if (op.kind === "ok") nameFlags.onRight++;
    else nameFlags.onWrong++;
  }

  const diffs = ops
    .filter((o) => o.kind !== "ok")
    .slice(0, MAX_DIFFS)
    .map((o) =>
      o.kind === "sub"
        ? `  sub: expected ${JSON.stringify(o.ref.text)}, got ${JSON.stringify(o.hyp.text)}`
        : o.kind === "del"
          ? `  missing: ${JSON.stringify(o.ref.text)}`
          : `  extra: ${JSON.stringify(o.hyp.text)}`,
    );
  if (errors > MAX_DIFFS) diffs.push(`  … and ${errors - MAX_DIFFS} more`);

  return {
    total,
    correct,
    substitutions,
    deletions,
    insertions,
    wer,
    score: Math.max(0, 1 - wer),
    keyterms: keytermCounts,
    speakers,
    confidence,
    nameFlags,
    diffs,
  };
}

/** Loads every fixture (subdirectory containing expected.json) under `dir`. */
export async function loadFixtures(dir: string): Promise<Fixture[]> {
  let entries: string[];
  try {
    entries = await readdir(dir, { withFileTypes: true }).then((d) =>
      d.filter((e) => e.isDirectory()).map((e) => e.name),
    );
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }

  const fixtures: Fixture[] = [];
  for (const name of entries.sort()) {
    const path = join(dir, name, "expected.json");
    let raw: string;
    try {
      raw = await readFile(path, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw err;
    }
    fixtures.push({ name, dir: join(dir, name), manifest: FixtureManifestSchema.parse(JSON.parse(raw)) });
  }
  return fixtures;
}

/**
 * Transcribes and scores one fixture. `sendGlossary: false` withholds the keyterms from
 * the vendor (they're still scored), to measure how much the glossary helps.
 */
export async function runFixture(
  fixture: Fixture,
  provider: TranscriptionProvider,
  { sendGlossary = true } = {},
): Promise<FixtureResult & { words: Word[] }> {
  const { keyterms } = fixture.manifest;
  const words = await provider.transcribe(resolve(fixture.dir, fixture.manifest.audioPath), sendGlossary ? keyterms : []);
  return {
    fixture: fixture.name,
    ...scoreWords(referenceWords(fixture.manifest), words, keyterms),
    words,
  };
}

/** "h:mm:ss(.sss)" → ms; undefined → 0. */
export function parseClockMs(clock: string | undefined): number {
  if (!clock) return 0;
  return clock.split(":").reduce((acc, part) => acc * 60 + Number(part), 0) * 1000;
}

function formatClock(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Readable "[h:mm:ss] Speaker: text" transcript, one line per speaker turn, times
 * offset by `offsetMs` so they match the source recording.
 */
export function formatTranscript(words: Word[], offsetMs = 0): string {
  const lines: string[] = [];
  let speaker: string | undefined;
  let line: string[] = [];
  let start = 0;
  const flush = () => {
    if (line.length) lines.push(`[${formatClock(offsetMs + start)}] ${speaker}: ${line.join(" ")}`);
  };
  for (const w of words) {
    if (w.speakerLabel !== speaker) {
      flush();
      speaker = w.speakerLabel;
      line = [];
      start = w.startMs;
    }
    line.push(w.text);
  }
  flush();
  return lines.join("\n") + "\n";
}
