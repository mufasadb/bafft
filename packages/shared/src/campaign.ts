// Campaign domain model (bafft-n0q). A campaign is a real, editable record:
// its game system shapes AI generation, and its style anchor keeps a
// campaign's "picture this" images looking consistent.
import { z } from "zod";

export const GAME_SYSTEMS = ["draw-steel", "dnd-5e", "shadowdark", "other"] as const;
export const GameSystemSchema = z.enum(GAME_SYSTEMS);
export type GameSystem = z.infer<typeof GameSystemSchema>;

export const GAME_SYSTEM_LABELS: Record<GameSystem, string> = {
  "draw-steel": "Draw Steel",
  "dnd-5e": "D&D 5e",
  shadowdark: "Shadowdark",
  other: "Other",
};

export const CampaignSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  gameSystem: GameSystemSchema,
  // Added to every image prompt, e.g. "muted watercolour, ink outlines".
  styleAnchor: z.string().nullable(),
  // World-level context (tone, themes, setting facts) for AI drafting.
  settingNotes: z.string().nullable(),
  // coerce: DB rows carry Dates, HTTP JSON carries ISO strings.
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Campaign = z.infer<typeof CampaignSchema>;

export const CampaignUpdateSchema = z
  .object({
    name: z.string().min(1),
    gameSystem: GameSystemSchema,
    styleAnchor: z.string().nullable(),
    settingNotes: z.string().nullable(),
  })
  .partial();
export type CampaignUpdate = z.infer<typeof CampaignUpdateSchema>;
