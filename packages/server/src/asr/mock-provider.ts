// Stub provider returning deterministic canned data — lets downstream code
// (labelling UI, fixture harness) be built before a real ASR vendor is
// chosen (wg1.5/.6). Ignores its inputs entirely.
import type { TranscriptionProvider, Word } from "@bafft/shared";

export const MOCK_WORDS: Word[] = [
  { text: "The", startMs: 0, endMs: 200, confidence: 0.98, speakerLabel: "Speaker 1" },
  { text: "party", startMs: 200, endMs: 550, confidence: 0.95, speakerLabel: "Speaker 1" },
  { text: "enters", startMs: 550, endMs: 900, confidence: 0.91, speakerLabel: "Speaker 1" },
  { text: "the", startMs: 900, endMs: 1050, confidence: 0.99, speakerLabel: "Speaker 1" },
  { text: "tavern", startMs: 1050, endMs: 1500, confidence: 0.32, speakerLabel: "Speaker 1" },
];

export const mockProvider: TranscriptionProvider = {
  name: "mock",
  async transcribe(_audioPath: string, _keyterms: string[]): Promise<Word[]> {
    return MOCK_WORDS;
  },
};
