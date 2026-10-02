// Campaign settings (bafft-n0q). No create/delete yet: there's one seeded
// campaign until multi-campaign support lands.
import { Router } from "express";
import { CampaignSchema, CampaignUpdateSchema } from "@bafft/shared";
import { requirePositiveIntId } from "./params.js";
import { getCampaign, listCampaigns, updateCampaign } from "../db/campaigns.js";

export const campaignsRouter = Router();
campaignsRouter.param("id", requirePositiveIntId);

campaignsRouter.get("/", async (_req, res, next) => {
  try {
    res.json(CampaignSchema.array().parse(await listCampaigns()));
  } catch (err) {
    next(err);
  }
});

campaignsRouter.get("/:id", async (req, res, next) => {
  try {
    const campaign = await getCampaign(Number(req.params.id));
    if (!campaign) {
      res.status(404).json({ error: "campaign not found" });
      return;
    }
    res.json(CampaignSchema.parse(campaign));
  } catch (err) {
    next(err);
  }
});

campaignsRouter.patch("/:id", async (req, res, next) => {
  try {
    const parsed = CampaignUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid campaign update", details: parsed.error.flatten() });
      return;
    }
    const updated = await updateCampaign(Number(req.params.id), parsed.data);
    if (!updated) {
      res.status(404).json({ error: "campaign not found" });
      return;
    }
    res.json(CampaignSchema.parse(updated));
  } catch (err) {
    next(err);
  }
});
