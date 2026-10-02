import { test } from "node:test";
import assert from "node:assert/strict";
import { startApp } from "./harness.js";

test("password-protected real server rejects anonymous requests and supports authenticated browser use", async () => {
  const app = await startApp({ BAFFT_PASSWORD: "e2e-password" });
  try {
    assert.equal((await fetch(`${app.baseUrl}/api/health`)).status, 200);
    for (const path of ["/", "/api/sessions", "/data/images/test.png"]) {
      assert.equal((await fetch(`${app.baseUrl}${path}`)).status, 401);
    }
    const headers = { Authorization: `Basic ${Buffer.from("anyone:e2e-password").toString("base64")}` };
    assert.equal((await fetch(`${app.baseUrl}/api/sessions`, { headers })).status, 200);
    assert.equal((await fetch(app.baseUrl, { headers })).status, 200);
    assert.equal((await app.page.request.get(`${app.baseUrl}/api/sessions`)).status(), 200);
    await app.page.waitForSelector("#root > *");
  } finally { await app.close(); }
});
