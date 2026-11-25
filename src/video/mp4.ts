/**
 * A small MP4 (ISO BMFF) muxer for H.264 video ("avc" format: length-
 * prefixed NAL units, `avcC` from the encoder's decoderConfig.description)
 * and optional AAC-LC audio, as WebCodecs produces them. Like the WebM
 * muxer, encoded chunks are collected and `finish` writes the whole file:
 *
 *   ftyp · moov (mvhd, trak video, [trak audio]) · mdat
 *
 * moov comes first ("fast start": playable while it downloads); chunk
 * offsets are written as co64 (8 bytes each), so moov's size does not
 * depend on them. One sample per chunk, samples interleaved by time.
 * Baseline-profile H.264 has no B-frames, so no composition offsets (ctts).
 */
import { concatBytes } from "./ebml";

export interface Mp4VideoTrack {
  width: number;
  height: number;
  /** AVCDecoderConfigurationRecord (VideoEncoder's decoderConfig.description). */
  avcC: Uint8Array;
}

export interface Mp4AudioTrack {
  sampleRate: number;
  channels: number;
  /** AudioSpecificConfig (AudioEncoder's decoderConfig.description); made for AAC-LC when absent. */
  audioSpecificConfig?: Uint8Array;
}

export interface Mp4Chunk {
  timestampUs: number;
  /** Duration in µs, if known (used for the last sample). */
  durationUs?: number;
  key: boolean;
  data: Uint8Array;
}

export const VIDEO_TIMESCALE = 90_000;
const MOVIE_TIMESCALE = 1000;

const AAC_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

/** AudioSpecificConfig for AAC-LC (object type 2). */
export function aacAudioSpecificConfig(sampleRate: number, channels: number): Uint8Array {
  const index = AAC_RATES.indexOf(sampleRate);
  if (index < 0) throw new RangeError(`AAC sample rate ${sampleRate} has no index`);
  return new Uint8Array([(2 << 3) | (index >> 1), ((index & 1) << 7) | (channels << 3)]);
}

// ---------------------------------------------------------------------------
// Box writing
// ---------------------------------------------------------------------------

class Writer {
  private bytes: number[] = [];
  u8(v: number): this {
    this.bytes.push(v & 0xff);
    return this;
  }
  u16(v: number): this {
    return this.u8(v >> 8).u8(v);
  }
  u24(v: number): this {
    return this.u8(v >> 16).u8(v >> 8).u8(v);
  }
  u32(v: number): this {
    return this.u16(Math.floor(v / 65536) & 0xffff).u16(v & 0xffff);
  }
  u64(v: number): this {
    return this.u32(Math.floor(v / 2 ** 32)).u32(v >>> 0);
  }
  zeros(n: number): this {
    for (let i = 0; i < n; i++) this.bytes.push(0);
    return this;
  }
  str(s: string): this {
    for (const c of s) this.bytes.push(c.charCodeAt(0) & 0xff);
    return this;
  }
  done(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

const w = () => new Writer();

export function box(type: string, ...parts: Uint8Array[]): Uint8Array {
  const body = concatBytes(parts);
  return concatBytes([w().u32(8 + body.length).str(type).done(), body]);
}

function fullBox(type: string, version: number, flags: number, ...parts: Uint8Array[]): Uint8Array {
  return box(type, w().u8(version).u24(flags).done(), ...parts);
}

const MATRIX = w().u32(0x00010000).u32(0).u32(0).u32(0).u32(0x00010000).u32(0).u32(0).u32(0).u32(0x40000000).done();

/** Run-length (count, delta) pairs of the sample durations. */
export function timeToSample(deltas: readonly number[]): [number, number][] {
  const runs: [number, number][] = [];
  for (const d of deltas) {
    const last = runs[runs.length - 1];
    if (last && last[1] === d) last[0]++;
    else runs.push([1, d]);
  }
  return runs;
}

interface TrackSamples {
  id: number;
  timescale: number;
  /** Sample start times in the track's timescale. */
  deltas: number[];
  durations: number;
  sizes: number[];
  keys: boolean[];
  offsets: number[];
}

function samplesOf(id: number, chunks: Mp4Chunk[], timescale: number, defaultDurationUs: number): TrackSamples {
  const times = chunks.map((c) => Math.round((c.timestampUs * timescale) / 1e6));
  const deltas = times.map((t, i) => {
    if (i + 1 < times.length) return Math.max(0, times[i + 1] - t);
    const us = chunks[i].durationUs ?? defaultDurationUs;
    return Math.max(1, Math.round((us * timescale) / 1e6));
  });
  return {
    id,
    timescale,
    deltas,
    durations: deltas.reduce((a, b) => a + b, 0),
    sizes: chunks.map((c) => c.data.length),
    keys: chunks.map((c) => c.key),
    offsets: chunks.map(() => 0),
  };
}

function stbl(s: TrackSamples, sampleEntry: Uint8Array, sync: boolean): Uint8Array {
  const runs = timeToSample(s.deltas);
  const stts = w().u32(runs.length);
  for (const [count, delta] of runs) stts.u32(count).u32(delta);
  const stsz = w().u32(0).u32(s.sizes.length);
  for (const size of s.sizes) stsz.u32(size);
  const co64 = w().u32(s.offsets.length);
  for (const o of s.offsets) co64.u64(o);
  const parts = [
    fullBox("stsd", 0, 0, w().u32(1).done(), sampleEntry),
    fullBox("stts", 0, 0, stts.done()),
  ];
  if (sync && s.keys.some((k) => !k)) {
    const numbers = s.keys.flatMap((k, i) => (k ? [i + 1] : []));
    const stss = w().u32(numbers.length);
    for (const n of numbers) stss.u32(n);
    parts.push(fullBox("stss", 0, 0, stss.done()));
  }
  parts.push(
    fullBox("stsc", 0, 0, w().u32(s.sizes.length ? 1 : 0).done(), s.sizes.length ? w().u32(1).u32(1).u32(1).done() : new Uint8Array(0)),
    fullBox("stsz", 0, 0, stsz.done()),
    fullBox("co64", 0, 0, co64.done()),
  );
  return box("stbl", ...parts);
}

function trak(s: TrackSamples, kind: "video" | "audio", width: number, height: number, sampleEntry: Uint8Array): Uint8Array {
  const movieDuration = Math.round((s.durations * MOVIE_TIMESCALE) / s.timescale);
  const tkhd = fullBox(
    "tkhd",
    0,
    3,
    w()
      .u32(0)
      .u32(0)
      .u32(s.id)
      .u32(0)
      .u32(movieDuration)
      .zeros(8)
      .u16(0)
      .u16(kind === "audio" ? 1 : 0)
      .u16(kind === "audio" ? 0x0100 : 0)
      .u16(0)
      .done(),
    MATRIX,
    w().u32(width * 65536).u32(height * 65536).done(),
  );
  const mdhd = fullBox("mdhd", 0, 0, w().u32(0).u32(0).u32(s.timescale).u32(s.durations).u16(0x55c4).u16(0).done());
  const hdlr = fullBox(
    "hdlr",
    0,
    0,
    w().u32(0).str(kind === "video" ? "vide" : "soun").zeros(12).str(kind === "video" ? "VideoHandler" : "SoundHandler").u8(0).done(),
  );
  const header = kind === "video" ? fullBox("vmhd", 0, 1, w().zeros(8).done()) : fullBox("smhd", 0, 0, w().zeros(4).done());
  const dinf = box("dinf", fullBox("dref", 0, 0, w().u32(1).done(), fullBox("url ", 0, 1)));
  const minf = box("minf", header, dinf, stbl(s, sampleEntry, kind === "video"));
  return box("trak", tkhd, box("mdia", mdhd, hdlr, minf));
}

function avc1Entry(v: Mp4VideoTrack): Uint8Array {
  return box(
    "avc1",
    w()
      .zeros(6)
      .u16(1)
      .zeros(16)
      .u16(v.width)
      .u16(v.height)
      .u32(0x00480000)
      .u32(0x00480000)
      .u32(0)
      .u16(1)
      .zeros(32)
      .u16(0x0018)
      .u16(0xffff)
      .done(),
    box("avcC", v.avcC),
  );
}

function descriptor(tag: number, ...parts: Uint8Array[]): Uint8Array {
  const body = concatBytes(parts);
  if (body.length > 127) throw new RangeError("Descriptor too long");
  return concatBytes([new Uint8Array([tag, body.length]), body]);
}

function mp4aEntry(a: Mp4AudioTrack, trackId: number): Uint8Array {
  const asc = a.audioSpecificConfig ?? aacAudioSpecificConfig(a.sampleRate, a.channels);
  const esds = fullBox(
    "esds",
    0,
    0,
    descriptor(
      0x03,
      w().u16(trackId).u8(0).done(),
      descriptor(0x04, w().u8(0x40).u8(0x15).u24(0).u32(0).u32(0).done(), descriptor(0x05, asc)),
      descriptor(0x06, new Uint8Array([0x02])),
    ),
  );
  return box(
    "mp4a",
    w().zeros(6).u16(1).zeros(8).u16(a.channels).u16(16).u16(0).u16(0).u32(Math.min(a.sampleRate, 65535) * 65536).done(),
    esds,
  );
}

export class Mp4Muxer {
  private readonly video: Mp4VideoTrack;
  private readonly audio: Mp4AudioTrack | null;
  private readonly videoChunks: Mp4Chunk[] = [];
  private readonly audioChunks: Mp4Chunk[] = [];
  private readonly frameUs: number;

  constructor(options: { video: Mp4VideoTrack; audio?: Mp4AudioTrack | null; fps: number }) {
    this.video = options.video;
    this.audio = options.audio ?? null;
    this.frameUs = 1e6 / options.fps;
  }

  addVideo(chunk: Mp4Chunk): void {
    this.videoChunks.push(chunk);
  }

  addAudio(chunk: Mp4Chunk): void {
    if (!this.audio) throw new Error("This MP4 file has no audio track");
    this.audioChunks.push(chunk);
  }

  finish(): Uint8Array[] {
    const byTime = (a: Mp4Chunk, b: Mp4Chunk) => a.timestampUs - b.timestampUs;
    const video = [...this.videoChunks].sort(byTime);
    const audio = [...this.audioChunks].sort(byTime);
    const vs = samplesOf(1, video, VIDEO_TIMESCALE, this.frameUs);
    const as = this.audio ? samplesOf(2, audio, this.audio.sampleRate, (1024 / this.audio.sampleRate) * 1e6) : null;

    // Interleave by time: the order of the samples in mdat.
    const order: { track: TrackSamples; index: number; chunk: Mp4Chunk }[] = [];
    let i = 0;
    let j = 0;
    while (i < video.length || j < audio.length) {
      if (j >= audio.length || (i < video.length && video[i].timestampUs <= audio[j].timestampUs)) {
        order.push({ track: vs, index: i, chunk: video[i] });
        i++;
      } else {
        order.push({ track: as!, index: j, chunk: audio[j] });
        j++;
      }
    }
    const mdatBytes = order.reduce((n, o) => n + o.chunk.data.length, 0);
    const large = mdatBytes + 8 > 0xffffffff;
    const mdatHeader = large ? w().u32(1).str("mdat").u64(16 + mdatBytes).done() : w().u32(8 + mdatBytes).str("mdat").done();

    const ftyp = box("ftyp", w().str("isom").u32(0x200).str("isom").str("iso2").str("avc1").str("mp41").done());
    const moov = () => {
      const durations = [vs, ...(as ? [as] : [])].map((s) => Math.round((s.durations * MOVIE_TIMESCALE) / s.timescale));
      const mvhd = fullBox(
        "mvhd",
        0,
        0,
        w().u32(0).u32(0).u32(MOVIE_TIMESCALE).u32(Math.max(...durations)).u32(0x00010000).u16(0x0100).zeros(10).done(),
        MATRIX,
        w().zeros(24).u32(as ? 3 : 2).done(),
      );
      const traks = [trak(vs, "video", this.video.width, this.video.height, avc1Entry(this.video))];
      if (as && this.audio) traks.push(trak(as, "audio", 0, 0, mp4aEntry(this.audio, 2)));
      return box("moov", mvhd, ...traks);
    };
    // co64 entries are fixed-size: measure moov once, then fill in the offsets.
    const moovSize = moov().length;
    let offset = ftyp.length + moovSize + mdatHeader.length;
    for (const o of order) {
      o.track.offsets[o.index] = offset;
      offset += o.chunk.data.length;
    }
    return [ftyp, moov(), mdatHeader, ...order.map((o) => o.chunk.data)];
  }
}

// ---------------------------------------------------------------------------
// Reading (tests)
// ---------------------------------------------------------------------------

export interface ParsedBox {
  type: string;
  offset: number;
  size: number;
  data: Uint8Array;
}

/** The boxes one after another in `bytes`. */
export function readBoxes(bytes: Uint8Array, base = 0): ParsedBox[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: ParsedBox[] = [];
  for (let pos = 0; pos + 8 <= bytes.length; ) {
    let size = view.getUint32(pos);
    const type = String.fromCharCode(...bytes.subarray(pos + 4, pos + 8));
    let header = 8;
    if (size === 1) {
      size = view.getUint32(pos + 8) * 2 ** 32 + view.getUint32(pos + 12);
      header = 16;
    }
    if (size < header || pos + size > bytes.length) throw new Error(`Box ${type} at ${base + pos} runs past its parent`);
    out.push({ type, offset: base + pos, size, data: bytes.subarray(pos + header, pos + size) });
    pos += size;
  }
  return out;
}
