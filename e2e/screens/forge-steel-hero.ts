// A hero linked to Forge Steel (bafft-cb6), and its edit form. Invented data.
import type { Screens } from "../screenshot.js";

const PORTRAIT = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mN4n+L0HwAGEgK4L1a9UQAAAABJRU5ErkJggg==";

export default {
  async seed(api, app) {
    const hero = await api.post("/api/entities", {
      type: "character",
      name: "Brannoc Ashhelm",
      tags: ["party"],
      quirks: ["Carries his grandmother's maul", "Never sits with his back to a door"],
      profile: {
        forgeSteel: {
          url: "https://forgesteel.net/#/hero/view/example",
          ancestry: "Dwarf", className: "Fury", subclass: "Berserker", level: 2, career: "Soldier", culture: "Mountain hold",
          importedAt: new Date().toISOString(),
        },
      },
    });
    await fetch(`${app.baseUrl}/api/entities/${hero.id}/picture`, {
      method: "POST",
      headers: { "Content-Type": "image/png" },
      body: Buffer.from(PORTRAIT, "base64"),
    });
  },
  shots: [
    {
      name: "hero-card",
      async go(page) {
        await page.getByRole("button", { name: "Characters", exact: true }).click();
        await page.getByRole("button", { name: /Brannoc/ }).click();
        await page.locator(".forge-steel-line").waitFor();
      },
    },
    {
      name: "hero-form",
      async go(page) {
        await page.getByRole("button", { name: "Edit", exact: true }).click();
        await page.locator("fieldset.forge-steel").scrollIntoViewIfNeeded();
      },
    },
  ],
} satisfies Screens;
