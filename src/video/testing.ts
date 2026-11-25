/** Test fixtures for the video export: small presentations. */
import { LANDSCAPE_VIEW_BOX, type Presentation, type PresentationSlide, type PresentationSlideKind, type SlideEffects } from "../formats/types";

export interface SlideSpec {
  label: string;
  kind?: PresentationSlideKind;
  waitForKey?: boolean;
  displaySeconds?: number;
  effects?: SlideEffects;
  fileName?: string;
  nested?: () => Presentation | null;
}

export function slide(spec: SlideSpec): PresentationSlide {
  const kind = spec.kind ?? "picture";
  const scene = kind === "picture" ? { viewBox: LANDSCAPE_VIEW_BOX, background: "#000080", elements: [] } : null;
  const out: PresentationSlide = {
    label: spec.label,
    kind,
    fileName: spec.fileName ?? null,
    scene: () => scene,
    warnings: () => [],
    keys: [],
    buttons: [],
    waitForKey: spec.waitForKey ?? kind === "picture",
  };
  if (spec.displaySeconds !== undefined) out.displaySeconds = spec.displaySeconds;
  if (spec.effects) out.effects = spec.effects;
  if (spec.nested) out.nested = spec.nested;
  return out;
}

/** Slide 0 is the show placeholder, as in HG3. */
export function show(id: string, slides: SlideSpec[]): Presentation {
  return {
    id,
    title: id,
    slides: [slide({ label: `${id}:0`, kind: "empty" }), ...slides.map(slide)],
    firstSlide: 1,
    globalKeys: [],
  };
}

/** A 16-bit PCM WAV of the given samples (per channel, interleaved on write). */
export function wavBytes(channels: number[][], sampleRate: number, bits: 8 | 16 = 16): Uint8Array {
  const frames = channels[0].length;
  const bytesPer = bits / 8;
  const dataSize = frames * channels.length * bytesPer;
  const out = new Uint8Array(44 + dataSize);
  const v = new DataView(out.buffer);
  const str = (o: number, s: string) => [...s].forEach((c, i) => (out[o + i] = c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + dataSize, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, channels.length, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * channels.length * bytesPer, true);
  v.setUint16(32, channels.length * bytesPer, true);
  v.setUint16(34, bits, true);
  str(36, "data");
  v.setUint32(40, dataSize, true);
  let o = 44;
  for (let f = 0; f < frames; f++) {
    for (const ch of channels) {
      if (bits === 16) v.setInt16(o, Math.round(ch[f] * 32767), true);
      else v.setUint8(o, Math.round(ch[f] * 127 + 128));
      o += bytesPer;
    }
  }
  return out;
}
