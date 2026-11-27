/**
 * A MIDI song played in the browser, with the interface of an audio element
 * (AudioLike) so the sound controller treats it like a WAV.
 *
 * The song is rendered by the synth worker (src/audio/synthWorker.ts) a
 * second at a time while it plays, and the pieces are queued back to back
 * on a shared Web Audio context, keeping about AHEAD_SECONDS rendered ahead.
 * Playing needs the context running: browsers keep it suspended until the
 * page has had a click or key press, and then play() rejects with
 * NotAllowedError, as an audio element does, so the controller can offer to
 * enable sound.
 */
import { OPL_RATE } from "../../audio/fm/opl";
import { type SynthResponse, createSynthWorker } from "../../audio/synthProtocol";
import type { AudioLike } from "./controller";

const CHUNK_SECONDS = 1;
const AHEAD_SECONDS = 6;
/** How long to wait for a suspended context to start before calling it blocked. */
const RESUME_WAIT_MS = 300;

let sharedContext: AudioContext | null = null;
function audioContext(): AudioContext {
  sharedContext ??= new AudioContext();
  return sharedContext;
}

function notAllowed(): Error {
  const err = new Error("The browser blocked sound until the page is clicked.");
  err.name = "NotAllowedError";
  return err;
}

export class MidiAudio implements AudioLike {
  src = "";
  onended: ((ev: Event) => unknown) | null = null;
  private readonly bytes: Uint8Array;
  private mutedValue = false;
  private worker: Worker | null = null;
  private gain: GainNode | null = null;
  private sources = new Set<AudioBufferSourceNode>();
  private nextTime = 0;
  private waiting = false;
  private finished = false;
  private stopped = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }

  get muted(): boolean {
    return this.mutedValue;
  }

  set muted(value: boolean) {
    this.mutedValue = value;
    if (this.gain) this.gain.gain.value = value ? 0 : 1;
  }

  async play(): Promise<void> {
    const ctx = audioContext();
    if (ctx.state !== "running") {
      await Promise.race([ctx.resume().catch(() => undefined), new Promise((r) => setTimeout(r, RESUME_WAIT_MS))]);
      if ((ctx.state as AudioContextState) !== "running") throw notAllowed();
    }
    if (this.worker || this.stopped) return;
    const worker = createSynthWorker();
    if (!worker) throw new Error("this browser cannot run the MIDI synthesizer (no Web Workers)");
    this.worker = worker;
    this.gain = ctx.createGain();
    this.gain.gain.value = this.mutedValue ? 0 : 1;
    this.gain.connect(ctx.destination);
    this.nextTime = ctx.currentTime + 0.05;
    await new Promise<void>((resolve, reject) => {
      let first = true;
      worker.onmessage = (e: MessageEvent<SynthResponse>) => {
        const msg = e.data;
        if (msg.type === "chunk") {
          this.schedule(msg.samples, msg.sampleRate);
          if (first) {
            first = false;
            resolve();
          }
        } else if (msg.type === "end") {
          this.finished = true;
          this.waiting = false;
          if (first) {
            first = false;
            resolve();
          }
          this.maybeEnded();
        } else if (msg.type === "error") {
          this.pause();
          if (first) reject(new Error(msg.message));
        }
      };
      worker.onerror = (e) => {
        this.pause();
        if (first) reject(new Error(e.message || "the MIDI synthesizer failed"));
      };
      worker.postMessage({ type: "start", bytes: this.bytes.slice() });
      this.request();
      this.timer = setInterval(() => this.request(), 250);
    });
  }

  /** Stop for good (the controller never resumes a paused sound). */
  pause(): void {
    this.stopped = true;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.worker?.terminate();
    this.worker = null;
    for (const s of this.sources) {
      s.onended = null;
      try {
        s.stop();
      } catch {
        // not started yet
      }
    }
    this.sources.clear();
    this.gain?.disconnect();
    this.gain = null;
  }

  /** Ask for the next second when less than AHEAD_SECONDS is queued. */
  private request(): void {
    if (!this.worker || this.waiting || this.finished || this.stopped) return;
    const ctx = audioContext();
    if (this.nextTime - ctx.currentTime > AHEAD_SECONDS) return;
    this.waiting = true;
    this.worker.postMessage({ type: "more", frames: Math.round(CHUNK_SECONDS * OPL_RATE) });
  }

  private schedule(samples: Float32Array, sampleRate: number): void {
    this.waiting = false;
    if (this.stopped || !this.gain || samples.length === 0) return;
    const ctx = audioContext();
    const buffer = ctx.createBuffer(1, samples.length, sampleRate);
    buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.gain);
    const at = Math.max(this.nextTime, ctx.currentTime + 0.02);
    source.start(at);
    this.nextTime = at + buffer.duration;
    this.sources.add(source);
    source.onended = () => {
      this.sources.delete(source);
      this.maybeEnded();
    };
    this.request();
  }

  private maybeEnded(): void {
    if (!this.finished || this.stopped || this.sources.size > 0) return;
    this.pause();
    this.onended?.(new Event("ended"));
  }
}
