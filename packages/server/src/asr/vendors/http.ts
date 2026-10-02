// Small helpers shared by the vendor adapters (bafft-wg1.5 benchmark; wg1.6
// hardens whichever one is chosen).
import { extname } from "node:path";

export function requireKey(envVar: string): string {
  const key = process.env[envVar];
  if (!key) throw new Error(`${envVar} is not set`);
  return key;
}

const AUDIO_TYPES: Record<string, string> = {
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".mp4": "audio/mp4",
  ".flac": "audio/flac",
  ".ogg": "audio/ogg",
  ".webm": "audio/webm",
};

export function audioContentType(path: string): string {
  return AUDIO_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";
}

export async function fetchJson<T>(url: string, init: RequestInit, vendor: string): Promise<T> {
  const res = await fetch(url, init);
  const text = await res.text();
  if (!res.ok) throw new Error(`${vendor} ${init.method ?? "GET"} ${url} failed (${res.status}): ${text.slice(0, 500)}`);
  return JSON.parse(text) as T;
}

/** Polls `check` until it returns a value, every `intervalMs`, giving up after `timeoutMs`. */
export async function poll<T>(
  check: () => Promise<T | undefined>,
  { intervalMs = 3000, timeoutMs = 60 * 60 * 1000 } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await check();
    if (result !== undefined) return result;
    if (Date.now() > deadline) throw new Error(`timed out after ${timeoutMs / 1000}s`);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/** Optional hint for vendors that accept a speaker count (the table size is usually known). */
export function expectedSpeakers(): number | undefined {
  const n = Number(process.env.BAFFT_ASR_SPEAKERS_EXPECTED);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}
