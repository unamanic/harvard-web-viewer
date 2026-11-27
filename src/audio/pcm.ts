/** Decoded sound: one Float32Array per channel, samples in -1..1. */
export interface Pcm {
  sampleRate: number;
  channels: Float32Array[];
}

/** A 16-bit PCM WAV file of the sound (samples clipped to -1..1). */
export function encodeWav(pcm: Pcm): Uint8Array {
  const channels = Math.max(1, pcm.channels.length);
  const frames = pcm.channels[0]?.length ?? 0;
  const rate = Math.round(pcm.sampleRate);
  const dataBytes = frames * channels * 2;
  const out = new Uint8Array(44 + dataBytes);
  const v = new DataView(out.buffer);
  const tag = (at: number, s: string) => {
    for (let i = 0; i < 4; i++) out[at + i] = s.charCodeAt(i);
  };
  tag(0, "RIFF");
  v.setUint32(4, 36 + dataBytes, true);
  tag(8, "WAVE");
  tag(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, channels, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * channels * 2, true);
  v.setUint16(32, channels * 2, true);
  v.setUint16(34, 16, true);
  tag(36, "data");
  v.setUint32(40, dataBytes, true);
  let o = 44;
  for (let f = 0; f < frames; f++) {
    for (let c = 0; c < channels; c++) {
      const s = Math.max(-1, Math.min(1, pcm.channels[c]?.[f] ?? 0));
      v.setInt16(o, Math.round(s * 32767), true);
      o += 2;
    }
  }
  return out;
}
