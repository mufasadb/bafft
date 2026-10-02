// Gemini image generation (bafft-yh2.4). The campaign's style anchor is
// appended to every prompt so a campaign's pictures share one look.
import { generateContent } from "../gemini/client.js";
import type { GeneratedImage, ImageProvider, ImageRequest } from "./types.js";

const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

export function buildImagePromptText(request: ImageRequest): string {
  const style = request.styleAnchor?.trim() ? ` Art style: ${request.styleAnchor.trim()}.` : "";
  // The card draws its own gold frame (bafft-w8f.7), and Gemini otherwise
  // tends to paint an ornate border of its own, which doubles it up.
  return `${request.prompt}.${style} No text, lettering or watermarks in the image. No border, frame or vignette: the scene fills the whole square edge to edge.`;
}

export function geminiImageModel(): string {
  return process.env.BAFFT_GEMINI_IMAGE_MODEL ?? "gemini-3.1-flash-image";
}

export const geminiImageProvider: ImageProvider = {
  name: "gemini",
  async generate(request: ImageRequest): Promise<GeneratedImage> {
    const parts = await generateContent(geminiImageModel(), {
      contents: [{ role: "user", parts: [{ text: buildImagePromptText(request) }] }],
      generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "1:1" } },
    });
    const image = parts.find((p) => p.inlineData)?.inlineData;
    if (!image) throw new Error("Gemini returned no image");
    return {
      data: new Uint8Array(Buffer.from(image.data, "base64")),
      mimeType: image.mimeType,
      extension: EXTENSIONS[image.mimeType] ?? "png",
    };
  },
};
