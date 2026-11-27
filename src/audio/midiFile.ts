/**
 * Standard MIDI files (.MID, "MThd"): formats 0 and 1, read into one list
 * of channel events in time order, with times in seconds from the tempo
 * map. Format 2 (independent sequences) is read like format 1. SysEx and
 * meta events other than tempo and end of track are skipped; text events
 * (title, copyright, track names) are kept for display.
 */

export interface MidiEvent {
  /** Seconds from the start. */
  time: number;
  /** Channel 0-15. */
  channel: number;
  /** Status high nibble: 0x80 note off, 0x90 note on, 0xA0 key pressure, 0xB0 controller, 0xC0 program, 0xD0 channel pressure, 0xE0 pitch bend. */
  type: number;
  /** First data byte (note, controller, program, or pitch bend LSB). */
  a: number;
  /** Second data byte (velocity, value, or pitch bend MSB); 0 for one-byte messages. */
  b: number;
}

export interface MidiSong {
  format: number;
  /** Ticks per quarter note (0 for SMPTE time). */
  division: number;
  events: MidiEvent[];
  /** Time of the last event (end of track included), seconds. */
  duration: number;
  /** Text and copyright meta events (type 1 and 2), in file order. */
  texts: string[];
}

export class MidiError extends Error {}

/** True when the bytes start like a standard MIDI file. */
export function isMidi(bytes: Uint8Array): boolean {
  return bytes.length >= 14 && bytes[0] === 0x4d && bytes[1] === 0x54 && bytes[2] === 0x68 && bytes[3] === 0x64;
}

interface RawEvent {
  tick: number;
  /** Order within the file, to keep equal-tick events stable. */
  seq: number;
  /** A channel message, or a tempo change (microseconds per quarter). */
  msg: { channel: number; type: number; a: number; b: number } | { tempo: number } | null;
}

const DATA_BYTES: Record<number, number> = { 0x80: 2, 0x90: 2, 0xa0: 2, 0xb0: 2, 0xc0: 1, 0xd0: 1, 0xe0: 2 };

/** Read a standard MIDI file. Throws MidiError when it is not one. */
export function readMidi(bytes: Uint8Array): MidiSong {
  if (!isMidi(bytes)) throw new MidiError("not a MIDI file (no MThd header)");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerLength = view.getUint32(4);
  const format = view.getUint16(8);
  const trackCount = view.getUint16(10);
  const rawDivision = view.getUint16(12);
  // SMPTE: frames per second × ticks per frame ticks per second.
  const smpte = (rawDivision & 0x8000) !== 0;
  const ticksPerSecond = smpte ? (256 - (rawDivision >> 8)) * (rawDivision & 0xff) : 0;
  const division = smpte ? 0 : rawDivision;
  if (!smpte && division === 0) throw new MidiError("MIDI file with a division of 0");

  const raw: RawEvent[] = [];
  const texts: string[] = [];
  let seq = 0;
  let pos = 8 + headerLength;
  for (let t = 0; t < trackCount && pos + 8 <= bytes.length; t++) {
    const id = String.fromCharCode(...bytes.subarray(pos, pos + 4));
    const length = view.getUint32(pos + 4);
    const start = pos + 8;
    const end = Math.min(bytes.length, start + length);
    pos = start + length;
    if (id !== "MTrk") {
      t--; // an unknown chunk does not count as a track
      continue;
    }
    let p = start;
    let tick = 0;
    let running = 0;
    const vlq = (): number => {
      let v = 0;
      for (let k = 0; k < 4 && p < end; k++) {
        const b = bytes[p++];
        v = (v << 7) | (b & 0x7f);
        if (b < 0x80) break;
      }
      return v;
    };
    while (p < end) {
      tick += vlq();
      if (p >= end) break;
      let status = bytes[p];
      if (status === 0xff) {
        const type = bytes[p + 1];
        p += 2;
        const len = vlq();
        const data = bytes.subarray(p, Math.min(end, p + len));
        p += len;
        if (type === 0x51 && data.length >= 3) raw.push({ tick, seq: seq++, msg: { tempo: (data[0] << 16) | (data[1] << 8) | data[2] } });
        else if (type === 0x01 || type === 0x02) texts.push(String.fromCharCode(...data).trim());
        else if (type === 0x2f) {
          raw.push({ tick, seq: seq++, msg: null });
          break;
        }
        continue;
      }
      if (status === 0xf0 || status === 0xf7) {
        p++;
        const len = vlq(); // (not `p += vlq()`: vlq moves p)
        p += len;
        continue;
      }
      if (status >= 0x80) {
        running = status;
        p++;
      } else if (running) {
        status = running;
      } else {
        throw new MidiError(`track ${t + 1}: data byte without a status`);
      }
      const type = status & 0xf0;
      const n = DATA_BYTES[type];
      if (n === undefined) {
        // System common/real-time inside a track: not valid in a file; skip the byte.
        continue;
      }
      const a = bytes[p] ?? 0;
      const b = n === 2 ? (bytes[p + 1] ?? 0) : 0;
      p += n;
      raw.push({ tick, seq: seq++, msg: { channel: status & 0x0f, type, a: a & 0x7f, b: b & 0x7f } });
    }
  }

  raw.sort((x, y) => x.tick - y.tick || x.seq - y.seq);
  const events: MidiEvent[] = [];
  let tempo = 500000; // 120 beats per minute until a tempo event
  let lastTick = 0;
  let time = 0;
  for (const r of raw) {
    time += smpte ? (r.tick - lastTick) / ticksPerSecond : ((r.tick - lastTick) * tempo) / (division * 1e6);
    lastTick = r.tick;
    if (!r.msg) continue;
    if ("tempo" in r.msg) {
      if (r.msg.tempo > 0) tempo = r.msg.tempo;
      continue;
    }
    events.push({ time, ...r.msg });
  }
  return { format, division, events, duration: time, texts };
}
