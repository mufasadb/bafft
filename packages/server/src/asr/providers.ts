// Provider registry. AssemblyAI (chosen in wg1.5) is the default whenever
// ASSEMBLYAI_API_KEY is set, otherwise the mock. BAFFT_ASR_PROVIDER overrides
// either way; the other vendors stay registered for the fixture benchmark.
import type { TranscriptionProvider } from "@bafft/shared";
import { mockProvider } from "./mock-provider.js";
import { assemblyAIProvider } from "./vendors/assemblyai.js";
import { deepgramProvider } from "./vendors/deepgram.js";
import { speechmaticsProvider } from "./vendors/speechmatics.js";

const providers: Record<string, TranscriptionProvider> = {
  mock: mockProvider,
  assemblyai: assemblyAIProvider,
  deepgram: deepgramProvider,
  speechmatics: speechmaticsProvider,
};

/** AssemblyAI when its key is set, otherwise the mock. BAFFT_ASR_PROVIDER overrides either way. */
export function getActiveProvider(
  name: string = process.env.BAFFT_ASR_PROVIDER ?? (process.env.ASSEMBLYAI_API_KEY ? "assemblyai" : "mock"),
): TranscriptionProvider {
  const provider = providers[name];
  if (!provider) {
    throw new Error(
      `Unknown ASR provider "${name}". Known providers: ${Object.keys(providers).join(", ")}`,
    );
  }
  return provider;
}
