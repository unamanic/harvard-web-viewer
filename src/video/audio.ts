/**
 * The video's sound track (pure): which sound slides play (as the player:
 * WAV or MIDI, the last playable one of a move, one sound at a time so a
 * new one cuts the one before), WAV files decoded to float samples (MIDI is
 * rendered by the synthesizer, src/audio), and all of them mixed into one
 * PCM track at their timeline offsets, resampled to the output rate.
 */
import type { Pcm } from "../audio/pcm";
import { describeWav, soundFormat, wavChunks } from "../player/sound/format";
import type { ResolveFile } from "../player/sound/controller";
import type { AudioCue } from "./timeline";

export type { Pcm } from "../audio/pcm";

/** A sound placed on the timeline. */
export interface PlacedSound {
  atMs: number;
  name: string;
  bytes: Uint8Array;
  /** A MIDI file (rendered by the synthesizer), else a WAV. */
  midi: boolean;
}

export interface AudioPlan {
  sounds: PlacedSound[];
  missing: string[];
  unplayable: string[];
}

/**
 * The sounds the video plays, from the timeline's cues. Only the WAV header
 * is read here (cheap enough for the dialog's estimate); decoding comes later.
 */
export function planAudio(cues: readonly AudioCue[], resolveFile: ResolveFile | undefined): AudioPlan {
  const plan: AudioPlan = { sounds: [], missing: [], unplayable: [] };
  const addOnce = (list: string[], name: string) => {
    if (!list.includes(name)) list.push(name);
  };
  let i = 0;
  while (i < cues.length) {
    // One move's cues: only the last playable sound starts (each would stop the one before).
    let last: PlacedSound | null = null;
    const move = cues[i].move;
    for (; i < cues.length && cues[i].move === move; i++) {
      const { slide, atMs } = cues[i];
      const name = slide.fileName ?? slide.label;
      const bytes = slide.fileName && resolveFile ? resolveFile(slide.fileName) : null;
      if (!bytes) {
        addOnce(plan.missing, name);
        continue;
      }
      const format = soundFormat(name, bytes);
      if (format === "midi") last = { atMs, name, bytes, midi: true };
      else if (format === "wav" && describeWav(bytes)) last = { atMs, name, bytes, midi: false };
      else addOnce(plan.unplayable, name);
    }
    if (last) plan.sounds.push(last);
  }
  return plan;
}

// ---------------------------------------------------------------------------
// WAV decoding
// ---------------------------------------------------------------------------

/**
 * Samples of a WAV file: PCM 8/16/24/32-bit, IEEE float 32/64, and
 * WAVE_FORMAT_EXTENSIBLE of those. Null for anything else (ADPCM, µ-law
 * ...), which the browser's decoder may still read.
 */
export function readWav(bytes: Uint8Array): Pcm | null {
  const chunks = wavChunks(bytes);
  const data = chunks?.data;
  if (!chunks?.fmt || !data) return null;
  const view = new DataView(chunks.fmt.buffer, chunks.fmt.byteOffset, chunks.fmt.byteLength);
  let tag = view.getUint16(0, true);
  // WAVE_FORMAT_EXTENSIBLE: the real format tag is the sub-format's first two bytes.
  if (tag === 0xfffe && chunks.fmt.length >= 26) tag = view.getUint16(24, true);
  const channels = view.getUint16(2, true);
  const rate = view.getUint32(4, true);
  const align = view.getUint16(12, true);
  const bits = view.getUint16(14, true);
  if (channels < 1 || rate < 1) return null;
  const bytesPer = bits / 8;
  const pcm = tag === 1 && [8, 16, 24, 32].includes(bits);
  const float = tag === 3 && (bits === 32 || bits === 64);
  if (!pcm && !float) return null;
  const frameBytes = Math.max(align, bytesPer * channels);
  const frames = Math.floor(data.length / frameBytes);
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const out = Array.from({ length: channels }, () => new Float32Array(frames));
  for (let f = 0; f < frames; f++) {
    for (let c = 0; c < channels; c++) {
      const o = f * frameBytes + c * bytesPer;
      let v: number;
      if (float) v = bits === 32 ? dv.getFloat32(o, true) : dv.getFloat64(o, true);
      else if (bits === 8) v = (dv.getUint8(o) - 128) / 128;
      else if (bits === 16) v = dv.getInt16(o, true) / 32768;
      else if (bits === 24) v = (((dv.getUint8(o + 2) << 24) | (dv.getUint8(o + 1) << 16) | (dv.getUint8(o) << 8)) >> 8) / 8388608;
      else v = dv.getInt32(o, true) / 2147483648;
      out[c][f] = v;
    }
  }
  return { sampleRate: rate, channels: out };
}

// ---------------------------------------------------------------------------
// Mixing
// ---------------------------------------------------------------------------

/** Sample `index` (fractional) of `samples`, linearly interpolated; 0 outside. */
function sampleAt(samples: Float32Array, index: number): number {
  const i = Math.floor(index);
  if (i < 0 || i >= samples.length) return 0;
  const a = samples[i];
  const b = i + 1 < samples.length ? samples[i + 1] : 0;
  return a + (b - a) * (index - i);
}

export interface DecodedSound {
  atMs: number;
  pcm: Pcm;
}

/**
 * One track of `durationMs` at `sampleRate` with `channels` channels (1 or
 * 2): each sound from its offset until it ends, the next sound starts (one
 * at a time, as the player), or the video ends. Mono sounds go to both
 * channels; a stereo sound in a mono track is averaged. Linear-interpolated
 * resampling; the sum is clipped to -1..1.
 */
export function mixSounds(sounds: readonly DecodedSound[], durationMs: number, sampleRate: number, channels: 1 | 2): Pcm {
  const total = Math.max(0, Math.round((durationMs * sampleRate) / 1000));
  const out = Array.from({ length: channels }, () => new Float32Array(total));
  const sorted = [...sounds].sort((a, b) => a.atMs - b.atMs);
  sorted.forEach((s, k) => {
    const start = Math.round((s.atMs * sampleRate) / 1000);
    const next = k + 1 < sorted.length ? Math.round((sorted[k + 1].atMs * sampleRate) / 1000) : total;
    const ratio = s.pcm.sampleRate / sampleRate;
    const srcFrames = s.pcm.channels[0]?.length ?? 0;
    const length = Math.min(next, total, start + Math.ceil(srcFrames / ratio)) - start;
    const src = s.pcm.channels;
    for (let n = 0; n < length; n++) {
      const at = n * ratio;
      if (channels === 1 || src.length === 1) {
        let v = 0;
        for (const ch of src) v += sampleAt(ch, at);
        v /= src.length;
        for (const ch of out) ch[start + n] += v;
      } else {
        out[0][start + n] += sampleAt(src[0], at);
        out[1][start + n] += sampleAt(src[1], at);
      }
    }
  });
  for (const ch of out) for (let i = 0; i < ch.length; i++) ch[i] = Math.max(-1, Math.min(1, ch[i]));
  return { sampleRate, channels: out };
}

/** True when the track is silent throughout. */
export function isSilent(pcm: Pcm): boolean {
  return pcm.channels.every((ch) => ch.every((v) => v === 0));
}

/** Interleave planar samples (`from`..`to` frames) for an encoder that wants f32 interleaved data. */
export function interleave(pcm: Pcm, from: number, to: number): Float32Array {
  const n = pcm.channels.length;
  const out = new Float32Array((to - from) * n);
  for (let f = from; f < to; f++) for (let c = 0; c < n; c++) out[(f - from) * n + c] = pcm.channels[c][f];
  return out;
}
