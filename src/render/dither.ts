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
  GRADIENT_FILL_PREFIX,
  PATTERN_FILL_PREFIX,
  type FillGradient,
  type FillPattern,
  type GradientBand,
  type Matrix,
  type Scene,
  type SceneElement,
  type ViewBox,
} from "../formats/types";
import { type RGB, formatCssColor, parseCssColor } from "./color";
import { type Box, gradientSpan, shapeBounds } from "./geometry";

/** Threshold matrix: every value 0..n−1 once (n = rows × columns), tiled from the screen's top left. */
export type ThresholdMatrix = readonly (readonly number[])[];

/** The 4 × 4 Bayer ordered-dither matrix. */
export const BAYER_4X4: ThresholdMatrix = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

/**
 * The 8 × 8 Bayer matrix (64 levels): the 4 × 4 one on each of the four
 * interleaved 2 × 2 sub-grids, sub-grid (0,0) first, then (1,1), (0,1), (1,0).
 */
export const BAYER_8X8: ThresholdMatrix = Array.from({ length: 8 }, (_, y) =>
  Array.from({ length: 8 }, (_, x) => BAYER_4X4[y >> 1][x >> 1] + 16 * [[0, 2], [3, 1]][y & 1][x & 1]),
);

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
  /**
   * Gradient fills (Scene.gradients) and the page background, when the
   * screen shows them with their own threshold matrix and colour rule (for
   * the VGA ScreenShow driver, 64 levels on an 8 × 8 matrix); when absent,
   * `matrix` and `dither`.
   */
  gradient?: { matrix: ThresholdMatrix; dither(rgb: RGB): Dither };
  /**
   * Solid screen colour for the page background. When absent the
   * background is dithered like a gradient band (`gradient`, else `dither`).
   */
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
  const gradients: Record<string, FillGradient> = {};
  type Entry = { solid: string } | { tileKey: string; tile: number[][] } | null;
  const ditherCache = new Map<string, Entry>();
  const gradientCache = new Map<string, Entry>();
  const fine = screen.gradient ?? { matrix: screen.matrix, dither: screen.dither };

  const entryOf = (rgb: RGB, dither: Screen["dither"], matrix: ThresholdMatrix): Entry => {
    const d = normalizeDither(dither(rgb));
    if (d.length === 0) return null;
    if (d.length === 1) return { solid: screen.colors[d[0].color] };
    const tile = ditherTile(d, matrix);
    return { tileKey: tile.map((r) => r.map((c) => c.toString(16)).join("")).join("/"), tile };
  };

  /** How the screen shows `css`: on shapes, lines and text, or (`gradient`) in gradients and the background. */
  const ditherOf = (css: string, gradient = false): Entry => {
    const cache = gradient ? gradientCache : ditherCache;
    let entry = cache.get(css);
    if (entry !== undefined) return entry;
    const rgb = parseCssColor(css);
    entry = rgb ? (gradient ? entryOf(rgb, fine.dither, fine.matrix) : entryOf(rgb, screen.dither, screen.matrix)) : null;
    cache.set(css, entry);
    return entry;
  };

  /**
   * Paint for `css` used in a coordinate system mapped to the scene's by
   * `toScene`: a screen colour, a "pattern:<id>", or `css` unchanged.
   */
  const paint = (css: string, toScene: Matrix, gradient = false): string => {
    const d = ditherOf(css, gradient);
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

  /**
   * A gradient fill as the screen shows it: sampled once per screen pixel
   * along its direction (over the element's bounding box `box`, in units
   * mapped to the scene's by `toScene`), each sample dithered with the
   * gradient rule, runs of equal paint merged into bands.
   */
  const gradientPaint = (fill: string, box: Box | null, toScene: Matrix): string => {
    const id = fill.slice(GRADIENT_FILL_PREFIX.length);
    const g = scene.gradients && Object.hasOwn(scene.gradients, id) ? scene.gradients[id] : undefined;
    if (!g) return fill;
    const from = parseCssColor(g.from);
    const to = parseCssColor(g.to);
    if (!from || !to || !box) return paint(g.from, toScene, true);
    const span = gradientSpan(box, g.angle);
    // Screen pixels along the direction: the span mapped to the scene, over the pixel size.
    const vx = toScene[0] * span.dir.x + toScene[2] * span.dir.y;
    const vy = toScene[1] * span.dir.x + toScene[3] * span.dir.y;
    const pixels = (Math.abs(span.end - span.start) * Math.hypot(vx / geo.pixelWidth, vy / geo.pixelHeight));
    const steps = Math.max(1, Math.min(GRADIENT_MAX_STEPS, Math.round(pixels)));
    const bands: GradientBand[] = [];
    for (let k = 0; k < steps; k++) {
      const t = (k + 0.5) / steps;
      const css = formatCssColor([0, 1, 2].map((c) => from[c] + (to[c] - from[c]) * t) as unknown as RGB);
      const p = paint(css, toScene, true);
      if (bands.length === 0 || bands[bands.length - 1].paint !== p) bands.push({ offset: k / steps, paint: p });
    }
    const newId = `${prefix}-g${Object.keys(gradients).length}`;
    gradients[newId] = { ...g, bands };
    return GRADIENT_FILL_PREFIX + newId;
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
          fill:
            el.fill === null
              ? null
              : el.fill.startsWith(GRADIENT_FILL_PREFIX)
                ? gradientPaint(el.fill, shapeBounds(el), toScene)
                : paint(el.fill, toScene),
          stroke: el.stroke === null ? null : paint(el.stroke, toScene),
        };
    }
  };

  const { minX, minY, width, height } = scene.viewBox;
  let background = scene.background;
  if (background.startsWith(GRADIENT_FILL_PREFIX)) {
    background = gradientPaint(background, { x: minX, y: minY, width, height }, IDENTITY);
  } else {
    const bgRgb = parseCssColor(background);
    if (bgRgb && screen.background) background = screen.colors[screen.background(bgRgb)];
    else if (bgRgb) background = paint(background, IDENTITY, true);
  }

  const elements = scene.elements.map((el) => mapEl(el, IDENTITY));
  const out: Scene = { ...scene, background, elements };
  if (Object.keys(patterns).length > 0) out.patterns = { ...scene.patterns, ...patterns };
  if (Object.keys(gradients).length > 0) out.gradients = { ...scene.gradients, ...gradients };
  return out;
}

/** Most bands a gradient is sampled into (one per screen pixel along it, up to this). */
export const GRADIENT_MAX_STEPS = 2048;

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
