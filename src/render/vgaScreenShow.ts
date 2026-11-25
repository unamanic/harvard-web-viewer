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
 * - Gradient fills and the page background are dithered in 64 levels on
 *   the 8 × 8 Bayer matrix: `screenShowGradientDither`.
 * - Every other colour (fills, lines and text alike) is an ordered dither
 *   on the 4 × 4 Bayer matrix, aligned to the screen's pixel grid, in 8
 *   levels (2 of the 16 thresholds per level), of up to three colours:
 *   `screenShowDither`. Reproduces 32 of the 33 distinct flat-fill tiles
 *   observed in the renders.
 */
import { type RGB, formatCssColor, parseCssColor, vgaChannel } from "./color";
import { BAYER_4X4, BAYER_8X8, type Dither, type DitherStop, type Screen, normalizeDither } from "./dither";

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
function greyStops(level: number, levels: number, cellsPerLevel = CELLS_PER_LEVEL): DitherStop[] {
  const seg = Math.max(0, Math.min(2, Math.floor(level / 21)));
  const lighter = Math.round((levels * (level - seg * 21)) / 21);
  return [
    { color: GREYS[seg + 1], cells: lighter * cellsPerLevel },
    { color: GREYS[seg], cells: (levels - lighter) * cellsPerLevel },
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
 *    present (a greyed colour): then the white share shows as dark grey
 *    (85) and the black share stays black. (Earlier read as a dither of the
 *    same average on the grey ramp. Fill pixels of the 238 references that
 *    match exactly: 99.94 % with that rule, 99.97 % with this one; e.g.
 *    LEAVES's (64,60,52) shows as 4/16 grey 85 on black, not 11/16.)
 * 5. Threshold order (lowest first): greys from light to dark, then the
 *    hue colours, the following hue (counter-clockwise) before the
 *    preceding one.
 */
export function screenShowDither(rgb: RGB): Dither {
  const [r, g, b] = rgb.map(six);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const white = Math.round((SCREENSHOW_LEVELS * min) / 63);
  // Rounding can give white + black one level too many: black gives way.
  const black = Math.min(SCREENSHOW_LEVELS - white, Math.round((SCREENSHOW_LEVELS * (63 - max)) / 63));
  const hue = SCREENSHOW_LEVELS - white - black;
  const angle = hueOf(rgb);
  if (max === min || angle === undefined) return greyStops((r + g + b) / 3, SCREENSHOW_LEVELS);
  if (hue <= 0 && !(white > 0 && black > 0)) return greyStops((r + g + b) / 3, SCREENSHOW_LEVELS);

  const stops: DitherStop[] = [];
  if (white > 0 && black > 0) {
    // A greyed colour: the white share shows as dark grey, the black share stays black.
    stops.push({ color: GREYS[1], cells: white * CELLS_PER_LEVEL }, { color: GREYS[0], cells: black * CELLS_PER_LEVEL });
  }
  else {
    if (white > 0) stops.push({ color: 1, cells: white * CELLS_PER_LEVEL });
    if (black > 0) stops.push({ color: 0, cells: black * CELLS_PER_LEVEL });
  }
  if (hue <= 0) return stops;
  const step = Math.floor((angle + 2) / 15) % 24;
  const cells = hue * CELLS_PER_LEVEL;
  if (step % 2 === 0) stops.push({ color: HUES[step / 2], cells });
  else {
    stops.push({ color: HUES[((step + 1) / 2) % 12], cells: Math.ceil(cells / 2) });
    stops.push({ color: HUES[(step - 1) / 2], cells: Math.floor(cells / 2) });
  }
  return stops;
}

/**
 * Chroma (max − min, 6-bit) up to which a gradient colour counts as grey:
 * LEAVES's (54,51,54) → black leaf shows only black and grey 85 (and an
 * interpolated colour must not flip between the grey and the hue rule).
 */
const GRADIENT_GREY_CHROMA = 1;

/** Gradient levels: one per cell of the 8 × 8 matrix. */
export const SCREENSHOW_GRADIENT_LEVELS = 64;

/**
 * How the VGA ScreenShow driver shows a colour inside a gradient fill or as
 * the page background (inferred from the reference renders; assumptions.ts
 * "Colour rules from the reference renders" has the evidence):
 *
 * 1. 64 levels on the 8 × 8 Bayer matrix (BAYER_8X8), screen-aligned like
 *    the 4 × 4 one of flat fills.
 * 2. Channels to the DAC's 6 bits. A grey (chroma max − min of at most
 *    GRADIENT_GREY_CHROMA) is dithered on the grey ramp between its two
 *    neighbours, lighter first (as `greyStops`).
 * 3. Otherwise the chroma max − min takes round(64 · (max − min) / 63)
 *    cells, split between the two hue colours around the hue angle in
 *    proportion (not in 24 steps as for flat fills): the following hue
 *    first.
 * 4. The rest of the tile is ONE grey: the grey ramp colour nearest to the
 *    remaining lightness 64 · min / rest (PLAY_ALL's (37,36,68) shows as
 *    black + 8/64 blue, BLUESKY's (91,156,220) as grey 170 + 32/64 azure).
 *    Greys go on the lower thresholds, hues after them.
 */
export function screenShowGradientDither(rgb: RGB): Dither {
  const L = SCREENSHOW_GRADIENT_LEVELS;
  const [r, g, b] = rgb.map(six);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const hue = max - min > GRADIENT_GREY_CHROMA ? Math.round((L * (max - min)) / 63) : 0;
  const angle = hueOf(rgb);
  if (hue <= 0 || angle === undefined) return greyStops((r + g + b) / 3, L, 1);
  const stops: DitherStop[] = [];
  const rest = L - hue;
  if (rest > 0) {
    const level = (L * min) / rest;
    const grey = Math.max(0, Math.min(3, Math.round(level / 21)));
    stops.push({ color: GREYS[grey], cells: rest });
  }
  // Within 2° of one of the 12 hues counts as that hue (as for flat fills):
  // PLAY_ALL's (37,36,68), hue 242°, shows pure blue.
  let pos = angle / 30;
  const near = Math.round(pos);
  if (Math.abs(pos - near) * 30 <= 2) pos = near;
  const i = Math.floor(pos) % 12;
  const following = Math.round(hue * (pos - Math.floor(pos)));
  stops.push({ color: HUES[(i + 1) % 12], cells: following });
  stops.push({ color: HUES[i], cells: hue - following });
  return stops.filter((s) => s.cells > 0);
}

/**
 * What a colour looks like on a screen whose 16 colours are `screenColors`
 * (Scene.screenColors) instead of the nominal ones: the colour with each
 * colour's share of its 64-level dither (screenShowGradientDither) moved
 * from the nominal colour to the document's own. A colour equal to nominal
 * colour i becomes screenColors[i]; colours of unchanged slots stay as they
 * are. Used by the non-VGA display modes, so that they show what the
 * program showed (e.g. 1HDW's magenta slot is dark blue).
 */
export function screenIntent(rgb: RGB, screenColors: readonly RGB[]): RGB {
  const d = normalizeDither(screenShowGradientDither(rgb));
  const total = d.reduce((n, s) => n + s.cells, 0) || 1;
  const out = [rgb[0], rgb[1], rgb[2]];
  for (const s of d) {
    const own = screenColors[s.color];
    if (!own) continue;
    const nominal = SCREENSHOW_NOMINAL[s.color];
    for (let c = 0; c < 3; c++) out[c] += (s.cells / total) * (own[c] - nominal[c]);
  }
  return [Math.round(out[0]), Math.round(out[1]), Math.round(out[2])].map((v) => Math.max(0, Math.min(255, v))) as unknown as RGB;
}

/** The document's screen colours that differ from the nominal set, as RGB; null when none do (or none are given). */
export function changedScreenColors(screenColors: readonly string[] | undefined): RGB[] | null {
  if (!screenColors) return null;
  const rgb = SCREENSHOW_NOMINAL.map((n, i) => (screenColors[i] !== undefined ? parseCssColor(screenColors[i]) : null) ?? n);
  return rgb.some((c, i) => c.some((v, k) => v !== SCREENSHOW_NOMINAL[i][k])) ? rgb : null;
}

/**
 * The VGA ScreenShow screen. `screenColors` (Scene.screenColors: the
 * chart palette's own 16 colours, as stored) replaces what the 16 colours
 * look like, through the DAC's 6 bits; colours are still matched against
 * the nominal set. Shapes, lines and text use `screenShowDither` on the
 * 4 × 4 matrix; gradients and the page background `screenShowGradientDither`
 * on the 8 × 8 one.
 */
export function vgaScreenShow(screenColors?: readonly string[]): Screen {
  const colors = SCREENSHOW_DAC.map((c, i) => {
    const own = screenColors?.[i] !== undefined ? parseCssColor(screenColors[i]) : null;
    return own ? formatCssColor([vgaChannel(own[0]), vgaChannel(own[1]), vgaChannel(own[2])]) : c;
  });
  return {
    id: "vga",
    width: 640,
    height: 480,
    pixelAspect: 1,
    colors,
    matrix: BAYER_4X4,
    dither: screenShowDither,
    gradient: { matrix: BAYER_8X8, dither: screenShowGradientDither },
  };
}
