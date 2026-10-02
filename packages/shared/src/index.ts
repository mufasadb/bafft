// @bafft/shared — types and schemas shared between server and web.
// The Session/TranscriptWord domain models land in later beads (bafft-wg1.4, .7).

import { z } from "zod";

export const HealthSchema = z.object({
  status: z.literal("ok"),
  service: z.string(),
  time: z.string(),
});

export type Health = z.infer<typeof HealthSchema>;

export * from "./entity.js";
export * from "./transcription.js";
export * from "./session.js";
export * from "./transcript-word.js";
export * from "./draft.js";
export * from "./campaign.js";
export * from "./npc.js";
export * from "./soundboard.js";
export * from "./run-sheet.js";
export * from "./speaker.js";
