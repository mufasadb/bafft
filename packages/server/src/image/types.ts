// Server-only — not in @bafft/shared, since a GeneratedImage's raw bytes
// aren't something the web package needs typed (it only ever sees the
// resulting imagePath, after accept). See bafft-yh2.2.
export interface ImageRequest {
  prompt: string;
  /**
   * A per-campaign look, injected into every call so a campaign's images
   * share a consistent style. Set on the campaign settings page
   * (bafft-n0q); absent until the owner fills it in.
   */
  styleAnchor?: string;
}

export interface GeneratedImage {
  data: Uint8Array;
  mimeType: string;
  /** File extension (no dot) to stage/store this under, e.g. "svg", "png". */
  extension: string;
}

export interface ImageProvider {
  readonly name: string;
  generate(request: ImageRequest): Promise<GeneratedImage>;
}
