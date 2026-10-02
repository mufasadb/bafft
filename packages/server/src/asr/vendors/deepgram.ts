// Deepgram Nova-3 adapter: one synchronous request with the audio as the
// body. Times come back in seconds. Requests taking over ~10 minutes to
// process 504 — fine for fixture clips; wg1.6 would need callback mode for
// full sessions.
import { readFile } from "node:fs/promises";
import type { TranscriptionProvider, Word } from "@bafft/shared";
import { audioContentType, fetchJson, requireKey } from "./http.js";

interface DeepgramWord {
  word: string;
  punctuated_word?: string;
  start: number;
  end: number;
  confidence: number;
  speaker?: number;
}

interface DeepgramResponse {
  results: { channels: { alternatives: { words: DeepgramWord[] }[] }[] };
}

export function parseDeepgramWords(response: DeepgramResponse): Word[] {
  const words = response.results.channels[0]?.alternatives[0]?.words ?? [];
  return words.map((w) => ({
    text: w.punctuated_word ?? w.word,
    startMs: Math.round(w.start * 1000),
    endMs: Math.round(w.end * 1000),
    confidence: w.confidence,
    speakerLabel: w.speaker === undefined ? "Speaker ?" : `Speaker ${w.speaker + 1}`,
  }));
}

export function deepgramUrl(keyterms: string[]): string {
  const params = new URLSearchParams({ model: "nova-3", language: "en", diarize: "true", smart_format: "true" });
  for (const term of keyterms) params.append("keyterm", term);
  return `https://api.deepgram.com/v1/listen?${params}`;
}

export const deepgramProvider: TranscriptionProvider = {
  name: "deepgram",
  async transcribe(audioPath, keyterms) {
    const key = requireKey("DEEPGRAM_API_KEY");
    const response = await fetchJson<DeepgramResponse>(
      deepgramUrl(keyterms),
      {
        method: "POST",
        headers: { Authorization: `Token ${key}`, "Content-Type": audioContentType(audioPath) },
        body: await readFile(audioPath),
      },
      "Deepgram",
    );
    return parseDeepgramWords(response);
  },
};
