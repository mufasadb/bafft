// Speechmatics batch adapter (Enhanced operating point, the one that
// supports a custom dictionary): submit a multipart job, poll, fetch the
// JSON transcript. Times come back in seconds; punctuation arrives as
// separate items and is dropped (scoring ignores punctuation anyway).
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { TranscriptionProvider, Word } from "@bafft/shared";
import { audioContentType, fetchJson, poll, requireKey } from "./http.js";

const BASE = "https://asr.api.speechmatics.com/v2";

interface SpeechmaticsResult {
  type: "word" | "punctuation" | "entity";
  start_time: number;
  end_time: number;
  alternatives?: { content: string; confidence: number; speaker?: string }[];
}

export function parseSpeechmaticsWords(transcript: { results: SpeechmaticsResult[] }): Word[] {
  return transcript.results
    .filter((r) => r.type === "word" && r.alternatives?.[0])
    .map((r) => {
      const best = r.alternatives![0]!;
      return {
        text: best.content,
        startMs: Math.round(r.start_time * 1000),
        endMs: Math.round(r.end_time * 1000),
        confidence: best.confidence,
        speakerLabel: best.speaker && best.speaker !== "UU" ? `Speaker ${best.speaker}` : "Speaker ?",
      };
    });
}

export function speechmaticsConfig(keyterms: string[]) {
  return {
    type: "transcription",
    transcription_config: {
      language: "en",
      operating_point: "enhanced",
      diarization: "speaker",
      ...(keyterms.length ? { additional_vocab: keyterms.slice(0, 1000).map((content) => ({ content })) } : {}),
    },
  };
}

export const speechmaticsProvider: TranscriptionProvider = {
  name: "speechmatics",
  async transcribe(audioPath, keyterms) {
    const headers = { Authorization: `Bearer ${requireKey("SPEECHMATICS_API_KEY")}` };
    const form = new FormData();
    form.append("config", JSON.stringify(speechmaticsConfig(keyterms)));
    form.append(
      "data_file",
      new Blob([await readFile(audioPath)], { type: audioContentType(audioPath) }),
      basename(audioPath),
    );
    const { id } = await fetchJson<{ id: string }>(`${BASE}/jobs`, { method: "POST", headers, body: form }, "Speechmatics");
    await poll(async () => {
      const { job } = await fetchJson<{ job: { status: string } }>(`${BASE}/jobs/${id}`, { headers }, "Speechmatics");
      if (job.status === "done") return true;
      if (job.status !== "running") throw new Error(`Speechmatics job ${id} ended as "${job.status}"`);
      return undefined;
    });
    const transcript = await fetchJson<{ results: SpeechmaticsResult[] }>(
      `${BASE}/jobs/${id}/transcript?format=json-v2`,
      { headers },
      "Speechmatics",
    );
    return parseSpeechmaticsWords(transcript);
  },
};
