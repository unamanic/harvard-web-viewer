/**
 * A small WebM (Matroska) muxer for encoded VP8/VP9 video and Opus audio
 * (WebCodecs output). Chunks are collected (they are compressed and small;
 * raw frames never get here), and `finish` lays the file out with every
 * size known:
 *
 *   EBML header
 *   Segment
 *     SeekHead (→ Info, Tracks, Cues)
 *     Info (1 ms timecodes, Duration)
 *     Tracks (video 1; audio 2 when there is sound)
 *     Cues (one CuePoint per cluster starting at a video key frame)
 *     Cluster* (Timecode, SimpleBlock* in time order)
 *
 * A cluster starts at each video key frame (the encoder asks for one every
 * few seconds), and before a block would be more than ~30 s past the
 * cluster's start (block timecodes are 16-bit, relative). Positions in
 * SeekHead and Cues are written in 8 bytes so the layout can be computed
 * before the values are known.
 */
import { type EbmlElement, concatBytes, encodeId, encodeSize, serialize } from "./ebml";

export const ID = {
  EBML: 0x1a45dfa3,
  EBMLVersion: 0x4286,
  EBMLReadVersion: 0x42f7,
  EBMLMaxIDLength: 0x42f2,
  EBMLMaxSizeLength: 0x42f3,
  DocType: 0x4282,
  DocTypeVersion: 0x4287,
  DocTypeReadVersion: 0x4285,
  Segment: 0x18538067,
  SeekHead: 0x114d9b74,
  Seek: 0x4dbb,
  SeekID: 0x53ab,
  SeekPosition: 0x53ac,
  Info: 0x1549a966,
  TimecodeScale: 0x2ad7b1,
  Duration: 0x4489,
  MuxingApp: 0x4d80,
  WritingApp: 0x5741,
  Tracks: 0x1654ae6b,
  TrackEntry: 0xae,
  TrackNumber: 0xd7,
  TrackUID: 0x73c5,
  TrackType: 0x83,
  FlagLacing: 0x9c,
  CodecID: 0x86,
  CodecPrivate: 0x63a2,
  CodecDelay: 0x56aa,
  SeekPreRoll: 0x56bb,
  DefaultDuration: 0x23e383,
  Video: 0xe0,
  PixelWidth: 0xb0,
  PixelHeight: 0xba,
  Audio: 0xe1,
  SamplingFrequency: 0xb5,
  Channels: 0x9f,
  Cluster: 0x1f43b675,
  Timecode: 0xe7,
  SimpleBlock: 0xa3,
  Cues: 0x1c53bb6b,
  CuePoint: 0xbb,
  CueTime: 0xb3,
  CueTrackPositions: 0xb7,
  CueTrack: 0xf7,
  CueClusterPosition: 0xf1,
} as const;

export const VIDEO_TRACK = 1;
export const AUDIO_TRACK = 2;
/** Longest cluster (ms); block timecodes are signed 16-bit offsets from it. */
export const MAX_CLUSTER_MS = 30_000;

export interface WebmVideoTrack {
  codecId: "V_VP8" | "V_VP9";
  width: number;
  height: number;
  /** Frames per second, written as the track's default frame duration. */
  fps?: number;
}

export interface WebmAudioTrack {
  codecId: "A_OPUS";
  sampleRate: number;
  channels: number;
  /** OpusHead; made from the other fields when absent (opusHead). */
  codecPrivate?: Uint8Array;
}

export interface MuxChunk {
  /** Presentation time in microseconds (WebCodecs' unit). */
  timestampUs: number;
  key: boolean;
  data: Uint8Array;
}

/** Opus pre-skip written when the encoder gives no OpusHead (libopus' usual 6.5 ms at 48 kHz). */
export const DEFAULT_OPUS_PRESKIP = 312;

/** An OpusHead (RFC 7845 §5.1) for mapping family 0 (mono or stereo). */
export function opusHead(channels: number, inputSampleRate: number, preSkip = DEFAULT_OPUS_PRESKIP): Uint8Array {
  const out = new Uint8Array(19);
  out.set(new TextEncoder().encode("OpusHead"), 0);
  const view = new DataView(out.buffer);
  out[8] = 1;
  out[9] = channels;
  view.setUint16(10, preSkip, true);
  view.setUint32(12, inputSampleRate, true);
  view.setInt16(16, 0, true);
  out[18] = 0;
  return out;
}

/** Pre-skip (48 kHz samples) of an OpusHead, or null if the bytes are not one. */
export function opusPreSkip(head: Uint8Array): number | null {
  if (head.length < 19 || new TextDecoder().decode(head.subarray(0, 8)) !== "OpusHead") return null;
  return head[10] | (head[11] << 8);
}

interface Block {
  track: number;
  ms: number;
  key: boolean;
  data: Uint8Array;
}

const uint = (id: number, value: number, width?: number): EbmlElement => ({ id, data: { uint: value, width } });
const str = (id: number, value: string): EbmlElement => ({ id, data: { string: value } });

/** EBML header of a WebM file. */
export function ebmlHeader(): Uint8Array {
  return serialize({
    id: ID.EBML,
    data: [
      uint(ID.EBMLVersion, 1),
      uint(ID.EBMLReadVersion, 1),
      uint(ID.EBMLMaxIDLength, 4),
      uint(ID.EBMLMaxSizeLength, 8),
      str(ID.DocType, "webm"),
      uint(ID.DocTypeVersion, 4),
      uint(ID.DocTypeReadVersion, 2),
    ],
  });
}

/** The SimpleBlock payload: track number (vint), int16 relative timecode, flags, frame. */
export function simpleBlock(track: number, relativeMs: number, key: boolean, data: Uint8Array): Uint8Array {
  if (relativeMs < -32768 || relativeMs > 32767) throw new RangeError(`Block timecode ${relativeMs} out of range`);
  const head = new Uint8Array(3);
  new DataView(head.buffer).setInt16(0, relativeMs);
  head[2] = key ? 0x80 : 0;
  return concatBytes([encodeSize(track), head, data]);
}

export class WebmMuxer {
  private readonly video: WebmVideoTrack;
  private readonly audio: WebmAudioTrack | null;
  private readonly videoBlocks: Block[] = [];
  private readonly audioBlocks: Block[] = [];
  private readonly app: string;

  constructor(options: { video: WebmVideoTrack; audio?: WebmAudioTrack | null; app?: string }) {
    this.video = options.video;
    this.audio = options.audio ?? null;
    this.app = options.app ?? "Harvard Web Viewer";
  }

  addVideo(chunk: MuxChunk): void {
    this.videoBlocks.push({ track: VIDEO_TRACK, ms: Math.round(chunk.timestampUs / 1000), key: chunk.key, data: chunk.data });
  }

  addAudio(chunk: MuxChunk): void {
    if (!this.audio) throw new Error("This WebM file has no audio track");
    this.audioBlocks.push({ track: AUDIO_TRACK, ms: Math.round(chunk.timestampUs / 1000), key: true, data: chunk.data });
  }

  /** The file's bytes, as parts to put in a Blob (or concatenate). `durationMs`: the video's length. */
  finish(durationMs: number): Uint8Array[] {
    const blocks = mergeBlocks(this.videoBlocks, this.audioBlocks);
    const clusters = buildClusters(blocks);
    const tracks = serialize(this.tracksElement());
    const info = serialize({
      id: ID.Info,
      data: [uint(ID.TimecodeScale, 1_000_000), str(ID.MuxingApp, this.app), str(ID.WritingApp, this.app), { id: ID.Duration, data: { float: durationMs } }],
    });
    const cueClusters = clusters.filter((c) => c.cue);
    const seekHead = (infoPos: number, tracksPos: number, cuesPos: number) =>
      serialize({
        id: ID.SeekHead,
        data: [
          [ID.Info, infoPos],
          [ID.Tracks, tracksPos],
          [ID.Cues, cuesPos],
        ].map(([id, pos]) => ({
          id: ID.Seek,
          data: [
            { id: ID.SeekID, data: new Uint8Array([(id >>> 24) & 0xff, (id >>> 16) & 0xff, (id >>> 8) & 0xff, id & 0xff]) },
            uint(ID.SeekPosition, pos, 8),
          ],
        })),
      });
    const cues = (positions: number[]) =>
      serialize({
        id: ID.Cues,
        data: cueClusters.map((c, i) => ({
          id: ID.CuePoint,
          data: [uint(ID.CueTime, c.ms), { id: ID.CueTrackPositions, data: [uint(ID.CueTrack, VIDEO_TRACK), uint(ID.CueClusterPosition, positions[i], 8)] }],
        })),
      });
    // Sizes do not depend on the positions (fixed-width), so lay out once with zeros.
    const seekSize = seekHead(0, 0, 0).length;
    const infoPos = seekSize;
    const tracksPos = infoPos + info.length;
    const cuesPos = tracksPos + tracks.length;
    const cuesSize = cueClusters.length ? cues(cueClusters.map(() => 0)).length : 0;
    let pos = cuesPos + cuesSize;
    const clusterPos = new Map<ClusterBytes, number>();
    for (const c of clusters) {
      clusterPos.set(c, pos);
      pos += c.bytes.length;
    }
    const segmentSize = pos;
    const parts: Uint8Array[] = [
      ebmlHeader(),
      concatBytes([encodeId(ID.Segment), encodeSize(segmentSize, 8)]),
      seekHead(infoPos, tracksPos, cueClusters.length ? cuesPos : tracksPos),
      info,
      tracks,
    ];
    if (cueClusters.length) parts.push(cues(cueClusters.map((c) => clusterPos.get(c)!)));
    for (const c of clusters) parts.push(c.bytes);
    return parts;
  }

  private tracksElement(): EbmlElement {
    const v = this.video;
    const entries: EbmlElement[] = [
      {
        id: ID.TrackEntry,
        data: [
          uint(ID.TrackNumber, VIDEO_TRACK),
          uint(ID.TrackUID, VIDEO_TRACK),
          uint(ID.TrackType, 1),
          uint(ID.FlagLacing, 0),
          str(ID.CodecID, v.codecId),
          ...(v.fps ? [uint(ID.DefaultDuration, Math.round(1e9 / v.fps))] : []),
          { id: ID.Video, data: [uint(ID.PixelWidth, v.width), uint(ID.PixelHeight, v.height)] },
        ],
      },
    ];
    const a = this.audio;
    if (a) {
      const head = a.codecPrivate && opusPreSkip(a.codecPrivate) !== null ? a.codecPrivate : opusHead(a.channels, a.sampleRate);
      const preSkip = opusPreSkip(head) ?? DEFAULT_OPUS_PRESKIP;
      entries.push({
        id: ID.TrackEntry,
        data: [
          uint(ID.TrackNumber, AUDIO_TRACK),
          uint(ID.TrackUID, AUDIO_TRACK),
          uint(ID.TrackType, 2),
          uint(ID.FlagLacing, 0),
          str(ID.CodecID, a.codecId),
          { id: ID.CodecPrivate, data: head },
          uint(ID.CodecDelay, Math.round((preSkip / 48_000) * 1e9)),
          uint(ID.SeekPreRoll, 80_000_000),
          { id: ID.Audio, data: [{ id: ID.SamplingFrequency, data: { float: a.sampleRate } }, uint(ID.Channels, a.channels)] },
        ],
      });
    }
    return { id: ID.Tracks, data: entries };
  }
}

/** Video and audio blocks in time order (video first at equal times). */
function mergeBlocks(video: Block[], audio: Block[]): Block[] {
  const byTime = (a: Block, b: Block) => a.ms - b.ms;
  const v = [...video].sort(byTime);
  const s = [...audio].sort(byTime);
  const out: Block[] = [];
  let i = 0;
  let j = 0;
  while (i < v.length || j < s.length) {
    if (j >= s.length || (i < v.length && v[i].ms <= s[j].ms)) out.push(v[i++]);
    else out.push(s[j++]);
  }
  return out;
}

interface ClusterBytes {
  ms: number;
  /** Starts with a video key frame (gets a cue). */
  cue: boolean;
  bytes: Uint8Array;
}

function buildClusters(blocks: Block[]): ClusterBytes[] {
  const out: ClusterBytes[] = [];
  let current: { ms: number; cue: boolean; parts: Uint8Array[] } | null = null;
  const close = () => {
    if (!current) return;
    const body = concatBytes([serialize(uint(ID.Timecode, current.ms)), ...current.parts]);
    out.push({ ms: current.ms, cue: current.cue, bytes: concatBytes([encodeId(ID.Cluster), encodeSize(body.length), body]) });
    current = null;
  };
  for (const b of blocks) {
    const videoKey = b.track === VIDEO_TRACK && b.key;
    if (!current || (videoKey && b.ms > current.ms) || b.ms - current.ms > MAX_CLUSTER_MS) {
      close();
      current = { ms: b.ms, cue: videoKey, parts: [] };
    }
    current.parts.push(serialize({ id: ID.SimpleBlock, data: simpleBlock(b.track, b.ms - current.ms, b.key, b.data) }));
  }
  close();
  return out;
}
