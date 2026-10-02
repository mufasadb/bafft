// Who's talking (bafft-wg1.12): a session's diarised speakers ("Speaker C"),
// each optionally named, and linked to the player at the table. A player and
// the hero they play are one speaker, whether the words are in character or
// table talk, so the hero comes along with the player.
import { z } from "zod";

export const SpeakerHeroSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  imagePath: z.string().nullable(),
  // coerce: Date from the database, ISO string over HTTP.
  updatedAt: z.coerce.date(),
});
export type SpeakerHero = z.infer<typeof SpeakerHeroSchema>;

export const SpeakerSchema = z.object({
  /** The diarisation label on the words, never rewritten. */
  speakerLabel: z.string(),
  wordCount: z.number().int().nonnegative(),
  /** Who it is, once the owner says; null while it's still "Speaker C". */
  name: z.string().nullable(),
  entityId: z.number().int().positive().nullable(),
  /** The linked player's hero (or the linked character itself), for the portrait. */
  hero: SpeakerHeroSchema.nullable(),
});
export type Speaker = z.infer<typeof SpeakerSchema>;

export const SpeakerUpdateSchema = z.object({
  speakerLabel: z.string().min(1),
  /** null, or blank, puts the speaker back to its label. */
  name: z.string().trim().nullable(),
  entityId: z.number().int().positive().nullable().default(null),
});
export type SpeakerUpdate = z.infer<typeof SpeakerUpdateSchema>;
