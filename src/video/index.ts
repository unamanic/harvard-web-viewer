/**
 * Video export entry point (browser only; loaded on demand by the export
 * dialog): what the browser can encode, and running an export with
 * WebCodecs or, where that is missing, MediaRecorder.
 */
import type { Presentation } from "../formats/types";
import type { DisplayMode } from "../render/displayMode";
import type { ResolveFile } from "../player/sound/controller";
import type { TransitionMode } from "../player/transitions/mode";
import { type DecodedSound, type Pcm, isSilent, mixSounds, planAudio, readWav } from "./audio";
import { type Progress, type VideoSink, runExport } from "./encode";
import {
  AUDIO_CODEC,
  AUDIO_SAMPLE_RATE,
  FPS,
  VIDEO_CODECS,
  type VideoFormat,
  type VideoOptions,
  pickCodec,
  timelineFor,
  videoSize,
} from "./options";
import { createCanvas, context2d, createPictureStore } from "./rasterize";
import { RecorderSink, hasMediaRecorder, recorderMimeType } from "./recorder";
import { WebCodecsSink, audioSupported, hasWebCodecs, videoSupported } from "./webcodecs";

export interface FormatSupport {
  /** How the format would be made, or null when this browser cannot make it. */
  method: "webcodecs" | "recorder" | null;
  /** The sound track can be encoded too. */
  audio: boolean;
}

export type Support = Record<VideoFormat, FormatSupport>;

/** What this browser can make, checked at the given size. */
export async function detectSupport(width: number, height: number): Promise<Support> {
  const one = async (format: VideoFormat): Promise<FormatSupport> => {
    if (hasWebCodecs()) {
      const codec = await pickCodec(VIDEO_CODECS[format], (c) => videoSupported(c, width, height, FPS));
      if (codec) return { method: "webcodecs", audio: await audioSupported(AUDIO_CODEC[format]).catch(() => false) };
    }
    if (hasMediaRecorder() && recorderMimeType(format, false)) {
      return { method: "recorder", audio: recorderMimeType(format, true) !== null && typeof AudioContext !== "undefined" };
    }
    return { method: null, audio: false };
  };
  return { webm: await one("webm"), mp4: await one("mp4") };
}

/** Decode a WAV: the built-in reader, else the browser's decoder (ADPCM and other codecs). */
async function decodeSound(bytes: Uint8Array): Promise<Pcm | null> {
  const own = readWav(bytes);
  if (own) return own;
  if (typeof OfflineAudioContext === "undefined") return null;
  try {
    const ctx = new OfflineAudioContext(1, 1, AUDIO_SAMPLE_RATE);
    const buffer = await ctx.decodeAudioData(bytes.slice().buffer);
    return { sampleRate: buffer.sampleRate, channels: Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i)) };
  } catch {
    return null;
  }
}

export interface VideoExportRequest {
  presentation: Presentation;
  options: VideoOptions;
  transitionMode: TransitionMode;
  displayMode: DisplayMode;
  resolveFile?: ResolveFile;
  /** Where the recorder's canvas is shown while recording (MediaRecorder needs a canvas on the page). */
  previewHost?: HTMLElement | null;
  onProgress?: (p: Progress) => void;
  signal?: AbortSignal;
}

export interface VideoExportResult {
  blob: Blob;
  format: VideoFormat;
  method: "webcodecs" | "recorder";
  /** Things the viewer should know (sound left out, ...). */
  notes: string[];
}

export async function exportVideo(req: VideoExportRequest): Promise<VideoExportResult> {
  const { presentation, options, signal } = req;
  const timeline = timelineFor(presentation, options, req.transitionMode);
  const firstScene = timeline.pictures[0]?.scene();
  if (!firstScene) throw new Error("The show has no slides to put in a video.");
  const { width, height } = videoSize(options.width, firstScene.viewBox);
  const format = options.format;
  const notes: string[] = [];

  // The method: WebCodecs with the best codec, else MediaRecorder.
  let videoCodec: string | null = null;
  if (hasWebCodecs()) videoCodec = await pickCodec(VIDEO_CODECS[format], (c) => videoSupported(c, width, height, FPS));
  const method: "webcodecs" | "recorder" | null = videoCodec ? "webcodecs" : recorderMimeType(format, false) ? "recorder" : null;
  if (!method) throw new Error(`This browser cannot make ${format === "mp4" ? "MP4" : "WebM"} video.`);

  // The sound track.
  let audio: Pcm | null = null;
  let audioCodec: string | null = null;
  if (options.sound) {
    const plan = planAudio(timeline.cues, req.resolveFile);
    if (plan.midi.length) notes.push(`MIDI music (${plan.midi.join(", ")}) is not included: the viewer has no MIDI synthesizer.`);
    if (plan.missing.length) notes.push(`Sound file ${plan.missing.join(", ")} is missing; left out.`);
    const canAudio = method === "webcodecs" ? await audioSupported(AUDIO_CODEC[format]).catch(() => false) : recorderMimeType(format, true) !== null;
    if (plan.sounds.length && !canAudio) {
      notes.push(`This browser cannot encode sound for ${format === "mp4" ? "MP4" : "WebM"}; the video has no sound.`);
    } else if (plan.sounds.length) {
      const decoded: DecodedSound[] = [];
      for (const s of plan.sounds) {
        const pcm = await decodeSound(s.bytes);
        if (pcm) decoded.push({ atMs: s.atMs, pcm });
        else notes.push(`${s.name} could not be decoded; left out.`);
      }
      const channels = decoded.some((d) => d.pcm.channels.length > 1) ? 2 : 1;
      const mixed = mixSounds(decoded, timeline.durationMs, AUDIO_SAMPLE_RATE, channels);
      if (!isSilent(mixed)) {
        audio = mixed;
        audioCodec = AUDIO_CODEC[format];
      }
    }
    if (timeline.trailingSounds.length) notes.push("Sound after the last slide is not included (the video ends with the last slide).");
  }

  let sink: VideoSink;
  let frameCanvas: HTMLCanvasElement | OffscreenCanvas;
  let shown: HTMLCanvasElement | null = null;
  if (method === "webcodecs") {
    frameCanvas = createCanvas(width, height);
    sink = new WebCodecsSink({ canvas: frameCanvas, format, videoCodec: videoCodec!, audioCodec, width, height, fps: FPS });
  } else {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.className = "video-preview-canvas";
    canvas.setAttribute("aria-hidden", "true");
    (req.previewHost ?? document.body).appendChild(canvas);
    shown = canvas;
    frameCanvas = canvas;
    const mimeType = recorderMimeType(format, audio !== null)!;
    sink = new RecorderSink({ canvas, mimeType, width, height });
    notes.push("This browser records in real time: the export takes as long as the video. Keep this tab visible.");
  }
  const pictures = createPictureStore(timeline.pictures, req.displayMode, width, height);
  try {
    const blob = await runExport({
      timeline,
      fps: FPS,
      width,
      height,
      frame: context2d(frameCanvas) as CanvasRenderingContext2D,
      pictures,
      sink,
      audio,
      onProgress: req.onProgress,
      signal,
    });
    return { blob, format: blob.type.includes("mp4") ? "mp4" : "webm", method, notes };
  } finally {
    if (shown) shown.remove();
    if ("width" in frameCanvas) {
      frameCanvas.width = 0;
      frameCanvas.height = 0;
    }
  }
}

export { type Progress } from "./encode";
export { ExportCancelled } from "./encode";
