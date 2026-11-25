import { describe, expect, it } from "vitest";
import { concatBytes } from "./ebml";
import { type ParsedBox, Mp4Muxer, VIDEO_TIMESCALE, aacAudioSpecificConfig, readBoxes, timeToSample } from "./mp4";

const find = (boxes: ParsedBox[], type: string) => boxes.find((b) => b.type === type)!;
const kids = (b: ParsedBox) => readBoxes(b.data, b.offset + 8);
const path = (boxes: ParsedBox[], ...types: string[]): ParsedBox => {
  let b = find(boxes, types[0]);
  for (const t of types.slice(1)) b = find(kids(b), t);
  return b;
};
const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);
/** Full-box payload after version/flags. */
const body = (b: ParsedBox) => b.data.subarray(4);

const AVCC = new Uint8Array([1, 0x42, 0xe0, 0x28, 0xff, 0xe1, 0, 4, 0x67, 0x42, 0, 0x28, 1, 0, 2, 0x68, 0xce]);

function build(audio: boolean) {
  const mux = new Mp4Muxer({ video: { width: 640, height: 480, avcC: AVCC }, audio: audio ? { sampleRate: 48000, channels: 2 } : null, fps: 30 });
  for (let i = 0; i < 90; i++) mux.addVideo({ timestampUs: Math.round((i * 1e6) / 30), key: i % 45 === 0, data: new Uint8Array([0, 0, 0, 1, i]) });
  if (audio) for (let k = 0; k < 141; k++) mux.addAudio({ timestampUs: Math.round((k * 1024 * 1e6) / 48000), key: true, data: new Uint8Array([0xaa, k]) });
  return concatBytes(mux.finish());
}

describe("Mp4Muxer", () => {
  it("writes ftyp, moov, mdat in that order, covering the file", () => {
    const file = build(true);
    const top = readBoxes(file);
    expect(top.map((b) => b.type)).toEqual(["ftyp", "moov", "mdat"]);
    expect(top.reduce((n, b) => n + b.size, 0)).toBe(file.length);
    expect(String.fromCharCode(...find(top, "ftyp").data.subarray(0, 4))).toBe("isom");
    expect(kids(find(top, "moov")).map((b) => b.type)).toEqual(["mvhd", "trak", "trak"]);
  });

  it("describes the video track: avc1 with avcC, times, sync samples", () => {
    const top = readBoxes(build(false));
    const stbl = path(top, "moov", "trak", "mdia", "minf", "stbl");
    expect(kids(stbl).map((b) => b.type)).toEqual(["stsd", "stts", "stss", "stsc", "stsz", "co64"]);
    const stsd = find(kids(stbl), "stsd");
    const avc1 = readBoxes(body(stsd).subarray(4), 0)[0];
    expect(avc1.type).toBe("avc1");
    expect(view(avc1.data).getUint16(24)).toBe(640);
    expect(view(avc1.data).getUint16(26)).toBe(480);
    const avcC = readBoxes(avc1.data.subarray(78))[0];
    expect(avcC.type).toBe("avcC");
    expect(Array.from(avcC.data)).toEqual(Array.from(AVCC));
    // 90 frames of 3000 ticks (30 fps at 90 kHz).
    const stts = body(find(kids(stbl), "stts"));
    expect([view(stts).getUint32(0), view(stts).getUint32(4), view(stts).getUint32(8)]).toEqual([1, 90, VIDEO_TIMESCALE / 30]);
    const stss = body(find(kids(stbl), "stss"));
    expect([view(stss).getUint32(0), view(stss).getUint32(4), view(stss).getUint32(8)]).toEqual([2, 1, 46]);
    const mdhd = body(path(top, "moov", "trak", "mdia", "mdhd"));
    expect(view(mdhd).getUint32(8)).toBe(VIDEO_TIMESCALE);
    expect(view(mdhd).getUint32(12)).toBe(270_000);
    const mvhd = body(path(top, "moov", "mvhd"));
    expect(view(mvhd).getUint32(12)).toBe(3000);
  });

  it("points every sample's offset at its bytes in mdat, interleaved by time", () => {
    const file = build(true);
    const top = readBoxes(file);
    const traks = kids(find(top, "moov")).filter((b) => b.type === "trak");
    const samples = traks.map((trak) => {
      const stbl = path(kids(trak), "mdia", "minf", "stbl");
      const co64 = body(find(kids(stbl), "co64"));
      const stsz = body(find(kids(stbl), "stsz"));
      const n = view(co64).getUint32(0);
      expect(view(stsz).getUint32(4)).toBe(n);
      return Array.from({ length: n }, (_, i) => ({
        offset: view(co64).getUint32(4 + i * 8 + 4),
        size: view(stsz).getUint32(8 + i * 4),
      }));
    });
    expect(samples[0]).toHaveLength(90);
    expect(samples[1]).toHaveLength(141);
    samples[0].forEach((s, i) => expect(Array.from(file.subarray(s.offset, s.offset + s.size))).toEqual([0, 0, 0, 1, i]));
    samples[1].forEach((s, k) => expect(Array.from(file.subarray(s.offset, s.offset + s.size))).toEqual([0xaa, k]));
    const mdat = find(top, "mdat");
    const all = [...samples[0], ...samples[1]].sort((a, b) => a.offset - b.offset);
    expect(all[0].offset).toBe(mdat.offset + 8);
    for (let i = 1; i < all.length; i++) expect(all[i].offset).toBe(all[i - 1].offset + all[i - 1].size);
  });

  it("describes AAC audio with an esds holding the AudioSpecificConfig", () => {
    const top = readBoxes(build(true));
    const trak = kids(find(top, "moov")).filter((b) => b.type === "trak")[1];
    expect(String.fromCharCode(...body(path(kids(trak), "mdia", "hdlr")).subarray(4, 8))).toBe("soun");
    const stsd = path(kids(trak), "mdia", "minf", "stbl", "stsd");
    const mp4a = readBoxes(body(stsd).subarray(4))[0];
    expect(mp4a.type).toBe("mp4a");
    expect(view(mp4a.data).getUint16(16)).toBe(2);
    expect(view(mp4a.data).getUint32(24) >>> 16).toBe(48000);
    const esds = readBoxes(mp4a.data.subarray(28))[0];
    expect(esds.type).toBe("esds");
    const asc = aacAudioSpecificConfig(48000, 2);
    const bytes = Array.from(body(esds));
    const at = bytes.findIndex((b, i) => b === 0x05 && bytes[i + 1] === asc.length);
    expect(bytes.slice(at + 2, at + 2 + asc.length)).toEqual(Array.from(asc));
    // No sync table: every audio sample is a sync sample.
    expect(kids(path(kids(trak), "mdia", "minf", "stbl")).map((b) => b.type)).not.toContain("stss");
  });
});

describe("MP4 helpers", () => {
  it("makes AAC-LC AudioSpecificConfigs", () => {
    expect(Array.from(aacAudioSpecificConfig(48000, 2))).toEqual([0x11, 0x90]);
    expect(Array.from(aacAudioSpecificConfig(44100, 1))).toEqual([0x12, 0x08]);
    expect(() => aacAudioSpecificConfig(12345, 2)).toThrow(RangeError);
  });

  it("run-length encodes sample durations", () => {
    expect(timeToSample([3000, 3000, 3000, 3003, 3000])).toEqual([
      [3, 3000],
      [1, 3003],
      [1, 3000],
    ]);
  });
});
