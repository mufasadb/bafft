// Entity CRUD (bafft-wg1.3) + AI-drafted authoring (bafft-yh2.1) +
// "picture this" (bafft-yh2.2). Specific paths (/tree, /draft) are
// registered before the generic /:id routes so Express doesn't try to
// match them as an id first.
import { randomUUID } from "node:crypto";
import { basename, extname, join } from "node:path";
import { access, mkdir, rename, writeFile } from "node:fs/promises";
import { Router } from "express";
import { requirePositiveIntId } from "./params.js";
import {
  EntitySchema,
  EntityInputSchema,
  EntityUpdateSchema,
  DraftRequestSchema,
  DraftedEntitySchema,
  NpcDraftRequestSchema,
  NpcProfileSchema,
  NpcDraftSchema,
  type Entity,
} from "@bafft/shared";
import { config } from "../config.js";
import {
  createEntity,
  deleteEntity,
  getEntity,
  getLocationTree,
  listEntities,
  listGlossary,
  updateEntity,
} from "../db/entities.js";
import { listRelationshipsFor } from "../db/entity-relationships.js";
import { getActiveDraftProvider } from "../draft/providers.js";
import { getActiveImageProvider } from "../image/providers.js";
import { removeEntityImages } from "../image/cleanup.js";
import { getCampaign } from "../db/campaigns.js";
import { mergeNpcDraft } from "../npc/merge.js";
import { ROLLABLE_FIELDS, rollNpc } from "../npc/roll.js";
import { z } from "zod";

export const entitiesRouter = Router();
entitiesRouter.param("id", requirePositiveIntId);

entitiesRouter.get("/", async (_req, res, next) => {
  try {
    res.json(EntitySchema.array().parse(await listEntities()));
  } catch (err) {
    next(err);
  }
});

entitiesRouter.get("/glossary", async (_req, res, next) => {
  try {
    res.json(await listGlossary());
  } catch (err) {
    next(err);
  }
});

entitiesRouter.get("/tree", async (req, res, next) => {
  try {
    res.json(await getLocationTree(req.query.audience === "player" ? "player" : "gm"));
  } catch (err) {
    next(err);
  }
});

// Draft mode is either { prompt } or { guided } — DraftRequestSchema enforces
// exactly one. Never persists anything; the owner reviews/edits, then the
// normal POST / below is what actually saves it.
entitiesRouter.post("/draft", async (req, res, next) => {
  try {
    const parsed = DraftRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid draft request", details: parsed.error.flatten() });
      return;
    }
    // Single-campaign for now: drafts are for campaign 1 (bafft-n0q).
    const campaign = await getCampaign(1);
    const draft = await getActiveDraftProvider().draft(
      parsed.data,
      campaign && { gameSystem: campaign.gameSystem, settingNotes: campaign.settingNotes },
    );
    res.json(DraftedEntitySchema.parse(draft));
  } catch (err) {
    next(err);
  }
});

// NPC "fill the blanks" (bafft-vm8.3): the GM sends a blurb and/or a
// partly-filled NPC, the AI fills the rest, and the merge keeps every value
// the GM already set. Never persists anything, same as /draft.
/** An entity's links as plain sentences for the AI, e.g.
 * "Daven Trel -> husband of -> Zevra" (bafft-w8f.10). */
async function canonLinks(entityId: number): Promise<string[]> {
  const [links, all] = await Promise.all([listRelationshipsFor(entityId), listEntities()]);
  const name = new Map(all.map((e) => [e.id, e.name]));
  return links
    .filter((l) => name.has(l.fromEntityId) && name.has(l.toEntityId))
    .map((l) => `${name.get(l.fromEntityId)} -> ${l.description} -> ${name.get(l.toEntityId)}`);
}

entitiesRouter.post("/npc-draft", async (req, res, next) => {
  try {
    const parsed = NpcDraftRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid NPC draft request", details: parsed.error.flatten() });
      return;
    }
    const campaign = await getCampaign(1);
    const canon = parsed.data.entityId ? await canonLinks(parsed.data.entityId) : [];
    const context = campaign && { gameSystem: campaign.gameSystem, settingNotes: campaign.settingNotes, canon };
    const ai = await getActiveDraftProvider().draftNpc(parsed.data, context);
    const merged = mergeNpcDraft(parsed.data, ai, campaign?.gameSystem === "draw-steel");
    res.json(NpcDraftSchema.parse(merged));
  } catch (err) {
    next(err);
  }
});

// NPC dice (bafft-vm8.2): fills every blank field from the roll tables, or
// re-rolls just `only`. Never persists anything.
const NpcRollRequestSchema = z.object({
  name: z.string().optional(),
  profile: NpcProfileSchema.default({}),
  only: z.enum(ROLLABLE_FIELDS).optional(),
  fields: z.array(z.enum(ROLLABLE_FIELDS)).optional(),
});

entitiesRouter.post("/npc-roll", async (req, res, next) => {
  try {
    const parsed = NpcRollRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid NPC roll request", details: parsed.error.flatten() });
      return;
    }
    const campaign = await getCampaign(1);
    res.json(rollNpc({ ...parsed.data, withNegotiation: campaign?.gameSystem === "draw-steel" }));
  } catch (err) {
    next(err);
  }
});

entitiesRouter.post("/", async (req, res, next) => {
  try {
    const parsed = EntityInputSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid entity input", details: parsed.error.flatten() });
      return;
    }
    res.status(201).json(EntitySchema.parse(await createEntity(parsed.data)));
  } catch (err) {
    next(err);
  }
});

entitiesRouter.get("/:id", async (req, res, next) => {
  try {
    const entity = await getEntity(Number(req.params.id));
    if (!entity) {
      res.status(404).json({ error: "entity not found" });
      return;
    }
    res.json(EntitySchema.parse(entity));
  } catch (err) {
    next(err);
  }
});

entitiesRouter.patch("/:id", async (req, res, next) => {
  try {
    const parsed = EntityUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid entity update", details: parsed.error.flatten() });
      return;
    }
    const updated = await updateEntity(Number(req.params.id), parsed.data);
    if (!updated) {
      res.status(404).json({ error: "entity not found" });
      return;
    }
    res.json(EntitySchema.parse(updated));
  } catch (err) {
    next(err);
  }
});

entitiesRouter.delete("/:id", async (req, res, next) => {
  try {
    const deleted = await deleteEntity(Number(req.params.id));
    if (!deleted) {
      res.status(404).json({ error: "entity not found" });
      return;
    }
    await removeEntityImages(Number(req.params.id));
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

/** name+type+tags+quirks, plus an NPC's ancestry/occupation/look. Deliberately
 * excludes `notes` and the NPC `secret`: both hold GM-only content that
 * shouldn't leak into a picture players might see (owner, 2026-09-27). */
export function buildImagePrompt(entity: Pick<Entity, "type" | "name" | "tags" | "quirks" | "profile">): string {
  const who = [entity.profile?.ancestry, entity.profile?.occupation].filter(Boolean).join(" ");
  const tagsPart = entity.tags.length ? ` (${entity.tags.join(", ")})` : "";
  const whoPart = who ? `, a ${who}` : "";
  const lookPart = entity.profile?.look ? `. ${entity.profile.look}` : "";
  const placePart = entity.profile?.description ? `. ${entity.profile.description.replace(/\s*\n\s*/g, " ")}` : "";
  const quirksPart = entity.quirks.length ? `. ${entity.quirks.join(" ")}` : "";
  return `Illustration of a ${entity.type}: ${entity.name}${whoPart}${tagsPart}${lookPart}${placePart}${quirksPart}`;
}

// Generates into a staged temp file and returns it as a data URL — nothing
// is saved to the entity yet. Mirrors the AI-drafted-text flow's own
// review-before-persist principle, just for an image.
entitiesRouter.post("/:id/picture/generate", async (req, res, next) => {
  try {
    const entity = await getEntity(Number(req.params.id));
    if (!entity) {
      res.status(404).json({ error: "entity not found" });
      return;
    }
    const prompt: string =
      typeof req.body?.prompt === "string" && req.body.prompt.trim() ? req.body.prompt : buildImagePrompt(entity);
    const campaign = await getCampaign(entity.campaignId);
    const image = await getActiveImageProvider().generate({
      prompt,
      styleAnchor: campaign?.styleAnchor ?? undefined,
    });
    const tempId = `${randomUUID()}.${image.extension}`;
    await mkdir(config.imagesTmpDir, { recursive: true });
    await writeFile(join(config.imagesTmpDir, tempId), image.data);
    res.json({
      tempId,
      mimeType: image.mimeType,
      dataUrl: `data:${image.mimeType};base64,${Buffer.from(image.data).toString("base64")}`,
    });
  } catch (err) {
    next(err);
  }
});

entitiesRouter.post("/:id/picture/accept", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const entity = await getEntity(id);
    if (!entity) {
      res.status(404).json({ error: "entity not found" });
      return;
    }
    const tempId = basename(String(req.body?.tempId ?? ""));
    const tempPath = join(config.imagesTmpDir, tempId);
    const finalDir = join(config.imagesDir, String(id));
    const finalPath = join(finalDir, `portrait${extname(tempId)}`);
    try {
      await access(tempPath);
    } catch {
      res.status(422).json({ error: "no such generated image — generate one first" });
      return;
    }
    // Replaces any earlier picture outright, so a new png doesn't sit
    // beside an old portrait.svg.
    await removeEntityImages(id);
    await mkdir(finalDir, { recursive: true });
    await rename(tempPath, finalPath);
    const relativePath = join("images", String(id), `portrait${extname(tempId)}`);
    const updated = await updateEntity(id, { imagePath: relativePath });
    res.json(EntitySchema.parse(updated));
  } catch (err) {
    next(err);
  }
});
