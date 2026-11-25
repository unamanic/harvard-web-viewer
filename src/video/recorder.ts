/**
 * Fallback encoding with MediaRecorder (browser only), where WebCodecs is
 * missing: the frame canvas's captureStream, a frame requested each time
 * the picture changes, paced in real time (the export takes as long as the
 * video); the sound track plays into the recording through Web Audio.
 * The tab must stay visible: hidden tabs stop painting.
 */
import type { Pcm } from "./audio";
import type { FrameInfo, VideoSink } from "./encode";
import { type VideoFormat, videoBitrate } from "./options";

const MIME_TYPES: Readonly<Record<VideoFormat, { withAudio: string[]; videoOnly: string[] }>> = {
  webm: {
    withAudio: ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"],
    videoOnly: ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"],
  },
  mp4: {
    withAudio: ["video/mp4;codecs=avc1,mp4a.40.2", "video/mp4;codecs=avc1,opus", "video/mp4"],
    videoOnly: ["video/mp4;codecs=avc1", "video/mp4"],
  },
};

export function hasMediaRecorder(): boolean {
  return typeof MediaRecorder !== "undefined" && typeof HTMLCanvasElement !== "undefined" && "captureStream" in HTMLCanvasElement.prototype;
}

/** The first MediaRecorder type the browser records for the format, or null. */
export function recorderMimeType(format: VideoFormat, withAudio: boolean): string | null {
  if (!hasMediaRecorder()) return null;
  const list = MIME_TYPES[format][withAudio ? "withAudio" : "videoOnly"];
  return list.find((t) => MediaRecorder.isTypeSupported(t)) ?? null;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, Math.max(0, ms)));

export class RecorderSink implements VideoSink {
  private readonly canvas: HTMLCanvasElement;
  private readonly mimeType: string;
  private readonly width: number;
  private readonly height: number;
  private recorder: MediaRecorder | null = null;
  private track: CanvasCaptureMediaStreamTrack | null = null;
  private audioContext: AudioContext | null = null;
  private readonly parts: Blob[] = [];
  private startedAt = 0;
  private error: Error | null = null;

  constructor(options: { canvas: HTMLCanvasElement; mimeType: string; width: number; height: number }) {
    this.canvas = options.canvas;
    this.mimeType = options.mimeType;
    this.width = options.width;
    this.height = options.height;
  }

  async start(audio: Pcm | null): Promise<void> {
    const stream = this.canvas.captureStream(0);
    this.track = (stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack | undefined) ?? null;
    let source: AudioBufferSourceNode | null = null;
    if (audio && audio.channels.length) {
      const ctx = new AudioContext({ sampleRate: audio.sampleRate });
      this.audioContext = ctx;
      await ctx.resume().catch(() => {});
      const buffer = ctx.createBuffer(audio.channels.length, audio.channels[0].length || 1, audio.sampleRate);
      audio.channels.forEach((ch, i) => buffer.copyToChannel(ch as Float32Array<ArrayBuffer>, i));
      const dest = ctx.createMediaStreamDestination();
      source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(dest);
      for (const t of dest.stream.getAudioTracks()) stream.addTrack(t);
    }
    const recorder = new MediaRecorder(stream, { mimeType: this.mimeType, videoBitsPerSecond: videoBitrate(this.width, this.height) });
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.parts.push(e.data);
    };
    recorder.onerror = (e) => {
      this.error ??= new Error(`Recording failed${"error" in e && e.error instanceof Error ? `: ${e.error.message}` : ""}`);
    };
    this.recorder = recorder;
    recorder.start(1000);
    source?.start();
    this.startedAt = performance.now();
  }

  async waitForSlot(frame: FrameInfo): Promise<void> {
    if (this.error) throw this.error;
    if (!frame.changed) return;
    await sleep(this.startedAt + frame.timestampUs / 1000 - performance.now());
  }

  async addFrame(frame: FrameInfo): Promise<void> {
    if (this.error) throw this.error;
    if (frame.changed) this.track?.requestFrame();
    // Unchanged frames cost nothing: the recording keeps the last picture until the next change.
    if (frame.index % 15 === 0) await sleep(0);
  }

  async finish(durationMs: number): Promise<Blob> {
    const recorder = this.recorder;
    if (!recorder) throw new Error("Recorder not started");
    await sleep(this.startedAt + durationMs - performance.now());
    // Repeat the last picture so the recording runs to the end.
    this.track?.requestFrame();
    await sleep(50);
    const stopped = new Promise<void>((resolve) => recorder.addEventListener("stop", () => resolve(), { once: true }));
    recorder.stop();
    await stopped;
    this.release();
    if (this.error) throw this.error;
    return new Blob(this.parts, { type: recorder.mimeType || this.mimeType });
  }

  abort(): void {
    try {
      if (this.recorder && this.recorder.state !== "inactive") this.recorder.stop();
    } catch {
      // Already stopped.
    }
    this.release();
    this.parts.length = 0;
  }

  private release(): void {
    this.track?.stop();
    this.track = null;
    void this.audioContext?.close().catch(() => {});
    this.audioContext = null;
  }
}
