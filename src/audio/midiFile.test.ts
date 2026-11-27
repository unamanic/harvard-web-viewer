import { describe, expect, it } from "vitest";
import { MidiError, isMidi, readMidi } from "./midiFile";
import { oneNote, smf, track, vlq } from "./testing/smf";

describe("readMidi", () => {
  it("reads variable-length deltas, running status and note-on with velocity 0", () => {
    expect(vlq(0x80)).toEqual([0x81, 0x00]);
    const song = readMidi(smf([track([[0, 0x90, 60, 100], [96, 60, 0], [0x80, 0x90, 64, 90]])]));
    expect(song.events.map((e) => [e.type, e.a, e.b])).toEqual([
      [0x90, 60, 100],
      [0x90, 60, 0],
      [0x90, 64, 90],
    ]);
    // 120 bpm by default: 96 ticks (a quarter) = 0.5 s; 0x80 = 128 ticks more = 0.6667 s.
    expect(song.events[1].time).toBeCloseTo(0.5);
    expect(song.events[2].time).toBeCloseTo(0.5 + 128 / 192);
  });

  it("applies tempo changes from any track of a format-1 file, merging tracks in time order", () => {
    // Track 1: tempo 60 bpm (1 000 000 µs per quarter) after one quarter. Track 2: notes every quarter.
    const tempo = track([[96, 0xff, 0x51, 3, 0x0f, 0x42, 0x40]]);
    const notes = track([[0, 0x91, 60, 1], [96, 0x91, 62, 1], [96, 0x91, 64, 1]]);
    const song = readMidi(smf([tempo, notes]));
    expect(song.events.map((e) => [e.channel, e.time])).toEqual([
      [1, 0],
      [1, 0.5],
      [1, 1.5],
    ]);
    expect(song.duration).toBeCloseTo(1.5);
  });

  it("skips SysEx and keeps text meta events", () => {
    const song = readMidi(smf([track([[0, 0xf0, 2, 0x7e, 0xf7], [0, 0xff, 0x02, 4, 0x28, 0x43, 0x29, 0x20], [0, 0xb0, 7, 90]])]));
    expect(song.texts).toEqual(["(C)"]);
    expect(song.events).toEqual([{ time: 0, channel: 0, type: 0xb0, a: 7, b: 90 }]);
  });

  it("rejects what is not a MIDI file", () => {
    expect(isMidi(oneNote(0, 60))).toBe(true);
    expect(isMidi(new Uint8Array(20))).toBe(false);
    expect(() => readMidi(new Uint8Array(20))).toThrow(MidiError);
  });
});
