// Central runtime config. Paths resolve to the repo-root /data dir so the
// SQLite file and uploaded audio live in one gitignored, Docker-mountable place.
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { mkdirSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url)); // packages/server/src
const repoRoot = resolve(here, "../../.."); // -> repo root

export const config = {
  port: Number(process.env.PORT ?? 3001),
  // The built web app (packages/web/dist). Set in the Docker image, where the
  // server serves the SPA and the API on one origin; unset in dev, where Vite does.
  webRoot: process.env.BAFFT_WEB_ROOT,
  dataDir: process.env.BAFFT_DATA_DIR ?? resolve(repoRoot, "data"),
  get dbPath() {
    return resolve(this.dataDir, "bafft.db");
  },
  get audioDir() {
    return resolve(this.dataDir, "audio");
  },
  // Staging area multer writes to mid-upload, before the session id (and
  // therefore the final data/audio/{id}/ home) is known. See routes/sessions.ts.
  get uploadsTmpDir() {
    return resolve(this.dataDir, "uploads-tmp");
  },
  get soundsDir() {
    return resolve(this.dataDir, "sounds");
  },
  get imagesDir() {
    return resolve(this.dataDir, "images");
  },
  // Staging area a "picture this" generation writes to before the owner
  // accepts it — same review-before-persist pattern as AI-drafted text,
  // just for an image instead of form fields. See routes/entities.ts.
  get imagesTmpDir() {
    return resolve(this.dataDir, "images-tmp");
  },
  // Optional read-only Tower mount. The feature is hidden when unset.
  importDir: process.env.BAFFT_IMPORT_DIR ? resolve(process.env.BAFFT_IMPORT_DIR) : null,
  get migrationsDir() {
    return resolve(here, "db/migrations");
  },
  // Feature flags (see spec). Off by default.
  autoTranscribeOnUpload: process.env.AUTO_TRANSCRIBE_ON_UPLOAD === "true",
  // Words below this confidence are flagged is_uncertain at transcription
  // time: the quieter "very low confidence" bucket, next to the possible-name
  // flags (wg1.15). Set for AssemblyAI on the fixtures (bafft-wg1.16): 0.7
  // flagged ~2,200 words per 4h and only 54% were really wrong; 0.4 flags
  // ~530 and 84% are.
  uncertainConfidenceThreshold: Number(process.env.BAFFT_UNCERTAIN_CONFIDENCE_THRESHOLD ?? 0.4),
};

/** Ensure the data directories exist before anything touches them. */
export function ensureDataDirs(): void {
  mkdirSync(config.dataDir, { recursive: true });
  mkdirSync(config.audioDir, { recursive: true });
  mkdirSync(config.uploadsTmpDir, { recursive: true });
  mkdirSync(config.imagesDir, { recursive: true });
  mkdirSync(config.soundsDir, { recursive: true });
  mkdirSync(config.imagesTmpDir, { recursive: true });
}
