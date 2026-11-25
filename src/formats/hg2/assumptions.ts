/**
 * Things the 1.x/2.x drawing code assumes because the files do not say
 * them and no reference picture has been compared yet. Every value here is
 * [I] (inferred) in the sense of docs/SPEC-HG1-HG2.md; change them here
 * when a screenshot of the original program shows otherwise.
 */
import { LANDSCAPE_VIEW_BOX } from "../types";

/** The page: the viewer's 4:3 landscape page, x -16384..16384, y -12288..12288 (scene y down). */
export const PAGE = {
  left: LANDSCAPE_VIEW_BOX.minX,
  top: LANDSCAPE_VIEW_BOX.minY,
  right: LANDSCAPE_VIEW_BOX.minX + LANDSCAPE_VIEW_BOX.width,
  bottom: LANDSCAPE_VIEW_BOX.minY + LANDSCAPE_VIEW_BOX.height,
  width: LANDSCAPE_VIEW_BOX.width,
  height: LANDSCAPE_VIEW_BOX.height,
} as const;

/** Margins around everything drawn, as fractions of the page width and height. */
export const MARGIN_X = 0.05 * PAGE.width;
export const MARGIN_Y = 0.04 * PAGE.height;

/** [I] Stored text sizes are percent of the page height (title 8, subtitle 6, footnote 3.5). */
export function sizeToUnits(size: number): number {
  return (size * PAGE.height) / 100;
}

/** Default sizes (percent of page height) when a field holds 0. */
export const DEFAULT_SIZES = {
  title: 8,
  subtitle: 6,
  footnote: 3.5,
  axisTitle: 4,
  axisLabel: 3,
  legend: 3,
  valueLabel: 2.5,
  body: 5.5,
  pieTitle: 5,
} as const;

/** [I] The screen is black and text defaults to colour 1 (white), as on the 2.x colour screen. */
export const BACKGROUND = "#000000";

/**
 * [I] Colour numbers 1..16. Neither format stores the colours themselves;
 * this is the EGA set in the order the 2.x colour menus list them (white,
 * cyan, magenta, green, blue, red, yellow, then the dark set). Unchecked
 * against the program's own screen.
 */
export const CLASSIC_PALETTE: readonly string[] = [
  "#FFFFFF", // 1 white
  "#00FFFF", // 2 cyan
  "#FF00FF", // 3 magenta
  "#00FF00", // 4 green
  "#5555FF", // 5 blue
  "#FF0000", // 6 red
  "#FFFF00", // 7 yellow
  "#AAAAAA", // 8 grey
  "#00AAAA", // 9 dark cyan
  "#AA00AA", // 10 dark magenta
  "#00AA00", // 11 dark green
  "#0000AA", // 12 dark blue
  "#AA0000", // 13 dark red
  "#AA5500", // 14 brown
  "#555555", // 15 dark grey
  "#000000", // 16 black
];

/** CSS colour of colour number n (1-based); 0 and out-of-range numbers wrap into 1..16. */
export function classicColor(n: number): string {
  if (!Number.isFinite(n) || n < 1) return CLASSIC_PALETTE[0];
  return CLASSIC_PALETTE[(Math.floor(n) - 1) % CLASSIC_PALETTE.length];
}

/** The colour mixed toward black by `factor` (0 = black, 1 = unchanged), for 3-D sides and shadows. */
export function shade(css: string, factor: number): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(css);
  if (!m) return css;
  const part = (h: string) =>
    Math.round(Number.parseInt(h, 16) * factor)
      .toString(16)
      .padStart(2, "0");
  return `#${part(m[1])}${part(m[2])}${part(m[3])}`;
}

/** [I] CSS stand-in for the program's own fonts, which are not decoded. */
export const FONT_FAMILY = "Helvetica, Arial, sans-serif";

/** [I] Average character width as a fraction of the text size, for laying text out without font metrics. */
export const CHAR_WIDTH = 0.6;
