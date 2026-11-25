/**
 * The export loop, independent of the browser's media APIs: for each frame
 * of the timeline, wait for the encoder (`sink.waitForSlot`: backpressure,
 * or real-time pacing for MediaRecorder), draw the frame on the frame
 * canvas when it differs from the one before, and hand it to the sink.
 * Pictures come pre-rendered from a `PictureStore`; nothing keeps more than
 * the few pictures in use, and no frame is kept after it is encoded.
 */
import { type FrameContext, drawFrame, drawOps } from "./compose";
import type { Pcm } from "./audio";
import { type Source, type Timeline, frameCount, frameKey, frameLayers, frameTimeMs } from "./timeline";

/** Pre-rendered pictures of the frame's size. */
export interface PictureStore {
  /** Make sure these pictures are ready (rendered on first use). */
  prepare(needed: readonly { picture: number; transparent: boolean }[]): Promise<void>;
  /** A prepared picture. */
  get(picture: number, transparent: boolean): CanvasImageSource;
  /** Free every picture. */
  clear(): void;
}

export interface FrameInfo {
  index: number;
  timestampUs: number;
  durationUs: number;
  /** The frame canvas was redrawn (false: same picture as the frame before). */
  changed: boolean;
  /** Ask the encoder for a key frame. */
  keyFrame: boolean;
}

/** Where frames (from the frame canvas) and the sound track go. */
export interface VideoSink {
  /** Called once before the first frame, with the mixed sound track when there is one. */
  start(audio: Pcm | null): Promise<void>;
  /** Resolves when frame `index` may be drawn (encoder queue not too long, or its time has come). */
  waitForSlot(frame: FrameInfo): Promise<void>;
  /** The frame canvas now shows frame `frame.index`. */
  addFrame(frame: FrameInfo): Promise<void>;
  /** All frames given: the finished file. */
  finish(durationMs: number): Promise<Blob>;
  /** Stop and free everything (after cancel or an error). */
  abort(): void;
}

export interface Progress {
  done: number;
  total: number;
  elapsedMs: number;
  /** Estimated from the pace so far; null until a few frames are done. */
  remainingMs: number | null;
}

export interface ExportJob {
  timeline: Timeline;
  fps: number;
  width: number;
  height: number;
  /** 2D context of the frame canvas the sink reads. */
  frame: FrameContext;
  pictures: PictureStore;
  sink: VideoSink;
  audio: Pcm | null;
  onProgress?: (p: Progress) => void;
  signal?: AbortSignal;
  now?: () => number;
  /** Seconds between key frames. */
  keyIntervalSeconds?: number;
}

export const KEY_INTERVAL_SECONDS = 3;

export class ExportCancelled extends Error {
  constructor() {
    super("Export cancelled");
    this.name = "AbortError";
  }
}

/** Remaining time from the pace so far (null before 5 frames, when it means little). */
export function remainingMs(done: number, total: number, elapsedMs: number): number | null {
  if (done < 5 || done <= 0) return null;
  return Math.max(0, (elapsedMs / done) * (total - done));
}

/** The pictures a frame's layers draw. */
export function neededPictures(layers: readonly { source: Source; transparent: boolean }[]): { picture: number; transparent: boolean }[] {
  return layers.flatMap((l) => (l.source === "blank" ? [] : [{ picture: l.source.picture, transparent: l.transparent }]));
}

export async function runExport(job: ExportJob): Promise<Blob> {
  const { timeline, fps, width, height, sink, pictures, signal } = job;
  const now = job.now ?? (() => performance.now());
  const total = frameCount(timeline.durationMs, fps);
  const keyEvery = Math.max(1, Math.round((job.keyIntervalSeconds ?? KEY_INTERVAL_SECONDS) * fps));
  const started = now();
  const check = () => {
    if (signal?.aborted) throw new ExportCancelled();
  };
  try {
    check();
    if (total === 0) throw new Error("The show has no slides to put in a video.");
    await sink.start(job.audio);
    let lastKey: string | null = null;
    for (let i = 0; i < total; i++) {
      check();
      const startMs = frameTimeMs(i, fps);
      const endMs = i + 1 < total ? frameTimeMs(i + 1, fps) : timeline.durationMs;
      const layers = frameLayers(timeline, i, fps);
      const key = frameKey(layers);
      const info: FrameInfo = {
        index: i,
        timestampUs: Math.round(startMs * 1000),
        durationUs: Math.max(1, Math.round((endMs - startMs) * 1000)),
        changed: key !== lastKey,
        keyFrame: i % keyEvery === 0,
      };
      await sink.waitForSlot(info);
      check();
      if (info.changed) {
        await pictures.prepare(neededPictures(layers));
        check();
        drawFrame(job.frame, drawOps(layers, width, height), width, height, (p, t) => pictures.get(p, t));
        lastKey = key;
      }
      await sink.addFrame(info);
      const elapsedMs = now() - started;
      job.onProgress?.({ done: i + 1, total, elapsedMs, remainingMs: remainingMs(i + 1, total, elapsedMs) });
    }
    check();
    const blob = await sink.finish(timeline.durationMs);
    check();
    return blob;
  } catch (e) {
    sink.abort();
    throw e;
  } finally {
    pictures.clear();
  }
}
