import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { warnIfOpen } from "./security.js";

process.env.BAFFT_DATA_DIR = mkdtempSync(join(tmpdir(), "bafft-security-"));
process.env.BAFFT_MAX_UPLOAD_MB = "0.001953125"; // 2048 bytes, exercise streaming cheaply
const { createApp } = await import("../app.js");
const { config, ensureDataDirs } = await import("../config.js");
const { db, client } = await import("../db/client.js");
const { migrate } = await import("drizzle-orm/libsql/migrator");
before(() => migrate(db, { migrationsFolder: config.migrationsDir }));
const { uploadLimitMb } = await import("./uploads.js");
ensureDataDirs();
after(() => { client.close(); rmSync(config.dataDir, { recursive: true, force: true }); });

async function withApp(run: (url: string) => Promise<void>) {
  const server = createApp().listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  try { await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`); }
  finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
}
const credentials = (password: string, username = "anyone") => ({
  Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
});

test("password guards API, files, SPA, unknown routes and methods; only GET health is public", async () => {
  process.env.BAFFT_PASSWORD = "secret:with:colons";
  try {
    await withApp(async (url) => {
      assert.equal((await fetch(`${url}/api/health`)).status, 200);
      for (const path of ["/api/sessions", "/data/images/example.png", "/", "/unknown", "/api/health/"]) {
        const response = await fetch(`${url}${path}`);
        assert.equal(response.status, 401);
        assert.match(response.headers.get("www-authenticate")!, /^Basic /);
      }
      for (const method of ["POST", "HEAD", "OPTIONS"]) {
        assert.equal((await fetch(`${url}/api/health`, { method })).status, 401);
      }
      for (const Authorization of ["Basic !!!!", "Bearer secret", "Basic " + Buffer.from("no-colon").toString("base64")]) {
        assert.equal((await fetch(`${url}/api/health`, { method: "POST", headers: { Authorization } })).status, 401);
      }
      for (const password of ["wrong", "", "secret:with:colon", "x".repeat(1000)]) {
        assert.equal((await fetch(`${url}/api/health`, { method: "POST", headers: credentials(password) })).status, 401);
      }
      for (const username of ["owner", "", "someone else"]) {
        assert.equal((await fetch(`${url}/api/health`, { headers: credentials("secret:with:colons", username) })).status, 200);
        assert.equal((await fetch(`${url}/unknown`, { headers: credentials("secret:with:colons", username) })).status, 404);
      }
      // Authentication happens before JSON parsing.
      assert.equal((await fetch(`${url}/api/sessions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" })).status, 401);
    });
  } finally { delete process.env.BAFFT_PASSWORD; }
});

test("unset password preserves open access and startup warns", async (t) => {
  const warning = t.mock.method(console, "warn", () => {});
  warnIfOpen("");
  assert.match(String(warning.mock.calls[0]!.arguments[0]), /open to anyone who can reach the port/);
  warnIfOpen("secret");
  assert.equal(warning.mock.callCount(), 1);
  await withApp(async (url) => {
    assert.equal((await fetch(`${url}/api/health`)).status, 200);
    assert.equal((await fetch(`${url}/unknown`)).status, 404);
  });
});

test("upload defaults and configuration validation", () => {
  assert.equal(uploadLimitMb(""), 4096);
  assert.equal(uploadLimitMb("10"), 10);
  for (const value of ["0", "-1", "NaN", "Infinity", "nope"]) assert.throws(() => uploadLimitMb(value), /BAFFT_MAX_UPLOAD_MB/);
});

test("both upload routes return clear 413 and remove partial files", async () => {
  await withApp(async (url) => {
    for (const route of ["sessions", "sound-assets"]) {
      const form = new FormData();
      form.set("audio", new Blob([new Uint8Array(2049)]), "large.wav");
      const response = await fetch(`${url}/api/${route}`, { method: "POST", body: form });
      assert.equal(response.status, 413);
      assert.match((await response.json() as { error: string }).error, /Upload exceeds .* MB file size limit/);
      assert.deepEqual(readdirSync(config.uploadsTmpDir), []);
      // A file below the cap still uploads successfully.
      const small = new FormData();
      small.set("title", "Below cap");
      small.set("sessionDate", "2026-10-02");
      small.set("audio", new Blob([new Uint8Array(2047)]), "small.wav");
      assert.equal((await fetch(`${url}/api/${route}`, { method: "POST", body: small })).status, 201);
    }
  });
});

test("production last-resort error response hides details but logs them; development retains details", async (t) => {
  const logged = t.mock.method(console, "error", () => {});
  const previous = process.env.NODE_ENV;
  try {
    for (const mode of ["production", "development"]) {
      process.env.NODE_ENV = mode;
      await withApp(async (url) => {
        const response = await fetch(`${url}/api/sessions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{private-detail" });
        assert.equal(response.status, 500);
        const { error } = await response.json() as { error: string };
        if (mode === "production") assert.equal(error, "internal error");
        else assert.notEqual(error, "internal error");
      });
    }
    assert.equal(logged.mock.callCount(), 2);
    assert.ok(logged.mock.calls[0]!.arguments[0] instanceof Error);
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});
