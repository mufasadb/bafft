// Shared multipart upload staging (session audio, soundboard clips). Files
// land in a temp dir first: their final home is named after a DB id that
// doesn't exist until after the row is created.
import { randomUUID } from "node:crypto";
import { basename, extname } from "node:path";
import multer from "multer";
import { config } from "../config.js";

export function uploadLimitMb(value = process.env.BAFFT_MAX_UPLOAD_MB): number {
  const mb = value ? Number(value) : 4096;
  if (!Number.isFinite(mb) || mb <= 0 || !Number.isSafeInteger(mb * 1024 * 1024)) {
    throw new Error("BAFFT_MAX_UPLOAD_MB must be a positive size in MB");
  }
  return mb;
}

export const maxUploadMb = uploadLimitMb();
export const stagedUpload = multer({
  limits: { fileSize: maxUploadMb * 1024 * 1024 },
  storage: multer.diskStorage({
    destination: config.uploadsTmpDir,
    filename: (_req, file, cb) => cb(null, `${randomUUID()}${extname(file.originalname)}`),
  }),
});

export function sanitizeFilename(name: string): string {
  return basename(name).replace(/[^a-zA-Z0-9._-]/g, "_") || "audio";
}
