// Real HTTP integration test, same pattern as routes/entities.test.ts.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { RunSheetSchema } from "@bafft/shared";

process.env.BAFFT_DATA_DIR = mkdtempSync(join(tmpdir(), "bafft-test-"));
// Never call a real AI vendor from tests, even if the shell has a key.
process.env.BAFFT_DRAFT_PROVIDER = "mock";
process.env.BAFFT_IMAGE_PROVIDER = "mock";

const { migrate } = await import("drizzle-orm/libsql/migrator");
const { campaigns } = await import("../db/schema.js");
const { db, client } = await import("../db/client.js");
const { config, ensureDataDirs } = await import("../config.js");
const { createApp } = await import("../app.js");

ensureDataDirs();
let baseUrl: string;
let server: import("node:http").Server;

before(async () => {
  await migrate(db, { migrationsFolder: config.migrationsDir });
  server = createApp().listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  client.close();
  rmSync(config.dataDir, { recursive: true, force: true });
});


async function request(path: string, method = "GET", body?: unknown) {
  return fetch(`${baseUrl}/api/run-sheets${path}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
}
test("CRUD persists Markdown, lists newest first and isolates campaigns", async () => {
  const firstRes = await request("", "POST", { title: " First ", markdown: "# Opening" });
  assert.equal(firstRes.status, 201);
  const first = RunSheetSchema.parse(await firstRes.json());
  assert.equal(first.title, "First"); assert.equal(first.campaignId, 1);
  const second = RunSheetSchema.parse(await (await request("", "POST", { title: "Second" })).json());
  const list = RunSheetSchema.array().parse(await (await request("")).json());
  assert.deepEqual(list.map(row => row.id), [second.id, first.id]);
  const patched = RunSheetSchema.parse(await (await request(`/${first.id}`, "PATCH", { markdown: "## Changed" })).json());
  assert.equal(patched.title, "First"); assert.ok(patched.updatedAt >= first.updatedAt);
  assert.equal(RunSheetSchema.parse(await (await request(`/${first.id}`)).json()).markdown, "## Changed");
  const [otherCampaign] = await db.insert(campaigns).values({ name: "Other campaign" }).returning();
  const other = RunSheetSchema.parse(await (await request("", "POST", { title: "Other session", campaignId: otherCampaign.id })).json());
  assert.deepEqual(RunSheetSchema.array().parse(await (await request(`?campaignId=${otherCampaign.id}`)).json()).map(row => row.id), [other.id]);
  assert.equal(RunSheetSchema.array().parse(await (await request("")).json()).length, 2);
  assert.equal((await request(`/${first.id}`, "DELETE")).status, 204);
  assert.equal((await request(`/${first.id}`)).status, 404);
  assert.equal((await request(`/${first.id}`, "PATCH", { title: "gone" })).status, 404);
  assert.equal((await request(`/${first.id}`, "DELETE")).status, 404);
});
test("invalid inputs and missing campaigns return client errors", async () => {
  for (const body of [{ title: " " }, { title: "x", markdown: 12 }, { title: "x", campaignId: -1 }, { title: "x", markdown: "x".repeat(100001) }]) {
    assert.equal((await request("", "POST", body)).status, 400);
  }
  assert.equal((await request("", "POST", { title: "x", campaignId: 99 })).status, 404);
  assert.equal((await request("?campaignId=nope")).status, 400);
  assert.equal((await request("/abc")).status, 400);
  assert.equal((await request("/1", "PATCH", { title: "" })).status, 400);
});
