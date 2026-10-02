// A session's speakers and who they are (bafft-wg1.12).
import { and, count, eq, inArray } from "drizzle-orm";
import type { Speaker, SpeakerHero, SpeakerUpdate } from "@bafft/shared";
import { db } from "./client.js";
import { entities, entityRelationships, sessionSpeakers, transcriptWords } from "./schema.js";

/** A player's hero is the character their "plays" relationship points at (as on the Players screen). */
const PLAYS = "plays";

export class SpeakerError extends Error {}

/** Every speaker in the session's transcript, most words first, with whoever the owner said they are. */
export async function listSpeakers(sessionId: number): Promise<Speaker[]> {
  const [labels, named] = await Promise.all([
    db
      .select({ speakerLabel: transcriptWords.speakerLabel, wordCount: count() })
      .from(transcriptWords)
      .where(eq(transcriptWords.sessionId, sessionId))
      .groupBy(transcriptWords.speakerLabel),
    db.select().from(sessionSpeakers).where(eq(sessionSpeakers.sessionId, sessionId)),
  ]);
  const byLabel = new Map(named.map((n) => [n.speakerLabel, n]));
  const heroes = await heroesFor(named.map((n) => n.entityId).filter((id) => id !== null));
  return labels
    .sort((a, b) => b.wordCount - a.wordCount || a.speakerLabel.localeCompare(b.speakerLabel))
    .map(({ speakerLabel, wordCount }) => {
      const n = byLabel.get(speakerLabel);
      return {
        speakerLabel,
        wordCount,
        name: n?.name ?? null,
        entityId: n?.entityId ?? null,
        hero: (n?.entityId && heroes.get(n.entityId)) || null,
      };
    });
}

/** Names a speaker, links it to an entity, or (blank name) puts it back to its label. Saved at once. */
export async function setSpeaker(sessionId: number, update: SpeakerUpdate): Promise<Speaker> {
  const [used] = await db
    .select({ n: count() })
    .from(transcriptWords)
    .where(and(eq(transcriptWords.sessionId, sessionId), eq(transcriptWords.speakerLabel, update.speakerLabel)));
  if (!used || used.n === 0) throw new SpeakerError("no such speaker in this session");
  const where = and(eq(sessionSpeakers.sessionId, sessionId), eq(sessionSpeakers.speakerLabel, update.speakerLabel));
  if (!update.name) {
    await db.delete(sessionSpeakers).where(where);
  } else {
    if (update.entityId !== null) {
      const [entity] = await db.select({ id: entities.id }).from(entities).where(eq(entities.id, update.entityId));
      if (!entity) throw new SpeakerError("no such entity");
    }
    await db
      .insert(sessionSpeakers)
      .values({ sessionId, speakerLabel: update.speakerLabel, name: update.name, entityId: update.entityId })
      .onConflictDoUpdate({
        target: [sessionSpeakers.sessionId, sessionSpeakers.speakerLabel],
        set: { name: update.name, entityId: update.entityId },
      });
  }
  const speaker = (await listSpeakers(sessionId)).find((s) => s.speakerLabel === update.speakerLabel);
  return speaker!;
}

/** The hero for each linked entity: a player's "plays" character, or a character itself. */
async function heroesFor(entityIds: number[]): Promise<Map<number, SpeakerHero>> {
  if (entityIds.length === 0) return new Map();
  const linked = await db.select().from(entities).where(inArray(entities.id, entityIds));
  const plays = await db
    .select({ playerId: entityRelationships.fromEntityId, heroId: entityRelationships.toEntityId })
    .from(entityRelationships)
    .where(and(inArray(entityRelationships.fromEntityId, entityIds), eq(entityRelationships.description, PLAYS)));
  const heroIds = plays.map((p) => p.heroId);
  const heroRows = heroIds.length > 0 ? await db.select().from(entities).where(inArray(entities.id, heroIds)) : [];
  const heroById = new Map(heroRows.map((h) => [h.id, h]));
  const result = new Map<number, SpeakerHero>();
  for (const e of linked) {
    const hero = e.type === "character" ? e : heroById.get(plays.find((p) => p.playerId === e.id)?.heroId ?? 0);
    if (hero) result.set(e.id, { id: hero.id, name: hero.name, imagePath: hero.imagePath, updatedAt: hero.updatedAt });
  }
  return result;
}
