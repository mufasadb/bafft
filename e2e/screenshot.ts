// Screenshots of the real app with seeded, invented data (bafft-trc): for
// READMEs, design reviews and showing the owner a change. Not a test.
//
//   npx tsx e2e/screenshot.ts e2e/screens/forge-steel-hero.ts [--out <dir>]
//
// A screens module default-exports { seed?, shots }: `seed` fills a fresh
// throwaway app through its HTTP API, then each shot drives the page to a
// screen and is saved as <out>/<name>.png (default out: a temp dir, printed).
// Mock AI and no vendor keys, same as the e2e harness. The app is always
// closed, even when a step throws, so no server is left running.
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Page } from "playwright";
import { startApp, type App } from "./harness.js";

/** A small JSON client for seeding. Some routes answer with an empty body, so json is optional. */
export type SeedApi = {
  get: <T = any>(path: string) => Promise<T>;
  post: <T = any>(path: string, body?: unknown) => Promise<T>;
  put: <T = any>(path: string, body?: unknown) => Promise<T>;
  patch: <T = any>(path: string, body?: unknown) => Promise<T>;
};

export type Screens = {
  seed?: (api: SeedApi, app: App) => Promise<void>;
  shots: { name: string; go: (page: Page, app: App) => Promise<void>; fullPage?: boolean }[];
};

function seedApi(baseUrl: string): SeedApi {
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${text}`);
    return text ? JSON.parse(text) : undefined;
  };
  return {
    get: (p) => call("GET", p),
    post: (p, b) => call("POST", p, b),
    put: (p, b) => call("PUT", p, b),
    patch: (p, b) => call("PATCH", p, b),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const outAt = args.indexOf("--out");
  const out = outAt >= 0 ? resolve(args.splice(outAt, 2)[1]!) : mkdtempSync(join(tmpdir(), "bafft-shots-"));
  const modulePath = args[0];
  if (!modulePath) throw new Error("usage: npx tsx e2e/screenshot.ts <screens module> [--out <dir>]");
  const screens: Screens = (await import(pathToFileURL(resolve(modulePath)).href)).default;
  mkdirSync(out, { recursive: true });

  const app = await startApp();
  try {
    await screens.seed?.(seedApi(app.baseUrl), app);
    await app.page.reload();
    for (const shot of screens.shots) {
      await shot.go(app.page, app);
      const file = join(out, `${shot.name}.png`);
      await app.page.screenshot({ path: file, fullPage: shot.fullPage ?? false });
      console.log(file);
    }
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
