import { expect, test } from "vitest";
import { forgeSteelLink, heroLine, parseForgeSteelHero } from "./forgesteel.js";

// The shape of a Forge Steel .ds-hero export, trimmed to what bafft reads
// plus some of the noise around it. Invented hero.
const PNG = "data:image/png;base64,iVBORw0KGgo=";
const hero = {
  id: "abc123",
  name: "Brannoc Ashhelm",
  picture: PNG,
  folder: "",
  sourcebookIDs: [],
  ancestry: { id: "ancestry-dwarf", name: "Dwarf", description: "…", features: [], ancestryPoints: 3 },
  culture: { id: "c1", name: "Mountain hold", type: "Custom" },
  career: { id: "career-soldier", name: "Soldier", features: [] },
  class: {
    id: "class-fury",
    name: "Fury",
    level: 2,
    subclasses: [
      { id: "s1", name: "Berserker", selected: true },
      { id: "s2", name: "Reaver", selected: false },
    ],
  },
  complication: null,
  features: [],
  state: {},
  abilityCustomizations: [],
  isActive: true,
};

test("reads the name, summary and portrait from a .ds-hero file", () => {
  const imported = parseForgeSteelHero(JSON.stringify(hero));
  expect(imported.name).toBe("Brannoc Ashhelm");
  expect(imported.summary).toEqual({
    ancestry: "Dwarf",
    className: "Fury",
    subclass: "Berserker",
    level: 2,
    career: "Soldier",
    culture: "Mountain hold",
  });
  expect(imported.picture).toBe(PNG);
});

test("a hero half-built in Forge Steel still imports, with what it has", () => {
  const imported = parseForgeSteelHero(JSON.stringify({ ...hero, class: null, career: null, culture: null, picture: null }));
  expect(imported.summary).toEqual({ ancestry: "Dwarf" });
  expect(imported.picture).toBeNull();
});

test("only an uploaded image is taken as a portrait, never a remote address", () => {
  expect(parseForgeSteelHero(JSON.stringify({ ...hero, picture: "https://example.com/x.png" })).picture).toBeNull();
  expect(parseForgeSteelHero(JSON.stringify({ ...hero, picture: "data:image/svg+xml;base64,PHN2Zz4=" })).picture).toBeNull();
});

test("anything that isn't a hero gets a readable error", () => {
  expect(() => parseForgeSteelHero("not json")).toThrow(/isn't JSON/);
  expect(() => parseForgeSteelHero(JSON.stringify({ name: "A sword", type: "item" }))).toThrow(/isn't a Forge Steel hero/);
  expect(() => parseForgeSteelHero("null")).toThrow(/isn't a Forge Steel hero/);
});

test("the card line reads like Forge Steel's own", () => {
  expect(heroLine({ level: 2, ancestry: "Dwarf", className: "Fury", subclass: "Berserker" })).toBe("Level 2 Dwarf Fury (Berserker)");
  expect(heroLine({ ancestry: "Dwarf" })).toBe("Dwarf");
  expect(heroLine({})).toBe("");
});

test("links: any web address, nothing else", () => {
  expect(forgeSteelLink(" https://forgesteel.net/#/hero/view/abc123 ")).toBe("https://forgesteel.net/#/hero/view/abc123");
  expect(forgeSteelLink("http://192.0.2.10:8080/#/hero/view/abc")).toBe("http://192.0.2.10:8080/#/hero/view/abc");
  expect(forgeSteelLink("javascript:alert(1)")).toBeNull();
  expect(forgeSteelLink("forgesteel.net/#/hero")).toBeNull();
});
