// What a labelling correction means for the glossary (bafft-wg1.11). Fixing
// "Hooper Duke" to Hupperdook teaches the glossary that Hupperdook gets heard
// as "Hooper Duke" (a sounds-like hint, so other sessions flag it); fixing
// something to a name nobody has entered asks the owner whether to add it.
// Corrections never touch other sessions' words: hints are only flags,
// computed on read.
import type { Entity, GlossaryOutcome } from "@bafft/shared";
import { isPlainPhrase } from "../asr/plain-words.js";

const normalize = (s: string) =>
  s.toLowerCase().replace(/[^\p{L}\p{N}' ]/gu, "").replace(/'/g, "").replace(/\s+/g, " ").trim();

/** Entity names a correction can mean: whole names and aliases first, then single words of them ("Silberquel"). */
function findNamed(entities: Entity[], text: string): { entity: Entity; name: string } | undefined {
  const key = normalize(text);
  for (const entity of entities) {
    const name = [entity.name, ...entity.aliases].find((n) => normalize(n) === key);
    if (name) return { entity, name };
  }
  for (const entity of entities) {
    for (const spelling of [entity.name, ...entity.aliases]) {
      const piece = spelling.split(/\s+/).find((p) => normalize(p) === key);
      if (piece) return { entity, name: piece };
    }
  }
  return undefined;
}

/** A capitalised word that isn't everyday English: worth asking about. */
const looksLikeName = (text: string) => /(^|\s)\p{Lu}/u.test(text) && !isPlainPhrase(text);

export interface GlossaryChange {
  outcome: GlossaryOutcome;
  /** The sounds-like list to save on the entity, when it changed. */
  update?: { entityId: number; soundsLike: string[] };
}

export function glossaryForCorrection(entities: Entity[], heard: string, text: string): GlossaryChange {
  const heardKey = normalize(heard);
  if (heardKey === normalize(text)) return { outcome: { kind: "none" } };

  const named = findNamed(entities, text);
  if (named) {
    const { entity, name } = named;
    const known = [entity.name, ...entity.aliases, ...entity.soundsLike].some((n) => normalize(n) === heardKey);
    const hint = heard.replace(/[^\p{L}\p{N}' ]/gu, "").trim();
    const everyday = hint === "" || isPlainPhrase(hint);
    const add = !known && !everyday;
    return {
      outcome: { kind: "known", entityId: entity.id, name, heard, hint: known ? "already" : everyday ? "everyday" : "added" },
      update: add ? { entityId: entity.id, soundsLike: [...entity.soundsLike, hint] } : undefined,
    };
  }
  if (looksLikeName(text)) return { outcome: { kind: "unknown", name: text, heard, heardIsPlain: isPlainPhrase(heard) } };
  return { outcome: { kind: "none" } };
}
