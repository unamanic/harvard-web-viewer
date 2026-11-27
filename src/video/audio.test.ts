import { describe, expect, it } from "vitest";
import { interleave, isSilent, mixSounds, planAudio, readWav } from "./audio";
import { show, wavBytes } from "./testing";
import { buildTimeline } from "./timeline";

const MIDI = new Uint8Array([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0, 96]);

describe("readWav", () => {
  it("reads 16-bit stereo and 8-bit mono PCM", () => {
    const st = readWav(wavBytes([[0, 0.5, -0.5], [1, -1, 0]], 22050))!;
    expect(st.sampleRate).toBe(22050);
    expect(st.channels).toHaveLength(2);
    expect(Array.from(st.channels[0]).map((v) => +v.toFixed(3))).toEqual([0, 0.5, -0.5]);
    expect(Array.from(st.channels[1]).map((v) => +v.toFixed(3))).toEqual([1, -1, 0]);
    const mono = readWav(wavBytes([[0, 1, -1]], 11025, 8))!;
    expect(Array.from(mono.channels[0]).map((v) => +v.toFixed(2))).toEqual([0, 0.99, -0.99]);
  });

  it("refuses what is not PCM WAV", () => {
    expect(readWav(MIDI)).toBeNull();
    const adpcm = wavBytes([[0, 0]], 8000);
    new DataView(adpcm.buffer).setUint16(20, 2, true);
    expect(readWav(adpcm)).toBeNull();
  });
});

describe("planAudio", () => {
  const files: Record<string, Uint8Array> = {
    "BELL.WAV": wavBytes([[0.1, 0.2]], 8000),
    "BUZZ.WAV": wavBytes([[0.3]], 8000),
    "TUNE.MID": MIDI,
    "JUNK.WAV": new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]),
  };
  const resolve = (name: string) => files[name] ?? null;

  it("plays the last sound (WAV or MIDI) of each move and reports missing and unplayable files", () => {
    const t = buildTimeline(
      show("A", [
        { label: "s1", kind: "sound", fileName: "BELL.WAV" },
        { label: "s2", kind: "sound", fileName: "BUZZ.WAV" },
        { label: "a" },
        { label: "m", kind: "sound", fileName: "TUNE.MID" },
        { label: "x", kind: "sound", fileName: "GONE.WAV" },
        { label: "j", kind: "sound", fileName: "JUNK.WAV" },
        { label: "b" },
        { label: "s3", kind: "sound", fileName: "BELL.WAV" },
        { label: "c" },
      ]),
      { waitSeconds: 2, transitionMode: "off" },
    );
    const plan = planAudio(t.cues, resolve);
    expect(plan.sounds.map((s) => [s.name, s.atMs, s.midi])).toEqual([
      ["BUZZ.WAV", 0, false],
      ["TUNE.MID", 2000, true],
      ["BELL.WAV", 4000, false],
    ]);
    expect(plan.missing).toEqual(["GONE.WAV"]);
    expect(plan.unplayable).toEqual(["JUNK.WAV"]);
  });

  it("counts every sound missing without a file resolver", () => {
    const t = buildTimeline(show("A", [{ label: "s", kind: "sound", fileName: "BELL.WAV" }, { label: "a" }]), { waitSeconds: 1, transitionMode: "off" });
    expect(planAudio(t.cues, undefined)).toMatchObject({ sounds: [], missing: ["BELL.WAV"] });
  });
});

describe("mixSounds", () => {
  const pcm = (rate: number, ...channels: number[][]) => ({ sampleRate: rate, channels: channels.map((c) => Float32Array.from(c)) });

  it("places sounds at their offsets in a track of the video's length", () => {
    const out = mixSounds([{ atMs: 2, pcm: pcm(1000, [0.5, 0.5]) }], 6, 1000, 2);
    expect(out.channels).toHaveLength(2);
    expect(Array.from(out.channels[0])).toEqual([0, 0, 0.5, 0.5, 0, 0]);
    expect(Array.from(out.channels[1])).toEqual([0, 0, 0.5, 0.5, 0, 0]);
  });

  it("cuts a sound when the next one starts, and at the end of the video", () => {
    const out = mixSounds(
      [
        { atMs: 4, pcm: pcm(1000, [0.25, 0.25, 0.25, 0.25]) },
        { atMs: 0, pcm: pcm(1000, [1, 1, 1, 1, 1, 1]) },
      ],
      6,
      1000,
      1,
    );
    expect(Array.from(out.channels[0])).toEqual([1, 1, 1, 1, 0.25, 0.25]);
  });

  it("resamples by linear interpolation", () => {
    // 500 Hz → 1000 Hz: every other sample is the mean of its neighbours.
    const up = mixSounds([{ atMs: 0, pcm: pcm(500, [0, 0.5, 1]) }], 6, 1000, 1);
    expect(Array.from(up.channels[0])).toEqual([0, 0.25, 0.5, 0.75, 1, 0.5]);
    // 2000 Hz → 1000 Hz: every other sample.
    const down = mixSounds([{ atMs: 0, pcm: pcm(2000, [0, 0.1, 0.2, 0.3, 0.4, 0.5]) }], 3, 1000, 1);
    expect(Array.from(down.channels[0]).map((v) => +v.toFixed(3))).toEqual([0, 0.2, 0.4]);
  });

  it("averages stereo into a mono track and clips", () => {
    const out = mixSounds([{ atMs: 0, pcm: pcm(1000, [1, 2], [0, 2]) }], 2, 1000, 1);
    expect(Array.from(out.channels[0])).toEqual([0.5, 1]);
  });

  it("knows a silent track and interleaves for encoders", () => {
    expect(isSilent(mixSounds([], 10, 1000, 2))).toBe(true);
    const out = pcm(1000, [1, 2, 3], [4, 5, 6]);
    expect(Array.from(interleave(out, 1, 3))).toEqual([2, 5, 3, 6]);
  });
});
