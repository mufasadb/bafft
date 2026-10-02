// Typed query helpers over the campaigns table (bafft-n0q).
import { eq } from "drizzle-orm";
import type { Campaign, CampaignUpdate } from "@bafft/shared";
import { db } from "./client.js";
import { campaigns } from "./schema.js";

export async function listCampaigns(): Promise<Campaign[]> {
  return db.select().from(campaigns);
}

export async function getCampaign(id: number): Promise<Campaign | undefined> {
  const [row] = await db.select().from(campaigns).where(eq(campaigns.id, id));
  return row;
}

export async function updateCampaign(id: number, input: CampaignUpdate): Promise<Campaign | undefined> {
  const [row] = await db
    .update(campaigns)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(campaigns.id, id))
    .returning();
  return row;
}
