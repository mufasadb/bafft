// Vendor adapters (bafft-wg1.5): parsers against each vendor's documented
// response shape, and the request flow against a stubbed fetch — no real
// API calls or keys needed.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assemblyAIKeyterms, assemblyAIProvider, parseAssemblyAIWords } from "./vendors/assemblyai.js";
import { deepgramProvider, deepgramUrl, parseDeepgramWords } from "./vendors/deepgram.js";
import { parseSpeechmaticsWords, speechmaticsConfig, speechmaticsProvider } from "./vendors/speechmatics.js";

const audio = join(mkdtempSync(join(tmpdir(), "bafft-vendor-")), "clip.wav");
writeFileSync(audio, "RIFF-not-really-audio");

const realFetch = globalThis.fetch;
const savedEnv = { ...process.env };
afterEach(() => {
  globalThis.fetch = realFetch;
  process.env = { ...savedEnv };
});

type Call = { url: string; init: RequestInit };
function stubFetch(respond: (call: Call) => unknown): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (url: string | URL, init: RequestInit = {}) => {
    const call = { url: String(url), init };
    calls.push(call);
    return new Response(JSON.stringify(respond(call)), { status: 200 });
  }) as typeof fetch;
  return calls;
}

test("AssemblyAI words: ms times, lettered speakers", () => {
  const words = parseAssemblyAIWords({
    words: [{ text: "Lethara,", start: 250, end: 700, confidence: 0.61, speaker: "B" }],
  });
  assert.deepEqual(words, [{ text: "Lethara,", startMs: 250, endMs: 700, confidence: 0.61, speakerLabel: "Speaker B" }]);
});

test("AssemblyAI keyterms respect the 6-words-per-term and 1,000-term limits", () => {
  const many = Array.from({ length: 1200 }, (_, i) => `term${i}`);
  assert.equal(assemblyAIKeyterms(many).length, 1000);
  assert.deepEqual(assemblyAIKeyterms(["Belvarin", "one two three four five six seven"]), ["Belvarin"]);
});

test("AssemblyAI flow: upload, create with keyterms + diarisation, poll to completion", async () => {
  process.env.ASSEMBLYAI_API_KEY = "aai-key";
  process.env.BAFFT_ASR_SPEAKERS_EXPECTED = "5";
  const calls = stubFetch(({ url }) => {
    if (url.endsWith("/upload")) return { upload_url: "https://cdn/x" };
    if (url.endsWith("/transcript")) return { id: "t1", status: "queued" };
    return { id: "t1", status: "completed", words: [{ text: "hi", start: 0, end: 90, confidence: 0.9, speaker: "A" }] };
  });
  const words = await assemblyAIProvider.transcribe(audio, ["Belvarin"]);
  assert.deepEqual(words.map((w) => w.text), ["hi"]);
  assert.equal((calls[0]!.init.headers as Record<string, string>).authorization, "aai-key");
  const body = JSON.parse(String(calls[1]!.init.body));
  assert.deepEqual(body.speech_models, ["universal-3-5-pro"]);
  assert.equal(body.speaker_labels, true);
  assert.equal(body.speakers_expected, 5);
  assert.deepEqual(body.keyterms_prompt, ["Belvarin"]);
  assert.match(calls[2]!.url, /\/transcript\/t1$/);
});

test("AssemblyAI: the session's table size wins over the env hint, and the upload is streamed", async () => {
  process.env.ASSEMBLYAI_API_KEY = "aai-key";
  process.env.BAFFT_ASR_SPEAKERS_EXPECTED = "5";
  const calls = stubFetch(({ url }) => {
    if (url.endsWith("/upload")) return { upload_url: "https://cdn/x" };
    if (url.endsWith("/transcript")) return { id: "t1", status: "queued" };
    return { id: "t1", status: "completed", words: [] };
  });
  await assemblyAIProvider.transcribe(audio, [], { speakersExpected: 7 });
  assert.ok(calls[0]!.init.body instanceof ReadableStream);
  assert.equal((calls[0]!.init.headers as Record<string, string>)["content-length"], "21");
  assert.equal(JSON.parse(String(calls[1]!.init.body)).speakers_expected, 7);
});

test("the active provider is AssemblyAI when its key is set, else the mock", async () => {
  const { getActiveProvider } = await import("./providers.js");
  delete process.env.BAFFT_ASR_PROVIDER;
  delete process.env.ASSEMBLYAI_API_KEY;
  assert.equal(getActiveProvider().name, "mock");
  process.env.ASSEMBLYAI_API_KEY = "aai-key";
  assert.equal(getActiveProvider().name, "assemblyai");
  process.env.BAFFT_ASR_PROVIDER = "mock";
  assert.equal(getActiveProvider().name, "mock");
});

test("AssemblyAI flow surfaces a failed transcript's error", async () => {
  process.env.ASSEMBLYAI_API_KEY = "aai-key";
  stubFetch(({ url }) =>
    url.endsWith("/upload") ? { upload_url: "u" } : url.endsWith("/transcript") ? { id: "t" } : { status: "error", error: "bad audio" },
  );
  await assert.rejects(assemblyAIProvider.transcribe(audio, []), /bad audio/);
});

test("Deepgram words: seconds to ms, prefers punctuated_word, numbers speakers from 1", () => {
  const words = parseDeepgramWords({
    results: {
      channels: [
        { alternatives: [{ words: [{ word: "yeah", punctuated_word: "Yeah.", start: 0.08, end: 0.32, confidence: 0.99, speaker: 0 }] }] },
      ],
    },
  });
  assert.deepEqual(words, [{ text: "Yeah.", startMs: 80, endMs: 320, confidence: 0.99, speakerLabel: "Speaker 1" }]);
});

test("Deepgram flow: one request, Token auth, keyterms as repeated params", async () => {
  process.env.DEEPGRAM_API_KEY = "dg-key";
  const calls = stubFetch(() => ({ results: { channels: [{ alternatives: [{ words: [] }] }] } }));
  await deepgramProvider.transcribe(audio, ["Belvarin", "Lethara Vale"]);
  assert.equal(calls.length, 1);
  const url = new URL(calls[0]!.url);
  assert.deepEqual(url.searchParams.getAll("keyterm"), ["Belvarin", "Lethara Vale"]);
  assert.equal(url.searchParams.get("diarize"), "true");
  assert.equal(url.searchParams.get("model"), "nova-3");
  const headers = calls[0]!.init.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Token dg-key");
  assert.equal(headers["Content-Type"], "audio/wav");
  assert.equal(deepgramUrl([]).includes("keyterm"), false);
});

test("Speechmatics words: drops punctuation, seconds to ms, UU speaker is unknown", () => {
  const words = parseSpeechmaticsWords({
    results: [
      { type: "word", start_time: 0.72, end_time: 1.36, alternatives: [{ content: "Welcome", confidence: 1, speaker: "S1" }] },
      { type: "punctuation", start_time: 1.36, end_time: 1.36, alternatives: [{ content: ".", confidence: 1, speaker: "S1" }] },
      { type: "word", start_time: 1.5, end_time: 1.9, alternatives: [{ content: "back", confidence: 0.8, speaker: "UU" }] },
    ],
  });
  assert.deepEqual(words, [
    { text: "Welcome", startMs: 720, endMs: 1360, confidence: 1, speakerLabel: "Speaker S1" },
    { text: "back", startMs: 1500, endMs: 1900, confidence: 0.8, speakerLabel: "Speaker ?" },
  ]);
});

test("Speechmatics flow: multipart job with enhanced + diarisation + vocab, poll, fetch transcript", async () => {
  process.env.SPEECHMATICS_API_KEY = "sm-key";
  const calls = stubFetch(({ url }) => {
    if (url.endsWith("/jobs")) return { id: "j1" };
    if (url.endsWith("/jobs/j1")) return { job: { status: "done" } };
    return { results: [] };
  });
  await speechmaticsProvider.transcribe(audio, ["Belvarin"]);
  const form = calls[0]!.init.body as FormData;
  assert.deepEqual(JSON.parse(String(form.get("config"))), speechmaticsConfig(["Belvarin"]));
  assert.equal(speechmaticsConfig(["Belvarin"]).transcription_config.operating_point, "enhanced");
  assert.ok(form.get("data_file") instanceof Blob);
  assert.equal((calls[0]!.init.headers as Record<string, string>).Authorization, "Bearer sm-key");
  assert.match(calls[2]!.url, /\/jobs\/j1\/transcript\?format=json-v2$/);
});

test("Speechmatics flow fails fast on a rejected job", async () => {
  process.env.SPEECHMATICS_API_KEY = "sm-key";
  stubFetch(({ url }) => (url.endsWith("/jobs") ? { id: "j2" } : { job: { status: "rejected" } }));
  await assert.rejects(speechmaticsProvider.transcribe(audio, []), /rejected/);
});

test("each vendor refuses to run without its API key", async () => {
  for (const [provider, envVar] of [
    [assemblyAIProvider, "ASSEMBLYAI_API_KEY"],
    [deepgramProvider, "DEEPGRAM_API_KEY"],
    [speechmaticsProvider, "SPEECHMATICS_API_KEY"],
  ] as const) {
    delete process.env[envVar];
    await assert.rejects(provider.transcribe(audio, []), new RegExp(`${envVar} is not set`));
  }
});
