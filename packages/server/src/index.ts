import { resolve } from "node:path";

// Local secrets (GEMINI_API_KEY, ...) live in the repo-root .env. Loaded here
// in the real server only, so tests never pick up a live key. Real
// environment variables win over the file.
try {
  process.loadEnvFile(resolve(import.meta.dirname, "../../../.env"));
} catch {
  // no .env: fine, AI features fall back to their mocks
}

// Dynamic so they read the environment after .env is loaded.
const { createApp } = await import("./app.js");
const { config, ensureDataDirs } = await import("./config.js");
const { listEntities } = await import("./db/entities.js");
const { sweepOrphanedEntityImages, sweepStaleImageTemps } = await import("./image/cleanup.js");

ensureDataDirs();

// Schema first: a deployed container has no terminal to run db:migrate in.
{
  const { migrate } = await import("drizzle-orm/libsql/migrator");
  const { db } = await import("./db/client.js");
  await migrate(db, { migrationsFolder: config.migrationsDir });
}

// Best-effort housekeeping (bafft-ea7); a failure here shouldn't stop the server.
try {
  const temps = await sweepStaleImageTemps();
  const orphans = await sweepOrphanedEntityImages((await listEntities()).map((e) => e.id));
  if (temps || orphans) console.log(`image cleanup: ${temps} stale temp(s), ${orphans} orphaned folder(s)`);
} catch (err) {
  console.error("image cleanup failed:", err);
}

const { warnIfOpen } = await import("./routes/security.js");
warnIfOpen();
const app = createApp();

app.listen(config.port, () => {
  console.log(`bafft-server listening on http://localhost:${config.port}`);
  console.log(`  data dir: ${config.dataDir}`);
});
