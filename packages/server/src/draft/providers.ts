// Provider registry: "gemini" (bafft-yh2.4) and a "mock" for tests and
// offline work, same pattern as asr/providers.ts.
import type { DraftProvider } from "@bafft/shared";
import { mockDraftProvider } from "./mock-provider.js";
import { geminiDraftProvider } from "./gemini-provider.js";

const providers: Record<string, DraftProvider> = {
  mock: mockDraftProvider,
  gemini: geminiDraftProvider,
};

/** Gemini when GEMINI_API_KEY is set, otherwise the mock. BAFFT_DRAFT_PROVIDER overrides either way. */
export function getActiveDraftProvider(
  name: string = process.env.BAFFT_DRAFT_PROVIDER ?? (process.env.GEMINI_API_KEY ? "gemini" : "mock"),
): DraftProvider {
  const provider = providers[name];
  if (!provider) {
    throw new Error(
      `Unknown draft provider "${name}". Known providers: ${Object.keys(providers).join(", ")}`,
    );
  }
  return provider;
}
