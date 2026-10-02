// End-to-end harness (bafft-0oz): builds the web app, starts the real server
// on a free port with a throwaway data dir and the mock AI providers, and
// opens system Chrome through Playwright (no bundled browser download).
import { execSync, spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright";

const root = resolve(import.meta.dirname, "..");

function freePort(): Promise<number> {
  return new Promise((ok, fail) => {
    const srv = createServer();
    srv.listen(0, () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => ok(port));
    });
    srv.on("error", fail);
  });
}

export type App = { baseUrl: string; page: Page; close: () => Promise<void> };

export async function startApp(envOverride: NodeJS.ProcessEnv = {}): Promise<App> {
  if (!process.env.E2E_SKIP_BUILD) execSync("npx vite build", { cwd: join(root, "packages/web"), stdio: "ignore" });
  const dataDir = mkdtempSync(join(tmpdir(), "bafft-e2e-"));
  const port = await freePort();
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    BAFFT_PASSWORD: "",
    ...envOverride,
    PORT: String(port),
    BAFFT_DATA_DIR: dataDir,
    BAFFT_WEB_ROOT: join(root, "packages/web/dist"),
  };
  // Never call real vendors from a test run: without keys the mocks are used.
  // Blank, not deleted: the server loads the repo .env on start, which fills
  // in any key that's missing (but never overrides one that's set).
  for (const key of ["GEMINI_API_KEY", "ASSEMBLYAI_API_KEY", "DEEPGRAM_API_KEY", "SPEECHMATICS_API_KEY", "FREESOUND_API_KEY", "YOUTUBE_API_KEY"]) env[key] = "";
  const server: ChildProcess = spawn(join(root, "node_modules/.bin/tsx"), ["packages/server/src/index.ts"], {
    cwd: root,
    env,
    stdio: ["ignore", "ignore", "inherit"],
  });
  const baseUrl = `http://localhost:${port}`;
  for (let i = 0; ; i++) {
    try {
      if ((await fetch(`${baseUrl}/api/health`)).ok) break;
    } catch {
      // not listening yet
    }
    if (i > 80) throw new Error("bafft server didn't start");
    await new Promise((r) => setTimeout(r, 250));
  }
  const browser: Browser = await chromium.launch({ channel: "chrome" });
  // The owner's MacBook viewport.
  const page = await browser.newPage({
    viewport: { width: 1512, height: 982 },
    ...(env.BAFFT_PASSWORD ? { httpCredentials: { username: "e2e", password: env.BAFFT_PASSWORD } } : {}),
  });
  page.on("pageerror", (e) => console.error("page error:", e.message));
  await page.goto(baseUrl);
  return {
    baseUrl,
    page,
    async close() {
      await browser.close();
      server.kill();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}
