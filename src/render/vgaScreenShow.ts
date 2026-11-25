/**
 * The Harvard Graphics 3.05 "VGA ScreenShow" display (640 × 480, 16
 * colours) as a dithering-engine Screen (dither.ts).
 *
 * Inferred from the 238 chart renders made in the real program
 * (samples-private/renders, private reference material):
 *
 * - The driver works with 16 colours. Their nominal RGB is the palette's
 *   record 1555, the same in 25 of the 31 sample palettes:
 *   SCREENSHOW_NOMINAL. Every chart colour is matched against these nominal
 *   colours; what the screen then shows for colour i is DAC entry i, which
 *   the driver loads from the chart palette's 1555 (6 bits per channel, so
 *   128 shows as 130). A palette with another 1555 (1HDW, 6HDW, 8HDW, 12HDW)
 *   recolours those slots on screen: Scene.screenColors.
 * - The page background is cleared to one solid colour: the nearest nominal
 *   colour (FrameBkg "Gry DD" 22,22,22 shows black).
 * - Every other colour (fills, lines and text alike) is an ordered dither
 *   on the 4 × 4 Bayer matrix, aligned to the screen's pixel grid, in 8
 *   levels (2 of the 16 thresholds per level), of up to three colours:
 *   `screenShowDither`. Reproduces 32 of the 33 distinct flat-fill tiles
 *   observed in the renders.
 */
import { type RGB, formatCssColor, nearestIndex, vgaChannel } from "./color";
import { BAYER_4X4, type Dither, type DitherStop, type Screen } from "./dither";

/** The driver's 16 colours as the palettes store them (record 1555 of HG3.PL3). */
export const SCREENSHOW_NOMINAL: readonly RGB[] = [
  [0, 0, 0], // 0 black
  [255, 255, 255], // 1 white
  [255, 0, 0], // 2 red
  [255, 128, 0], // 3 orange
  [255, 255, 0], // 4 yellow
  [128, 255, 0], // 5 yellow-green
  [0, 255, 0], // 6 green
  [0, 255, 128], // 7 green-cyan
  [0, 255, 255], // 8 cyan
  [0, 128, 255], // 9 blue-cyan
  [0, 0, 255], // 10 blue
  [128, 0, 255], // 11 purple
  [255, 0, 255], // 12 magenta
  [255, 0, 128], // 13 magenta-red
  [85, 85, 85], // 14 dark grey
  [170, 170, 170], // 15 light grey
];

/** Indexes of the 12 hue colours, at hues 0°, 30°, ... 330°. */
const HUES = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13] as const;

/** The grey ramp, darkest first: black, dark grey, light grey, white. */
const GREYS = [0, 14, 15, 1] as const;

/** Dither levels: each level is 16 / LEVELS thresholds of the 4 × 4 matrix. */
export const SCREENSHOW_LEVELS = 8;
const CELLS_PER_LEVEL = 16 / SCREENSHOW_LEVELS;

/** What the screen shows for nominal colour i: the DAC's 6-bit rendering of it. */
export const SCREENSHOW_DAC: readonly string[] = SCREENSHOW_NOMINAL.map((c) =>
  formatCssColor([vgaChannel(c[0]), vgaChannel(c[1]), vgaChannel(c[2])]),
);

/** 8 bits to the DAC's 6. */
const six = (v: number) => Math.round((Math.max(0, Math.min(255, v)) * 63) / 255);

/**
 * `levels` levels of the grey ramp at grey `level` (0..63, 6-bit), lighter
 * colour first (on the lower thresholds).
 */
function greyStops(level: number, levels: number): DitherStop[] {
  const seg = Math.max(0, Math.min(2, Math.floor(level / 21)));
  const lighter = Math.round((levels * (level - seg * 21)) / 21);
  return [
    { color: GREYS[seg + 1], cells: lighter * CELLS_PER_LEVEL },
    { color: GREYS[seg], cells: (levels - lighter) * CELLS_PER_LEVEL },
  ].filter((s) => s.cells > 0);
}

/** Hue angle of an RGB colour, degrees 0..360 (undefined for greys). */
function hueOf(rgb: RGB): number | undefined {
  const [r, g, b] = rgb;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) return undefined;
  const h = max === r ? ((g - b) / d) * 60 : max === g ? ((b - r) / d) * 60 + 120 : ((r - g) / d) * 60 + 240;
  return (h + 360) % 360;
}

/**
 * How the VGA ScreenShow driver shows a colour (inferred; module comment):
 *
 * 1. Channels to the DAC's 6 bits. White share W = round(8 · min / 63),
 *    black share K = round(8 · (63 − max) / 63), hue share P = 8 − W − K
 *    (in eighths of the tile).
 * 2. No hue share (or no chroma): a grey, dithered on the grey ramp black,
 *    dark grey, light grey, white between its two neighbours.
 * 3. Otherwise the hue share takes one of 24 hues: the hue angle in 15°
 *    steps (rounded down, with 2° of slack so the exact hues of the 16
 *    colours are not split by rounding); even steps are one of the 12 hue
 *    colours, odd steps half each of the two neighbours.
 * 4. The white and black shares stay white and black, except when both are
 *    present (a greyed colour): then they become a grey of the same
 *    average on the grey ramp.
 * 5. Threshold order (lowest first): greys from light to dark, then the
 *    hue colours, the following hue (counter-clockwise) before the
 *    preceding one.
 */
export function screenShowDither(rgb: RGB): Dither {
  const [r, g, b] = rgb.map(six);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const white = Math.round((SCREENSHOW_LEVELS * min) / 63);
  const black = Math.round((SCREENSHOW_LEVELS * (63 - max)) / 63);
  const hue = SCREENSHOW_LEVELS - white - black;
  const angle = hueOf(rgb);
  if (hue <= 0 || max === min || angle === undefined) return greyStops((r + g + b) / 3, SCREENSHOW_LEVELS);

  const stops: DitherStop[] = [];
  if (white > 0 && black > 0) stops.push(...greyStops(Math.min(63, (SCREENSHOW_LEVELS * min) / (white + black)), white + black));
  else {
    if (white > 0) stops.push({ color: 1, cells: white * CELLS_PER_LEVEL });
    if (black > 0) stops.push({ color: 0, cells: black * CELLS_PER_LEVEL });
  }
  const step = Math.floor((angle + 2) / 15) % 24;
  const cells = hue * CELLS_PER_LEVEL;
  if (step % 2 === 0) stops.push({ color: HUES[step / 2], cells });
  else {
    stops.push({ color: HUES[((step + 1) / 2) % 12], cells: Math.ceil(cells / 2) });
    stops.push({ color: HUES[(step - 1) / 2], cells: Math.floor(cells / 2) });
  }
  return stops;
}

/** Background rule: the nearest nominal colour, solid. */
export function screenShowBackground(rgb: RGB): number {
  return nearestIndex(rgb, SCREENSHOW_NOMINAL);
}

/**
 * The VGA ScreenShow screen. `screenColors` (Scene.screenColors: the
 * chart palette's own 16 colours, as CSS) replaces what the 16 colours look
 * like; colours are still matched against the nominal set.
 */
export function vgaScreenShow(screenColors?: readonly string[]): Screen {
  const colors = SCREENSHOW_DAC.map((c, i) => screenColors?.[i] ?? c);
  return {
    id: "vga",
    width: 640,
    height: 480,
    pixelAspect: 1,
    colors,
    matrix: BAYER_4X4,
    dither: screenShowDither,
    background: screenShowBackground,
  };
}
