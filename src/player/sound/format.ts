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

/** Read a RIFF/WAVE header, or null if the bytes are not one. */
export function describeWav(bytes: Uint8Array): WavInfo | null {
  if (bytes.length < 12 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WAVE") return null;
  let fmt: Omit<WavInfo, "dataBytes"> | null = null;
  let dataBytes: number | null = null;
  for (let pos = 12; pos + 8 <= bytes.length; ) {
    const id = ascii(bytes, pos, 4);
    const size = u32(bytes, pos + 4);
    if (id === "fmt " && size >= 16 && pos + 24 <= bytes.length) {
      fmt = {
        formatTag: u16(bytes, pos + 8),
        channels: u16(bytes, pos + 10),
        sampleRate: u32(bytes, pos + 12),
        bitsPerSample: u16(bytes, pos + 22),
      };
    } else if (id === "data") {
      dataBytes = Math.min(size, bytes.length - pos - 8);
    }
    pos += 8 + size + (size & 1);
  }
  return fmt && { ...fmt, dataBytes };
}
