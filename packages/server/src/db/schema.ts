// Drizzle schema. The sessions/transcript_words tables arrive in beads
// bafft-wg1.7 / .8.
import { sql } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  real,
  check,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
// Imported from the "./entity" subpath, not the "@bafft/shared" barrel:
// drizzle-kit's schema loader doesn't resolve NodeNext `.js`→`.ts` relative
// imports (same limitation noted in drizzle.config.ts), and the barrel's
// `export * from "./entity.js"` trips it. entity.ts itself has no relative
// imports, so importing it directly sidesteps the issue.
import { ENTITY_TYPES } from "@bafft/shared/entity";
import { SESSION_STATUSES } from "@bafft/shared/session";
import { GAME_SYSTEMS } from "@bafft/shared/campaign";
import type { NpcProfile } from "@bafft/shared/npc";
import type { BoardScene } from "@bafft/shared/soundboard";
import { CLIP_KINDS, SOUND_CATEGORIES, SOUND_SOURCES } from "@bafft/shared/soundboard";

/** Formats string enum values as a literal SQL `'a', 'b', 'c'` list for CHECK constraints. */
function toSqlList(values: readonly string[]): string {
  return values.map((v) => `'${v.replace(/'/g, "''")}'`).join(", ");
}

export const appMeta = sqliteTable("app_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// A real, editable campaign record (bafft-n0q). Still single-campaign in
// practice: the migration seeds id 1, which entities/sessions already
// default to. Their campaign_id columns aren't FK'd yet; that lands with
// real multi-campaign support.
export const campaigns = sqliteTable(
  "campaigns",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    gameSystem: text("game_system", { enum: GAME_SYSTEMS }).notNull().default("other"),
    styleAnchor: text("style_anchor"),
    settingNotes: text("setting_notes"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    check("campaigns_game_system_check", sql`${table.gameSystem} in (${sql.raw(toSqlList(GAME_SYSTEMS))})`),
  ],
);

// The polymorphic entities table — this IS the glossary (aliases compile
// into ASR keyterms) and doubles as the future canon graph's nodes.
// Relationships between entities (including location hierarchy) live in
// entityRelationships below, not as columns here — see its comment for why.
export const entities = sqliteTable(
  "entities",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    // Only campaign 1 exists this milestone; kept so a future multi-campaign
    // move isn't a breaking migration.
    campaignId: integer("campaign_id").notNull().default(1),
    type: text("type", { enum: ENTITY_TYPES }).notNull(),
    name: text("name").notNull(),
    // JSON array of strings — other real names/spellings, compiled into ASR
    // keyterms (spellings the vendor will output).
    aliases: text("aliases", { mode: "json" }).notNull().$type<string[]>(),
    // JSON array of pronunciation hints ("fyord"). Kept out of ASR keyterms,
    // which would write them into transcripts (bafft-aar).
    soundsLike: text("sounds_like", { mode: "json" }).notNull().$type<string[]>().default([]),
    notes: text("notes"),
    // Loose, filterable labels — same json-array pattern as aliases,
    // deliberately not a fixed vocabulary (bafft-yh2 design doc).
    tags: text("tags", { mode: "json" }).notNull().$type<string[]>().default([]),
    // AI-offered "color and quirks" bullets, kept separate from the owner's
    // own freeform `notes` so AI-suggested material stays visually and
    // structurally distinct. Always arrives as an editable draft — nothing
    // here is written without the owner approving it via the normal
    // create/update call (bafft-yh2.1).
    quirks: text("quirks", { mode: "json" }).notNull().$type<string[]>().default([]),
    // Set once a "picture this" generation is accepted (bafft-yh2.2). Same
    // relative-to-dataDir convention as sessions.audioPath.
    imagePath: text("image_path"),
    // Structured NPC details (bafft-vm8.1), validated by NpcProfileSchema at
    // the API edge. Null for other entity types.
    profile: text("profile", { mode: "json" }).$type<NpcProfile>(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    // CHECK constraints are DDL, not a parameterized query — the enum values
    // must be inlined as SQL literals (sql.raw), not bound as `?` params,
    // or the generated migration is invalid SQL. Values are our own
    // compile-time constants, so this isn't a string-building injection risk.
    check("entities_type_check", sql`${table.type} in (${sql.raw(toSqlList(ENTITY_TYPES))})`),
  ],
);

// Any entity can relate to any other entity, any number of times (an NPC can
// own a location AND have been born in a different one) — replaces an
// earlier single parent_id+relation_type pair on `entities`, which could
// only hold one relationship per entity. See the 2026-09-19/20 design
// conversation (Lattice memory: bafft-entity-relationships.md) for the full
// reasoning; this table is a from-scratch migration, not layered on top of
// that earlier shape, since no real campaign data existed yet to preserve.
export const entityRelationships = sqliteTable(
  "entity_relationships",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    // cascade: deleting an entity (no delete-guard-rails-beyond-a-confirm,
    // single user, per wg1.3) should also clear out relationships that
    // mention it, not leave dangling rows or reject the delete outright.
    fromEntityId: integer("from_entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    toEntityId: integer("to_entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    // Free text ("owner of", "born in", "located in", "sibling of", ...) —
    // normalised by suggesting/reusing existing wording at the app layer,
    // deliberately not a fixed enum (owner's call: real relationships don't
    // fit a short predetermined list).
    description: text("description").notNull(),
    // True only for the location-hierarchy "part of" family — the one kind
    // of relationship that's inheritable (filtering by a location also
    // surfaces everything nested inside it, transitively). Meaningful only
    // when both ends are type=location; enforced at the app layer (the
    // relationship-create helper in db/entity-relationships.ts), not a DB
    // CHECK, since SQLite can't cleanly cross-reference entities.type from
    // inside this table's own constraint.
    isContainment: integer("is_containment", { mode: "boolean" })
      .notNull()
      .default(false),
    gmOnly: integer("gm_only", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    // Hard limit (owner's explicit call): at most one outgoing containment
    // relationship per entity, so the location ladder stays a clean tree —
    // nothing "part of" two states at once.
    uniqueIndex("entity_relationships_one_containment_parent")
      .on(table.fromEntityId)
      .where(sql`${table.isContainment} = 1`),
  ],
);

// A session starts life as `uploaded` (session creation and audio upload
// are one atomic action — see routes/sessions.ts) and moves forward through
// transcribing -> transcribed -> labelled (bafft-wg1.8/.13).
export const sessions = sqliteTable(
  "sessions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    campaignId: integer("campaign_id").notNull().default(1),
    title: text("title").notNull(),
    // ISO "YYYY-MM-DD" — which session date, not a recording timestamp.
    sessionDate: text("session_date").notNull(),
    // Set once the uploaded file has been moved to its final
    // data/audio/{id}/ home; null only for the brief window mid-request.
    audioPath: text("audio_path"),
    status: text("status", { enum: SESSION_STATUSES }).notNull().default("uploaded"),
    // People at the table, passed to ASR as a speaker-count hint (bafft-wg1.6).
    speakersExpected: integer("speakers_expected"),
    // Provider that produced the current transcript_words, and the last
    // failed run's error (cleared on success) — bafft-wg1.6.
    transcriptionProvider: text("transcription_provider"),
    transcriptionError: text("transcription_error"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    check("sessions_status_check", sql`${table.status} in (${sql.raw(toSqlList(SESSION_STATUSES))})`),
  ],
);

// One row per ASR word. Written by the run-transcription action
// (bafft-wg1.8); speaker_label is renamed and text/is_uncertain corrected
// in place by the labelling UI (bafft-wg1.9/.11/.12) rather than rewritten
// wholesale, so corrections survive a session's single labelling pass.
export const transcriptWords = sqliteTable("transcript_words", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: integer("session_id")
    .notNull()
    .references(() => sessions.id),
  // Plain text, e.g. "Speaker 1" — not FK'd to entities this milestone.
  speakerLabel: text("speaker_label").notNull(),
  text: text("text").notNull(),
  startMs: integer("start_ms").notNull(),
  endMs: integer("end_ms").notNull(),
  confidence: real("confidence").notNull(),
  // Derived from a confidence threshold at transcription time, not
  // recomputed afterward — a correction shouldn't retroactively "uncertain"
  // itself away based on a threshold that may since have changed.
  isUncertain: integer("is_uncertain", { mode: "boolean" }).notNull(),
  corrected: integer("corrected", { mode: "boolean" }).notNull().default(false),
  // What the ASR wrote before the owner's first correction (bafft-wg1.11);
  // null until corrected. A fix that merges words ("Hooper Duke" ->
  // Hupperdook) keeps them all here, joined by spaces.
  heardText: text("heard_text"),
});

// Who each diarised speaker in a session is (bafft-wg1.12): "Speaker C" is
// Ava. A name over the raw label rather than a rewrite of
// transcript_words.speaker_label, so two speakers given the same name stay
// two (diarisation may have split one voice, or merged two) and a rename can
// always be undone. entityId links a player (whose hero shows beside them);
// name alone is free text for a guest. Removing the entity keeps the name.
export const sessionSpeakers = sqliteTable(
  "session_speakers",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sessionId: integer("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    speakerLabel: text("speaker_label").notNull(),
    name: text("name").notNull(),
    entityId: integer("entity_id").references(() => entities.id, { onDelete: "set null" }),
  },
  (table) => [uniqueIndex("session_speakers_one_per_label").on(table.sessionId, table.speakerLabel)],
);

// Sound library (bafft-c4d.5): each audio file stored once, referenced by
// any number of board clips.
export const soundAssets = sqliteTable(
  "sound_assets",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    campaignId: integer("campaign_id").notNull().default(1),
    title: text("title").notNull(),
    category: text("category", { enum: SOUND_CATEGORIES }).notNull(),
    tags: text("tags", { mode: "json" }).$type<string[]>().notNull().default([]),
    source: text("source", { enum: SOUND_SOURCES }).notNull().default("upload"),
    sourceId: text("source_id"),
    licence: text("licence"),
    attribution: text("attribution"),
    durationMs: integer("duration_ms"),
    // Relative to dataDir: sounds/{asset_id}/{file}.
    audioPath: text("audio_path").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    check("sound_assets_category_check", sql`${table.category} in (${sql.raw(toSqlList(SOUND_CATEGORIES))})`),
    check("sound_assets_source_check", sql`${table.source} in (${sql.raw(toSqlList(SOUND_SOURCES))})`),
    uniqueIndex("sound_assets_source_unique").on(table.source, table.sourceId),
  ],
);

// Soundboards (bafft-c4d): per-campaign boards of clips fired live at the table.
export const soundboards = sqliteTable("soundboards", {
  scenes: text("scenes", { mode: "json" }).$type<BoardScene[]>().notNull().default(sql`'[]'`),
  id: integer("id").primaryKey({ autoIncrement: true }),
  campaignId: integer("campaign_id").notNull().default(1),
  name: text("name").notNull(),
  position: integer("position").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// A library track placed on a board, with this board's settings for it.
export const soundClips = sqliteTable(
  "sound_clips",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    boardId: integer("board_id")
      .notNull()
      .references(() => soundboards.id),
    assetId: integer("asset_id")
      .notNull()
      .references(() => soundAssets.id),
    name: text("name").notNull(),
    kind: text("kind", { enum: CLIP_KINDS }).notNull().default("one-shot"),
    // "group" is an SQL keyword.
    group: text("clip_group"),
    volume: real("volume").notNull().default(0.8),
    fadeInMs: integer("fade_in_ms").notNull().default(0),
    colour: text("colour"),
    position: integer("position").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [check("sound_clips_kind_check", sql`${table.kind} in (${sql.raw(toSqlList(CLIP_KINDS))})`)],
);

// Session preparation notes, kept separately for each campaign (bafft-eic).
export const runSheets = sqliteTable("run_sheets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  campaignId: integer("campaign_id").notNull().default(1).references(() => campaigns.id),
  title: text("title").notNull(),
  markdown: text("markdown").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});
