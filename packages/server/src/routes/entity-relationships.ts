// Relationships between entities — a separate resource from entities.ts
// since a relationship has two entity ids of its own, not one.
import { Router } from "express";
import { requirePositiveIntId } from "./params.js";
import { EntityRelationshipSchema, EntityRelationshipInputSchema } from "@bafft/shared";
import {
  createRelationship,
  deleteRelationship,
  listRelationshipsFor,
  listRelationshipLabels,
  setLocationInside,
  setRelationshipGmOnly,
  RelationshipError,
} from "../db/entity-relationships.js";

export const entityRelationshipsRouter = Router();
entityRelationshipsRouter.param("id", requirePositiveIntId);

entityRelationshipsRouter.get("/labels", async (req, res, next) => {
  try {
    res.json(await listRelationshipLabels(req.query.audience === "player" ? "player" : "gm"));
  } catch (err) {
    next(err);
  }
});

entityRelationshipsRouter.get("/", async (req, res, next) => {
  try {
    const entityId = Number(req.query.entityId);
    if (!Number.isInteger(entityId)) {
      res.status(400).json({ error: "entityId query param is required" });
      return;
    }
    res.json(EntityRelationshipSchema.array().parse(await listRelationshipsFor(entityId, req.query.audience === "player" ? "player" : "gm")));
  } catch (err) {
    next(err);
  }
});

entityRelationshipsRouter.put("/:id/inside", async (req, res, next) => {
  const parentId = req.body.parentId;
  if (parentId !== null && (!Number.isInteger(parentId) || parentId <= 0)) {
    res.status(400).json({ error: "parentId must be a positive integer or null" });
    return;
  }
  try {
    await setLocationInside(Number(req.params.id), parentId);
    res.status(204).end();
  } catch (err) {
    if (err instanceof RelationshipError) {
      res.status(422).json({ error: err.message });
      return;
    }
    next(err);
  }
});

entityRelationshipsRouter.post("/", async (req, res, next) => {
  try {
    const parsed = EntityRelationshipInputSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid relationship input", details: parsed.error.flatten() });
      return;
    }
    const relationship = await createRelationship(parsed.data);
    res.status(201).json(EntityRelationshipSchema.parse(relationship));
  } catch (err) {
    if (err instanceof RelationshipError) {
      res.status(422).json({ error: err.message });
      return;
    }
    next(err);
  }
});

entityRelationshipsRouter.delete("/:id", async (req, res, next) => {
  try {
    const deleted = await deleteRelationship(Number(req.params.id));
    if (!deleted) {
      res.status(404).json({ error: "relationship not found" });
      return;
    }
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

entityRelationshipsRouter.patch("/:id", async (req, res, next) => {
  if (typeof req.body?.gmOnly !== "boolean") {
    res.status(400).json({ error: "gmOnly must be a boolean" });
    return;
  }
  try {
    const updated = await setRelationshipGmOnly(Number(req.params.id), req.body.gmOnly);
    if (!updated) {
      res.status(404).json({ error: "relationship not found" });
      return;
    }
    res.json(EntityRelationshipSchema.parse(updated));
  } catch (err) {
    next(err);
  }
});
