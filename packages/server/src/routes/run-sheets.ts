import { Router } from "express";
import { z } from "zod";
import { RunSheetInputSchema, RunSheetSchema, RunSheetUpdateSchema } from "@bafft/shared";
import { desc, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { runSheets } from "../db/schema.js";
import { getCampaign } from "../db/campaigns.js";
import { requirePositiveIntId } from "./params.js";

export const runSheetsRouter = Router();
runSheetsRouter.param("id", requirePositiveIntId);
runSheetsRouter.get("/", async (req, res, next) => {
  try {
    const campaign = z.coerce.number().int().positive().safeParse(req.query.campaignId ?? 1);
    if (!campaign.success) { res.status(400).json({ error: "invalid campaign id" }); return; }
    const rows = await db.select().from(runSheets).where(eq(runSheets.campaignId, campaign.data))
      .orderBy(desc(runSheets.createdAt), desc(runSheets.id));
    res.json(RunSheetSchema.array().parse(rows));
  } catch (err) { next(err); }
});
runSheetsRouter.post("/", async (req, res, next) => {
  try {
    const input = RunSheetInputSchema.safeParse(req.body);
    if (!input.success) { res.status(400).json({ error: "invalid run sheet" }); return; }
    if (!await getCampaign(input.data.campaignId)) { res.status(404).json({ error: "campaign not found" }); return; }
    const [row] = await db.insert(runSheets).values(input.data).returning();
    res.status(201).json(RunSheetSchema.parse(row));
  } catch (err) { next(err); }
});
runSheetsRouter.get("/:id", async (req, res, next) => {
  try {
    const [row] = await db.select().from(runSheets).where(eq(runSheets.id, Number(req.params.id)));
    if (!row) { res.status(404).json({ error: "run sheet not found" }); return; }
    res.json(RunSheetSchema.parse(row));
  } catch (err) { next(err); }
});
runSheetsRouter.patch("/:id", async (req, res, next) => {
  try {
    const input = RunSheetUpdateSchema.safeParse(req.body);
    if (!input.success) { res.status(400).json({ error: "invalid run sheet update" }); return; }
    const [row] = await db.update(runSheets).set({ ...input.data, updatedAt: new Date() })
      .where(eq(runSheets.id, Number(req.params.id))).returning();
    if (!row) { res.status(404).json({ error: "run sheet not found" }); return; }
    res.json(RunSheetSchema.parse(row));
  } catch (err) { next(err); }
});
runSheetsRouter.delete("/:id", async (req, res, next) => {
  try {
    const rows = await db.delete(runSheets).where(eq(runSheets.id, Number(req.params.id))).returning();
    if (!rows.length) { res.status(404).json({ error: "run sheet not found" }); return; }
    res.sendStatus(204);
  } catch (err) { next(err); }
});
