// Minimal Gemini generateContent client shared by the draft and image
// providers (bafft-yh2.4). Plain fetch, no SDK.
import { fetchJson, requireKey } from "../asr/vendors/http.js";

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
}

interface GeminiResponse {
  candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
}

/** Calls generateContent and returns the first candidate's parts, or throws a readable error. */
export async function generateContent(model: string, body: unknown): Promise<GeminiPart[]> {
  const key = requireKey("GEMINI_API_KEY");
  const res = await fetchJson<GeminiResponse>(
    `${BASE}/${model}:generateContent`,
    {
      method: "POST",
      headers: { "x-goog-api-key": key, "content-type": "application/json" },
      body: JSON.stringify(body),
    },
    "Gemini",
  );
  if (res.promptFeedback?.blockReason) {
    throw new Error(`Gemini refused the request (${res.promptFeedback.blockReason})`);
  }
  const candidate = res.candidates?.[0];
  const parts = candidate?.content?.parts;
  if (!parts?.length) {
    throw new Error(`Gemini returned nothing (finish reason: ${candidate?.finishReason ?? "unknown"})`);
  }
  return parts;
}
