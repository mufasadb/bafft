// Single shared Drizzle client over a local SQLite file, via libsql.
// libsql ships prebuilt binaries (no native compile) and has a plain-file mode,
// which keeps this robust on new Node versions and clean for a Docker volume.
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { config, ensureDataDirs } from "../config.js";
import * as schema from "./schema.js";

ensureDataDirs();

export const client = createClient({ url: `file:${config.dbPath}` });
export const db = drizzle(client, { schema });
