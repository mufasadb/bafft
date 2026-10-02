// Test doubles for the soundboard engine: just enough of Web Audio and
// <audio> to see what the engine schedules. Not a *.test.ts, so it only
// ever loads from tests.
export class FakeParam {
  value = 1;
  events: [string, number, number][] = [];
  setValueAtTime(v: number, t: number) {
    this.events.push(["set", v, t]);
    this.value = v;
  }
  linearRampToValueAtTime(v: number, t: number) {
    this.events.push(["ramp", v, t]);
  }
  setTargetAtTime(v: number, t: number) {
    this.events.push(["target", v, t]);
  }
  cancelScheduledValues(t: number) {
    this.events.push(["cancel", 0, t]);
  }
}
export class FakeGain {
  gain = new FakeParam();
  connected = false;
  connect() {
    this.connected = true;
  }
  disconnect() {
    this.connected = false;
  }
}
export class FakeSource {
  buffer: { duration: number } | null = null;
  loop = false;
  startedAt: number | null = null;
  stoppedAt: number | null = null;
  onended: (() => void) | null = null;
  connect() {}
  start(t: number) {
    this.startedAt = t;
  }
  stop(t: number) {
    this.stoppedAt = t;
  }
  end() {
    this.onended?.();
  }
}
export class FakeContext {
  currentTime = 10;
  state = "suspended";
  destination = {};
  gains: FakeGain[] = [];
  sources: FakeSource[] = [];
  createGain() {
    const g = new FakeGain();
    this.gains.push(g);
    return g;
  }
  createBufferSource() {
    const s = new FakeSource();
    this.sources.push(s);
    return s;
  }
  createMediaElementSource(_el: FakeAudio) {
    return { connect() {} };
  }
  async decodeAudioData(data: ArrayBuffer) {
    return { duration: new Uint8Array(data)[0]! };
  }
  async resume() {
    this.state = "running";
  }
  async close() {
    this.state = "closed";
  }
}

export class FakeAudio {
  loop = false;
  currentTime = 0;
  duration = 600;
  paused = true;
  private handlers: Record<string, () => void> = {};
  constructor(public src: string) {}
  addEventListener(type: string, fn: () => void) {
    this.handlers[type] = fn;
  }
  async play() {
    this.paused = false;
  }
  pause() {
    this.paused = true;
  }
  removeAttribute() {}
  fire(type: string) {
    this.handlers[type]?.();
  }
}

