// NPC profile (bafft-vm8.1). The structured half of an NPC: who they are,
// how they come across at the table, their story, and (Draw Steel) how they
// negotiate. Every field is optional: an NPC is often half-filled by the GM,
// the dice, or the AI, and the rest gets filled in later.
//
// No relative imports here: entity.ts pulls this in via "@bafft/shared/npc"
// and drizzle-kit's schema loader can't follow relative `.js` imports.
import { z } from "zod";

/** Draw Steel ancestries (Heroes p.21-51). A suggestion list, not enforced. */
export const DRAW_STEEL_ANCESTRIES = [
  "devil",
  "dragon knight",
  "dwarf",
  "wode elf",
  "high elf",
  "hakaan",
  "human",
  "memonek",
  "orc",
  "polder",
  "revenant",
  "time raider",
] as const;

/** Each ancestry's usual native language (Heroes p.53, 56-57). Caelian is the
 * common tongue everyone knows; a revenant keeps their former life's language. */
export const DRAW_STEEL_LANGUAGES: Record<string, string> = {
  devil: "Anjali",
  "dragon knight": "Vastariax",
  dwarf: "Zaliac",
  "wode elf": "Yllyric",
  "high elf": "Hyrallic",
  hakaan: "Vhoric",
  human: "Vaslorian",
  memonek: "Axiomatic",
  orc: "Kalliak",
  polder: "Khoursirian",
  "time raider": "Voll",
};

/** Draw Steel negotiation attitudes and their starting Interest/Patience (Heroes p.287). */
export const ATTITUDES = ["hostile", "suspicious", "neutral", "open", "friendly", "trusting"] as const;
export const AttitudeSchema = z.enum(ATTITUDES);
export type Attitude = z.infer<typeof AttitudeSchema>;

export const ATTITUDE_START: Record<Attitude, { interest: number; patience: number }> = {
  hostile: { interest: 1, patience: 2 },
  suspicious: { interest: 2, patience: 2 },
  neutral: { interest: 2, patience: 3 },
  open: { interest: 3, patience: 3 },
  friendly: { interest: 3, patience: 4 },
  trusting: { interest: 3, patience: 5 },
};

/** The one list both motivations and pitfalls are drawn from (Heroes p.284-287). */
export const MOTIVATIONS = [
  "benevolence",
  "discovery",
  "freedom",
  "greed",
  "higher authority",
  "justice",
  "legacy",
  "peace",
  "power",
  "protection",
  "revelry",
  "vengeance",
] as const;
export const MotivationSchema = z.enum(MOTIVATIONS);
export type Motivation = z.infer<typeof MotivationSchema>;

const ReasonedMotivationSchema = z.object({
  kind: MotivationSchema,
  // One line tying it to this NPC, e.g. "wants the guild debt gone".
  reason: z.string().default(""),
});

export const NegotiationSchema = z
  .object({
    attitude: AttitudeSchema.optional(),
    impression: z.number().int().min(1).max(12).optional(),
    language: z.string().optional(),
    motivations: z.array(ReasonedMotivationSchema).default([]),
    pitfalls: z.array(ReasonedMotivationSchema).default([]),
    // What they give up as the heroes raise their Interest (bafft-w8f.4),
    // e.g. 3: "the notes, if they swear to bring him back alive".
    offers: z.array(z.object({ interest: z.number().int().min(0).max(5), offer: z.string() })).optional(),
  })
  .refine(
    (n) => !n.motivations.some((m) => n.pitfalls.some((p) => p.kind === m.kind)),
    { message: "the same thing can't be both a motivation and a pitfall" },
  );
export type Negotiation = z.infer<typeof NegotiationSchema>;

/** The free-text NPC fields, in the order the creator shows them. */
export const NPC_TEXT_FIELDS = [
  "ancestry",
  "occupation",
  "look",
  "voice",
  "behaviour",
  "flaw",
  "wants",
  "can",
  "plan",
  "sideways",
  "story",
] as const;
export type NpcTextField = (typeof NPC_TEXT_FIELDS)[number];

/** The plot-bearing fields: what "keep to my notes" never lets the AI write. */
export const NPC_STORY_FIELDS = ["wants", "can", "plan", "sideways", "story"] as const satisfies readonly NpcTextField[];

export const NpcProfileSchema = z.object({
  ancestry: z.string().optional(),
  occupation: z.string().optional(),
  // Director's "Creating NPCs" checklist (Heroes p.379).
  look: z.string().optional(),
  voice: z.string().optional(),
  behaviour: z.string().optional(),
  flaw: z.string().optional(),
  // How the director preps NPCs (bafft-w8f.4): what they want, what they can
  // do, the steps they're taking, and what they do when it goes wrong.
  wants: z.string().optional(),
  can: z.string().optional(),
  plan: z.string().optional(),
  sideways: z.string().optional(),
  // One open-ended story (owner, bafft-w8f.15): why they'd help or refuse,
  // hooks, secrets, anything. Never sent to image prompts.
  story: z.string().optional(),
  // Before w8f.15 the story was four fields. Still accepted so old rows
  // parse; foldLegacyStory() moves them into `story` when an NPC is read.
  helpReason: z.string().optional(),
  refuseReason: z.string().optional(),
  hook: z.string().optional(),
  secret: z.string().optional(),
  // Draw Steel negotiation block; absent for other systems.
  negotiation: NegotiationSchema.optional(),
  // Locations use the same profile column (bafft-w8f.16): what it looks
  // like, then why it matters to the story. Notes stay in entity.notes.
  description: z.string().optional(),
  storyRelevance: z.string().optional(),
});
export type NpcProfile = z.infer<typeof NpcProfileSchema>;

/** Starting Interest/Patience for an attitude, or undefined when none is set. */
export function negotiationStart(attitude: Attitude | undefined) {
  return attitude ? ATTITUDE_START[attitude] : undefined;
}

/** What the GM hands the AI: a blurb and/or whatever they've filled in so far. */
export const NpcDraftRequestSchema = z.object({
  blurb: z.string().optional(),
  name: z.string().optional(),
  profile: NpcProfileSchema.default({}),
  // Everything else the GM already has, so the AI builds around it (bafft-w8f.13).
  aliases: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  quirks: z.array(z.string()).optional(),
  // An NPC already saved: its links are handed to the AI as canon (bafft-w8f.10).
  entityId: z.number().int().positive().optional(),
  // "Keep to my notes": the AI writes colour only and leaves the story to the GM.
  colourOnly: z.boolean().optional(),
});
export type NpcDraftRequest = z.infer<typeof NpcDraftRequestSchema>;

/** A complete NPC draft: still unsaved until the GM hits Save. */
export const NpcDraftSchema = z.object({
  name: z.string().min(1),
  tags: z.array(z.string()),
  quirks: z.array(z.string()),
  profile: NpcProfileSchema,
});
export type NpcDraft = z.infer<typeof NpcDraftSchema>;

const LEGACY_STORY: [key: "helpReason" | "refuseReason" | "hook" | "secret", label: string][] = [
  ["hook", "Hook"],
  ["helpReason", "Helps if"],
  ["refuseReason", "Refuses if"],
  ["secret", "Secret"],
];

/** Moves the pre-w8f.15 story fields into the single `story`, as labelled
 * lines after anything already there. A profile without them is returned as is. */
export function foldLegacyStory(profile: NpcProfile): NpcProfile {
  if (!LEGACY_STORY.some(([k]) => profile[k] !== undefined)) return profile;
  const { helpReason: _h, refuseReason: _r, hook: _k, secret: _s, ...rest } = profile;
  const lines = LEGACY_STORY.filter(([k]) => profile[k]?.trim()).map(([k, label]) => `${label}: ${profile[k]!.trim()}`);
  const story = [profile.story?.trim(), ...lines].filter(Boolean).join("\n");
  return story ? { ...rest, story } : rest;
}

/** Locations used to keep their look in `quirks` (one per line). Read them as
 * the physical description instead (bafft-w8f.16); saving writes the new shape. */
export function foldLocationQuirks<T extends { type: string; quirks: string[]; profile: NpcProfile | null }>(entity: T): T {
  if (entity.type !== "location" || entity.quirks.length === 0 || entity.profile?.description) return entity;
  return { ...entity, quirks: [], profile: { ...entity.profile, description: entity.quirks.join("\n") } };
}
