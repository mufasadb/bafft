// App construction, separated from the process bootstrap (index.ts) so
// tests can build a real Express instance without binding a port.
import { join } from "node:path";
import express from "express";
import multer from "multer";
import { passwordAuth } from "./routes/security.js";
import { maxUploadMb } from "./routes/uploads.js";
import { HealthSchema } from "@bafft/shared";
import { config } from "./config.js";
import { sessionsRouter } from "./routes/sessions.js";
import { entitiesRouter } from "./routes/entities.js";
import { entityRelationshipsRouter } from "./routes/entity-relationships.js";
import { runSheetsRouter } from "./routes/run-sheets.js";
import { campaignsRouter } from "./routes/campaigns.js";
import { catalogueRouter, soundAssetsRouter, soundClipsRouter, soundboardsRouter } from "./routes/soundboards.js";

export function createApp() {
  const app = express();
  app.use(passwordAuth());
  app.use(express.json());
  // API data changes constantly (drafts, rolls, edits): no ETags, no caching.
  // A 304 from a revalidated GET was reaching the web client as an error.
  app.set("etag", false);
  app.use("/api", (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  // Saved entity pictures (imagePath is "images/..."), served as files. Only
  // that folder: the data dir also holds bafft.db and uploaded audio, which
  // must not be downloadable (bafft-bfz); audio has its own routes.
  app.use("/data/images", express.static(config.imagesDir));

  app.get("/api/health", (_req, res) => {
    const health = HealthSchema.parse({
      status: "ok",
      service: "bafft-server",
      time: new Date().toISOString(),
    });
    res.json(health);
  });

  app.use("/api/sessions", sessionsRouter);
  app.use("/api/entities", entitiesRouter);
  app.use("/api/entity-relationships", entityRelationshipsRouter);
  app.use("/api/campaigns", campaignsRouter);
  app.use("/api/run-sheets", runSheetsRouter);
  app.use("/api/sound-assets", soundAssetsRouter);
  app.use("/api/catalogue", catalogueRouter);
  app.use("/api/soundboards", soundboardsRouter);
  app.use("/api/sound-clips", soundClipsRouter);

  // Production (the Docker image): the SPA and its assets on the same origin.
  // Any other GET outside /api is a client-side route, so it gets index.html.
  if (config.webRoot) {
    const webRoot = config.webRoot;
    app.use(express.static(webRoot, { index: false }));
    app.get(/^\/(?!api\/|data\/).*/, (_req, res) => res.sendFile(join(webRoot, "index.html")));
  }

  // Last-resort JSON error handler (covers thrown validation/multer errors
  // from the routers above instead of Express's default HTML error page).
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({ error: `Upload exceeds the ${maxUploadMb} MB file size limit` });
      return;
    }
    console.error(err);
    res.status(500).json({ error: process.env.NODE_ENV === "production"
      ? "internal error"
      : err instanceof Error ? err.message : "internal error" });
  });

  return app;
}
