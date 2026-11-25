/**
 * Encoding with WebCodecs (browser only): VideoEncoder (VP9/VP8 for WebM,
 * H.264 for MP4) fed from the frame canvas, AudioEncoder (Opus / AAC) fed
 * the mixed sound track, chunks handed to the in-repo muxers. Faster than
 * real time; the encoder's queue is kept short so frames do not pile up.
 */
import { type Pcm } from "./audio";
import type { FrameInfo, VideoSink } from "./encode";
import { Mp4Muxer } from "./mp4";
import { AUDIO_SAMPLE_RATE, type VideoFormat, videoBitrate, webmCodecId } from "./options";
import { WebmMuxer } from "./webm";

/** Frames waiting in the encoder before drawing the next one waits. */
export const MAX_QUEUE = 6;
const AUDIO_BITRATE = 128_000;
/** Samples per AudioData handed to the encoder (100 ms). */
const AUDIO_BLOCK = 4800;

export function hasWebCodecs(): boolean {
  return typeof VideoEncoder !== "undefined" && typeof VideoFrame !== "undefined";
}

export function videoConfig(codec: string, width: number, height: number, fps: number): VideoEncoderConfig {
  // bitrateMode and latencyMode keep their defaults ("variable", "quality"), which every browser accepts.
  const config: VideoEncoderConfig = { codec, width, height, framerate: fps, bitrate: videoBitrate(width, height) };
  if (codec.startsWith("avc1")) config.avc = { format: "avc" };
  return config;
}

export function audioConfig(codec: string, channels: number): AudioEncoderConfig {
  return { codec, sampleRate: AUDIO_SAMPLE_RATE, numberOfChannels: channels, bitrate: AUDIO_BITRATE };
}

export async function videoSupported(codec: string, width: number, height: number, fps: number): Promise<boolean> {
  if (!hasWebCodecs()) return false;
  return (await VideoEncoder.isConfigSupported(videoConfig(codec, width, height, fps))).supported === true;
}

export async function audioSupported(codec: string, channels = 2): Promise<boolean> {
  if (typeof AudioEncoder === "undefined" || typeof AudioData === "undefined") return false;
  return (await AudioEncoder.isConfigSupported(audioConfig(codec, channels))).supported === true;
}

function chunkBytes(chunk: EncodedVideoChunk | EncodedAudioChunk): Uint8Array {
  const out = new Uint8Array(chunk.byteLength);
  chunk.copyTo(out);
  return out;
}

function descriptionBytes(d: AllowSharedBufferSource | undefined): Uint8Array | undefined {
  if (!d) return undefined;
  if (d instanceof ArrayBuffer || (typeof SharedArrayBuffer !== "undefined" && d instanceof SharedArrayBuffer)) return new Uint8Array(d.slice(0));
  const view = d as ArrayBufferView;
  return new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
}

interface Collected {
  timestampUs: number;
  durationUs?: number;
  key: boolean;
  data: Uint8Array;
}

export interface WebCodecsSinkOptions {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  format: VideoFormat;
  videoCodec: string;
  /** Null: no sound track. */
  audioCodec: string | null;
  width: number;
  height: number;
  fps: number;
}

export class WebCodecsSink implements VideoSink {
  private readonly o: WebCodecsSinkOptions;
  private video: VideoEncoder | null = null;
  private audio: AudioEncoder | null = null;
  private error: Error | null = null;
  private readonly videoChunks: Collected[] = [];
  private readonly audioChunks: Collected[] = [];
  private videoDescription: Uint8Array | undefined;
  private audioDescription: Uint8Array | undefined;
  private audioChannels = 2;
  private last: VideoFrame | null = null;

  constructor(options: WebCodecsSinkOptions) {
    this.o = options;
  }

  private fail = (e: unknown) => {
    this.error ??= e instanceof Error ? e : new Error(String(e));
  };

  private throwIfFailed(): void {
    if (this.error) throw new Error(`The browser's encoder stopped: ${this.error.message}`);
  }

  async start(audio: Pcm | null): Promise<void> {
    const { videoCodec, width, height, fps } = this.o;
    this.video = new VideoEncoder({
      output: (chunk, meta) => {
        if (meta?.decoderConfig?.description) this.videoDescription ??= descriptionBytes(meta.decoderConfig.description);
        this.videoChunks.push({ timestampUs: chunk.timestamp, durationUs: chunk.duration ?? undefined, key: chunk.type === "key", data: chunkBytes(chunk) });
      },
      error: this.fail,
    });
    this.video.configure(videoConfig(videoCodec, width, height, fps));
    if (audio && this.o.audioCodec) await this.encodeAudio(audio, this.o.audioCodec);
  }

  private async encodeAudio(pcm: Pcm, codec: string): Promise<void> {
    const channels = pcm.channels.length;
    this.audioChannels = channels;
    const encoder = new AudioEncoder({
      output: (chunk, meta) => {
        if (meta?.decoderConfig?.description) this.audioDescription ??= descriptionBytes(meta.decoderConfig.description);
        this.audioChunks.push({ timestampUs: chunk.timestamp, durationUs: chunk.duration ?? undefined, key: true, data: chunkBytes(chunk) });
      },
      error: this.fail,
    });
    this.audio = encoder;
    encoder.configure(audioConfig(codec, channels));
    const frames = pcm.channels[0]?.length ?? 0;
    for (let from = 0; from < frames; from += AUDIO_BLOCK) {
      this.throwIfFailed();
      const n = Math.min(AUDIO_BLOCK, frames - from);
      const planar = new Float32Array(n * channels);
      for (let c = 0; c < channels; c++) planar.set(pcm.channels[c].subarray(from, from + n), c * n);
      const data = new AudioData({
        format: "f32-planar",
        sampleRate: pcm.sampleRate,
        numberOfFrames: n,
        numberOfChannels: channels,
        timestamp: Math.round((from / pcm.sampleRate) * 1e6),
        data: planar,
      });
      encoder.encode(data);
      data.close();
      if (encoder.encodeQueueSize > 32) await new Promise((r) => setTimeout(r, 0));
    }
    await encoder.flush();
    this.throwIfFailed();
  }

  async waitForSlot(): Promise<void> {
    const video = this.video;
    if (!video) throw new Error("Encoder not started");
    while (video.encodeQueueSize > MAX_QUEUE) {
      this.throwIfFailed();
      await new Promise<void>((resolve) => {
        const done = () => {
          video.removeEventListener("dequeue", done);
          clearTimeout(timer);
          resolve();
        };
        // Some browsers have no "dequeue" event: poll as well.
        const timer = setTimeout(done, 15);
        video.addEventListener("dequeue", done);
      });
    }
    this.throwIfFailed();
  }

  async addFrame(frame: FrameInfo): Promise<void> {
    const video = this.video;
    if (!video) throw new Error("Encoder not started");
    this.throwIfFailed();
    const init = { timestamp: frame.timestampUs, duration: frame.durationUs };
    // An unchanged frame reuses the last one's pixels (no canvas read-back).
    const vf = !frame.changed && this.last ? new VideoFrame(this.last, init) : new VideoFrame(this.o.canvas, init);
    if (frame.changed || !this.last) {
      this.last?.close();
      this.last = vf.clone();
    }
    video.encode(vf, { keyFrame: frame.keyFrame });
    vf.close();
    // Let the page breathe (progress bar, Cancel).
    if (frame.index % 15 === 0) await new Promise((r) => setTimeout(r, 0));
  }

  async finish(durationMs: number): Promise<Blob> {
    const video = this.video;
    if (!video) throw new Error("Encoder not started");
    await video.flush();
    this.throwIfFailed();
    this.closeAll();
    const { format, width, height, fps, videoCodec } = this.o;
    const hasAudio = this.audioChunks.length > 0;
    if (format === "webm") {
      const mux = new WebmMuxer({
        video: { codecId: webmCodecId(videoCodec), width, height, fps },
        audio: hasAudio ? { codecId: "A_OPUS", sampleRate: AUDIO_SAMPLE_RATE, channels: this.audioChannels, codecPrivate: this.audioDescription } : null,
      });
      for (const c of this.videoChunks) mux.addVideo(c);
      for (const c of this.audioChunks) mux.addAudio(c);
      return new Blob(mux.finish(durationMs) as BlobPart[], { type: "video/webm" });
    }
    if (!this.videoDescription) throw new Error("The H.264 encoder gave no decoder configuration.");
    const mux = new Mp4Muxer({
      video: { width, height, avcC: this.videoDescription },
      audio: hasAudio ? { sampleRate: AUDIO_SAMPLE_RATE, channels: this.audioChannels, audioSpecificConfig: this.audioDescription } : null,
      fps,
    });
    for (const c of this.videoChunks) mux.addVideo(c);
    for (const c of this.audioChunks) mux.addAudio(c);
    return new Blob(mux.finish() as BlobPart[], { type: "video/mp4" });
  }

  abort(): void {
    this.closeAll();
    this.videoChunks.length = 0;
    this.audioChunks.length = 0;
  }

  private closeAll(): void {
    this.last?.close();
    this.last = null;
    for (const enc of [this.video, this.audio]) {
      try {
        if (enc && enc.state !== "closed") enc.close();
      } catch {
        // Already closed.
      }
    }
  }
}
