/**
 * Telling the sound files a show names apart (SPEC §4.2: slide kind 0x09 is
 * a digital sound, .WAV; 0x0A a MIDI music file, .MID). The presentation
 * model gives both the kind "sound", so the file itself (or its extension)
 * decides.
 */

export type SoundFormat = "wav" | "midi" | "unknown";

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let s = "";
  for (let i = offset; i < offset + length && i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

function u16(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function u32(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

/** Format of a sound file: by its signature when the bytes are known, else by its extension. */
export function soundFormat(name: string, bytes: Uint8Array | null): SoundFormat {
  if (bytes && bytes.length >= 12) {
    if (ascii(bytes, 0, 4) === "MThd") return "midi";
    if (ascii(bytes, 0, 4) === "RIFF") {
      const form = ascii(bytes, 8, 4);
      if (form === "WAVE") return "wav";
      if (form === "RMID") return "midi";
    }
  }
  if (/\.(mid|midi|rmi)$/i.test(name)) return "midi";
  if (/\.wav$/i.test(name) && !bytes) return "wav";
  return "unknown";
}

/** What a WAV file's "fmt " chunk says. */
export interface WavInfo {
  /** 1 = PCM. */
  formatTag: number;
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
  /** Size of the "data" chunk in bytes, or null if there is none. */
  dataBytes: number | null;
}

/** The "fmt " and "data" chunks of a WAV file (each cut short at the end of the bytes). */
export interface WavChunks {
  /** Body of the last "fmt " chunk of at least 16 bytes, or null. */
  fmt: Uint8Array | null;
  /** Body of the last "data" chunk, or null. */
  data: Uint8Array | null;
}

/** Walk a RIFF/WAVE file's chunks, or null if the bytes are not one. */
export function wavChunks(bytes: Uint8Array): WavChunks | null {
  if (bytes.length < 12 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WAVE") return null;
  const out: WavChunks = { fmt: null, data: null };
  for (let pos = 12; pos + 8 <= bytes.length; ) {
    const id = ascii(bytes, pos, 4);
    const size = u32(bytes, pos + 4);
    const body = bytes.subarray(pos + 8, Math.min(bytes.length, pos + 8 + size));
    if (id === "fmt " && size >= 16 && body.length >= 16) out.fmt = body;
    else if (id === "data") out.data = body;
    pos += 8 + size + (size & 1);
  }
  return out;
}

/** Read a RIFF/WAVE header, or null if the bytes are not one. */
export function describeWav(bytes: Uint8Array): WavInfo | null {
  const chunks = wavChunks(bytes);
  const fmt = chunks?.fmt;
  if (!fmt) return null;
  return {
    formatTag: u16(fmt, 0),
    channels: u16(fmt, 2),
    sampleRate: u32(fmt, 4),
    bitsPerSample: u16(fmt, 14),
    dataBytes: chunks.data ? chunks.data.length : null,
  };
}
