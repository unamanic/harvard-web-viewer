import { describe, expect, it } from "vitest";
import { type ParsedElement, concatBytes, encodeId, encodeSize, encodeUint, readElements, readFloat, readUint, serialize } from "./ebml";
import { ID, MAX_CLUSTER_MS, WebmMuxer, opusHead, opusPreSkip, simpleBlock } from "./webm";

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join(" ");
const text = (b: Uint8Array) => new TextDecoder().decode(b);
const child = (el: ParsedElement, id: number) => readElements(el.data, el.offset + el.headerSize).find((e) => e.id === id);
const children = (el: ParsedElement, id?: number) => readElements(el.data, el.offset + el.headerSize).filter((e) => id === undefined || e.id === id);

describe("EBML", () => {
  it("encodes sizes as variable-length integers", () => {
    expect(hex(encodeSize(0))).toBe("80");
    expect(hex(encodeSize(1))).toBe("81");
    expect(hex(encodeSize(126))).toBe("fe");
    // 127 (all ones in one byte) means "unknown": two bytes.
    expect(hex(encodeSize(127))).toBe("40 7f");
    expect(hex(encodeSize(16382))).toBe("7f fe");
    expect(hex(encodeSize(16383))).toBe("20 3f ff");
    expect(hex(encodeSize(5, 8))).toBe("01 00 00 00 00 00 00 05");
    expect(hex(encodeSize(2 ** 40, 8))).toBe("01 00 01 00 00 00 00 00");
    expect(() => encodeSize(200, 1)).toThrow(RangeError);
    expect(() => encodeSize(-1)).toThrow(RangeError);
  });

  it("writes IDs with their own length marker", () => {
    expect(hex(encodeId(0xa3))).toBe("a3");
    expect(hex(encodeId(0x4286))).toBe("42 86");
    expect(hex(encodeId(0x2ad7b1))).toBe("2a d7 b1");
    expect(hex(encodeId(0x1a45dfa3))).toBe("1a 45 df a3");
    expect(() => encodeId(0x0186)).toThrow(RangeError);
  });

  it("writes unsigned integers big-endian, shortest or fixed width", () => {
    expect(hex(encodeUint(0))).toBe("00");
    expect(hex(encodeUint(1_000_000))).toBe("0f 42 40");
    expect(hex(encodeUint(258, 8))).toBe("00 00 00 00 00 00 01 02");
    expect(() => encodeUint(256, 1)).toThrow(RangeError);
  });

  it("serialises nested elements and reads them back", () => {
    const bytes = serialize({ id: 0x1a45dfa3, data: [{ id: 0x4286, data: { uint: 1 } }, { id: 0x4282, data: { string: "webm" } }, { id: 0x4489, data: { float: 1.5 } }] });
    const [root] = readElements(bytes);
    expect(root.id).toBe(0x1a45dfa3);
    const kids = readElements(root.data);
    expect(kids.map((k) => k.id)).toEqual([0x4286, 0x4282, 0x4489]);
    expect(readUint(kids[0].data)).toBe(1);
    expect(text(kids[1].data)).toBe("webm");
    expect(readFloat(kids[2].data)).toBe(1.5);
  });
});

describe("SimpleBlock", () => {
  it("is track, signed 16-bit relative time, flags, frame", () => {
    expect(hex(simpleBlock(1, 33, true, new Uint8Array([9, 9])))).toBe("81 00 21 80 09 09");
    expect(hex(simpleBlock(2, -2, false, new Uint8Array([])))).toBe("82 ff fe 00");
    expect(() => simpleBlock(1, 40000, true, new Uint8Array())).toThrow(RangeError);
  });
});

describe("OpusHead", () => {
  it("is 19 bytes with the pre-skip", () => {
    const head = opusHead(2, 48000);
    expect(head.length).toBe(19);
    expect(text(head.subarray(0, 8))).toBe("OpusHead");
    expect(opusPreSkip(head)).toBe(312);
    expect(opusPreSkip(new Uint8Array(19))).toBeNull();
  });
});

/** A fake encoded frame: 4 bytes carrying its index. */
const frame = (i: number) => new Uint8Array([0xf0, i >> 16, (i >> 8) & 0xff, i & 0xff]);

function muxed(options: { seconds: number; keyEvery: number; audio: boolean }) {
  const mux = new WebmMuxer({
    video: { codecId: "V_VP9", width: 640, height: 480, fps: 30 },
    audio: options.audio ? { codecId: "A_OPUS", sampleRate: 48000, channels: 2 } : null,
  });
  const frames = options.seconds * 30;
  for (let i = 0; i < frames; i++) mux.addVideo({ timestampUs: Math.round((i * 1e6) / 30), key: i % options.keyEvery === 0, data: frame(i) });
  if (options.audio) for (let k = 0; k * 20 < options.seconds * 1000; k++) mux.addAudio({ timestampUs: k * 20_000, key: true, data: new Uint8Array([0xa0, k & 0xff]) });
  return { file: concatBytes(mux.finish(options.seconds * 1000)), frames };
}

describe("WebmMuxer", () => {
  it("starts with the EBML header naming webm", () => {
    const { file } = muxed({ seconds: 1, keyEvery: 30, audio: false });
    expect(hex(file.subarray(0, 4))).toBe("1a 45 df a3");
    const [header, segment] = readElements(file);
    expect(header.id).toBe(ID.EBML);
    expect(text(child(header, ID.DocType)!.data)).toBe("webm");
    expect(readUint(child(header, ID.DocTypeReadVersion)!.data)).toBe(2);
    expect(segment.id).toBe(ID.Segment);
    // The Segment's size runs exactly to the end of the file.
    expect(segment.offset + segment.headerSize + segment.size).toBe(file.length);
  });

  it("lays out SeekHead, Info, Tracks, Cues and Clusters with correct positions", () => {
    const { file } = muxed({ seconds: 7, keyEvery: 90, audio: true });
    const [, segment] = readElements(file);
    const dataStart = segment.offset + segment.headerSize;
    const top = children(segment);
    expect(top.map((e) => e.id)).toEqual([ID.SeekHead, ID.Info, ID.Tracks, ID.Cues, ID.Cluster, ID.Cluster, ID.Cluster]);

    // SeekHead entries point at the elements, relative to the segment's data.
    for (const seek of children(top[0], ID.Seek)) {
      const id = readUint(child(seek, ID.SeekID)!.data);
      const pos = readUint(child(seek, ID.SeekPosition)!.data);
      expect(top.find((e) => e.id === id)!.offset - dataStart).toBe(pos);
    }

    const info = top[1];
    expect(readUint(child(info, ID.TimecodeScale)!.data)).toBe(1_000_000);
    expect(readFloat(child(info, ID.Duration)!.data)).toBe(7000);

    const tracks = children(top[2], ID.TrackEntry);
    expect(tracks.map((t) => text(child(t, ID.CodecID)!.data))).toEqual(["V_VP9", "A_OPUS"]);
    const video = child(tracks[0], ID.Video)!;
    expect([readUint(child(video, ID.PixelWidth)!.data), readUint(child(video, ID.PixelHeight)!.data)]).toEqual([640, 480]);
    expect(readUint(child(tracks[0], ID.DefaultDuration)!.data)).toBe(33_333_333);
    expect(text(child(tracks[1], ID.CodecPrivate)!.data.subarray(0, 8))).toBe("OpusHead");
    expect(readUint(child(tracks[1], ID.CodecDelay)!.data)).toBe(6_500_000);
    expect(readFloat(child(child(tracks[1], ID.Audio)!, ID.SamplingFrequency)!.data)).toBe(48000);

    // One cue per cluster (each starts at a key frame), pointing at it.
    const cues = children(top[3], ID.CuePoint);
    const clusters = top.filter((e) => e.id === ID.Cluster);
    expect(cues.map((c) => readUint(child(c, ID.CueTime)!.data))).toEqual([0, 3000, 6000]);
    cues.forEach((c, i) => {
      const pos = readUint(child(child(c, ID.CueTrackPositions)!, ID.CueClusterPosition)!.data);
      expect(pos).toBe(clusters[i].offset - dataStart);
    });
  });

  it("puts every frame in a block with its time, in order, key frames flagged", () => {
    const { file, frames } = muxed({ seconds: 7, keyEvery: 90, audio: true });
    const [, segment] = readElements(file);
    const blocks: { track: number; ms: number; key: boolean; payload: Uint8Array }[] = [];
    for (const cluster of children(segment, ID.Cluster)) {
      const base = readUint(child(cluster, ID.Timecode)!.data);
      for (const b of children(cluster, ID.SimpleBlock)) {
        const view = new DataView(b.data.buffer, b.data.byteOffset, b.data.byteLength);
        blocks.push({ track: b.data[0] & 0x7f, ms: base + view.getInt16(1), key: (b.data[3] & 0x80) !== 0, payload: b.data.subarray(4) });
      }
    }
    const video = blocks.filter((b) => b.track === 1);
    expect(video).toHaveLength(frames);
    video.forEach((b, i) => {
      expect(b.ms).toBe(Math.round((i * 1000) / 30));
      expect(b.key).toBe(i % 90 === 0);
      expect(Array.from(b.payload)).toEqual(Array.from(frame(i)));
    });
    expect(blocks.filter((b) => b.track === 2)).toHaveLength(350);
    // Interleaved by time across both tracks.
    for (let i = 1; i < blocks.length; i++) expect(blocks[i].ms).toBeGreaterThanOrEqual(blocks[i - 1].ms);
  });

  it("starts a new cluster before block times overflow, even without key frames", () => {
    const { file } = muxed({ seconds: 70, keyEvery: 1e9, audio: false });
    const [, segment] = readElements(file);
    const clusters = children(segment, ID.Cluster);
    const times = clusters.map((c) => readUint(child(c, ID.Timecode)!.data));
    expect(times.length).toBe(3);
    for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeLessThanOrEqual(MAX_CLUSTER_MS + 34);
    // Only the first cluster starts at a key frame, so only it has a cue.
    expect(children(children(segment, ID.Cues)[0], ID.CuePoint)).toHaveLength(1);
  });

  it("writes a video-only file without an audio track", () => {
    const { file } = muxed({ seconds: 1, keyEvery: 30, audio: false });
    const [, segment] = readElements(file);
    expect(children(child(segment, ID.Tracks)!, ID.TrackEntry)).toHaveLength(1);
    expect(() => new WebmMuxer({ video: { codecId: "V_VP8", width: 2, height: 2 } }).addAudio({ timestampUs: 0, key: true, data: new Uint8Array() })).toThrow();
  });
});
