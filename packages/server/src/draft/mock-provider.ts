// Stub provider returning one deterministic canned draft per entity type —
// lets the authoring UI (bafft-yh2.1) be built before a real LLM vendor is
// chosen. Ignores prompt/guided content, same as the ASR mock ignores its
// audio input.
import type { DraftProvider, DraftRequest, DraftedEntity, NpcDraft } from "@bafft/shared";

const CANNED_DRAFTS: Record<DraftRequest["type"], DraftedEntity> = {
  location: {
    name: "Drafted Location",
    aliases: [],
    tags: ["settlement"],
    quirks: [
      "Smells faintly of woodsmoke and low tide.",
      "Everyone here has a strong opinion about the weather.",
    ],
  },
  npc: {
    name: "Drafted NPC",
    aliases: [],
    tags: [],
    quirks: [
      "Speaks slowly, like every sentence costs something.",
      "Collects something nobody else finds interesting.",
    ],
  },
  character: {
    name: "Drafted Character",
    aliases: [],
    tags: [],
    quirks: ["Still carries something from home nobody's asked about yet."],
  },
  faction: {
    name: "Drafted Faction",
    aliases: [],
    tags: ["faction"],
    quirks: ["Pays in coin and expects loyalty in return."],
  },
  item: {
    name: "Drafted Item",
    aliases: [],
    tags: [],
    quirks: ["Older than it looks.", "Not quite what the last owner thought it was."],
  },
  player: {
    name: "Drafted Player Character",
    aliases: [],
    tags: [],
    quirks: ["Signed up for one thing, got another."],
  },
};

// A full canned NPC; the route's merge keeps whatever the GM already filled.
const CANNED_NPC: NpcDraft = {
  name: "Drafted NPC",
  tags: ["npc"],
  quirks: ["Speaks slowly, like every sentence costs something."],
  profile: {
    ancestry: "human",
    occupation: "ferryman",
    look: "rope-burned hands and a sodden felt hat",
    voice: "hums between sentences",
    behaviour: "counts coins twice, out loud",
    flaw: "can't turn down a wager",
    wants: "a boat of his own, free of the guild",
    can: "knows every current and every smuggler on the river",
    plan: "skim a coin from each fare until the boat is paid for",
    sideways: "cuts the rope and lets the ferry drift",
    story:
      "Helps because the heroes remind him of his lost son; refuses anything that crosses the river guild. His ferry keeps arriving one passenger heavier than it left. Secret: he sank the last ferry on purpose.",
    negotiation: {
      attitude: "neutral",
      impression: 1,
      language: "Caelian",
      motivations: [
        { kind: "greed", reason: "saving for a boat of his own" },
        { kind: "protection", reason: "keeps the river folk safe" },
      ],
      pitfalls: [{ kind: "higher authority", reason: "the guild squeezed him dry" }],
    },
  },
};

export const mockDraftProvider: DraftProvider = {
  name: "mock",
  async draft(request: DraftRequest): Promise<DraftedEntity> {
    return CANNED_DRAFTS[request.type];
  },
  async draftNpc(): Promise<NpcDraft> {
    return structuredClone(CANNED_NPC);
  },
};
