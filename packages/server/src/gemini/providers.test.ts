// Gemini draft + image providers (bafft-yh2.4) against a stubbed fetch —
// no real API calls or keys needed.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { buildNpcPrompt, buildSystemInstruction, buildUserPrompt, geminiDraftProvider } from "../draft/gemini-provider.js";
import { buildImagePromptText, geminiImageProvider } from "../image/gemini-provider.js";
import { getActiveDraftProvider } from "../draft/providers.js";

const realFetch = globalThis.fetch;
const savedEnv = { ...process.env };
afterEach(() => {
  globalThis.fetch = realFetch;
  process.env = { ...savedEnv };
});

type Call = { url: string; init: RequestInit };
function stubFetch(body: unknown, status = 200): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (url: string | URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return calls;
}

const textReply = (text: string) => ({ candidates: [{ content: { parts: [{ text }] } }] });

test("guided answers become labelled lines; blanks are dropped", () => {
  const prompt = buildUserPrompt({ type: "location", guided: { kind: "village", mood: " tense ", size: " " } });
  assert.equal(prompt, "Draft a location.\nKind: village\nMood: tense");
  assert.equal(buildUserPrompt({ type: "npc", prompt: "a nervous priest" }), "Draft a NPC. a nervous priest");
});

test("system instruction names the game system and includes setting notes", () => {
  const text = buildSystemInstruction({ gameSystem: "shadowdark", settingNotes: "The sun died a century ago." });
  assert.match(text, /game system is Shadowdark/);
  assert.match(text, /The sun died a century ago\./);
  assert.doesNotMatch(buildSystemInstruction({ gameSystem: "other", settingNotes: null }), /game system is/);
});

test("draft: sends structured-output request and parses the JSON reply", async () => {
  process.env.GEMINI_API_KEY = "test-key";
  const drafted = { name: "Kaelen Varr", aliases: ["Old Varr"], tags: ["innkeeper"], quirks: ["Keeps a crossbow under the bar."] };
  const calls = stubFetch(textReply(JSON.stringify(drafted)));

  const result = await geminiDraftProvider.draft({ type: "npc", prompt: "wary innkeeper" }, { gameSystem: "draw-steel", settingNotes: null });

  assert.deepEqual(result, drafted);
  assert.match(calls[0].url, /models\/gemini-[\w.-]+:generateContent$/);
  assert.equal((calls[0].init.headers as Record<string, string>)["x-goog-api-key"], "test-key");
  const sent = JSON.parse(String(calls[0].init.body));
  assert.equal(sent.generationConfig.responseMimeType, "application/json");
  assert.match(sent.systemInstruction.parts[0].text, /Draw Steel/);
});

test("draft: a malformed reply is an error, not a half-filled form", async () => {
  process.env.GEMINI_API_KEY = "test-key";
  stubFetch(textReply(JSON.stringify({ name: "No lists" })));
  await assert.rejects(geminiDraftProvider.draft({ type: "npc", prompt: "x" }));
});

test("draft: a blocked prompt surfaces the reason", async () => {
  process.env.GEMINI_API_KEY = "test-key";
  stubFetch({ promptFeedback: { blockReason: "SAFETY" } });
  await assert.rejects(geminiDraftProvider.draft({ type: "npc", prompt: "x" }), /SAFETY/);
});

test("image: style anchor is appended, and the inline image is decoded", async () => {
  process.env.GEMINI_API_KEY = "test-key";
  const png = Buffer.from("fake-png-bytes");
  const calls = stubFetch({
    candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/jpeg", data: png.toString("base64") } }] } }],
  });

  const image = await geminiImageProvider.generate({ prompt: "An innkeeper", styleAnchor: "woodcut print" });

  assert.equal(image.mimeType, "image/jpeg");
  assert.equal(image.extension, "jpg");
  assert.equal(Buffer.from(image.data).toString(), "fake-png-bytes");
  const sent = JSON.parse(String(calls[0].init.body));
  assert.deepEqual(sent.generationConfig.responseModalities, ["IMAGE"]);
  assert.match(sent.contents[0].parts[0].text, /Art style: woodcut print\./);
  assert.equal(
    buildImagePromptText({ prompt: "A tower" }),
    "A tower. No text, lettering or watermarks in the image. No border, frame or vignette: the scene fills the whole square edge to edge.",
  );
});

test("an HTTP error from Gemini is reported with its status", async () => {
  process.env.GEMINI_API_KEY = "test-key";
  stubFetch({ error: { message: "quota" } }, 429);
  await assert.rejects(geminiImageProvider.generate({ prompt: "x" }), /429/);
});

test("Gemini is the default once a key exists; the mock otherwise", () => {
  delete process.env.BAFFT_DRAFT_PROVIDER;
  delete process.env.GEMINI_API_KEY;
  assert.equal(getActiveDraftProvider().name, "mock");
  process.env.GEMINI_API_KEY = "k";
  assert.equal(getActiveDraftProvider().name, "gemini");
  process.env.BAFFT_DRAFT_PROVIDER = "mock";
  assert.equal(getActiveDraftProvider().name, "mock");
});

test("NPC prompt pins the GM's choices and only asks for negotiation when wanted", () => {
  const request = {
    blurb: "a wary innkeeper",
    name: "Boran",
    profile: { ancestry: "dwarf", negotiation: { attitude: "hostile" as const, motivations: [], pitfalls: [] } },
  };
  const ds = buildNpcPrompt(request, true);
  assert.match(ds, /The GM's idea: a wary innkeeper/);
  assert.match(ds, /- name: Boran/);
  assert.match(ds, /- ancestry: dwarf/);
  assert.match(ds, /attitude hostile/);
  assert.match(ds, /dwarf Zaliac/);
  assert.doesNotMatch(buildNpcPrompt(request, false), /negotiation/i);
});

test("NPC draft: invalid or clashing motivations from the model are dropped, not fatal", async () => {
  process.env.GEMINI_API_KEY = "test-key";
  stubFetch(
    textReply(
      JSON.stringify({
        name: "Boran",
        tags: [],
        quirks: [],
        profile: {
          negotiation: {
            attitude: "grumpy",
            impression: 40,
            language: "Zaliac",
            motivations: [{ kind: "greed", reason: "x" }, { kind: "snacks", reason: "y" }],
            pitfalls: [{ kind: "greed", reason: "z" }, { kind: "justice", reason: "w" }],
          },
        },
      }),
    ),
  );
  const draft = await geminiDraftProvider.draftNpc({ profile: {} }, { gameSystem: "draw-steel", settingNotes: null });
  const n = draft.profile.negotiation!;
  assert.equal(n.attitude, undefined);
  assert.equal(n.impression, 12);
  assert.deepEqual(n.motivations.map((m) => m.kind), ["greed"]);
  assert.deepEqual(n.pitfalls.map((m) => m.kind), ["justice"]);
});

test("the NPC prompt carries canon links and the keep-to-my-notes instruction (bafft-w8f.10)", () => {
  const prompt = buildNpcPrompt({ profile: {}, colourOnly: true }, false, ["Daven Trel -> husband of -> Zevra"]);
  assert.match(prompt, /Never contradict it:\n- Daven Trel -> husband of -> Zevra/);
  assert.match(prompt, /The GM writes this NPC's story/);
  assert.doesNotMatch(buildNpcPrompt({ profile: {} }, false), /Canon|GM writes this NPC's story/);
});

test("the NPC prompt passes on reasons, offers, other names and quirks, and asks for 2 pitfalls (bafft-w8f.13)", () => {
  const prompt = buildNpcPrompt(
    {
      profile: {
        negotiation: {
          attitude: "suspicious",
          motivations: [{ kind: "protection", reason: "Daven is her charge" }],
          pitfalls: [],
          offers: [{ interest: 3, offer: "the notes" }],
        },
      },
      aliases: ["Daven's wife"],
      quirks: ["hums while she mends"],
    },
    true,
  );
  assert.match(prompt, /motivations protection \(Daven is her charge\)/);
  assert.match(prompt, /offers by interest 3: the notes/);
  assert.match(prompt, /other names: Daven's wife/);
  assert.match(prompt, /hums while she mends/);
  assert.match(prompt, /2 motivations and 2 pitfalls/);
});
