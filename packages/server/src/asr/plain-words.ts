import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

// Names made only of everyday English words ("The keep", "The Hall of the
// Dawn") gain nothing as ASR keyterms: the vendor already writes them
// correctly, and every extra keyterm dilutes the ones that matter
// (Vellrune, Kelvor). bafft-w8f.1.
//
// "Everyday" = SCOWL frequency levels 10-35 (~38k words, inflections
// included), from wordlist-english. Level 40+ is left out on purpose: it
// holds rarer words that are also fantasy names (fjord, pip, moira).
const LEVELS = [10, 20, 35];

let common: Set<string> | undefined;

function commonWords(): Set<string> {
  if (!common) {
    const dir = dirname(createRequire(import.meta.url).resolve("wordlist-english/package.json"));
    common = new Set(
      LEVELS.flatMap((l) => JSON.parse(readFileSync(join(dir, `english-words-${l}.json`), "utf8")) as string[]),
    );
  }
  return common;
}

/** True when every word in the name is an everyday English word. */
export function isPlainPhrase(term: string): boolean {
  const words = term
    .toLowerCase()
    .replace(/['’]s\b/g, "")
    .split(/[^a-z]+/)
    .filter(Boolean);
  if (words.length === 0) return false;
  const words_ = commonWords();
  return words.every((w) => words_.has(w));
}
