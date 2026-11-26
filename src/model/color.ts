/**
 * Colours as the scene model stores them: CSS "#rrggbb" strings, built
 * from red, green and blue channels.
 */

/** Red, green, blue, each 0 to 255. */
export type RGB = readonly [number, number, number];

/** "#rrggbb", lower case; channels are rounded and clamped to 0..255. */
export function rgbToCss(rgb: RGB): string {
  return "#" + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
}

/** Scale a "#rrggbb" colour towards black by `factor` (0 = black, 1 = unchanged); other CSS colours are returned unchanged. */
export function shadeCss(css: string, factor: number): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(css);
  if (!m) return css;
  return rgbToCss([parseInt(m[1]!, 16) * factor, parseInt(m[2]!, 16) * factor, parseInt(m[3]!, 16) * factor]);
}
