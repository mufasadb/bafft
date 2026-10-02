// The vendor-agnostic seam for AI-drafted entity authoring (Workflow 1,
// bafft-yh2.1) — every draft vendor sits behind DraftProvider so vendor
// choice never touches the rest of the app, same shape as
// TranscriptionProvider. Output is always an unsaved draft the owner
// reviews/edits before the normal create/update call saves it — this
// interface has no "save" of its own.
import { z } from "zod";
import { EntityTypeSchema, type EntityType } from "./entity.js";
import type { GameSystem } from "./campaign.js";
import type { NpcDraft, NpcDraftRequest } from "./npc.js";

export const DraftRequestSchema = z
  .object({
    type: EntityTypeSchema,
    // Exactly one of these is expected — prompt mode or guided mode (see
    // design doc; which to build first was still open, so both are modeled).
    prompt: z.string().min(1).optional(),
    guided: z
      .record(z.string(), z.string())
      .refine((g) => Object.values(g).some((v) => v.trim()), { message: "fill in at least one guided field" })
      .optional(),
  })
  .refine((d) => Boolean(d.prompt) !== Boolean(d.guided), {
    message: "provide exactly one of prompt or guided, not both or neither",
  });
export type DraftRequest = z.infer<typeof DraftRequestSchema>;

/** One question in guided mode. Answers go to the provider keyed by `key`;
 * `suggestions` are just prompts for the owner, never a closed list. */
export interface GuidedField {
  key: string;
  label: string;
  suggestions: readonly string[];
}

// Per-type guided-mode questions (bafft-yh2.3). All optional, all free text.
// Kept system-neutral for now; once a campaign has a game system (bafft-n0q)
// the suggestions can follow it (Draw Steel ancestries vs D&D races, etc).
const PERSON_FIELDS: readonly GuidedField[] = [
  { key: "ancestry", label: "Ancestry", suggestions: ["human", "elf", "dwarf", "orc", "halfling"] },
  { key: "role", label: "Role or class", suggestions: ["fighter", "wizard", "rogue", "cleric", "bard"] },
  { key: "background", label: "Background", suggestions: ["noble", "soldier", "criminal", "farmer", "scholar"] },
  { key: "personality", label: "Personality", suggestions: ["gruff", "cheerful", "paranoid", "proud"] },
];

export const GUIDED_FIELDS: Record<EntityType, readonly GuidedField[]> = {
  location: [
    { key: "kind", label: "Kind", suggestions: ["city", "town", "village", "dungeon", "ruin", "wilderness", "landmark"] },
    { key: "size", label: "Size", suggestions: ["tiny", "small", "large", "sprawling"] },
    { key: "terrain", label: "Climate / terrain", suggestions: ["coastal", "mountain", "forest", "desert", "swamp", "tundra"] },
    { key: "mood", label: "Mood", suggestions: ["welcoming", "tense", "decaying", "prosperous", "haunted"] },
  ],
  npc: [
    { key: "occupation", label: "Occupation", suggestions: ["innkeeper", "guard captain", "merchant", "priest", "smuggler"] },
    { key: "ancestry", label: "Ancestry", suggestions: ["human", "elf", "dwarf", "orc", "halfling"] },
    { key: "attitude", label: "Attitude to the party", suggestions: ["friendly", "wary", "hostile", "indifferent"] },
    { key: "age", label: "Age", suggestions: ["young", "middle-aged", "old", "ancient"] },
  ],
  character: PERSON_FIELDS,
  player: PERSON_FIELDS,
  faction: [
    { key: "kind", label: "Kind", suggestions: ["mercenary company", "guild", "cult", "noble house", "army", "gang"] },
    { key: "size", label: "Size", suggestions: ["a handful", "a company", "a city-wide network", "a nation's army"] },
    { key: "goal", label: "What they want", suggestions: ["coin", "power", "revenge", "faith", "survival"] },
  ],
  item: [
    { key: "kind", label: "Kind", suggestions: ["weapon", "armour", "trinket", "tome", "potion", "relic"] },
    { key: "rarity", label: "Rarity", suggestions: ["common", "uncommon", "rare", "legendary"] },
    { key: "origin", label: "Origin", suggestions: ["dwarven", "elven", "fey", "infernal", "ancient empire"] },
  ],
};

export const DraftedEntitySchema = z.object({
  name: z.string().min(1),
  aliases: z.array(z.string()),
  tags: z.array(z.string()),
  quirks: z.array(z.string()),
});
export type DraftedEntity = z.infer<typeof DraftedEntitySchema>;

/** Campaign-level context a provider shapes its draft around (bafft-n0q). */
export interface DraftContext {
  gameSystem: GameSystem;
  settingNotes: string | null;
  /** Facts from the world the draft must not contradict, e.g. an NPC's links. */
  canon?: string[];
}

export interface DraftProvider {
  readonly name: string;
  draft(request: DraftRequest, context?: DraftContext): Promise<DraftedEntity>;
  /** Fills in an NPC around whatever the GM already has (bafft-vm8.3). The
   * caller merges the result so the GM's own values always win. */
  draftNpc(request: NpcDraftRequest, context?: DraftContext): Promise<NpcDraft>;
}
