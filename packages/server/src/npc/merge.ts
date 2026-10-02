// Merges an AI NPC draft under what the GM already wrote (bafft-vm8.3): the
// GM's values always win, the AI only fills gaps, and the Draw Steel rules
// (fixed motivation list, never both a motivation and a pitfall) hold no
// matter what the model returned.
import {
  NPC_STORY_FIELDS,
  NPC_TEXT_FIELDS,
  NegotiationSchema,
  type Negotiation,
  type NpcDraft,
  type NpcDraftRequest,
  type NpcProfile,
} from "@bafft/shared";

const MIN_MOTIVATIONS = 2;
// Draw Steel NPCs always get at least two of each (owner, bafft-w8f.13).
const MIN_PITFALLS = 2;

type Reasoned = Negotiation["motivations"][number];

function filled(value: string | undefined): value is string {
  return Boolean(value?.trim());
}

/** GM picks first (reasons filled from the AI where the GM left them blank),
 * then AI picks up to `min`, skipping any kind already used elsewhere. */
function mergePicks(gm: Reasoned[], ai: Reasoned[], min: number, taken: Set<string>): Reasoned[] {
  const aiReason = new Map(ai.map((m) => [m.kind, m.reason]));
  const result = gm.map((m) => ({ kind: m.kind, reason: filled(m.reason) ? m.reason : (aiReason.get(m.kind) ?? "") }));
  for (const m of ai) {
    if (result.length >= min) break;
    if (taken.has(m.kind)) continue;
    result.push(m);
    taken.add(m.kind);
  }
  return result;
}

function mergeNegotiation(gm: Negotiation | undefined, ai: Negotiation | undefined): Negotiation | undefined {
  if (!gm && !ai) return undefined;
  // Reserve every kind the GM chose, in either list, before the AI tops up.
  const taken = new Set<string>([...(gm?.motivations ?? []), ...(gm?.pitfalls ?? [])].map((m) => m.kind));
  const motivations = mergePicks(gm?.motivations ?? [], ai?.motivations ?? [], MIN_MOTIVATIONS, taken);
  const pitfalls = mergePicks(gm?.pitfalls ?? [], ai?.pitfalls ?? [], MIN_PITFALLS, taken);
  return NegotiationSchema.parse({
    attitude: gm?.attitude ?? ai?.attitude,
    impression: gm?.impression ?? ai?.impression,
    language: filled(gm?.language) ? gm.language : ai?.language,
    motivations,
    pitfalls,
    // Only the GM writes offers; the AI isn't asked for them (bafft-w8f.4).
    offers: gm?.offers,
  });
}

export function mergeNpcDraft(request: NpcDraftRequest, ai: NpcDraft, includeNegotiation: boolean): NpcDraft {
  const gm: NpcProfile = request.profile ?? {};
  const profile: NpcProfile = {};
  const story = new Set<string>(NPC_STORY_FIELDS);
  for (const field of NPC_TEXT_FIELDS) {
    // "Keep to my notes" (bafft-w8f.10): the AI's story is dropped, whatever it wrote.
    const fromAi = request.colourOnly && story.has(field) ? undefined : ai.profile[field];
    const value = filled(gm[field]) ? gm[field] : fromAi;
    if (filled(value)) profile[field] = value;
  }
  const negotiation = includeNegotiation ? mergeNegotiation(gm.negotiation, ai.profile.negotiation) : gm.negotiation;
  if (negotiation) profile.negotiation = negotiation;
  return {
    name: filled(request.name) ? request.name : ai.name,
    tags: ai.tags,
    quirks: ai.quirks,
    profile,
  };
}
