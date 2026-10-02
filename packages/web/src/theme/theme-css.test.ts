import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

// bafft-w8f.7: the labelling screen's speaker badge reused ".portrait", and
// its later rule (height 2.25rem) squashed every card's picture into a thin
// strip. One stylesheet, so a bare single-class rule must be defined once.
test("no single-class rule is defined twice at the top level of theme.css", () => {
  const css = readFileSync(join(__dirname, "theme.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const seen = new Map<string, number>();
  for (const m of css.matchAll(/^(\.[a-z][\w-]*)\s*\{/gm)) seen.set(m[1]!, (seen.get(m[1]!) ?? 0) + 1);
  const dupes = [...seen].filter(([, n]) => n > 1).map(([sel]) => sel);
  expect(dupes).toEqual([]);
});
