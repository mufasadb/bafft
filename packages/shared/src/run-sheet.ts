import { z } from "zod";

export const RunSheetInputSchema = z.object({
  campaignId: z.number().int().positive().default(1),
  title: z.string().trim().min(1).max(200),
  markdown: z.string().max(100_000).default(""),
});
export const RunSheetUpdateSchema = RunSheetInputSchema.pick({ title: true, markdown: true }).partial();
export const RunSheetSchema = RunSheetInputSchema.extend({
  id: z.number().int().positive(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type RunSheet = z.infer<typeof RunSheetSchema>;
export type RunSheetInput = z.infer<typeof RunSheetInputSchema>;
export type RunSheetUpdate = z.infer<typeof RunSheetUpdateSchema>;
