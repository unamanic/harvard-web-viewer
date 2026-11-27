/** Small standard MIDI files for tests. */

/** A variable-length quantity. */
export function vlq(n: number): number[] {
  const out = [n & 0x7f];
  for (n >>= 7; n > 0; n >>= 7) out.unshift((n & 0x7f) | 0x80);
  return out;
}

/** A track chunk from [delta ticks, ...event bytes] entries; an end-of-track is added. */
export function track(events: readonly (readonly number[])[]): number[] {
  const body = [...events.flatMap(([delta, ...bytes]) => [...vlq(delta), ...bytes]), 0, 0xff, 0x2f, 0];
  const n = body.length;
  return [0x4d, 0x54, 0x72, 0x6b, (n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255, ...body];
}

/** A format-1 file of `tracks` (track() results) at `division` ticks per quarter note. */
export function smf(tracks: readonly number[][], division = 96, format = 1): Uint8Array {
  return new Uint8Array([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, format, 0, tracks.length, (division >> 8) & 255, division & 255, ...tracks.flat()]);
}

/** One note: program, key and velocity on `channel`, held `ticks` (96 per quarter, 120 bpm: 96 ticks = 0.5 s). */
export function oneNote(program: number, key: number, channel = 0, ticks = 96, velocity = 100): Uint8Array {
  return smf([track([[0, 0xc0 | channel, program], [0, 0x90 | channel, key, velocity], [ticks, 0x80 | channel, key, 0]])]);
}
