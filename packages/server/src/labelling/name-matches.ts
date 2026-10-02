// "Possible names" for the labelling screen (bafft-wg1.15). ASR confidence
// barely catches a misheard glossary name (fixtures, 2026-09-29: glossary on,
// 1 of 8 misheard names under 0.7; "Hupperdook" -> "duke" at 0.99), but the
// near-misses it does produce ("hupperduke", "silverquell", "barelbin") are
// close to a glossary spelling in letters or in sound. This flags those, with
// the name they probably meant.
//
// Computed on read against the current glossary, so adding a name later also
// flags transcripts that already exist. Real-word substitutions ("acid" for
// "Yasha") are out of reach unless the owner has added that as a sounds-like hint.
import { doubleMetaphone } from "double-metaphone";

export interface GlossaryName {
  entityId: number;
  name: string;
  aliases: string[];
  soundsLike: string[];
}

export interface NameMatch {
  /** Indices into the words passed in: one word, or two adjacent ("hupper duke"). */
  wordIndices: number[];
  heard: string;
  entityId: number;
  /** The glossary name to suggest. */
  suggestion: string;
  via: "spelling" | "sound" | "sounds-like";
}

// Tuned on the fixture dumps (bafft-wg1.15). By spelling, 0.75 keeps
// "nogvuro"/"silverquell" and loses ordinary words.
const MIN_SPELLING = 0.75;
// By sound, short codes collide with everyday words ("don't" TNT vs Trent
// TRNT, "turn yet" TRNT exactly), and near-identical codes still let in
// "your cart" (ARKRT) for Beauregard (PRKRT). So a sound match needs the same
// code, 5+ letters long ("barelbin"/Berleben are both PRLPN, "Hooper Duke"/
// Hupperdook both HPRTK), and a passing resemblance in spelling.
const MIN_SOUND_CODE = 5;
const MIN_SPELLING_FOR_SOUND = 0.4;
// Short names collide with everyday words by sound (Nott/"not", Kiri/"carry"),
// so a glossary word needs this many letters before fuzzy matching applies.
const MIN_FUZZY_LENGTH = 5;

// Lowercase, punctuation off, and a possessive dropped ("Fjord's" is Fjord, heard right).
const normalize = (s: string) =>
  s.toLowerCase().replace(/[^\p{L}\p{N}' -]/gu, "").replace(/'s\b/g, "").replace(/'/g, "").trim();

// Reused across calls: a full session runs this hundreds of thousands of times.
let prevRow = new Uint16Array(64);
let curRow = new Uint16Array(64);

/** Edit distance, or anything over `max` as soon as it's certain to exceed it. */
function levenshtein(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  if (b.length + 1 > prevRow.length) {
    prevRow = new Uint16Array(b.length + 1);
    curRow = new Uint16Array(b.length + 1);
  }
  for (let j = 0; j <= b.length; j++) prevRow[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curRow[0] = i;
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prevRow[j - 1]! + (a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1), prevRow[j]! + 1, curRow[j - 1]! + 1);
      curRow[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    [prevRow, curRow] = [curRow, prevRow];
  }
  return prevRow[b.length]!;
}

/** Similarity in [0, 1], or 0 when it's below `min` (which lets the edit distance stop early). */
function similarity(a: string, b: string, min: number): number {
  const longest = Math.max(a.length, b.length);
  const edits = levenshtein(a, b, Math.floor((1 - min) * longest));
  const sim = 1 - edits / longest;
  return sim >= min ? sim : 0;
}

interface Target {
  entityId: number;
  suggestion: string;
  /** One glossary word, lowercased, e.g. "silberquel" from "Silberquel Ridge". */
  word: string;
  sound: string;
}

interface Targets {
  /**
   * Fuzzy targets by the first letter of their sound code, so K/C/Q-initial
   * words share a bucket, as do all vowel-initial ones. A misheard name keeps
   * its first sound in every fixture case ("Barelbin", "Silverquell",
   * "Hooper Duke"), and this cuts the comparisons per word ~15x.
   */
  fuzzy: Map<string, Target[]>;
  /** Fuzzy targets by sound code, for the exact-code sound match. */
  bySound: Map<string, Target[]>;
  exact: Set<string>;
  hints: Map<string, GlossaryName>;
}

function targets(glossary: GlossaryName[]): Targets {
  const fuzzy = new Map<string, Target[]>();
  const bySound = new Map<string, Target[]>();
  const exact = new Set<string>();
  const hints = new Map<string, GlossaryName>();
  for (const entry of glossary) {
    for (const spelling of [entry.name, ...entry.aliases]) {
      // Per word, suggesting "Silberquel" (not "Silberquel Ridge") for "silverquell".
      for (const piece of spelling.split(/\s+/)) {
        const word = normalize(piece);
        if (!word) continue;
        exact.add(word);
        if (word.length >= MIN_FUZZY_LENGTH) {
          const target = { entityId: entry.entityId, suggestion: piece, word, sound: doubleMetaphone(word)[0] };
          fuzzy.set(target.sound[0] ?? "", [...(fuzzy.get(target.sound[0] ?? "") ?? []), target]);
          bySound.set(target.sound, [...(bySound.get(target.sound) ?? []), target]);
        }
      }
    }
    for (const hint of entry.soundsLike) {
      const key = normalize(hint);
      if (key) hints.set(key, entry);
    }
  }
  return { fuzzy, bySound, exact, hints };
}

function bestFuzzy(heard: string, { fuzzy, bySound }: Targets): { target: Target; via: "spelling" | "sound" } | null {
  if (heard.length < MIN_FUZZY_LENGTH - 1) return null;
  const sound = doubleMetaphone(heard)[0];
  let best: { target: Target; via: "spelling" | "sound"; score: number } | null = null;
  for (const target of fuzzy.get(sound[0] ?? "") ?? []) {
    const score = similarity(heard, target.word, MIN_SPELLING);
    if (score > 0 && (!best || score > best.score)) best = { target, via: "spelling", score };
  }
  if (best) return best;
  if (sound.length < MIN_SOUND_CODE) return null;
  for (const target of bySound.get(sound) ?? []) {
    const score = similarity(heard, target.word, MIN_SPELLING_FOR_SOUND);
    if (score > 0 && (!best || score > best.score)) best = { target, via: "sound", score };
  }
  return best;
}

export function findNameMatches(words: { text: string }[], glossary: GlossaryName[]): NameMatch[] {
  const glossaryTargets = targets(glossary);
  const { exact, hints } = glossaryTargets;
  const texts = words.map((w) => normalize(w.text));
  // A 4-hour session is ~40k words but only a few thousand distinct ones.
  const cache = new Map<string, ReturnType<typeof bestFuzzy>>();
  const near = (heard: string) => {
    if (!cache.has(heard)) cache.set(heard, bestFuzzy(heard, glossaryTargets));
    return cache.get(heard)!;
  };
  const matches: NameMatch[] = [];
  for (let i = 0; i < texts.length; i++) {
    const one = texts[i]!;
    if (!one) continue;
    const two = i + 1 < texts.length && texts[i + 1] ? `${one} ${texts[i + 1]}` : null;

    // The owner's own sounds-like hints win: they name exactly what the ASR
    // tends to write instead, real words included.
    const hinted = (two && hints.get(two) && ([i, i + 1] as const)) || (hints.get(one) && ([i] as const));
    if (hinted) {
      const entry = hints.get(hinted.length === 2 ? two! : one)!;
      matches.push({
        wordIndices: [...hinted],
        heard: hinted.map((k) => words[k]!.text).join(" "),
        entityId: entry.entityId,
        suggestion: entry.name,
        via: "sounds-like",
      });
      i += hinted.length - 1;
      continue;
    }
    if (exact.has(one)) continue;

    // A name split in two ("hupper duke") is checked joined up first.
    // Only when neither word is a name on its own, so "by Hupperduke" flags
    // just "Hupperduke".
    const next = texts[i + 1];
    if (two && next && !exact.has(next) && near(one) === null && near(next) === null) {
      const joined = near(two.replace(" ", ""));
      if (joined) {
        matches.push({
          wordIndices: [i, i + 1],
          heard: `${words[i]!.text} ${words[i + 1]!.text}`,
          entityId: joined.target.entityId,
          suggestion: joined.target.suggestion,
          via: joined.via,
        });
        i++;
        continue;
      }
    }
    const single = near(one);
    if (single) {
      matches.push({
        wordIndices: [i],
        heard: words[i]!.text,
        entityId: single.target.entityId,
        suggestion: single.target.suggestion,
        via: single.via,
      });
    }
  }
  return matches;
}
