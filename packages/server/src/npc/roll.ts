// Dice for the NPC generator (bafft-vm8.2): fills blank NPC fields at random
// from the roll tables, or re-rolls one field. Only ever fills what the GM
// left empty, unless they re-roll a specific field.
import {
  ATTITUDES,
  DRAW_STEEL_ANCESTRIES,
  DRAW_STEEL_LANGUAGES,
  MOTIVATIONS,
  NegotiationSchema,
  type Negotiation,
  type NpcProfile,
} from "@bafft/shared";
// Written by the Muse (la-p17x2k): original names, no book text.
import tables from "./tables/npc-roll-tables.json" with { type: "json" };

export const ROLLABLE_TEXT_FIELDS = [
  "occupation",
  "look",
  "voice",
  "behaviour",
  "flaw",
] as const;
export const ROLLABLE_FIELDS = ["name", "ancestry", ...ROLLABLE_TEXT_FIELDS, "negotiation"] as const;
export type RollableField = (typeof ROLLABLE_FIELDS)[number];

/** What "Roll" fills by default: who they are and how they come across. The
 * story is left for the GM or the AI to write around the rolled seeds. */
export const SEED_FIELDS = ["name", "ancestry", "occupation", "look", "voice", "behaviour", "flaw", "negotiation"] as const;

export type Rng = () => number;

const pick = <T>(list: readonly T[], rng: Rng): T => list[Math.floor(rng() * list.length)];

// "dragon knight" -> "dragonKnight", matching the table's keys.
const nameKey = (ancestry: string) => ancestry.toLowerCase().replace(/ (\w)/g, (_, c: string) => c.toUpperCase());

function rollName(ancestry: string | undefined, rng: Rng): string {
  const byAncestry = tables.nameByAncestry as Record<string, string[]>;
  const names = (ancestry && byAncestry[nameKey(ancestry)]) || byAncestry.human;
  return pick(names, rng);
}

// Most people the heroes meet are commoners; weight Impression low.
const IMPRESSIONS = [1, 1, 1, 1, 2, 2, 2, 3, 3, 4, 5, 6];

/** A voice the GM can play the same way every time (owner, bafft-w8f.14):
 * an accent plus one signature feature of delivery. */
export function rollVoice(rng: Rng): string {
  return `${pick(tables.voiceAccent, rng)} accent, ${pick(tables.voice, rng)}`;
}

/** Keeps the GM's picks and tops up to 2 motivations and 2 pitfalls, never repeating a kind. */
function rollNegotiation(gm: Negotiation | undefined, ancestry: string | undefined, rng: Rng): Negotiation {
  const motivations = [...(gm?.motivations ?? [])];
  const pitfalls = [...(gm?.pitfalls ?? [])];
  const taken = new Set([...motivations, ...pitfalls].map((m) => m.kind));
  const fresh = () => {
    const kind = pick(MOTIVATIONS.filter((k) => !taken.has(k)), rng);
    taken.add(kind);
    return { kind, reason: "" };
  };
  while (motivations.length < 2) motivations.push(fresh());
  while (pitfalls.length < 2) pitfalls.push(fresh());
  return NegotiationSchema.parse({
    attitude: gm?.attitude ?? pick(ATTITUDES, rng),
    impression: gm?.impression ?? pick(IMPRESSIONS, rng),
    language: gm?.language ?? (ancestry ? DRAW_STEEL_LANGUAGES[ancestry.toLowerCase()] : undefined),
    motivations,
    pitfalls,
  });
}

function blank(value: string | undefined): boolean {
  return !value?.trim();
}

export interface RollInput {
  name?: string;
  profile: NpcProfile;
  /** Re-roll just this field (even if filled). Omitted: fill every blank. */
  only?: RollableField;
  /** Limit a fill-the-blanks roll to these fields (e.g. just the seeds, leaving
   * the story fields for the AI to write around them). */
  fields?: readonly RollableField[];
  /** False for games other than Draw Steel. */
  withNegotiation: boolean;
}

export function rollNpc({ name, profile, only, fields, withNegotiation }: RollInput, rng: Rng = Math.random) {
  const out: NpcProfile = structuredClone(profile);
  const should = (field: RollableField, empty: boolean) =>
    only ? only === field : empty && (!fields || fields.includes(field));

  if (should("ancestry", blank(out.ancestry))) out.ancestry = pick(DRAW_STEEL_ANCESTRIES, rng);
  const t = tables as unknown as Record<(typeof ROLLABLE_TEXT_FIELDS)[number], string[]>;
  for (const field of ROLLABLE_TEXT_FIELDS) {
    if (should(field, blank(out[field]))) out[field] = field === "voice" ? rollVoice(rng) : pick(t[field], rng);
  }
  const negotiationEmpty = !out.negotiation?.attitude || (out.negotiation.motivations.length ?? 0) < 2;
  if (withNegotiation && should("negotiation", negotiationEmpty)) {
    // A deliberate re-roll starts over; filling blanks keeps the GM's picks.
    out.negotiation = rollNegotiation(only === "negotiation" ? undefined : out.negotiation, out.ancestry, rng);
  }
  const newName = should("name", blank(name)) ? rollName(out.ancestry, rng) : name;
  return { name: newName, profile: out };
}
