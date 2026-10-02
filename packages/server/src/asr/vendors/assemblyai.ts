// AssemblyAI Universal-3.5 Pro adapter: upload the file, create a transcript
// with keyterms + diarisation, poll until done. Times are already in ms.
// The vendor chosen in wg1.5 (see docs/superpowers/specs/2026-09-26-asr-vendor-research.md).
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import type { TranscriptionProvider, Word } from "@bafft/shared";
import { expectedSpeakers, fetchJson, poll, requireKey } from "./http.js";

const BASE = "https://api.assemblyai.com/v2";
const MAX_KEYTERMS = 1000;
const MAX_WORDS_PER_KEYTERM = 6;

interface AssemblyAIWord {
  text: string;
  start: number;
  end: number;
  confidence: number;
  speaker?: string | null;
}

interface AssemblyAITranscript {
  id: string;
  status: "queued" | "processing" | "completed" | "error";
  error?: string;
  words?: AssemblyAIWord[] | null;
}

export function parseAssemblyAIWords(transcript: Pick<AssemblyAITranscript, "words">): Word[] {
  return (transcript.words ?? []).map((w) => ({
    text: w.text,
    startMs: w.start,
    endMs: w.end,
    confidence: w.confidence,
    speakerLabel: w.speaker ? `Speaker ${w.speaker}` : "Speaker ?",
  }));
}

export function assemblyAIKeyterms(keyterms: string[]): string[] {
  return keyterms.filter((k) => k.trim().split(/\s+/).length <= MAX_WORDS_PER_KEYTERM).slice(0, MAX_KEYTERMS);
}

export const assemblyAIProvider: TranscriptionProvider = {
  name: "assemblyai",
  async transcribe(audioPath, keyterms, options = {}) {
    const authorization = requireKey("ASSEMBLYAI_API_KEY");
    // Streamed rather than read into memory: a 4h session is a few hundred MB.
    const { size } = await stat(audioPath);
    const { upload_url } = await fetchJson<{ upload_url: string }>(
      `${BASE}/upload`,
      {
        method: "POST",
        headers: { authorization, "content-length": String(size) },
        body: Readable.toWeb(createReadStream(audioPath)) as ReadableStream,
        duplex: "half",
      } as RequestInit,
      "AssemblyAI",
    );
    // An exact count beat both no hint and a min/max range on the fixtures
    // (wg1.6: attribution 70% -> 77%), so the owner's table size goes in as-is.
    const speakers = options.speakersExpected ?? expectedSpeakers();
    const terms = assemblyAIKeyterms(keyterms);
    const created = await fetchJson<AssemblyAITranscript>(
      `${BASE}/transcript`,
      {
        method: "POST",
        headers: { authorization, "content-type": "application/json" },
        body: JSON.stringify({
          audio_url: upload_url,
          speech_models: ["universal-3-5-pro"],
          language_code: "en",
          speaker_labels: true,
          ...(speakers ? { speakers_expected: speakers } : {}),
          ...(terms.length ? { keyterms_prompt: terms } : {}),
        }),
      },
      "AssemblyAI",
    );
    const done = await poll(async () => {
      const t = await fetchJson<AssemblyAITranscript>(`${BASE}/transcript/${created.id}`, { headers: { authorization } }, "AssemblyAI");
      if (t.status === "error") throw new Error(`AssemblyAI transcription failed: ${t.error}`);
      return t.status === "completed" ? t : undefined;
    });
    return parseAssemblyAIWords(done);
  },
};
