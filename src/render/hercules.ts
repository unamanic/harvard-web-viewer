/**
 * The Harvard Graphics 3.05 Hercules display (HERC.SC3: 720 × 348, one bit
 * per pixel) as a dithering-engine Screen (dither.ts).
 *
 * Inferred from the 238 chart renders made in the real program with the
 * Hercules driver (samples-private/renders/hercules, private reference
 * material), compared with the same charts on VGA:
 *
 * - Geometry: 720 × 348 pixels fill a 4:3 screen, so a pixel is
 *   (4 / 3) / (720 / 348) ≈ 0.644 as wide as tall (about 1.55 times taller
 *   than wide). The page is letterboxed in that 4:3 space like on VGA (a
 *   portrait page covers the same 58 % of the screen width on both).
 * - Fills, text and the page background: the colour's grey level picks one
 *   of 9 ordered-dither patterns on the 4 × 4 Bayer matrix (white on the
 *   lowest 2 × level thresholds), aligned to the screen's pixel grid:
 *   `herculesDither`. The level comes from the Rec. 601 luma alone; it does
 *   not depend on the chart's palette beyond the stored RGB (cyan and orange
 *   share a pattern, as do (0,128,255), dark cyan and magenta).
 *   Reproduces 99.98 % of the flat fill-interior pixels of the 238
 *   references (gradients 99.7 %, thin-line and text interiors 99.9 / 99.1 %).
 * - Thin lines and outlines (strokes up to HERCULES_LINE_MAX_WIDTH pixels)
 *   are not patterned: solid white when the colour's fill level is above
 *   0, else black: `herculesLine` (a blue or dark grey rule is a solid
 *   white line, a navy one is black). Thicker strokes (data-series lines)
 *   are patterned like fills.
 * - Gradient fills: 64 levels on the 8 × 8 Bayer matrix, again by luma:
 *   `herculesGradientDither`.
 * - Bitmaps are left to the renderer (not recoloured); the real driver
 *   patterns them too (FLOOR, LOGOBKG1, PATTVIEW, ROCKTOP).
 * - Glyph outlines (stroke fonts; none in the samples) are treated as text.
 */
import { type RGB, luma } from "./color";
import { BAYER_4X4, BAYER_8X8, type Dither, type Screen } from "./dither";

/** Screen size in pixels. */
export const HERCULES_WIDTH = 720;
export const HERCULES_HEIGHT = 348;

/** Width / height of one pixel: 720 × 348 fills a 4:3 screen. */
export const HERCULES_PIXEL_ASPECT = 4 / 3 / (HERCULES_WIDTH / HERCULES_HEIGHT);

/** The two screen colours: index 0 black (off), 1 white (on). */
export const HERCULES_COLORS: readonly string[] = ["#000000", "#ffffff"];

/** Fill levels run from 0 (black) to HERCULES_LEVELS (white), 2 of the 16 thresholds apart. */
export const HERCULES_LEVELS = 8;

/** Luma in 64ths (0..63): luma / 4, rounded down. */
function luma64(rgb: RGB): number {
  return Math.max(0, Math.min(63, Math.floor(luma(rgb) / 4)));
}

/**
 * Fill level (0..8) of a colour: floor((floor(luma / 4) + 3) / 8). The
 * boundaries fitted to the references lie at luma ≈ 19, 51, 83, 115, 148,
 * 180, 212, 244 (e.g. (49,49,49) is level 1 and (53,53,53) level 2; (0,255,255)
 * at luma 179 is 5, (0,128,255) at 104 is 3).
 */
export function herculesLevel(rgb: RGB): number {
  return Math.min(HERCULES_LEVELS, Math.floor((luma64(rgb) + 3) / 8));
}

/** Fills, text and the background: white on the lowest 2 × level cells of the 4 × 4 Bayer matrix. */
export function herculesDither(rgb: RGB): Dither {
  const white = 2 * herculesLevel(rgb);
  return [
    { color: 1, cells: white },
    { color: 0, cells: 16 - white },
  ].filter((s) => s.cells > 0);
}

/**
 * Strokes up to this wide (in screen pixel heights) are thin lines, drawn
 * solid (`herculesLine`); wider ones (e.g. thick data-series lines) are
 * patterned like fills.
 */
export const HERCULES_LINE_MAX_WIDTH = 1.5;

/** Thin lines and outlines: solid white when the fill level is above 0, else solid black. */
export function herculesLine(rgb: RGB): Dither {
  return [{ color: herculesLevel(rgb) > 0 ? 1 : 0, cells: 16 }];
}

/**
 * Gradient fills: white on the lowest n of the 64 cells of the 8 × 8 Bayer
 * matrix, n = floor(64 · luma / 255 + 0.2) (fitted to the 13 gradient charts;
 * luma 4 → 1 cell, 64 → 16, 160 → 40).
 */
export function herculesGradientDither(rgb: RGB): Dither {
  const white = Math.max(0, Math.min(64, Math.floor((64 * luma(rgb)) / 255 + 0.2)));
  return [
    { color: 1, cells: white },
    { color: 0, cells: 64 - white },
  ].filter((s) => s.cells > 0);
}

/** The Hercules screen (module comment). */
export function herculesScreen(): Screen {
  return {
    id: "herc",
    width: HERCULES_WIDTH,
    height: HERCULES_HEIGHT,
    pixelAspect: HERCULES_PIXEL_ASPECT,
    colors: HERCULES_COLORS,
    matrix: BAYER_4X4,
    dither: herculesDither,
    line: { maxWidth: HERCULES_LINE_MAX_WIDTH, dither: herculesLine },
    gradient: { matrix: BAYER_8X8, dither: herculesGradientDither },
    backgroundLikeShapes: true,
  };
}
