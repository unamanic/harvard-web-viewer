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
 * - VGA: each channel rounded to the VGA DAC's 6 bits.
 * - EGA: nearest of the 64 EGA colours (2 bits per channel). Record 1555 is
 *   not a display mapping (formats.md "Verified findings"), so this is a
 *   nearest-colour rule. A scene may show at most 16 EGA colours at once:
 *   if more are used, the 16 most used (counted by element occurrences,
 *   background included) are kept and the others map to the nearest kept one.
 * - CGA: 640 × 200 mono; each colour becomes black or white by Rec. 601
 *   luma, threshold 50%. A colour may end up the same as the background
 *   (e.g. dark blue text on black); that is what a mono screen did with a
 *   colour palette, so it is kept rather than "fixed".
 * - Modern: stored RGB unchanged.
 *
 * Only colours in the forms #rgb, #rrggbb and rgb(r, g, b) are transformed;
 * any other CSS colour string (named colours, hsl(), ...) is left unchanged.
 * Bitmaps (image elements) are not recoloured.
 */
import type { Scene, SceneElement } from "../formats/types";

export type DisplayMode = "vga" | "ega" | "cga" | "modern";

export const DEFAULT_DISPLAY_MODE: DisplayMode = "vga";

/** Modes in selector order, with their labels. */
export const DISPLAY_MODES: readonly { mode: DisplayMode; label: string }[] = [
  { mode: "vga", label: "VGA (262,144 colours)" },
  { mode: "ega", label: "EGA (16 of 64 colours)" },
  { mode: "cga", label: "CGA (640 × 200 mono)" },
  { mode: "modern", label: "Modern (24-bit, as stored)" },
];

export function isDisplayMode(value: unknown): value is DisplayMode {
  return DISPLAY_MODES.some((m) => m.mode === value);
}

export type RGB = readonly [number, number, number];

// ---------------------------------------------------------------------------
// CSS colour parsing / formatting
// ---------------------------------------------------------------------------

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

function clamp255(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

/** Formats as lower-case #rrggbb. */
export function formatCssColor(rgb: RGB): string {
  return "#" + rgb.map((v) => clamp255(v).toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------------------
// Per-colour rules
// ---------------------------------------------------------------------------

/** One channel through the VGA DAC: 8 bits to 6 bits and back. */
export function vgaChannel(v: number): number {
  const v6 = Math.round((clamp255(v) * 63) / 255);
  return Math.round((v6 * 255) / 63);
}

/** Channel levels of the EGA's 64 colours (2 bits per channel). */
const EGA_LEVELS = [0x00, 0x55, 0xaa, 0xff] as const;

/** All 64 EGA colours. */
export const EGA_COLORS: readonly RGB[] = EGA_LEVELS.flatMap((r) =>
  EGA_LEVELS.flatMap((g) => EGA_LEVELS.map((b) => [r, g, b] as const)),
);

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

/** The candidate closest to `rgb` (first one wins ties). */
export function nearestColor(rgb: RGB, candidates: readonly RGB[]): RGB {
  let best = candidates[0];
  let bestD = Infinity;
  for (const c of candidates) {
    const d = colorDistance(rgb, c);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

/** Rec. 601 luma, 0..255. */
export function luma(rgb: RGB): number {
  return 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
}

/**
 * Screen colour of one stored RGB in `mode`. For EGA this is the nearest of
 * the 64 colours only; the 16-at-once limit needs the whole scene and is
 * applied by `applyDisplayMode`.
 */
export function toScreenColor(rgb: RGB, mode: DisplayMode): RGB {
  switch (mode) {
    case "vga":
      return [vgaChannel(rgb[0]), vgaChannel(rgb[1]), vgaChannel(rgb[2])];
    case "ega":
      return nearestColor(rgb, EGA_COLORS);
    case "cga":
      return luma(rgb) >= 127.5 ? [255, 255, 255] : [0, 0, 0];
    case "modern":
      return [rgb[0], rgb[1], rgb[2]];
  }
}

// ---------------------------------------------------------------------------
// Whole scene
// ---------------------------------------------------------------------------

/** Calls `visit` on every colour string in the scene, background first. */
function forEachColor(scene: Scene, visit: (css: string) => void): void {
  visit(scene.background);
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
  return { ...scene, background: map(scene.background), elements: scene.elements.map(mapEl) };
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

/**
 * The scene as seen on a `mode` display. Pure: the input is not modified.
 * "modern" returns the scene itself.
 */
export function applyDisplayMode(scene: Scene, mode: DisplayMode): Scene {
  if (mode === "modern") return scene;
  const toScreen = mode === "ega" ? egaMapper(scene) : (rgb: RGB) => toScreenColor(rgb, mode);
  const cache = new Map<string, string>();
  return mapColors(scene, (css) => {
    let out = cache.get(css);
    if (out === undefined) {
      const rgb = parseCssColor(css);
      out = rgb ? formatCssColor(toScreen(rgb)) : css;
      cache.set(css, out);
    }
    return out;
  });
}

// ---------------------------------------------------------------------------
// Persistence (per browser)
// ---------------------------------------------------------------------------

const STORAGE_KEY = "hwv.displayMode";

/** The remembered mode, or the default if none (or storage is unavailable). */
export function loadDisplayMode(): DisplayMode {
  try {
    const v = globalThis.localStorage?.getItem(STORAGE_KEY);
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
