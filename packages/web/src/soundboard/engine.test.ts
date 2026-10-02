import { beforeEach, describe, expect, test } from "vitest";
import { DECLICK_S, SoundEngine, type EngineClip } from "./engine.js";
import { FakeAudio, FakeContext } from "./test-fakes.js";

let ctx: FakeContext;
let audios: FakeAudio[];
let engine: SoundEngine;
// A clip's "audio" is one byte: its duration in seconds.
const fetcher = (async (url: string) => new Response(new Uint8Array([Number(url)]))) as typeof fetch;
const loop: EngineClip = { id: 1, kind: "loop", volume: 0.5, fadeInMs: 0 };
const song: EngineClip = { id: 2, kind: "loop", volume: 0.8, fadeInMs: 4000 };
const jeer: EngineClip = { id: 3, kind: "one-shot", volume: 1, fadeInMs: 0 };

beforeEach(async () => {
  ctx = new FakeContext();
  audios = [];
  engine = new SoundEngine({
    createContext: () => ctx as unknown as AudioContext,
    createAudio: (url) => {
      const a = new FakeAudio(url);
      audios.push(a);
      return a as unknown as HTMLAudioElement;
    },
    fetcher,
  });
  await engine.load(1, "60");
  await engine.load(2, "180");
  await engine.load(3, "4");
});

test("a tap starts a clip and a second tap stops it; loops loop, one-shots don't", () => {
  expect(engine.toggle(loop)).toBe(true);
  expect(ctx.sources[0]).toMatchObject({ loop: true, startedAt: 10 });
  expect(engine.toggle(jeer)).toBe(true);
  expect(ctx.sources[1]!.loop).toBe(false);
  expect([engine.isPlaying(1), engine.isPlaying(3)]).toEqual([true, true]);

  expect(engine.toggle(loop)).toBe(false);
  expect(engine.isPlaying(1)).toBe(false);
  expect(engine.isPlaying(3)).toBe(true);
});

test("stop cuts dead: a declick ramp of a few ms, not a fade", () => {
  engine.play(song);
  ctx.currentTime = 12;
  engine.stop(2);
  expect(ctx.sources[0]!.stoppedAt).toBe(12 + DECLICK_S);
  expect(ctx.gains[0]!.gain.events.slice(-3)).toEqual([
    ["cancel", 0, 12],
    ["set", 0, 12],
    ["ramp", 0, 12 + DECLICK_S],
  ]);
  expect(DECLICK_S).toBeLessThanOrEqual(0.02);
});

test("fade-in ramps from silence to the clip's volume; no fade starts at full volume", () => {
  engine.play(song);
  expect(ctx.gains[0]!.gain.events).toEqual([
    ["cancel", 0, 10],
    ["set", 0, 10],
    ["ramp", 0.8, 14],
  ]);
  engine.play(loop);
  expect(ctx.gains[1]!.gain.events).toEqual([
    ["cancel", 0, 10],
    ["set", 0.5, 10],
  ]);
});

test("volume changes apply live, override a fade in progress, and stick for the next start", () => {
  engine.play(song);
  ctx.currentTime = 11;
  engine.setVolume(2, 0.3);
  expect(ctx.gains[0]!.gain.events.slice(-2)).toEqual([
    ["cancel", 0, 11],
    ["target", 0.3, 11],
  ]);
  engine.stop(2);
  engine.play(song);
  expect(ctx.gains[1]!.gain.events.at(-1)).toEqual(["ramp", 0.3, 11 + 4]);
  expect(engine.volume(2, 0.8)).toBe(0.3);
});

test("stop all silences everything that's playing", () => {
  engine.play(loop);
  engine.play(song);
  engine.play(jeer);
  engine.stopAll();
  expect(ctx.sources.every((s) => s.stoppedAt !== null)).toBe(true);
  expect([1, 2, 3].some((id) => engine.isPlaying(id))).toBe(false);
});

test("a one-shot that runs out counts as stopped, and reports progress while it plays", () => {
  const changes: number[] = [];
  engine.subscribe(() => changes.push(1));
  engine.play(jeer);
  ctx.currentTime = 11;
  expect(engine.progress(3)).toBe(0.25);
  expect(engine.progress(1)).toBeNull(); // not playing
  ctx.sources[0]!.end();
  expect(engine.isPlaying(3)).toBe(false);
  expect(ctx.gains[0]!.connected).toBe(false);
  expect(changes.length).toBeGreaterThanOrEqual(2);
});

test("the old voice ending late doesn't stop a restarted clip", () => {
  engine.play(jeer);
  engine.stop(3);
  engine.play(jeer);
  ctx.sources[0]!.end(); // the first voice's onended arrives after the restart
  expect(engine.isPlaying(3)).toBe(true);
});

test("a clip that hasn't loaded yet doesn't play", async () => {
  expect(engine.play({ id: 99, kind: "one-shot", volume: 1, fadeInMs: 0 })).toBe(false);
  const failing = new SoundEngine({
    createContext: () => ctx as unknown as AudioContext,
    fetcher: (async () => new Response(null, { status: 404 })) as typeof fetch,
  });
  await expect(failing.load(98, "x")).rejects.toThrow(/98/);
});

test("the first tap unlocks a suspended audio context", async () => {
  await engine.unlock();
  expect(ctx.state).toBe("running");
});

test("a loop's progress is its place in the current pass", () => {
  engine.play(loop); // 60s long, started at t=10
  ctx.currentTime = 10 + 60 + 15;
  expect(engine.progress(1)).toBe(0.25);
});

test("the loop toggle applies to a clip that's already playing", () => {
  engine.play(jeer);
  engine.setLoop(3, true);
  expect(ctx.sources[0]!.loop).toBe(true);
  engine.setLoop(3, false);
  expect(ctx.sources[0]!.loop).toBe(false);
});

describe("streamed clips (music, ambience)", () => {
  const music: EngineClip = { id: 10, kind: "loop", volume: 0.7, fadeInMs: 3000 };

  beforeEach(async () => {
    await engine.load(10, "/api/sound-assets/5/audio", "stream");
  });

  test("stream from the server through a gain, with the same fade-in and loop", () => {
    expect(audios.map((a) => a.src)).toEqual(["/api/sound-assets/5/audio"]);
    expect(engine.isLoaded(10)).toBe(true);
    engine.play(music);
    expect(audios[0]).toMatchObject({ paused: false, loop: true, currentTime: 0 });
    expect(ctx.gains[0]!.gain.events.slice(-2)).toEqual([
      ["set", 0, 10],
      ["ramp", 0.7, 13],
    ]);
  });

  test("report progress from the element, and cut dead then pause", async () => {
    engine.play(music);
    audios[0]!.currentTime = 150;
    expect(engine.progress(10)).toBe(0.25);
    engine.stop(10);
    expect(ctx.gains[0]!.gain.events.at(-1)).toEqual(["ramp", 0, 10 + DECLICK_S]);
    expect(engine.isPlaying(10)).toBe(false);
    await new Promise((r) => setTimeout(r, 30));
    expect(audios[0]!.paused).toBe(true);
  });

  test("a streamed one-shot that ends counts as stopped", () => {
    engine.play({ ...music, kind: "one-shot" });
    expect(audios[0]!.loop).toBe(false);
    audios[0]!.fire("ended");
    expect(engine.isPlaying(10)).toBe(false);
  });

  test("restarting straight after a stop isn't paused by the old stop", async () => {
    engine.play(music);
    engine.stop(10);
    engine.play(music);
    await new Promise((r) => setTimeout(r, 30));
    expect(audios[0]!.paused).toBe(false);
  });
});

test("fade out ramps to silence over the given time, then stops; it counts as stopped at once", () => {
  engine.play(loop);
  engine.fadeOut(1, 4);
  expect(engine.isPlaying(1)).toBe(false);
  expect(ctx.gains[0]!.gain.events.at(-1)).toEqual(["ramp", 0, 14]);
  expect(ctx.sources[0]!.stoppedAt).toBe(14);
});

test("onEnded fires when a clip plays out on its own, not when it's stopped", () => {
  const ended: number[] = [];
  engine.onEnded((id) => ended.push(id));
  engine.play(jeer);
  engine.stop(3);
  ctx.sources[0]!.end(); // the stopped voice's own end
  expect(ended).toEqual([]);
  engine.play(jeer);
  ctx.sources[1]!.end();
  expect(ended).toEqual([3]);
});

test("position reports where a playing clip is", () => {
  engine.play(jeer);
  ctx.currentTime = 11;
  expect(engine.position(3)).toEqual({ at: 1, duration: 4 });
  expect(engine.position(1)).toBeNull();
});

describe("YouTube clips (bafft-w8f.17)", () => {
  type Fake = { calls: string[]; volume: number; loop: boolean; events: import("./youtube-player.js").YtEvents };
  let fakes: Fake[];
  let dock: HTMLElement;
  const tune: EngineClip = { id: 20, kind: "loop", volume: 0.6, fadeInMs: 3000 };
  const flush = () => new Promise((r) => setTimeout(r, 0));

  beforeEach(async () => {
    fakes = [];
    dock = document.createElement("div");
    engine = new SoundEngine({
      createContext: () => ctx as unknown as AudioContext,
      youTubeDock: () => dock,
      createYouTube: async (_ref, _host, events) => {
        const f: Fake = { calls: [], volume: 0, loop: false, events };
        fakes.push(f);
        return {
          play: () => f.calls.push("play"),
          pause: () => f.calls.push("pause"),
          restart: () => f.calls.push("restart"),
          setVolume: (v) => {
            f.volume = v;
          },
          setLoop: (l) => {
            f.loop = l;
          },
          currentTime: () => 12,
          duration: () => 240,
          destroy: () => f.calls.push("destroy"),
        };
      },
    });
    await engine.load(20, "youtube:video:abcdefghijk", "youtube");
  });

  test("the player is made on first play, starts at the clip's volume with no fade, and docks visibly", async () => {
    expect(engine.isLoaded(20)).toBe(true);
    expect(fakes).toHaveLength(0);
    engine.play(tune);
    await flush();
    expect(fakes).toHaveLength(1);
    expect(fakes[0]!.calls).toEqual(["restart"]);
    expect(fakes[0]!.volume).toBe(0.6);
    expect(fakes[0]!.loop).toBe(true);
    expect(dock.querySelector(".yt-slot")?.hasAttribute("hidden")).toBe(false);
    expect(engine.position(20)).toEqual({ at: 12, duration: 240 });
  });

  test("stopping pauses it at once (no crossfade) and hides the player; replaying reuses it", async () => {
    engine.play(tune);
    await flush();
    engine.fadeOut(20, 4);
    expect(engine.isPlaying(20)).toBe(false);
    await flush();
    expect(fakes[0]!.calls).toEqual(["restart", "pause"]);
    expect(dock.querySelector(".yt-slot")?.hasAttribute("hidden")).toBe(true);
    engine.play(tune);
    await flush();
    expect(fakes).toHaveLength(1);
  });

  test("volume goes to the player; a loop restarts at the end, a one-shot ends", async () => {
    engine.play(tune);
    await flush();
    engine.setVolume(20, 0.3);
    await flush();
    expect(fakes[0]!.volume).toBe(0.3);
    fakes[0]!.events.onEnded();
    await flush();
    expect(fakes[0]!.calls.at(-1)).toBe("restart");
    expect(engine.isPlaying(20)).toBe(true);

    const ended: number[] = [];
    engine.onEnded((id) => ended.push(id));
    engine.setLoop(20, false);
    fakes[0]!.events.onEnded();
    expect(engine.isPlaying(20)).toBe(false);
    expect(ended).toEqual([20]);
  });
});
