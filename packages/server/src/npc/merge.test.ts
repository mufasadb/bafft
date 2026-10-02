// The GM always wins (bafft-vm8.3): the AI only fills gaps, and Draw Steel's
// negotiation rules hold whatever the model returned.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { NpcDraft } from "@bafft/shared";
import { mergeNpcDraft } from "./merge.js";

const ai: NpcDraft = {
  name: "AI Name",
  tags: ["ai"],
  quirks: ["an AI quirk"],
  profile: {
    ancestry: "orc",
    occupation: "smith",
    voice: "booming",
    story: "ai story",
    negotiation: {
      attitude: "open",
      impression: 3,
      language: "Anjali",
      motivations: [
        { kind: "greed", reason: "ai greed" },
        { kind: "power", reason: "ai power" },
        { kind: "legacy", reason: "ai legacy" },
      ],
      pitfalls: [{ kind: "justice", reason: "ai justice" }],
    },
  },
};

test("the GM's filled fields and name win; blanks come from the AI", () => {
  const merged = mergeNpcDraft(
    { name: "Boran", profile: { ancestry: "dwarf", occupation: "  ", voice: "" } },
    ai,
    true,
  );
  assert.equal(merged.name, "Boran");
  assert.equal(merged.profile.ancestry, "dwarf");
  assert.equal(merged.profile.occupation, "smith");
  assert.equal(merged.profile.voice, "booming");
  assert.equal(merged.profile.story, "ai story");
});

test("GM motivations are kept, topped up to 2 without clashing with GM pitfalls", () => {
  const merged = mergeNpcDraft(
    {
      profile: {
        negotiation: {
          attitude: "hostile",
          motivations: [{ kind: "vengeance", reason: "" }],
          pitfalls: [{ kind: "greed", reason: "gm: hates money" }],
        },
      },
    },
    ai,
    true,
  );
  const n = merged.profile.negotiation!;
  assert.equal(n.attitude, "hostile");
  assert.equal(n.impression, 3);
  // vengeance kept; greed skipped because the GM made it a pitfall; power added.
  assert.deepEqual(n.motivations.map((m) => m.kind), ["vengeance", "power"]);
  // Pitfalls topped up to two as well (bafft-w8f.13).
  assert.deepEqual(n.pitfalls, [
    { kind: "greed", reason: "gm: hates money" },
    { kind: "justice", reason: "ai justice" },
  ]);
});

test("a GM pick with no reason borrows the AI's reason for the same kind", () => {
  const merged = mergeNpcDraft(
    { profile: { negotiation: { motivations: [{ kind: "legacy", reason: "" }], pitfalls: [] } } },
    ai,
    true,
  );
  assert.equal(merged.profile.negotiation!.motivations[0].reason, "ai legacy");
});

test("other game systems don't get an AI negotiation block", () => {
  assert.equal(mergeNpcDraft({ profile: {} }, ai, false).profile.negotiation, undefined);
});

test("the drive fields fill like any other; the GM's offers survive a flesh-out (bafft-w8f.4)", () => {
  const merged = mergeNpcDraft(
    {
      profile: {
        wants: "her husband safe and home",
        negotiation: {
          attitude: "suspicious",
          motivations: [],
          pitfalls: [],
          offers: [{ interest: 3, offer: "the notes, if they swear to bring him back alive" }],
        },
      },
    },
    { ...ai, profile: { ...ai.profile, wants: "ai wants", plan: "ai plan" } },
    true,
  );
  assert.equal(merged.profile.wants, "her husband safe and home");
  assert.equal(merged.profile.plan, "ai plan");
  assert.deepEqual(merged.profile.negotiation?.offers, [
    { interest: 3, offer: "the notes, if they swear to bring him back alive" },
  ]);
});

test("keep to my notes: the AI's story fields are dropped, its colour kept (bafft-w8f.10)", () => {
  const merged = mergeNpcDraft(
    { colourOnly: true, profile: { story: "the GM's story" } },
    { ...ai, profile: { ...ai.profile, look: "ai look", plan: "ai plan", story: "ai story" } },
    true,
  );
  assert.equal(merged.profile.look, "ai look");
  assert.equal(merged.profile.voice, "booming");
  assert.equal(merged.profile.story, "the GM's story");
  assert.equal(merged.profile.plan, undefined);
  assert.equal(merged.profile.wants, undefined);
});
