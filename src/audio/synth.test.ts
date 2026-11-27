import { describe, expect, it } from "vitest";
import { MELODIC, PERCUSSION } from "./fm/bank";
import { OPL_RATE, envelopeTime, fnumBlock } from "./fm/opl";
import { readMidi } from "./midiFile";
import { encodeWav } from "./pcm";
import { channelPlan, midiRenderer, renderMidi } from "./synth";
import { oneNote, smf, track } from "./testing/smf";

/** Fundamental frequency by autocorrelation (lags 60-300, parabolic peak). */
function pitch(s: Float32Array, rate: number): number {
  const a = s.subarray(2000, 2000 + 16384);
  const corr = (lag: number) => {
    let c = 0;
    for (let i = 0; i + lag < a.length; i++) c += a[i] * a[i + lag];
    return c;
  };
  let lag = 0;
  let best = -Infinity;
  for (let l = 60; l < 300; l++) {
    const c = corr(l);
    if (c > best) [best, lag] = [c, l];
  }
  const y0 = corr(lag - 1);
  const y2 = corr(lag + 1);
  return rate / (lag + (y0 - y2) / (2 * (y0 - 2 * best + y2)));
}

const peak = (s: Float32Array) => s.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

describe("FM bank", () => {
  it("has 128 programs and 47 percussion keys, each one or two voices of 11 bytes", () => {
    expect(MELODIC).toHaveLength(128);
    expect(PERCUSSION).toHaveLength(47);
    for (const row of [...MELODIC, ...PERCUSSION]) {
      expect([5, 7]).toContain(row.length);
      expect(row[3]).toMatch(/^[0-9a-f]{22}$/);
    }
  });
});

describe("OPL voice", () => {
  it("picks the block that keeps the frequency number below 1024", () => {
    const { fnum, block } = fnumBlock(440);
    expect(block).toBe(4);
    expect((fnum * OPL_RATE) / 2 ** (20 - block)).toBeCloseTo(440, 0);
  });

  it("times envelopes as the YM3812 datasheet: halving per rate, attack 60+ immediate", () => {
    expect(envelopeTime(4, false)).toBeCloseTo(39.28064);
    expect(envelopeTime(8, false)).toBeCloseTo(39.28064 / 2);
    expect(envelopeTime(60, true)).toBe(0);
    expect(envelopeTime(0, true)).toBe(Infinity);
  });
});

describe("renderMidi", () => {
  it("plays notes at their pitch (the bank's offsets as the DMX player counts notes)", () => {
    for (const program of [0, 40, 73]) {
      const pcm = renderMidi(oneNote(program, 69, 0, 192));
      expect(pcm.sampleRate).toBe(OPL_RATE);
      expect(pitch(pcm.channels[0], pcm.sampleRate)).toBeCloseTo(440, 0);
    }
    const low = renderMidi(oneNote(0, 57, 0, 192));
    expect(pitch(low.channels[0], low.sampleRate)).toBeCloseTo(220, 0);
  });

  it("runs past the last event until the notes die away, then stops", () => {
    const pcm = renderMidi(oneNote(0, 60, 0, 96));
    const seconds = pcm.channels[0].length / OPL_RATE;
    expect(seconds).toBeGreaterThan(0.5);
    expect(seconds).toBeLessThan(0.5 + 4.01);
    expect(peak(pcm.channels[0])).toBeGreaterThan(0.01);
  });

  it("is quieter at a lower velocity and silent at channel volume 0", () => {
    const loud = peak(renderMidi(oneNote(0, 60, 0, 96, 127)).channels[0]);
    const soft = peak(renderMidi(oneNote(0, 60, 0, 96, 40)).channels[0]);
    expect(soft).toBeLessThan(loud / 2);
    const muted = smf([track([[0, 0xb0, 7, 0], [0, 0x90, 60, 100], [96, 0x80, 60, 0]])]);
    expect(peak(renderMidi(muted).channels[0])).toBeLessThan(1e-4);
  });

  it("plays only channels 13-16 of a dual-format file, else every channel with drums on 10", () => {
    const dual = smf([track([[0, 0x90, 60, 100], [0, 0x9c, 64, 100], [96, 0x80, 60, 0], [0, 0x8c, 64, 0]])]);
    expect(channelPlan(readMidi(dual))).toMatchObject({ level: "base", drums: 15 });
    expect(channelPlan(readMidi(oneNote(0, 60)))).toMatchObject({ level: "general", drums: 9 });
    // Extended-only notes in a dual file are not played.
    const extendedOnly = smf([track([[0, 0x90, 60, 100], [0, 0x9c, 64, 0], [96, 0x80, 60, 0]])]);
    expect(channelPlan(readMidi(extendedOnly)).level).toBe("general");
    const ignored = smf([track([[0, 0x90, 60, 100], [0, 0x9c, 64, 1], [0, 0x8c, 64, 0], [96, 0x80, 60, 0]])]);
    expect(peak(renderMidi(ignored).channels[0])).toBeLessThan(0.01);
  });

  it("holds notes with the sustain pedal until it is released", () => {
    const withPedal = smf([track([[0, 0xb0, 64, 127], [0, 0x90, 60, 100], [24, 0x80, 60, 0], [960, 0xb0, 64, 0]])]);
    const without = smf([track([[0, 0x90, 60, 100], [24, 0x80, 60, 0], [960, 0xb0, 64, 0]])]);
    const at = Math.round(3 * OPL_RATE); // 3 s in: the pedal (released at 5.1 s) still holds the note
    const level = (b: Uint8Array) => peak(renderMidi(b).channels[0].subarray(at, at + 4000));
    expect(level(withPedal)).toBeGreaterThan(level(without) * 2);
  });

  it("renders in pieces exactly as at once", () => {
    const bytes = smf([track([[0, 0x90, 60, 100], [48, 0x90, 64, 100], [48, 0x80, 60, 0], [96, 0x80, 64, 0]])]);
    const whole = renderMidi(bytes).channels[0];
    const r = midiRenderer(bytes);
    const parts: number[] = [];
    for (let c = r.next(5000); c; c = r.next(5000)) parts.push(...c);
    expect(parts.length).toBe(whole.length);
    expect(Float32Array.from(parts)).toEqual(whole);
  });

  it("renders an empty file to no samples", () => {
    expect(renderMidi(smf([track([])])).channels[0].length).toBe(0);
  });
});

describe("encodeWav", () => {
  it("writes 16-bit PCM", () => {
    const wav = encodeWav({ sampleRate: 8000, channels: [Float32Array.from([0, 1, -1, 2])] });
    const v = new DataView(wav.buffer);
    expect(String.fromCharCode(...wav.subarray(0, 4))).toBe("RIFF");
    expect(v.getUint32(24, true)).toBe(8000);
    expect(v.getUint16(34, true)).toBe(16);
    expect([0, 1, 2, 3].map((i) => v.getInt16(44 + 2 * i, true))).toEqual([0, 32767, -32767, 32767]);
  });
});
