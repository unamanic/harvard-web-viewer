/**
 * Dithering engine: shows a scene on a screen of few colours, the way a
 * period display driver did, by drawing each colour as a solid screen colour
 * or as an ordered-dither tile of several screen colours.
 *
 * The engine knows nothing about file formats or about any particular
 * program. A `Screen` says what the display can show (its colours, its pixel
 * grid, its threshold matrix) and how a stored colour becomes a `Dither`
 * (which screen colours, on which thresholds). `applyScreen` then rewrites a
 * scene: solid colours become screen colours, mixed ones become
 * `Scene.patterns` entries ("pattern:<id>" fills and strokes) whose tile
 * pixel is one screen pixel, aligned to the screen's pixel grid even inside
 * transformed groups (FillPattern.transform), as on the real screen.
 *
 * Screens so far: the Harvard Graphics 3 VGA ScreenShow driver
 * (vgaScreenShow.ts). A monochrome screen is another `Screen` with two
 * colours (and, if need be, another matrix); the current imitation mono mode
 * (displayMode.ts) builds its tiles with `ditherRows`.
 */
import {
  PATTERN_FILL_PREFIX,
  type FillPattern,
  type Matrix,
  type Scene,
  type SceneElement,
  type ViewBox,
} from "../formats/types";
import { type RGB, parseCssColor } from "./color";

/** Threshold matrix: every value 0..n−1 once (n = rows × columns), tiled from the screen's top left. */
export type ThresholdMatrix = readonly (readonly number[])[];

/** The 4 × 4 Bayer ordered-dither matrix. */
export const BAYER_4X4: ThresholdMatrix = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

/** One colour of a dither: a screen colour (index into Screen.colors) on `cells` thresholds. */
export interface DitherStop {
  color: number;
  cells: number;
}

/**
 * How a screen shows one colour: stops in threshold order (the first stop
 * takes the lowest thresholds). Cells add up to the matrix size; a single
 * stop is a solid colour.
 */
export type Dither = readonly DitherStop[];

/** A display the engine can imitate. */
export interface Screen {
  /** Short name, used in pattern ids. */
  id: string;
  /** Screen size in pixels; the page is letterboxed (centred) on it. */
  width: number;
  height: number;
  /** Width / height of one pixel (1 for square pixels). */
  pixelAspect: number;
  /** The colours the screen shows (CSS), indexed by DitherStop.color. */
  colors: readonly string[];
  matrix: ThresholdMatrix;
  /** How a stored colour is shown on shapes, lines and text. */
  dither(rgb: RGB): Dither;
  /** Solid screen colour for the page background; when absent, the stop with the most cells. */
  background?(rgb: RGB): number;
}

/** Number of cells (thresholds) of a matrix. */
export function matrixSize(matrix: ThresholdMatrix): number {
  return matrix.reduce((n, row) => n + row.length, 0);
}

/** The screen colour at threshold `t` of a dither. */
export function colorAtThreshold(d: Dither, t: number): number {
  let acc = 0;
  for (const s of d) {
    acc += s.cells;
    if (t < acc) return s.color;
  }
  return d[d.length - 1].color;
}

/** The dither as a tile of screen colour indexes, one per matrix cell. */
export function ditherTile(d: Dither, matrix: ThresholdMatrix = BAYER_4X4): number[][] {
  return matrix.map((row) => row.map((t) => colorAtThreshold(d, t)));
}

/** Tile rows of a two-colour dither: "1" where the tile shows `ink`, "0" elsewhere. */
export function ditherRows(d: Dither, ink: number, matrix: ThresholdMatrix = BAYER_4X4): string[] {
  return ditherTile(d, matrix).map((row) => row.map((c) => (c === ink ? "1" : "0")).join(""));
}

/** Drops empty stops and merges repeats of a colour (keeping the first position). */
export function normalizeDither(d: Dither): DitherStop[] {
  const out: DitherStop[] = [];
  for (const s of d) {
    if (s.cells <= 0) continue;
    const same = out.find((o) => o.color === s.color);
    if (same) same.cells += s.cells;
    else out.push({ ...s });
  }
  return out;
}

/** The colour a dither averages to (as the eye blends it). */
export function ditherAverage(d: Dither, colors: readonly RGB[]): RGB {
  const total = d.reduce((n, s) => n + s.cells, 0) || 1;
  const sum = [0, 1, 2].map((k) => d.reduce((acc, s) => acc + s.cells * colors[s.color][k], 0) / total);
  return [sum[0], sum[1], sum[2]];
}

/** Where the screen's pixel grid lies over a scene's viewBox. */
export interface ScreenGeometry {
  /** Scene coordinates of the screen's top-left corner. */
  originX: number;
  originY: number;
  /** One screen pixel, in scene units. */
  pixelWidth: number;
  pixelHeight: number;
}

/**
 * The screen's pixel grid over `viewBox`: the page is letterboxed (centred,
 * aspect kept) on a width × height screen of pixels pixelAspect wide. For
 * a 4:3 page on a 640 × 480 screen a pixel is viewBox.height / 480.
 */
export function screenGeometry(
  viewBox: ViewBox,
  screen: Pick<Screen, "width" | "height" | "pixelAspect">,
): ScreenGeometry {
  // Screen size in "square" units, then fit the page in it.
  const screenW = screen.width * screen.pixelAspect;
  const screenH = screen.height;
  const scale = Math.min(screenW / viewBox.width, screenH / viewBox.height); // square units per scene unit
  const pixelHeight = 1 / scale;
  const pixelWidth = screen.pixelAspect / scale;
  return {
    originX: viewBox.minX + viewBox.width / 2 - (screen.width * pixelWidth) / 2,
    originY: viewBox.minY + viewBox.height / 2 - (screen.height * pixelHeight) / 2,
    pixelWidth,
    pixelHeight,
  };
}

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function multiply(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

function invert(m: Matrix): Matrix | null {
  const det = m[0] * m[3] - m[1] * m[2];
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  const a = m[3] / det;
  const b = -m[1] / det;
  const c = -m[2] / det;
  const d = m[0] / det;
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
}

/** Rounds for use in keys and output (6 significant digits is plenty). */
function tidy(v: number): number {
  const r = Number(v.toPrecision(6));
  return Object.is(r, -0) ? 0 : r;
}

export interface ApplyScreenOptions {
  /** Prefix of the pattern ids added to the scene (default: the screen's id). */
  idPrefix?: string;
}

/**
 * The scene as `screen` shows it. Pure: the input is not modified.
 *
 * - The background becomes a solid screen colour (Screen.background).
 * - Fills, outlines and text (glyph paths, fallback text) become the
 *   screen colour of their dither when it is solid, else a pattern of one
 *   tile per dither, one tile pixel per screen pixel, aligned to the
 *   screen's pixel grid (patterns get a transform inside transformed
 *   groups and glyph lines).
 * - Colours that are not #rgb, #rrggbb or rgb() (named colours,
 *   "transparent", existing "pattern:" fills), halos and images are left
 *   unchanged.
 */
export function applyScreen(scene: Scene, screen: Screen, options: ApplyScreenOptions = {}): Scene {
  const prefix = options.idPrefix ?? screen.id;
  const geo = screenGeometry(scene.viewBox, screen);
  const patterns: Record<string, FillPattern> = {};
  const patternIds = new Map<string, string>();
  const ditherCache = new Map<string, { solid: string } | { tileKey: string; tile: number[][] } | null>();

  const ditherOf = (css: string) => {
    let entry = ditherCache.get(css);
    if (entry !== undefined) return entry;
    const rgb = parseCssColor(css);
    if (!rgb) entry = null;
    else {
      const d = normalizeDither(screen.dither(rgb));
      if (d.length === 0) entry = null;
      else if (d.length === 1) entry = { solid: screen.colors[d[0].color] };
      else {
        const tile = ditherTile(d, screen.matrix);
        entry = { tileKey: tile.map((r) => r.map((c) => c.toString(16)).join("")).join("/"), tile };
      }
    }
    ditherCache.set(css, entry);
    return entry;
  };

  /**
   * Paint for `css` used in a coordinate system mapped to the scene's by
   * `toScene`: a screen colour, a "pattern:<id>", or `css` unchanged.
   */
  const paint = (css: string, toScene: Matrix): string => {
    const d = ditherOf(css);
    if (d === null) return css;
    if ("solid" in d) return d.solid;
    // Pattern units are scene units shifted to the screen's origin; map them
    // into the element's units: local = toScene⁻¹ · translate(origin).
    const inv = invert(toScene);
    if (!inv) return screen.colors[d.tile[0][0]];
    const t = multiply(inv, [1, 0, 0, 1, geo.originX, geo.originY]).map(tidy) as Matrix;
    const transform = t.every((v, i) => v === IDENTITY[i]) ? undefined : t;
    const key = d.tileKey + "|" + (transform?.join(",") ?? "");
    let id = patternIds.get(key);
    if (id === undefined) {
      id = `${prefix}-${patternIds.size}`;
      patternIds.set(key, id);
      patterns[id] = tilePattern(d.tile, screen.colors, geo.pixelWidth, geo.pixelHeight, transform);
    }
    return PATTERN_FILL_PREFIX + id;
  };

  const mapEl = (el: SceneElement, toScene: Matrix): SceneElement => {
    switch (el.kind) {
      case "group": {
        const m = el.transform ? multiply(toScene, el.transform) : toScene;
        return { ...el, children: el.children.map((c) => mapEl(c, m)) };
      }
      case "image":
        return el;
      case "text":
        return { ...el, fill: paint(el.fill, toScene) };
      case "glyphs": {
        const m = el.transform ? multiply(toScene, el.transform) : toScene;
        return {
          ...el,
          fill: el.fill === null ? null : paint(el.fill, m),
          stroke: el.stroke === null ? null : paint(el.stroke, m),
        };
      }
      default:
        return {
          ...el,
          fill: el.fill === null ? null : paint(el.fill, toScene),
          stroke: el.stroke === null ? null : paint(el.stroke, toScene),
        };
    }
  };

  const bgRgb = parseCssColor(scene.background);
  let background = scene.background;
  if (bgRgb) {
    let index: number;
    if (screen.background) index = screen.background(bgRgb);
    else {
      const d = normalizeDither(screen.dither(bgRgb));
      index = d.length ? d.reduce((a, b) => (b.cells > a.cells ? b : a)).color : 0;
    }
    background = screen.colors[index];
  }

  const elements = scene.elements.map((el) => mapEl(el, IDENTITY));
  const out: Scene = { ...scene, background, elements };
  if (Object.keys(patterns).length > 0) out.patterns = { ...scene.patterns, ...patterns };
  return out;
}

/**
 * A FillPattern for a tile of screen colour indexes: ink / paper rows for
 * two colours, `colors` with hexadecimal digits for more.
 */
export function tilePattern(
  tile: readonly (readonly number[])[],
  colors: readonly string[],
  pixelWidth: number,
  pixelHeight: number,
  transform?: Matrix,
): FillPattern {
  const used = [...new Set(tile.flat())];
  let pattern: FillPattern;
  if (used.length <= 2) {
    const [paper, ink = paper] = used;
    pattern = {
      rows: tile.map((r) => r.map((c) => (c === ink && ink !== paper ? "1" : "0")).join("")),
      ink: colors[ink],
      paper: colors[paper],
      pixelWidth,
      pixelHeight,
    };
  } else {
    pattern = {
      rows: tile.map((r) => r.map((c) => used.indexOf(c).toString(16)).join("")),
      ink: colors[used[1]],
      paper: colors[used[0]],
      colors: used.map((c) => colors[c]),
      pixelWidth,
      pixelHeight,
    };
  }
  if (transform) pattern.transform = transform;
  return pattern;
}
