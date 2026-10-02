import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { defineConfig } from "drizzle-kit";

// Self-contained (drizzle-kit's config loader doesn't resolve our NodeNext
// `.js`→`.ts` imports), so we recompute the db path here. Kept in sync with
// src/config.ts by convention.
const here = dirname(fileURLToPath(import.meta.url)); // packages/server
const dbPath =
  process.env.BAFFT_DATA_DIR
    ? resolve(process.env.BAFFT_DATA_DIR, "bafft.db")
    : resolve(here, "../../data/bafft.db");

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dbCredentials: { url: `file:${dbPath}` },
});
