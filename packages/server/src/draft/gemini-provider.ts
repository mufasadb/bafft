// Gemini drafting (bafft-yh2.4). Structured JSON output shaped like
// DraftedEntity, steered by the campaign's game system and setting notes.
import {
  ATTITUDES,
  DRAW_STEEL_LANGUAGES,
  DraftedEntitySchema,
  MOTIVATIONS,
  NpcDraftSchema,
  type NpcDraft,
  type NpcDraftRequest,
  GAME_SYSTEM_LABELS,
  GUIDED_FIELDS,
  type DraftContext,
  type DraftProvider,
  type DraftRequest,
  type DraftedEntity,
  type EntityType,
  NPC_STORY_FIELDS,
} from "@bafft/shared";
import { generateContent } from "../gemini/client.js";

const TYPE_NOUNS: Record<EntityType, string> = {
  player: "player character",
  character: "character",
  npc: "NPC",
  item: "item",
  location: "location",
  faction: "faction (a group, company, guild or cult)",
};

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string" },
    aliases: { type: "array", items: { type: "string" } },
    tags: { type: "array", items: { type: "string" } },
    quirks: { type: "array", items: { type: "string" } },
  },
  required: ["name", "aliases", "tags", "quirks"],
};

export function buildSystemInstruction(context?: DraftContext): string {
  const lines = [
    "You help a tabletop RPG game master build their world.",
    "Write vivid, specific details a GM can use at the table: concrete sensory detail, a habit, a want, a hook or a secret. Avoid generic fantasy filler.",
  ];
  if (context && context.gameSystem !== "other") {
    const system = GAME_SYSTEM_LABELS[context.gameSystem];
    lines.push(`The game system is ${system}. Use its own ancestries, classes, and terms where they fit.`);
  }
  if (context?.settingNotes) lines.push(`About this campaign's setting:\n${context.settingNotes}`);
  lines.push(
    "Fields: name is a fitting, memorable name. aliases are other names or nicknames people would use at the table (may be empty). tags are 2-5 short lowercase labels. quirks are 3-5 bullet points, one or two sentences each.",
  );
  return lines.join("\n\n");
}

export function buildUserPrompt(request: DraftRequest): string {
  const head = `Draft a ${TYPE_NOUNS[request.type]}.`;
  if (request.prompt) return `${head} ${request.prompt}`;
  const labels = new Map(GUIDED_FIELDS[request.type].map((f) => [f.key, f.label]));
  const answers = Object.entries(request.guided ?? {})
    .filter(([, v]) => v.trim())
    .map(([k, v]) => `${labels.get(k) ?? k}: ${v.trim()}`);
  return [head, ...answers].join("\n");
}

// Field guidance follows the Director's "Creating NPCs" checklist (Heroes p.379).
const NPC_FIELD_GUIDE: Record<string, string> = {
  ancestry: "their ancestry",
  occupation: "job or role, 1-4 words",
  look: "one notable look or smell, a short phrase",
  voice:
    "an accent plus one signature feature of delivery, so the GM can play them the same way every time, e.g. 'Irish accent, high-pitched Christopher Walken cadence' or 'Cockney mother who yells every sentence, like Howard's mum'",
  behaviour: "one behaviour quirk visible in a scene",
  flaw: "one flaw that could cause trouble",
  wants: "what they want most right now, one sentence",
  can: "what they can do about it: power, skills, resources, people, one sentence",
  plan: "the steps they're taking to get it, one or two sentences",
  sideways: "what they do if things go wrong for them, one sentence",
  story:
    "their part in the story, open-ended, 2-4 sentences: what would make them help or refuse the heroes, a hook they carry, a secret",
};

const REASONED = {
  type: "array",
  items: {
    type: "object",
    properties: { kind: { type: "string", enum: [...MOTIVATIONS] }, reason: { type: "string" } },
    required: ["kind", "reason"],
  },
};

function npcResponseSchema(withNegotiation: boolean) {
  const profileProps: Record<string, unknown> = Object.fromEntries(
    Object.keys(NPC_FIELD_GUIDE).map((k) => [k, { type: "string" }]),
  );
  if (withNegotiation) {
    profileProps.negotiation = {
      type: "object",
      properties: {
        attitude: { type: "string", enum: [...ATTITUDES] },
        impression: { type: "integer", minimum: 1, maximum: 12 },
        language: { type: "string" },
        motivations: REASONED,
        pitfalls: REASONED,
      },
      required: ["attitude", "impression", "language", "motivations", "pitfalls"],
    };
  }
  return {
    type: "object",
    properties: {
      name: { type: "string" },
      tags: { type: "array", items: { type: "string" } },
      quirks: { type: "array", items: { type: "string" } },
      profile: { type: "object", properties: profileProps, required: Object.keys(profileProps) },
    },
    required: ["name", "tags", "quirks", "profile"],
  };
}

export function buildNpcPrompt(request: NpcDraftRequest, withNegotiation: boolean, canon: string[] = []): string {
  const lines = ["Create one NPC. Fill every field."];
  if (request.blurb?.trim()) lines.push(`The GM's idea: ${request.blurb.trim()}`);
  if (canon.length) {
    lines.push("Canon from the GM's world. Never contradict it:", ...canon.map((c) => `- ${c}`));
  }
  if (request.colourOnly) {
    lines.push(
      `The GM writes this NPC's story. Put your effort into look, voice, behaviour, flaw, quirks and tags; keep ${NPC_STORY_FIELDS.join(", ")} to a few plain words (they will be discarded).`,
    );
  }
  const given = Object.entries({ name: request.name, ...request.profile })
    .filter(([k, v]) => k !== "negotiation" && typeof v === "string" && v.trim())
    .map(([k, v]) => `- ${k}: ${v}`);
  if (request.aliases?.length) given.push(`- other names: ${request.aliases.join(", ")}`);
  if (request.tags?.length) given.push(`- tags: ${request.tags.join(", ")}`);
  if (request.quirks?.length) given.push(`- quirks already written (keep them, add different ones): ${request.quirks.join(" | ")}`);
  if (given.length) {
    lines.push("The GM already decided these. Repeat them exactly and build everything else to fit them:", ...given);
  }
  const n = request.profile.negotiation;
  if (withNegotiation && n) {
    const reasoned = (m: { kind: string; reason: string }) => (m.reason.trim() ? `${m.kind} (${m.reason.trim()})` : m.kind);
    const picks = [
      n.attitude && `attitude ${n.attitude}`,
      n.impression && `impression ${n.impression}`,
      n.language && `language ${n.language}`,
      n.motivations.length && `motivations ${n.motivations.map(reasoned).join(", ")}`,
      n.pitfalls.length && `pitfalls ${n.pitfalls.map(reasoned).join(", ")}`,
      n.offers?.length && `offers by interest ${n.offers.map((o) => `${o.interest}: ${o.offer}`).join("; ")}`,
    ].filter(Boolean);
    if (picks.length) lines.push(`Negotiation already decided: ${picks.join("; ")}.`);
  }
  lines.push("Field guide:", ...Object.entries(NPC_FIELD_GUIDE).map(([k, v]) => `- ${k}: ${v}`));
  lines.push("tags: 2-5 short lowercase labels. quirks: 2-4 extra bullet points of colour, not repeating the fields.");
  if (withNegotiation) {
    lines.push(
      `negotiation (Draw Steel): attitude toward the heroes on first meeting; impression 1-12 (1 commoner, 3 noble or cult leader, 5 high priest, 10 monarch); their native language, using Draw Steel's real language names (by ancestry: ${Object.entries(DRAW_STEEL_LANGUAGES).map(([a, l]) => `${a} ${l}`).join(", ")}; Caelian is the common tongue); exactly 2 motivations and 2 pitfalls (keep any the GM chose and add to reach two of each), each with a one-line reason tied to this NPC. A kind can't be both a motivation and a pitfall.`,
    );
  }
  return lines.join("\n");
}

/** Drops anything the book's rules don't allow before strict parsing. */
function sanitiseNpc(raw: unknown): unknown {
  const draft = raw as { profile?: { negotiation?: Record<string, unknown> } };
  const n = draft.profile?.negotiation;
  if (n) {
    const valid = (list: unknown) =>
      (Array.isArray(list) ? list : []).filter((m) => (MOTIVATIONS as readonly string[]).includes(m?.kind));
    const motivations = valid(n.motivations);
    const used = new Set(motivations.map((m) => m.kind));
    n.motivations = motivations;
    n.pitfalls = valid(n.pitfalls).filter((m) => !used.has(m.kind));
    if (typeof n.impression === "number") n.impression = Math.min(12, Math.max(1, Math.round(n.impression)));
    if (!(ATTITUDES as readonly string[]).includes(n.attitude as string)) delete n.attitude;
  }
  return draft;
}

export function geminiDraftModel(): string {
  return process.env.BAFFT_GEMINI_TEXT_MODEL ?? "gemini-3.8-flash";
}

export const geminiDraftProvider: DraftProvider = {
  name: "gemini",
  async draft(request: DraftRequest, context?: DraftContext): Promise<DraftedEntity> {
    const parts = await generateContent(geminiDraftModel(), {
      systemInstruction: { parts: [{ text: buildSystemInstruction(context) }] },
      contents: [{ role: "user", parts: [{ text: buildUserPrompt(request) }] }],
      generationConfig: { responseMimeType: "application/json", responseJsonSchema: RESPONSE_SCHEMA },
    });
    const text = parts.map((p) => p.text ?? "").join("");
    return DraftedEntitySchema.parse(JSON.parse(text));
  },
  async draftNpc(request: NpcDraftRequest, context?: DraftContext): Promise<NpcDraft> {
    const withNegotiation = context?.gameSystem === "draw-steel";
    const parts = await generateContent(geminiDraftModel(), {
      systemInstruction: { parts: [{ text: buildSystemInstruction(context) }] },
      contents: [{ role: "user", parts: [{ text: buildNpcPrompt(request, withNegotiation, context?.canon) }] }],
      generationConfig: { responseMimeType: "application/json", responseJsonSchema: npcResponseSchema(withNegotiation) },
    });
    const text = parts.map((p) => p.text ?? "").join("");
    return NpcDraftSchema.parse(sanitiseNpc(JSON.parse(text)));
  },
};
