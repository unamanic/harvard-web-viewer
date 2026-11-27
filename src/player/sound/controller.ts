/**
 * Sound for the show player (SPEC §4.7: a sound or MIDI slide starts playing
 * and the show continues at once). Pure logic over an injected environment
 * so that tests can use a fake audio element; `browserSoundEnv` is the real
 * one.
 *
 * - WAV plays through an audio element from a blob URL, revoked when the
 *   sound stops or ends. One sound at a time: a new one stops the previous.
 * - MIDI plays through the FM synthesizer (src/audio/synth.ts), streamed by
 *   an AudioLike of its own (midiAudio.ts). Like a WAV, it stops the sound
 *   before it, and a later sound stops it [I: one sound at a time].
 * - A missing or unplayable file gives a note and a warning; the show goes on.
 * - Browsers block playing without a user gesture: a rejected play() is
 *   reported as `blocked` and `enable()` (from a click) tries again.
 */
import { describeWav, soundFormat } from "./format";
import { MidiAudio } from "./midiAudio";

/** The part of HTMLAudioElement the controller uses. */
export interface AudioLike {
  src: string;
  muted: boolean;
  play(): Promise<void> | undefined;
  pause(): void;
  onended: ((ev: Event) => unknown) | null;
}

export type ResolveFile = (name: string) => Uint8Array | null;

export interface SoundEnv {
  resolveFile: ResolveFile;
  createAudio(): AudioLike;
  /** A player for MIDI file bytes (it ignores `src`). */
  createMidiAudio(bytes: Uint8Array): AudioLike;
  createObjectUrl(bytes: Uint8Array, type: string): string;
  revokeObjectUrl(url: string): void;
  warn(message: string): void;
}

export interface SoundStatus {
  /** File name of the sound playing (or waiting to be enabled), or null. */
  playing: string | null;
  /** The browser refused to start the sound without a user gesture. */
  blocked: boolean;
  muted: boolean;
}

export interface SoundListener {
  onStatus?(status: SoundStatus): void;
  /** A short message for the viewer (shown for a few seconds). */
  onNote?(text: string): void;
}

/** What the controller needs of a sound slide. */
export interface SoundSlide {
  readonly label: string;
  readonly fileName: string | null;
}

interface Current {
  name: string;
  audio: AudioLike;
  /** Blob URL of a WAV (revoked when it stops); null for MIDI. */
  url: string | null;
}

function listNames(names: string[]): string {
  return names.join(", ");
}

export class SoundController {
  private current: Current | null = null;
  private blocked = false;
  private muted: boolean;
  private readonly env: SoundEnv;
  private readonly listener: SoundListener;
  /** Files already warned about (one warning per file). */
  private readonly warned: Set<string>;

  constructor(env: SoundEnv, listener: SoundListener = {}, options: { muted?: boolean; warned?: Set<string> } = {}) {
    this.env = env;
    this.listener = listener;
    this.muted = options.muted ?? false;
    this.warned = options.warned ?? new Set();
  }

  get status(): SoundStatus {
    return { playing: this.current?.name ?? null, blocked: this.blocked, muted: this.muted };
  }

  /**
   * Start the sounds of the slides one move passed over, in order. Each
   * playable sound would stop the one before, so only the last playable one
   * (WAV or MIDI) is started; every missing or unplayable file is mentioned
   * in one note.
   */
  playSlides(slides: readonly SoundSlide[]): void {
    const missing: string[] = [];
    const unplayable: string[] = [];
    let last: { name: string; bytes: Uint8Array; midi: boolean } | null = null;
    for (const slide of slides) {
      const name = slide.fileName ?? slide.label;
      const bytes = slide.fileName ? this.env.resolveFile(slide.fileName) : null;
      if (!bytes) {
        missing.push(name);
        this.warnOnce(`missing:${name}`, `Sound file ${name} is missing; the show goes on without it.`);
        continue;
      }
      const format = soundFormat(name, bytes);
      if (format === "midi") {
        last = { name, bytes, midi: true };
      } else if (format === "wav" && describeWav(bytes)) {
        last = { name, bytes, midi: false };
      } else {
        unplayable.push(name);
        this.warnOnce(`bad:${name}`, `${name} is not a WAV or MIDI file; not played.`);
      }
    }
    const notes: string[] = [];
    if (missing.length) notes.push(`Sound file ${listNames(missing)} is missing`);
    if (unplayable.length) notes.push(`${listNames(unplayable)} cannot be played`);
    if (notes.length) this.listener.onNote?.(notes.join(". "));
    if (last) this.start(last.name, last.bytes, last.midi);
  }

  /** Stop the sound playing, if any. */
  stop(): void {
    if (!this.release()) return;
    this.emit();
  }

  setMuted(muted: boolean): void {
    if (muted === this.muted) return;
    this.muted = muted;
    if (this.current) this.current.audio.muted = muted;
    this.emit();
  }

  /** After `blocked`: try again (call from a click, which browsers accept as a gesture). */
  enable(): void {
    if (this.current && this.blocked) this.tryPlay(this.current);
  }

  private start(name: string, bytes: Uint8Array, midi: boolean): void {
    this.release();
    const url = midi ? null : this.env.createObjectUrl(bytes, "audio/wav");
    const audio = midi ? this.env.createMidiAudio(bytes) : this.env.createAudio();
    audio.muted = this.muted;
    if (url) audio.src = url;
    const current: Current = { name, audio, url };
    audio.onended = () => {
      if (this.current === current) this.stop();
    };
    this.current = current;
    this.emit();
    this.tryPlay(current);
  }

  private tryPlay(current: Current): void {
    const failed = (err: unknown) => {
      if (this.current !== current) return;
      if (err instanceof Error && err.name === "NotAllowedError") {
        if (!this.blocked) {
          this.blocked = true;
          this.emit();
        }
        return;
      }
      const why = err instanceof Error ? err.message : String(err);
      this.warnOnce(`fail:${current.name}`, `Could not play ${current.name}: ${why}`);
      this.listener.onNote?.(`${current.name} could not be played`);
      this.stop();
    };
    let promise: Promise<void> | undefined;
    try {
      promise = current.audio.play();
    } catch (err) {
      failed(err);
      return;
    }
    const played = () => {
      if (this.current === current && this.blocked) {
        this.blocked = false;
        this.emit();
      }
    };
    if (promise) promise.then(played, failed);
    else played();
  }

  /** Stop and forget the current sound. True if there was one. */
  private release(): boolean {
    const current = this.current;
    this.current = null;
    this.blocked = false;
    if (!current) return false;
    current.audio.onended = null;
    current.audio.pause();
    if (current.url) this.env.revokeObjectUrl(current.url);
    return true;
  }

  private warnOnce(key: string, message: string): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    this.env.warn(message);
  }

  private emit(): void {
    this.listener.onStatus?.(this.status);
  }
}

/** The real environment: HTMLAudioElement, the MIDI synthesizer, blob URLs and console warnings. */
export function browserSoundEnv(resolveFile: ResolveFile): SoundEnv {
  return {
    resolveFile,
    createAudio: () => new Audio(),
    createMidiAudio: (bytes) => new MidiAudio(bytes),
    // slice() gives a copy backed by a plain ArrayBuffer, as Blob wants.
    createObjectUrl: (bytes, type) => URL.createObjectURL(new Blob([bytes.slice()], { type })),
    revokeObjectUrl: (url) => URL.revokeObjectURL(url),
    warn: (message) => console.warn(message),
  };
}
