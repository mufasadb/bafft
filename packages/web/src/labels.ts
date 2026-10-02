import type { EntityType } from "@bafft/shared";

export const TYPE_SINGULAR: Record<EntityType, string> = {
  player: "player",
  character: "character",
  npc: "NPC",
  item: "item",
  location: "location",
  faction: "faction",
};

export const TYPE_LABELS: Record<EntityType, string> = {
  player: "Players",
  character: "Characters",
  npc: "NPCs",
  item: "Items",
  location: "Locations",
  faction: "Factions",
};

/** "Location", "NPC": one of a type, capitalised for labels and dropdowns. */
export function typeName(type: EntityType): string {
  const s = TYPE_SINGULAR[type];
  return s[0]!.toUpperCase() + s.slice(1);
}
