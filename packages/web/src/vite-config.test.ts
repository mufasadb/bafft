// @vitest-environment node
import { expect, test } from "vitest";
import config from "../vite.config.js";

// Without /data, <img src="/data/..."> falls through to Vite's SPA fallback
// and saved pictures silently never render (found in the bafft-tj8 click-through).
test("the dev server proxies both /api and /data to the Express server", () => {
  expect(config.server?.proxy).toMatchObject({
    "/api": "http://localhost:3001",
    "/data": "http://localhost:3001",
  });
});
