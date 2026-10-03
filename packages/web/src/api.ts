// Typed wrappers over the server's JSON API. Every call throws ApiError with
// the server's own `error` message on a non-2xx, so callers can surface it.
import {
  CampaignSchema,
  RunSheetSchema,
  type RunSheetInput,
  type RunSheetUpdate,
  DraftedEntitySchema,
  EntityRelationshipSchema,
  EntitySchema,
  EntityWithChildrenSchema,
  GlossaryEntrySchema,
  NameMatchSchema,
  NpcDraftSchema,
  NpcProfileSchema,
  SessionSchema,
  CatalogueSearchSchema,
  ImportScanResultSchema,
  ImportStatusSchema,
  SoundAssetSchema,
  SoundClipSchema,
  SoundboardSchema,
  SoundboardWithClipsSchema,
  TranscriptWordSchema,
  SpeakerSchema,
  type SpeakerUpdate,
  WordCorrectionResultSchema,
  type WordCorrection,
  type CampaignUpdate,
  type DraftRequest,
  type EntityInput,
  type EntityRelationshipInput,
  type EntityUpdate,
  type NpcDraftRequest,
  type NpcProfile,
  type CatalogueSource,
  type SoundAssetUpdate,
  type SoundCategory,
  type SoundClipUpdate,
  YouTubeResultSchema,
} from "@bafft/shared";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function send(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(path, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body.error ?? `request failed (${res.status})`, res.status);
  }
  return res;
}

function jsonBody(method: string, body: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

export const api = {
  async listRunSheets(campaignId = 1) {
    return RunSheetSchema.array().parse(await (await send(`/api/run-sheets?campaignId=${campaignId}`)).json());
  },
  async saveRunSheet(id: number | null, body: RunSheetInput | RunSheetUpdate) {
    return RunSheetSchema.parse(await (await send(id === null ? "/api/run-sheets" : `/api/run-sheets/${id}`, jsonBody(id === null ? "POST" : "PATCH", body))).json());
  },
  async deleteRunSheet(id: number) {
    await send(`/api/run-sheets/${id}`, { method: "DELETE" });
  },
  async listSessions() {
    return SessionSchema.array().parse(await (await send("/api/sessions")).json());
  },
  async getSession(id: number) {
    return SessionSchema.parse(await (await send(`/api/sessions/${id}`)).json());
  },
  async listWords(sessionId: number) {
    return TranscriptWordSchema.array().parse(await (await send(`/api/sessions/${sessionId}/words`)).json());
  },
  async listNameMatches(sessionId: number) {
    return NameMatchSchema.array().parse(await (await send(`/api/sessions/${sessionId}/name-matches`)).json());
  },
  async listSpeakers(sessionId: number) {
    return SpeakerSchema.array().parse(await (await send(`/api/sessions/${sessionId}/speakers`)).json());
  },
  async setSpeaker(sessionId: number, update: SpeakerUpdate) {
    return SpeakerSchema.parse(await (await send(`/api/sessions/${sessionId}/speakers`, jsonBody("PUT", update))).json());
  },
  async correctWords(sessionId: number, correction: WordCorrection) {
    const res = await send(`/api/sessions/${sessionId}/words`, jsonBody("PATCH", correction));
    return WordCorrectionResultSchema.parse(await res.json());
  },
  async transcribe(sessionId: number) {
    return SessionSchema.parse(await (await send(`/api/sessions/${sessionId}/transcribe`, { method: "POST" })).json());
  },
  async getCampaign(id: number) {
    return CampaignSchema.parse(await (await send(`/api/campaigns/${id}`)).json());
  },
  async saveCampaign(id: number, body: CampaignUpdate) {
    return CampaignSchema.parse(await (await send(`/api/campaigns/${id}`, jsonBody("PATCH", body))).json());
  },
  async getGlossary() {
    return GlossaryEntrySchema.array().parse(await (await send("/api/entities/glossary")).json());
  },
  async listEntities() {
    return EntitySchema.array().parse(await (await send("/api/entities")).json());
  },
  async getLocationTree() {
    return EntityWithChildrenSchema.array().parse(await (await send("/api/entities/tree")).json());
  },
  async saveEntity(id: number | null, body: Partial<EntityInput> | EntityUpdate) {
    const res = await send(id ? `/api/entities/${id}` : "/api/entities", jsonBody(id ? "PATCH" : "POST", body));
    return EntitySchema.parse(await res.json());
  },
  async deleteEntity(id: number) {
    await send(`/api/entities/${id}`, { method: "DELETE" });
  },
  async draftEntity(request: DraftRequest) {
    return DraftedEntitySchema.parse(await (await send("/api/entities/draft", jsonBody("POST", request))).json());
  },
  async setLocationInside(id: number, parentId: number | null) {
    await send(`/api/entity-relationships/${id}/inside`, jsonBody("PUT", { parentId }));
  },
  async listRelationshipLabels(): Promise<string[]> {
    return EntityRelationshipSchema.shape.description.array().parse(await (await send("/api/entity-relationships/labels")).json());
  },
  async listRelationships(entityId: number, audience: "gm" | "player" = "gm") {
    const res = await send(`/api/entity-relationships?entityId=${entityId}&audience=${audience}`);
    return EntityRelationshipSchema.array().parse(await res.json());
  },
  async createRelationship(input: EntityRelationshipInput) {
    return EntityRelationshipSchema.parse(await (await send("/api/entity-relationships", jsonBody("POST", input))).json());
  },
  async setRelationshipGmOnly(id: number, gmOnly: boolean) {
    return EntityRelationshipSchema.parse(await (await send(`/api/entity-relationships/${id}`, jsonBody("PATCH", { gmOnly }))).json());
  },
  async deleteRelationship(id: number) {
    await send(`/api/entity-relationships/${id}`, { method: "DELETE" });
  },
  async draftNpc(request: NpcDraftRequest) {
    return NpcDraftSchema.parse(await (await send("/api/entities/npc-draft", jsonBody("POST", request))).json());
  },
  /** Fills every blank field from the roll tables, or re-rolls just `only`. */
  async rollNpc(request: { name?: string; profile: NpcProfile; only?: string; fields?: string[] }) {
    const body = await (await send("/api/entities/npc-roll", jsonBody("POST", request))).json();
    return { name: body.name as string, profile: NpcProfileSchema.parse(body.profile) };
  },
  async generatePicture(entityId: number): Promise<{ tempId: string; dataUrl: string }> {
    return (await send(`/api/entities/${entityId}/picture/generate`, { method: "POST" })).json();
  },
  async acceptPicture(entityId: number, tempId: string) {
    const res = await send(`/api/entities/${entityId}/picture/accept`, jsonBody("POST", { tempId }));
    return EntitySchema.parse(await res.json());
  },
  /** Sets an entity's picture from an image (a data: URL works, via fetch). */
  async uploadPicture(entityId: number, image: Blob) {
    const res = await send(`/api/entities/${entityId}/picture`, {
      method: "POST",
      headers: { "Content-Type": image.type },
      body: image,
    });
    return EntitySchema.parse(await res.json());
  },
  // ---------- soundboard + sound library (bafft-c4d) ----------
  async listSoundboards() {
    return SoundboardSchema.array().parse(await (await send("/api/soundboards")).json());
  },
  async createSoundboard(name: string) {
    return SoundboardSchema.parse(await (await send("/api/soundboards", jsonBody("POST", { name }))).json());
  },
  async getSoundboard(id: number) {
    return SoundboardWithClipsSchema.parse(await (await send(`/api/soundboards/${id}`)).json());
  },
  async renameSoundboard(id: number, name: string) {
    return SoundboardSchema.parse(await (await send(`/api/soundboards/${id}`, jsonBody("PATCH", { name }))).json());
  },
  async saveBoardScenes(id: number, scenes: import("@bafft/shared").BoardScene[]) {
    return SoundboardWithClipsSchema.parse(await (await send(`/api/soundboards/${id}/scenes`, jsonBody("PUT", { scenes }))).json());
  },
  async reorderClips(id: number, clipIds: number[]) {
    await send(`/api/soundboards/${id}/clip-order`, jsonBody("PUT", { clipIds }));
  },
  async deleteSoundboard(id: number) {
    await send(`/api/soundboards/${id}`, { method: "DELETE" });
  },
  async addClip(boardId: number, body: { assetId: number; group?: string | null; name?: string; kind?: "loop" | "one-shot"; volume?: number; fadeInMs?: number }) {
    return SoundClipSchema.parse(await (await send(`/api/soundboards/${boardId}/clips`, jsonBody("POST", body))).json());
  },
  async updateClip(id: number, update: SoundClipUpdate) {
    return SoundClipSchema.parse(await (await send(`/api/sound-clips/${id}`, jsonBody("PATCH", update))).json());
  },
  async removeClip(id: number) {
    await send(`/api/sound-clips/${id}`, { method: "DELETE" });
  },
  async listSounds(filter: { q?: string; category?: SoundCategory; pack?: string } = {}) {
    const params = new URLSearchParams();
    if (filter.q) params.set("q", filter.q);
    if (filter.category) params.set("category", filter.category);
    if (filter.pack) params.set("pack", filter.pack);
    return SoundAssetSchema.array().parse(await (await send(`/api/sound-assets?${params}`)).json());
  },
  async importStatus() {
    return ImportStatusSchema.parse(await (await send("/api/sound-assets/import-status")).json());
  },
  async scanSoundImport() {
    return ImportScanResultSchema.parse(await (await send("/api/sound-assets/import-scan", { method: "POST" })).json());
  },
  async uploadSound(file: File, fields: { category: SoundCategory; title?: string; tags?: string }) {
    const form = new FormData();
    form.set("category", fields.category);
    if (fields.title) form.set("title", fields.title);
    if (fields.tags) form.set("tags", fields.tags);
    form.set("audio", file);
    return SoundAssetSchema.parse(await (await send("/api/sound-assets", { method: "POST", body: form })).json());
  },
  async updateSound(id: number, update: SoundAssetUpdate) {
    return SoundAssetSchema.parse(await (await send(`/api/sound-assets/${id}`, jsonBody("PATCH", update))).json());
  },
  async deleteSound(id: number) {
    await send(`/api/sound-assets/${id}`, { method: "DELETE" });
  },
  /** One search across every catalogue (bafft-c4d.10). */
  async searchCatalogue(filter: { q: string; category?: SoundCategory }) {
    const params = new URLSearchParams({ q: filter.q, ...(filter.category ? { category: filter.category } : {}) });
    return CatalogueSearchSchema.parse(await (await send(`/api/catalogue?${params}`)).json());
  },
  async searchYouTube(q: string) {
    return YouTubeResultSchema.array().parse(await (await send(`/api/catalogue/youtube?${new URLSearchParams({ q })}`)).json());
  },
  async addYouTube(body: { url: string; title?: string; category: SoundCategory; tags?: string[] }) {
    return SoundAssetSchema.parse(await (await send("/api/catalogue/youtube", jsonBody("POST", body))).json());
  },
  async keepTrack(source: CatalogueSource, sourceId: string) {
    return SoundAssetSchema.parse(await (await send("/api/catalogue/keep", jsonBody("POST", { source, sourceId }))).json());
  },
};
