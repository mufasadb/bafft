// NPC dice (bafft-vm8.2): blanks get filled, the GM's values are kept, and a
// single-field re-roll touches only that field.
import { test } from "node:test";
import assert from "node:assert/strict";
import { MOTIVATIONS } from "@bafft/shared";
import tables from "./tables/npc-roll-tables.json" with { type: "json" };
import { ROLLABLE_TEXT_FIELDS, SEED_FIELDS, rollNpc } from "./roll.js";

/** Deterministic rng cycling through fixed values. */
function seq(...values: number[]) {
  let i = 0;
  return () => values[i++ % values.length];
}

test("the tables are big and every text table is non-empty", () => {
  const t = tables as unknown as Record<string, string[]>;
  for (const field of ROLLABLE_TEXT_FIELDS) assert.ok(t[field].length >= 50, `${field} has ${t[field].length}`);
  assert.equal(Object.keys(tables.nameByAncestry).length, 12);
});

test("an empty NPC gets every field rolled, with a valid Draw Steel negotiation", () => {
  for (let i = 0; i < 50; i++) {
    const { name, profile } = rollNpc({ profile: {}, withNegotiation: true });
    assert.ok(name);
    for (const field of ["ancestry", ...ROLLABLE_TEXT_FIELDS] as const) assert.ok(profile[field], field);
    const n = profile.negotiation!;
    assert.equal(n.motivations.length, 2);
    assert.equal(n.pitfalls.length, 2);
    const kinds = [...n.motivations, ...n.pitfalls].map((m) => m.kind);
    assert.equal(new Set(kinds).size, 4, "no kind repeats");
    assert.ok(kinds.every((k) => (MOTIVATIONS as readonly string[]).includes(k)));
  }
});

test("the GM's own fields and picks survive a roll", () => {
  const { name, profile } = rollNpc({
    name: "Boran",
    profile: {
      ancestry: "dwarf",
      voice: "whispers",
      negotiation: { attitude: "hostile", motivations: [{ kind: "greed", reason: "debts" }], pitfalls: [] },
    },
    withNegotiation: true,
  });
  assert.equal(name, "Boran");
  assert.equal(profile.ancestry, "dwarf");
  assert.equal(profile.voice, "whispers");
  assert.equal(profile.negotiation!.attitude, "hostile");
  assert.deepEqual(profile.negotiation!.motivations[0], { kind: "greed", reason: "debts" });
  assert.equal(profile.negotiation!.motivations.length, 2);
});

test("re-rolling one field changes only that field", () => {
  const start = rollNpc({ profile: {}, withNegotiation: true }, seq(0.1));
  const again = rollNpc({ ...start, only: "voice", withNegotiation: true }, seq(0.9));
  assert.notEqual(again.profile.voice, start.profile.voice);
  assert.equal(again.name, start.name);
  assert.deepEqual({ ...again.profile, voice: undefined }, { ...start.profile, voice: undefined });
});

test("names follow the ancestry", () => {
  const { name } = rollNpc({ profile: { ancestry: "dragon knight" }, only: "name", withNegotiation: false });
  assert.ok(tables.nameByAncestry.dragonKnight.includes(name!));
});

test("no negotiation block outside Draw Steel", () => {
  assert.equal(rollNpc({ profile: {}, withNegotiation: false }).profile.negotiation, undefined);
});

test("a seeds-only roll leaves the story fields for the AI", () => {
  const { profile } = rollNpc({ profile: {}, fields: SEED_FIELDS, withNegotiation: true });
  assert.ok(profile.occupation && profile.look && profile.negotiation);
  assert.equal(profile.hook, undefined);
  assert.equal(profile.secret, undefined);
  assert.equal(profile.helpReason, undefined);
});

test("the rolled native language follows the ancestry", () => {
  const { profile } = rollNpc({ profile: { ancestry: "dwarf" }, withNegotiation: true });
  assert.equal(profile.negotiation?.language, "Zaliac");
});

test("a rolled voice is an accent plus one feature; negotiation gets 2 pitfalls (bafft-w8f.14, w8f.13)", () => {
  const { profile } = rollNpc({ profile: {}, withNegotiation: true }, seq(0.3));
  assert.match(profile.voice!, /^[\w' -]+ accent, .+/);
  assert.equal(profile.negotiation?.pitfalls.length, 2);
});
