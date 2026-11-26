/**
 * CSS colour parsing and formatting, and small colour metrics, shared by the
 * display modes (displayMode.ts) and the dithering engine (dither.ts).
 */

import { type RGB, rgbToCss } from "../model/color";

export type { RGB };

const HEX3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i;
const HEX6 = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;
const RGB_FN = /^rgb\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*\)$/i;

/** Parses #rgb, #rrggbb or rgb(r, g, b); returns null for anything else. */
export function parseCssColor(css: string): RGB | null {
  const s = css.trim();
  let m = HEX6.exec(s);
  if (m) return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
  m = HEX3.exec(s);
  if (m) return [parseInt(m[1] + m[1], 16), parseInt(m[2] + m[2], 16), parseInt(m[3] + m[3], 16)];
  m = RGB_FN.exec(s);
  if (m) return [clamp255(+m[1]), clamp255(+m[2]), clamp255(+m[3])];
  return null;
}

export function clamp255(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

/** Formats as lower-case #rrggbb (model/color.ts). */
export const formatCssColor = rgbToCss;

/** One channel through the VGA DAC: 8 bits to 6 bits and back. */
export function vgaChannel(v: number): number {
  const v6 = Math.round((clamp255(v) * 63) / 255);
  return Math.round((v6 * 255) / 63);
}

/**
 * Squared "redmean" distance: a cheap weighted RGB metric that follows
 * perceived difference far better than plain Euclidean RGB.
 */
export function colorDistance(a: RGB, b: RGB): number {
  const rMean = (a[0] + b[0]) / 2;
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return (2 + rMean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rMean) / 256) * db * db;
}

/** Index of the candidate closest to `rgb` (first one wins ties). */
export function nearestIndex(rgb: RGB, candidates: readonly RGB[]): number {
  let best = 0;
  let bestD = Infinity;
  candidates.forEach((c, i) => {
    const d = colorDistance(rgb, c);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

/** The candidate closest to `rgb` (first one wins ties). */
export function nearestColor(rgb: RGB, candidates: readonly RGB[]): RGB {
  return candidates[nearestIndex(rgb, candidates)];
}

/** Rec. 601 luma, 0..255. */
export function luma(rgb: RGB): number {
  return 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
}
