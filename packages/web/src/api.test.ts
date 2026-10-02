import { afterEach, expect, test, vi } from "vitest";
import { api, ApiError } from "./api.js";

afterEach(() => vi.unstubAllGlobals());

function stubFetch(status: number, body: unknown) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status })));
}

test("a non-2xx response throws ApiError carrying the server's own message", async () => {
  stubFetch(422, { error: "that would put a location inside itself" });
  const err = await api.deleteRelationship(1).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(ApiError);
  expect(err).toMatchObject({ message: "that would put a location inside itself", status: 422 });
});

test("a non-JSON error body still throws, with the status", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>", { status: 502 })));
  await expect(api.deleteEntity(1)).rejects.toMatchObject({ message: "request failed (502)", status: 502 });
});

test("responses are validated, so dates come back as Date objects", async () => {
  stubFetch(200, [
    {
      id: 1, campaignId: 1, type: "npc", name: "Mira", aliases: [], soundsLike: [], notes: null, tags: [], quirks: [],
      imagePath: null, profile: null, createdAt: "2026-09-26T00:00:00.000Z", updatedAt: "2026-09-26T00:00:00.000Z",
    },
  ]);
  const [mira] = await api.listEntities();
  expect(mira!.updatedAt).toBeInstanceOf(Date);
});
