/**
 * Video export options (pure): defaults, the sizes offered, the estimate
 * shown before starting, codec choice, and the file name.
 */
import type { Presentation } from "../model/presentation";
import type { ViewBox } from "../model/scene";
import type { TransitionMode } from "../player/transitions/mode";
import type { ResolveFile } from "../player/sound/controller";
import { planAudio } from "./audio";
import { type Timeline, buildTimeline, frameCount } from "./timeline";

export type VideoFormat = "webm" | "mp4";

export interface VideoOptions {
  /** Seconds shown for slides that wait for a key. */
  waitSeconds: number;
  /** Draw the slide changes with the viewer's Transitions setting (else Replace). */
  transitions: boolean;
  sound: boolean;
  /** Output width; the height follows the page shape. */
  width: 640 | 1280;
  format: VideoFormat;
}

export const FPS = 30;
export const DEFAULT_WAIT_SECONDS = 5;
export const MAX_WAIT_SECONDS = 600;
export const VIDEO_WIDTHS = [640, 1280] as const;

export function defaultVideoOptions(transitionMode: TransitionMode, hasSound: boolean): VideoOptions {
  return { waitSeconds: DEFAULT_WAIT_SECONDS, transitions: transitionMode !== "off", sound: hasSound, width: 640, format: "webm" };
}

/** A wait time typed by the user, made valid (0.5 s steps are kept). */
export function clampWaitSeconds(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_WAIT_SECONDS;
  return Math.min(MAX_WAIT_SECONDS, Math.max(0, value));
}

/** Output size for a width and the show's page shape; both even (4:2:0 video). */
export function videoSize(width: number, viewBox: ViewBox): { width: number; height: number } {
  const h = Math.max(2, Math.round((width * viewBox.height) / viewBox.width));
  return { width: width - (width % 2), height: h + (h % 2) };
}

/** The timeline for the options chosen. */
export function timelineFor(presentation: Presentation, options: Pick<VideoOptions, "waitSeconds" | "transitions">, transitionMode: TransitionMode): Timeline {
  return buildTimeline(presentation, {
    waitSeconds: clampWaitSeconds(options.waitSeconds),
    transitionMode: options.transitions ? transitionMode : "off",
  });
}

export interface VideoEstimate {
  durationMs: number;
  /** Picture slides shown. */
  slides: number;
  frames: number;
  /** WAV sounds the video plays. */
  sounds: number;
  /** MIDI files skipped. */
  midi: string[];
  missing: string[];
  unplayable: string[];
}

export function estimate(timeline: Timeline, resolveFile: ResolveFile | undefined): VideoEstimate {
  const plan = planAudio(timeline.cues, resolveFile);
  return {
    durationMs: timeline.durationMs,
    slides: timeline.pictures.length,
    frames: frameCount(timeline.durationMs, FPS),
    sounds: plan.sounds.length,
    midi: plan.midi,
    missing: plan.missing,
    unplayable: plan.unplayable,
  };
}

/** 83 500 ms → "1:24"; an hour or more → "1:02:03". */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** "SALES93.SH3" → "SALES93.webm". */
export function videoFileName(fileName: string, format: VideoFormat): string {
  const dot = fileName.lastIndexOf(".");
  const base = (dot > 0 ? fileName.slice(0, dot) : fileName).replace(/[^A-Za-z0-9_&-]+/g, "_") || "show";
  return `${base}.${format}`;
}

/** Bits per second for the video: dithered screens are detailed, so generous. */
export function videoBitrate(width: number, height: number): number {
  return Math.round(width * height * FPS * 0.12);
}

/** Codec strings tried, best first. */
export const VIDEO_CODECS: Readonly<Record<VideoFormat, readonly string[]>> = {
  // VP9 profile 0, level 4.0, 8-bit (up to 2048 × 1088); then VP8.
  webm: ["vp09.00.40.08", "vp8"],
  // H.264 constrained baseline, level 4.0 (no B-frames: no composition offsets needed).
  mp4: ["avc1.42E028", "avc1.42001f"],
};

export const AUDIO_CODEC: Readonly<Record<VideoFormat, string>> = { webm: "opus", mp4: "mp4a.40.2" };

export const AUDIO_SAMPLE_RATE = 48_000;

/** The first codec the browser says it can encode, or null. */
export async function pickCodec(codecs: readonly string[], supported: (codec: string) => Promise<boolean>): Promise<string | null> {
  for (const codec of codecs) {
    try {
      if (await supported(codec)) return codec;
    } catch {
      // A browser that throws for a codec string cannot use it.
    }
  }
  return null;
}

/** The WebM CodecID for a WebCodecs codec string. */
export function webmCodecId(codec: string): "V_VP8" | "V_VP9" {
  return codec.startsWith("vp09") ? "V_VP9" : "V_VP8";
}
