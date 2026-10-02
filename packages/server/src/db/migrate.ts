// Applies pending Drizzle migrations, then exits. Run via `npm run db:migrate`.
import { migrate } from "drizzle-orm/libsql/migrator";
import { db, client } from "./client.js";
import { config } from "../config.js";

await migrate(db, { migrationsFolder: config.migrationsDir });
client.close();
console.log(`✓ migrations applied (${config.dbPath})`);
