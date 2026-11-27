/**
 * The CGA display as Harvard Graphics 1.0 (A.00) and 2.3 use it, as a
 * dithering-engine Screen (dither.ts).
 *
 * From the story show's real-program screens (harvard-graphics/story-v2):
 * - Graph and pie charts, in A.00 and 2.3 alike: 320 × 200 in four colours,
 *   palette 0 on a blue background (blue, green, red, brown). Colour number n
 *   shows as CGA colour ((n - 1) mod 4 + 1) mod 4, so colour 4 vanishes into
 *   the background (2.3's CGA pie draws its colour-4 slice as outline only).
 *   Colours are solid: neither program dithers on the CGA.
 * - A.00 text and org charts: 640 × 200 in two colours, white on black.
 * Harvard Graphics 1.0/2.x scenes say which colour number each colour is
 * (Scene.classicSlots). Any other scene (HG3 never ran on a CGA) is shown
 * as the nearest of the four colours, light colours as green, the CGA's
 * text colour [I].
 */
import { type RGB, colorDistance, luma, parseCssColor } from "./color";
import { BAYER_4X4, type Dither, type Screen } from "./dither";
import { SCREENSHOW_NOMINAL } from "./vgaScreenShow";

export const CGA_COLORS_4: readonly string[] = ["#0000aa", "#00aa00", "#aa0000", "#aa5500"];
export const CGA_COLORS_2: readonly string[] = ["#000000", "#ffffff"];

/** CGA colour (0..3) of colour number n: ((n - 1) mod 4 + 1) mod 4, 0 (the background) for 0. */
export function cgaIndexOfNumber(n: number): number {
  if (!(n >= 1)) return 0;
  return (((Math.floor(n) - 1) % 4) + 1) % 4;
}

const solid = (color: number): Dither => [{ color, cells: 16 }];

/** The standard screen slot nearest to `rgb` (exact for a classic scene's own colours). */
function nearestSlot(rgb: RGB): number {
  let best = 0;
  let bestD = Infinity;
  SCREENSHOW_NOMINAL.forEach((n, i) => {
    const d = colorDistance(rgb, n);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

const CGA_RGB_4: readonly RGB[] = CGA_COLORS_4.map((c) => parseCssColor(c) ?? [0, 0, 0]);

/** A colour of a scene that is not Harvard Graphics 1.0/2.x: nearest of the four, light ones green [I]. */
function nearestCga(rgb: RGB): number {
  if (luma(rgb) > 160) return 1;
  let best = 0;
  let bestD = Infinity;
  CGA_RGB_4.forEach((c, i) => {
    const d = colorDistance(rgb, c);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

/**
 * The CGA screen for a scene: `classicSlots` as the scene gives it ("cga2"
 * for A.00 text and org charts, "cga4" for other 1.0/2.x charts, absent
 * for any other scene).
 */
export function cgaScreen(classicSlots?: "cga4" | "cga2"): Screen {
  if (classicSlots === "cga2") {
    const index = (rgb: RGB) => (nearestSlot(rgb) === 0 ? 0 : 1);
    return {
      id: "cga2",
      width: 640,
      height: 200,
      pixelAspect: 4 / 3 / (640 / 200),
      colors: CGA_COLORS_2,
      matrix: BAYER_4X4,
      dither: (rgb) => solid(index(rgb)),
      background: index,
    };
  }
  const index = classicSlots === "cga4" ? (rgb: RGB) => cgaIndexOfNumber(nearestSlot(rgb)) : nearestCga;
  return {
    id: "cga",
    width: 320,
    height: 200,
    pixelAspect: 4 / 3 / (320 / 200),
    colors: CGA_COLORS_4,
    matrix: BAYER_4X4,
    dither: (rgb) => solid(index(rgb)),
    background: classicSlots ? (rgb) => index(rgb) : () => 0,
  };
}
