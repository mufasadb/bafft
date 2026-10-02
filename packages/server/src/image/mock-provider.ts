// Stub provider returning a deterministic placeholder image — lets the
// "picture this" flow (accept/discard, imagePath storage) be built and
// tested before a real vendor (Gemini or otherwise) is chosen.
import type { ImageProvider, ImageRequest, GeneratedImage } from "./types.js";

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export const mockImageProvider: ImageProvider = {
  name: "mock",
  async generate(request: ImageRequest): Promise<GeneratedImage> {
    const style = request.styleAnchor ? ` [style: ${request.styleAnchor}]` : "";
    const label = escapeXml(request.prompt.slice(0, 100) + style);
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">` +
      `<rect width="100%" height="100%" fill="#e7f5ff"/>` +
      `<foreignObject x="24" y="24" width="464" height="464">` +
      `<div xmlns="http://www.w3.org/1999/xhtml" style="font-family: sans-serif; font-size: 18px; color: #1c7ed6;">${label}</div>` +
      `</foreignObject>` +
      `</svg>`;
    return { data: new TextEncoder().encode(svg), mimeType: "image/svg+xml", extension: "svg" };
  },
};
