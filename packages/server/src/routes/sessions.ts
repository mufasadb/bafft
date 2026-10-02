// Session creation + upload (bafft-wg1.7). Creating a session and uploading
// its audio are one atomic multipart request — there's no separate
// "draft, pre-upload" status in the spec's session lifecycle, so a session
// exists from the start with its audio attached and status=uploaded.
import { join, resolve } from "node:path";
import { mkdir, rename, unlink } from "node:fs/promises";
import { Router } from "express";
import { requirePositiveIntId } from "./params.js";
import { sanitizeFilename, stagedUpload } from "./uploads.js";
import {
  NameMatchSchema,
  SessionInputSchema,
  SessionSchema,
  SpeakerSchema,
  SpeakerUpdateSchema,
  TranscriptWordSchema,
  WordCorrectionResultSchema,
  WordCorrectionSchema,
} from "@bafft/shared";
import { config } from "../config.js";
import { createSession, getSession, listSessions, setSessionAudioPath } from "../db/sessions.js";
import { correctTranscriptWords, CorrectionError, listTranscriptWords } from "../db/transcript-words.js";
import { listEntities, updateEntity } from "../db/entities.js";
import { listSpeakers, setSpeaker, SpeakerError } from "../db/session-speakers.js";
import { glossaryForCorrection } from "../labelling/correction-glossary.js";
import { findNameMatches } from "../labelling/name-matches.js";
import { getActiveProvider } from "../asr/providers.js";
import { runTranscription } from "../asr/run-transcription.js";

export const sessionsRouter = Router();
sessionsRouter.param("id", requirePositiveIntId);

sessionsRouter.get("/", async (_req, res, next) => {
  try {
    res.json(SessionSchema.array().parse(await listSessions()));
  } catch (err) {
    next(err);
  }
});

sessionsRouter.post("/", stagedUpload.single("audio"), async (req, res, next) => {
  const cleanupTemp = () => (req.file ? unlink(req.file.path).catch(() => {}) : undefined);
  try {
    const parsed = SessionInputSchema.safeParse(req.body);
    if (!parsed.success) {
      await cleanupTemp();
      res.status(400).json({ error: "invalid session input", details: parsed.error.flatten() });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: "audio file is required" });
      return;
    }

    const session = await createSession(parsed.data);

    const finalDir = join(config.audioDir, String(session.id));
    await mkdir(finalDir, { recursive: true });
    const finalPath = join(finalDir, sanitizeFilename(req.file.originalname));
    await rename(req.file.path, finalPath);

    // Stored relative to dataDir, not absolute — dataDir is itself
    // relocatable (BAFFT_DATA_DIR, and eventually a Docker volume).
    const relativePath = join("audio", String(session.id), sanitizeFilename(req.file.originalname));
    let updated = await setSessionAudioPath(session.id, relativePath);

    if (config.autoTranscribeOnUpload) {
      // Same code path as the manual "Run transcription" button — only the
      // trigger differs. Failure here shouldn't fail the upload itself:
      // runTranscription already reverts status to `uploaded` on error, so
      // the session just lands as if auto-transcribe were off.
      updated = await runTranscription(session.id, getActiveProvider()).catch(() => updated);
    }

    res.status(201).json(SessionSchema.parse(updated));
  } catch (err) {
    await cleanupTemp();
    next(err);
  }
});

sessionsRouter.post("/:id/transcribe", async (req, res) => {
  const id = Number(req.params.id);
  try {
    const updated = await runTranscription(id, getActiveProvider());
    res.json(SessionSchema.parse(updated));
  } catch (err) {
    res.status(422).json({ error: err instanceof Error ? err.message : "transcription failed" });
  }
});

sessionsRouter.get("/:id", async (req, res, next) => {
  try {
    const session = await getSession(Number(req.params.id));
    if (!session) {
      res.status(404).json({ error: "session not found" });
      return;
    }
    res.json(SessionSchema.parse(session));
  } catch (err) {
    next(err);
  }
});

// The session's own audio file for the labelling screen's player (bafft-wg1.10).
// sendFile answers HTTP Range requests, so the browser can seek anywhere in a
// multi-hour file without downloading it all.
sessionsRouter.get("/:id/audio", async (req, res, next) => {
  try {
    const session = await getSession(Number(req.params.id));
    if (!session?.audioPath) {
      res.status(404).json({ error: "no audio for this session" });
      return;
    }
    res.sendFile(resolve(config.dataDir, session.audioPath), (err) => {
      if (err && !res.headersSent) res.status(404).json({ error: "audio file missing on disk" });
    });
  } catch (err) {
    next(err);
  }
});

sessionsRouter.get("/:id/words", async (req, res, next) => {
  try {
    res.json(TranscriptWordSchema.array().parse(await listTranscriptWords(Number(req.params.id))));
  } catch (err) {
    next(err);
  }
});

// Who's talking (bafft-wg1.12): each diarised speaker, and who the owner says it is.
sessionsRouter.get("/:id/speakers", async (req, res, next) => {
  try {
    res.json(SpeakerSchema.array().parse(await listSpeakers(Number(req.params.id))));
  } catch (err) {
    next(err);
  }
});

sessionsRouter.put("/:id/speakers", async (req, res, next) => {
  try {
    const parsed = SpeakerUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid speaker", details: parsed.error.flatten() });
      return;
    }
    res.json(SpeakerSchema.parse(await setSpeaker(Number(req.params.id), parsed.data)));
  } catch (err) {
    if (err instanceof SpeakerError) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
});

// The owner's correction of a word or a run of adjacent words (bafft-wg1.11),
// saved at once. A fix to a known name also records what was heard as that
// name's sounds-like hint; a fix to an unknown name is reported back so the
// owner can choose to add it.
sessionsRouter.patch("/:id/words", async (req, res, next) => {
  try {
    const parsed = WordCorrectionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid correction", details: parsed.error.flatten() });
      return;
    }
    const { word, removedIds, heard } = await correctTranscriptWords(
      Number(req.params.id),
      parsed.data.wordIds,
      parsed.data.text,
    );
    const { outcome, update } = glossaryForCorrection(await listEntities(), heard, word.text);
    if (update) await updateEntity(update.entityId, { soundsLike: update.soundsLike });
    res.json(WordCorrectionResultSchema.parse({ word, removedIds, glossary: outcome }));
  } catch (err) {
    if (err instanceof CorrectionError) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
});

// Possible misheard glossary names (bafft-wg1.15), against the glossary as it
// is now. Words the owner already corrected are left out.
sessionsRouter.get("/:id/name-matches", async (req, res, next) => {
  try {
    const [words, entities] = await Promise.all([listTranscriptWords(Number(req.params.id)), listEntities()]);
    const glossary = entities.map((e) => ({ entityId: e.id, name: e.name, aliases: e.aliases, soundsLike: e.soundsLike }));
    const matches = findNameMatches(words, glossary)
      .filter((m) => m.wordIndices.every((i) => !words[i]!.corrected))
      .map(({ wordIndices, ...m }) => ({ ...m, wordIds: wordIndices.map((i) => words[i]!.id) }));
    res.json(NameMatchSchema.array().parse(matches));
  } catch (err) {
    next(err);
  }
});
