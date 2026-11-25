/**
 * Display modes (task 6b): imitate the screen Harvard Graphics 3 ran on.
 *
 * Parsers resolve palette roles to the stored RGB and put CSS colours in the
 * Scene ("Modern"). The display mode is applied afterwards, here in the
 * render layer, as a pure colour transform over the whole scene
 * (`applyDisplayMode`). Switching mode therefore recolours the open chart
 * without re-parsing, and formats know nothing about display modes.
 *
 * Rules (RENDERER_TASKS.md task 6b):
 * - VGA: the Harvard Graphics 3 "VGA ScreenShow" driver, as the reference
 *   renders show it (vgaScreenShow.ts, through the dithering engine
 *   dither.ts): 16 fixed colours; the background cleared to the nearest one;
 *   every other colour, text and lines included, an ordered dither of up to
 *   three of them, aligned to the 640 × 480 pixel grid. The mode id stays
 *   "vga" (stored settings keep working); its earlier rule, each channel
 *   rounded to the DAC's 6 bits, was a guess and looked the same as Modern.
 * - EGA: nearest of the 64 EGA colours (2 bits per channel). Record 1555 is
 *   not a display mapping (formats.md "Verified findings"), so this is a
 *   nearest-colour rule. A scene may show at most 16 EGA colours at once:
 *   if more are used, the 16 most used (counted by element occurrences,
 *   background included) are kept and the others map to the nearest kept one.
 * - Mono: a 1-bit monochrome screen. Harvard Graphics 3 never supported
 *   CGA; its mono displays were EGA Monochrome (640 × 350) and, from 3.05,
 *   Hercules (720 × 348). How it mapped chart colours on them is not
 *   documented, so this rule is an imitation [I], chosen to look like a
 *   period 1-bit screen and stay readable (`applyMono`, rules as MONO_*
 *   constants): the background becomes black or white by Rec. 601 luma
 *   (threshold 50%); text and outlines always take the other colour, so they
 *   never vanish; fills become one of 9 ordered (Bayer 4 × 4) dither levels
 *   from black to white chosen by luma, drawn as `Scene.patterns` with one
 *   pattern pixel per screen pixel (640 × 350); levels are allocated per
 *   scene so that distinct fill colours get distinct patterns (while 9
 *   levels suffice) and near-identical ones share one. A fill at the
 *   background level gets an outline if it had none, so the shape stays
 *   visible. Text gets a halo in the background colour so it stays readable
 *   over dithered fills. (Drawing with the program's own greyscale palettes,
 *   MONOCHRB / MONOCHRW, is a separate option in the format layer.)
 * - Modern: stored RGB unchanged, except that a document with its own 16
 *   screen colours (Scene.screenColors, e.g. HG3's 1HDW palettes) shows
 *   each colour with its slots replaced (`applyScreenIntent`); EGA and mono
 *   start from those colours too. Gradients stay smooth in Modern and EGA
 *   (EGA maps their two colours); mono draws them as their middle colour.
 *
 * Only colours in the forms #rgb, #rrggbb and rgb(r, g, b) are transformed;
 * any other CSS colour string (named colours, hsl(), ...) is left unchanged.
 * Bitmaps (image elements) are not recoloured.
 */
import {
  GRADIENT_FILL_PREFIX,
  PATTERN_FILL_PREFIX,
  type FillGradient,
  type FillPattern,
  type Scene,
  type SceneElement,
} from "../formats/types";
import { type RGB, colorDistance, formatCssColor, luma, nearestColor, parseCssColor } from "./color";
import { BAYER_4X4, applyScreen, ditherAverage, ditherRows, normalizeDither } from "./dither";
import { SCREENSHOW_DAC, changedScreenColors, screenIntent, screenShowDither, vgaScreenShow } from "./vgaScreenShow";

export { type RGB, colorDistance, formatCssColor, luma, nearestColor, parseCssColor, vgaChannel } from "./color";

export type DisplayMode = "vga" | "ega" | "mono" | "modern";

export const DEFAULT_DISPLAY_MODE: DisplayMode = "vga";

/** Modes in selector order, with their labels. */
export const DISPLAY_MODES: readonly { mode: DisplayMode; label: string }[] = [
  { mode: "vga", label: "VGA ScreenShow (16 colours, dithered)" },
  { mode: "ega", label: "EGA (16 of 64 colours)" },
  { mode: "mono", label: "Monochrome screen (EGA Mono / Hercules) — imitation" },
  { mode: "modern", label: "Modern (24-bit, as stored)" },
];

export function isDisplayMode(value: unknown): value is DisplayMode {
  return DISPLAY_MODES.some((m) => m.mode === value);
}

/** Channel levels of the EGA's 64 colours (2 bits per channel). */
const EGA_LEVELS = [0x00, 0x55, 0xaa, 0xff] as const;

/** All 64 EGA colours. */
export const EGA_COLORS: readonly RGB[] = EGA_LEVELS.flatMap((r) =>
  EGA_LEVELS.flatMap((g) => EGA_LEVELS.map((b) => [r, g, b] as const)),
);

/** The VGA ScreenShow colours as RGB (standard DAC). */
const SCREENSHOW_DAC_RGB: readonly RGB[] = SCREENSHOW_DAC.map((c) => parseCssColor(c) ?? [0, 0, 0]);

/**
 * Screen colour of one stored RGB in `mode`. For VGA this is the colour its
 * dither averages to (what the eye blends; `applyDisplayMode` draws the
 * dither itself). For EGA this is the nearest of the 64 colours only; the
 * 16-at-once limit needs the whole scene and is applied by
 * `applyDisplayMode`. For mono this is the plain black / white threshold
 * (the background rule of `applyMono`; fills are dithered there).
 */
export function toScreenColor(rgb: RGB, mode: DisplayMode): RGB {
  switch (mode) {
    case "vga": {
      const avg = ditherAverage(normalizeDither(screenShowDither(rgb)), SCREENSHOW_DAC_RGB);
      return [Math.round(avg[0]), Math.round(avg[1]), Math.round(avg[2])];
    }
    case "ega":
      return nearestColor(rgb, EGA_COLORS);
    case "mono":
      return luma(rgb) >= MONO_WHITE_THRESHOLD ? [255, 255, 255] : [0, 0, 0];
    case "modern":
      return [rgb[0], rgb[1], rgb[2]];
  }
}

// ---------------------------------------------------------------------------
// Whole scene
// ---------------------------------------------------------------------------

/** Calls `visit` on every colour string in the scene, background first (gradients' colours after it). */
function forEachColor(scene: Scene, visit: (css: string) => void): void {
  visit(scene.background);
  for (const g of Object.values(scene.gradients ?? {})) {
    visit(g.from);
    visit(g.to);
  }
  const walk = (els: SceneElement[]) => {
    for (const el of els) {
      switch (el.kind) {
        case "group":
          walk(el.children);
          break;
        case "image":
          break;
        case "text":
          visit(el.fill);
          break;
        default:
          if (el.fill !== null) visit(el.fill);
          if (el.stroke !== null) visit(el.stroke);
      }
    }
  };
  walk(scene.elements);
}

/** Returns a copy of the scene with every colour passed through `map`. */
function mapColors(scene: Scene, map: (css: string) => string): Scene {
  const mapEl = (el: SceneElement): SceneElement => {
    switch (el.kind) {
      case "group":
        return { ...el, children: el.children.map(mapEl) };
      case "image":
        return el;
      case "text":
        return { ...el, fill: map(el.fill) };
      default:
        return {
          ...el,
          fill: el.fill === null ? null : map(el.fill),
          stroke: el.stroke === null ? null : map(el.stroke),
        };
    }
  };
  const out: Scene = { ...scene, background: map(scene.background), elements: scene.elements.map(mapEl) };
  if (scene.gradients) {
    out.gradients = Object.fromEntries(
      Object.entries(scene.gradients).map(([id, g]) => [id, { ...g, from: map(g.from), to: map(g.to) }]),
    );
  }
  return out;
}

/** `css` through `f` when it is an #rgb/#rrggbb/rgb() colour, else unchanged; cached per call site. */
function rgbMapper(f: (rgb: RGB) => RGB): (css: string) => string {
  const cache = new Map<string, string>();
  return (css) => {
    let out = cache.get(css);
    if (out === undefined) {
      const rgb = parseCssColor(css);
      out = rgb ? formatCssColor(f(rgb)) : css;
      cache.set(css, out);
    }
    return out;
  };
}

/**
 * The scene's colours as its own screen colours show them
 * (Scene.screenColors, vgaScreenShow.ts `screenIntent`): unchanged unless
 * the document changes some of the 16 screen colours. The VGA mode does not
 * use this: it draws the stored colours with the document's DAC.
 */
export function applyScreenIntent(scene: Scene): Scene {
  const own = changedScreenColors(scene.screenColors);
  if (!own) return scene;
  return mapColors(scene, rgbMapper((rgb) => screenIntent(rgb, own)));
}

/**
 * Gradient fills (and a gradient background) replaced by the colour half
 * way between their two colours, for display modes that do not draw
 * gradients.
 */
function flattenGradients(scene: Scene): Scene {
  const gradients = scene.gradients;
  if (!gradients) return scene;
  const mid = (fill: string): string => {
    if (!fill.startsWith(GRADIENT_FILL_PREFIX)) return fill;
    const g: FillGradient | undefined = gradients[fill.slice(GRADIENT_FILL_PREFIX.length)];
    const a = g && parseCssColor(g.from);
    const b = g && parseCssColor(g.to);
    return a && b ? formatCssColor([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]) : (g?.from ?? fill);
  };
  const mapEl = (el: SceneElement): SceneElement => {
    if (el.kind === "group") return { ...el, children: el.children.map(mapEl) };
    if (el.kind === "image" || el.kind === "text" || el.fill === null) return el;
    return { ...el, fill: mid(el.fill) };
  };
  const { gradients: _drawn, ...rest } = scene;
  return { ...rest, background: mid(scene.background), elements: scene.elements.map(mapEl) };
}

/** Most EGA colours shown at once. */
export const EGA_MAX_COLORS = 16;

/**
 * The scene's colour mapping for EGA: each parsed colour to its nearest EGA
 * colour, limited to the EGA_MAX_COLORS most used (ties: first seen wins).
 */
function egaMapper(scene: Scene): (rgb: RGB) => RGB {
  const counts = new Map<string, { rgb: RGB; count: number; order: number }>();
  forEachColor(scene, (css) => {
    const rgb = parseCssColor(css);
    if (!rgb) return;
    const ega = nearestColor(rgb, EGA_COLORS);
    const key = formatCssColor(ega);
    const entry = counts.get(key);
    if (entry) entry.count++;
    else counts.set(key, { rgb: ega, count: 1, order: counts.size });
  });
  if (counts.size <= EGA_MAX_COLORS) return (rgb) => nearestColor(rgb, EGA_COLORS);
  const kept = [...counts.values()]
    .sort((a, b) => b.count - a.count || a.order - b.order)
    .slice(0, EGA_MAX_COLORS)
    .map((e) => e.rgb);
  const keptKeys = new Set(kept.map(formatCssColor));
  return (rgb) => {
    const ega = nearestColor(rgb, EGA_COLORS);
    // A colour whose own EGA colour was kept keeps it; others go to the kept
    // colour nearest the original RGB.
    return keptKeys.has(formatCssColor(ega)) ? ega : nearestColor(rgb, kept);
  };
}

// ---------------------------------------------------------------------------
// Mono (1-bit screen, imitation; see the module comment)
// ---------------------------------------------------------------------------

export const MONO_BLACK = "#000000";
export const MONO_WHITE = "#ffffff";

/** A colour of at least this Rec. 601 luma (0..255) counts as white. */
export const MONO_WHITE_THRESHOLD = 127.5;

/** The EGA Monochrome screen, in pixels (Hercules, 720 × 348, is close). */
export const MONO_SCREEN = { width: 640, height: 350 } as const;

/**
 * Width / height of one screen pixel: 640 × 350 pixels filled a 4:3
 * screen, so a pixel was (4 / 640) / (3 / 350) = 35/48 as wide as tall.
 */
export const MONO_PIXEL_ASPECT = 4 / MONO_SCREEN.width / (3 / MONO_SCREEN.height);

/** Ordered-dither thresholds (0..15): a pixel is white when its value < 16 × coverage. */
export const MONO_BAYER_4X4 = BAYER_4X4;

/** Fill levels run from 0 (black) to MONO_FILL_LEVELS (white): 9 levels, 2/16 apart. */
export const MONO_FILL_LEVELS = 8;

/**
 * Fill colours closer than this (square root of `colorDistance`, roughly
 * "about 10 per channel") count as the same colour and share a level.
 */
export const MONO_SAME_FILL_DISTANCE = 32;

/**
 * Halo (in the background colour) under text and glyph lines, beyond the
 * glyph edge, in screen pixel heights: keeps text readable over dithered or
 * foreground fills and is invisible over the background.
 */
export const MONO_TEXT_HALO_PIXELS = 0.6;

/** Give a fill at the background level an outline if it has none. */
export const MONO_OUTLINE_BACKGROUND_FILLS = true;

/** Dither level of a fill colour: luma rounded to 0..MONO_FILL_LEVELS. */
export function monoFillLevel(rgb: RGB): number {
  return Math.round((luma(rgb) / 255) * MONO_FILL_LEVELS);
}

/**
 * Dither levels for a scene's fill colours (the mono rules): near-identical
 * colours (MONO_SAME_FILL_DISTANCE) are merged; a colour merged with the
 * background takes the background level; the others get levels as close as
 * possible to `monoFillLevel`, in luma order, and all different from each
 * other, while there are levels enough (9).
 * With more distinct colours than levels, each gets plain `monoFillLevel`.
 *
 * Returns a lookup from colour key (`formatCssColor`) to level.
 */
export function monoLevelsForFills(fills: readonly RGB[], background: RGB): Map<string, number> {
  const bgWhite = luma(background) >= MONO_WHITE_THRESHOLD;
  const bgLevel = bgWhite ? MONO_FILL_LEVELS : 0;
  const near = (a: RGB, b: RGB) => colorDistance(a, b) < MONO_SAME_FILL_DISTANCE ** 2;
  // Clusters of near-identical colours; the background's is first.
  const clusters: { rep: RGB; members: RGB[] }[] = [{ rep: background, members: [] }];
  const seen = new Set<string>();
  for (const rgb of fills) {
    const key = formatCssColor(rgb);
    if (seen.has(key)) continue;
    seen.add(key);
    const c = clusters.find((cl) => near(cl.rep, rgb));
    if (c) c.members.push(rgb);
    else clusters.push({ rep: rgb, members: [rgb] });
  }
  const [bgCluster, ...others] = clusters;
  const levels = new Map<string, number>();
  for (const rgb of bgCluster.members) levels.set(formatCssColor(rgb), bgLevel);
  const ideal = others.map((c) => monoFillLevel(c.rep));
  let assigned: number[];
  if (others.length > MONO_FILL_LEVELS + 1) {
    assigned = ideal;
  } else {
    // Lightness order. The background level stays a choice (such fills get
    // an outline): pushing near-background panels to a dither only adds
    // noise behind their text.
    const order = others.map((_, i) => i).sort((a, b) => luma(others[a].rep) - luma(others[b].rep));
    const choices = [...Array(MONO_FILL_LEVELS + 1).keys()];
    const best = increasingAssignment(order.map((i) => ideal[i]), choices);
    assigned = new Array<number>(others.length);
    order.forEach((i, k) => (assigned[i] = best[k]));
  }
  others.forEach((c, i) => {
    for (const rgb of c.members) levels.set(formatCssColor(rgb), assigned[i]);
  });
  return levels;
}

/**
 * Strictly increasing picks from `choices` (sorted ascending, at least as
 * many as `ideal`) minimising the summed squared distance to `ideal`.
 */
function increasingAssignment(ideal: readonly number[], choices: readonly number[]): number[] {
  const n = ideal.length;
  const m = choices.length;
  if (n === 0) return [];
  // cost[i][j]: best cost of items 0..i with item i at choices[j].
  const cost: number[][] = [];
  const from: number[][] = [];
  for (let i = 0; i < n; i++) {
    cost.push(new Array<number>(m).fill(Infinity));
    from.push(new Array<number>(m).fill(-1));
    for (let j = i; j < m; j++) {
      const own = (choices[j] - ideal[i]) ** 2;
      if (i === 0) {
        cost[i][j] = own;
        continue;
      }
      for (let k = i - 1; k < j; k++) {
        const c = cost[i - 1][k] + own;
        if (c < cost[i][j]) {
          cost[i][j] = c;
          from[i][j] = k;
        }
      }
    }
  }
  let j = 0;
  for (let k = 1; k < m; k++) if (cost[n - 1][k] < cost[n - 1][j]) j = k;
  const out = new Array<number>(n);
  for (let i = n - 1; i >= 0; i--) {
    out[i] = choices[j];
    j = from[i][j];
  }
  return out;
}

/** Tile rows of dither `level` ("1" = white pixel): white on the lowest 2 × level thresholds. */
export function monoPatternRows(level: number): string[] {
  const white = Math.round((16 * level) / MONO_FILL_LEVELS);
  return ditherRows(
    [
      { color: 1, cells: white },
      { color: 0, cells: 16 - white },
    ],
    1,
    MONO_BAYER_4X4,
  );
}

/** Id (in `Scene.patterns`) of the pattern for dither `level`. */
export function monoPatternId(level: number): string {
  return `mono-${level}`;
}

/** Calls `visit` on the fill of every shape (not text or glyphs), in order. */
function forEachShapeFill(elements: SceneElement[], visit: (css: string) => void): void {
  for (const el of elements) {
    if (el.kind === "group") forEachShapeFill(el.children, visit);
    else if (el.kind !== "image" && el.kind !== "text" && el.kind !== "glyphs" && el.fill !== null)
      visit(el.fill);
  }
}

/**
 * The scene on a 640 × 350 mono screen (rules above and in the MONO_*
 * constants). Pattern pixels are one screen pixel of the page letterboxed on
 * the screen; inside scaled groups a scaled copy of the pattern is used.
 */
export function applyMono(scene: Scene): Scene {
  const bgRgb = parseCssColor(scene.background) ?? [0, 0, 0];
  const bgWhite = luma(bgRgb) >= MONO_WHITE_THRESHOLD;
  const bg = bgWhite ? MONO_WHITE : MONO_BLACK;
  const fg = bgWhite ? MONO_BLACK : MONO_WHITE;
  const bgLevel = bgWhite ? MONO_FILL_LEVELS : 0;
  const pixelHeight = scene.viewBox.height / MONO_SCREEN.height;
  const pixelWidth = pixelHeight * MONO_PIXEL_ASPECT;
  const haloWidth = pixelHeight * MONO_TEXT_HALO_PIXELS;
  const patterns: Record<string, FillPattern> = {};
  const fills: RGB[] = [];
  forEachShapeFill(scene.elements, (css) => {
    const rgb = parseCssColor(css);
    if (rgb) fills.push(rgb);
  });
  const levels = monoLevelsForFills(fills, bgRgb);

  /** Fill for `css` in a coordinate system scaled by (sx, sy) from the scene's. */
  const mapFill = (css: string, sx: number, sy: number): { fill: string; isBg: boolean } => {
    const rgb = parseCssColor(css);
    if (!rgb) return { fill: css, isBg: false };
    const level = levels.get(formatCssColor(rgb)) ?? monoFillLevel(rgb);
    const isBg = level === bgLevel;
    if (level === 0) return { fill: MONO_BLACK, isBg };
    if (level === MONO_FILL_LEVELS) return { fill: MONO_WHITE, isBg };
    const qx = Math.round(sx * 1000) / 1000;
    const qy = Math.round(sy * 1000) / 1000;
    const id = monoPatternId(level) + (qx === 1 && qy === 1 ? "" : `@${qx}x${qy}`);
    patterns[id] ??= {
      rows: monoPatternRows(level),
      ink: MONO_WHITE,
      paper: MONO_BLACK,
      pixelWidth: pixelWidth / (qx || 1),
      pixelHeight: pixelHeight / (qy || 1),
    };
    return { fill: PATTERN_FILL_PREFIX + id, isBg };
  };

  const mapEl = (el: SceneElement, sx: number, sy: number): SceneElement => {
    switch (el.kind) {
      case "group": {
        const t = el.transform;
        const csx = t ? sx * Math.hypot(t[0], t[1]) : sx;
        const csy = t ? sy * Math.hypot(t[2], t[3]) : sy;
        return { ...el, children: el.children.map((c) => mapEl(c, csx, csy)) };
      }
      case "image":
        return el;
      case "text":
        return { ...el, fill: fg, halo: { color: bg, width: haloWidth / Math.sqrt(sx * sy) } };
      case "glyphs": {
        // Local units: the line's own transform scales too.
        const t = el.transform;
        const s = Math.sqrt(sx * sy * (t ? Math.abs(t[0] * t[3] - t[1] * t[2]) : 1));
        return {
          ...el,
          fill: el.fill === null ? null : fg,
          stroke: el.stroke === null ? null : fg,
          halo: { color: bg, width: haloWidth / (s || 1) },
        };
      }
      default: {
        const stroke = el.stroke === null ? null : fg;
        if (el.fill === null) return { ...el, stroke };
        const { fill, isBg } = mapFill(el.fill, sx, sy);
        if (isBg && stroke === null && MONO_OUTLINE_BACKGROUND_FILLS) return { ...el, fill, stroke: fg };
        return { ...el, fill, stroke };
      }
    }
  };

  const elements = scene.elements.map((el) => mapEl(el, 1, 1));
  const out: Scene = { ...scene, background: bg, elements };
  if (Object.keys(patterns).length > 0) out.patterns = { ...scene.patterns, ...patterns };
  return out;
}

/**
 * The scene as seen on a `mode` display. Pure: the input is not modified.
 * "modern" returns the scene itself.
 */
export function applyDisplayMode(scene: Scene, mode: DisplayMode): Scene {
  if (mode === "vga") return applyScreen(scene, vgaScreenShow(scene.screenColors));
  const shown = applyScreenIntent(scene);
  if (mode === "modern") return shown;
  if (mode === "mono") return applyMono(flattenGradients(shown));
  return mapColors(shown, rgbMapper(egaMapper(shown)));
}

// ---------------------------------------------------------------------------
// Persistence (per browser)
// ---------------------------------------------------------------------------

const STORAGE_KEY = "hwv.displayMode";

/** Earlier name of the "mono" mode, still found in stored settings. */
const LEGACY_CGA_MODE = "cga";

/** The remembered mode, or the default if none (or storage is unavailable). */
export function loadDisplayMode(): DisplayMode {
  try {
    const v = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (v === LEGACY_CGA_MODE) return "mono";
    if (isDisplayMode(v)) return v;
  } catch {
    // Storage blocked (private mode, sandbox): fall through to the default.
  }
  return DEFAULT_DISPLAY_MODE;
}

export function saveDisplayMode(mode: DisplayMode): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, mode);
  } catch {
    // Not remembered; the choice still applies for this session.
  }
}
