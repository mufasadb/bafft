import type { ForgeSteelHero } from "@bafft/shared";

// Forge Steel (forgesteel.net) heroes, bafft-cb6. Forge Steel keeps its
// heroes in the browser, so bafft can't read one from a link: the GM links
// the hero's sheet, and imports the .ds-hero file Forge Steel exports to
// pull across a summary. The file is the whole Hero object as JSON; only a
// few names are read from it, and anything missing is simply left out.

/** What an imported .ds-hero gives bafft: the summary, the name, maybe a picture. */
export type ImportedHero = {
  name: string;
  summary: ForgeSteelHero;
  // A data: URL, as Forge Steel stores an uploaded portrait.
  picture: string | null;
};

type Named = { name?: unknown };

function nameOf(x: unknown): string | undefined {
  const name = (x as Named | null | undefined)?.name;
  return typeof name === "string" && name.trim() ? name.trim() : undefined;
}

/** Reads a .ds-hero file's text. Throws a readable error if it isn't one. */
export function parseForgeSteelHero(text: string): ImportedHero {
  let hero: Record<string, unknown>;
  try {
    hero = JSON.parse(text);
  } catch {
    throw new Error("That file isn't a Forge Steel hero (it isn't JSON).");
  }
  const name = nameOf(hero);
  if (!hero || typeof hero !== "object" || !name || !("class" in hero) || !("ancestry" in hero)) {
    throw new Error("That file isn't a Forge Steel hero. Export one from Forge Steel's hero page (.ds-hero).");
  }
  const heroClass = hero.class as (Named & { level?: unknown; subclasses?: (Named & { selected?: unknown })[] }) | null;
  const level = typeof heroClass?.level === "number" ? heroClass.level : undefined;
  const subclass = (heroClass?.subclasses ?? [])
    .filter((sc) => sc.selected)
    .map(nameOf)
    .filter(Boolean)
    .join(" / ");
  const picture = typeof hero.picture === "string" && /^data:image\/(png|jpeg|webp);base64,/.test(hero.picture)
    ? hero.picture
    : null;

  const summary: ForgeSteelHero = {
    ancestry: nameOf(hero.ancestry),
    className: nameOf(heroClass),
    subclass: subclass || undefined,
    level,
    career: nameOf(hero.career),
    culture: nameOf(hero.culture),
    complication: nameOf(hero.complication),
  };
  for (const key of Object.keys(summary) as (keyof ForgeSteelHero)[]) {
    if (summary[key] === undefined) delete summary[key];
  }
  return { name, summary, picture };
}

/** "Level 2 Dwarf Fury (Berserker)": the one line a card shows. */
export function heroLine(fs: ForgeSteelHero): string {
  const parts = [
    fs.level !== undefined ? `Level ${fs.level}` : "",
    fs.ancestry ?? "",
    fs.className ?? "",
  ].filter(Boolean);
  const line = parts.join(" ");
  return fs.subclass ? `${line} (${fs.subclass})`.trim() : line;
}

/**
 * Tidies a pasted link, or returns null if it isn't a web address. Any
 * http(s) address is fine: Forge Steel lives at forgesteel.net, on GitHub
 * Pages, and wherever a group self-hosts it. A hero sheet looks like
 * https://forgesteel.net/#/hero/view/<id>.
 */
export function forgeSteelLink(input: string): string | null {
  try {
    const url = new URL(input.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}
