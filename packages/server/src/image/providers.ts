// Provider registry: "gemini" (bafft-yh2.4) and a "mock" for tests and
// offline work, same pattern as asr/providers.ts.
import type { ImageProvider } from "./types.js";
import { mockImageProvider } from "./mock-provider.js";
import { geminiImageProvider } from "./gemini-provider.js";

const providers: Record<string, ImageProvider> = {
  mock: mockImageProvider,
  gemini: geminiImageProvider,
};

/** Gemini when GEMINI_API_KEY is set, otherwise the mock. BAFFT_IMAGE_PROVIDER overrides either way. */
export function getActiveImageProvider(
  name: string = process.env.BAFFT_IMAGE_PROVIDER ?? (process.env.GEMINI_API_KEY ? "gemini" : "mock"),
): ImageProvider {
  const provider = providers[name];
  if (!provider) {
    throw new Error(
      `Unknown image provider "${name}". Known providers: ${Object.keys(providers).join(", ")}`,
    );
  }
  return provider;
}
