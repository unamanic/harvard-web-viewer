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
 * - EGA: the Harvard Graphics 3.05 EGA driver (EGA.SC3, 640 × 350), as its
 *   reference renders show it (ega.ts): the VGA ScreenShow dither rules
 *   with each of the 16 screen colours shown as the nearest of the 64 EGA
 *   colours, on the 640 × 350 grid (pixels 1.37 times taller than wide).
 *   It replaces a nearest-colour rule (each colour to the nearest of the
 *   64, at most 16 at once), which drew no dithers.
 * - Mono: the Harvard Graphics 3.05 Hercules driver (HERC.SC3, 720 × 348,
 *   one bit per pixel), as its reference renders show it (hercules.ts,
 *   through the dithering engine): fills, text and the background become
 *   one of 9 ordered-dither patterns (4 × 4 Bayer, screen aligned, pixels
 *   about 1.55 times taller than wide) chosen by luma; thin lines and
 *   outlines are solid white (black for near-black colours); gradients
 *   use 64 levels on the 8 × 8 matrix. It replaces an earlier invented
 *   imitation (luma threshold background, text and lines forced to the
 *   foreground, halos, added outlines); HG 3.05's other mono driver, EGA
 *   Mono (EGAMONO.SC3), could not be captured. The stored colours are used
 *   (Scene.screenColors only reprogram the colour drivers' 16 slots).
 * - Modern: stored RGB unchanged, except that a document with its own 16
 *   screen colours (Scene.screenColors, e.g. HG3's 1HDW palettes) shows
 *   each colour with its slots replaced (`applyScreenIntent`). Gradients
 *   stay smooth in Modern.
 *
 * Only colours in the forms #rgb, #rrggbb and rgb(r, g, b) are transformed;
 * any other CSS colour string (named colours, hsl(), ...) is left unchanged.
 * Bitmaps with indexed pixels are redrawn by the screen modes at the
 * screen's resolution, each pixel's colour dithered as a fill of that
 * colour at that screen pixel (dither.ts, screenImage.ts; the reference
 * renders show exactly that for FLOOR, ROCKTOP, LOGOBKG1 and PATTVIEW in
 * all three modes). Modern leaves images as they are.
 */
import type { Scene, SceneElement } from "../formats/types";
import { type RGB, formatCssColor, parseCssColor } from "./color";
import { applyScreen, ditherAverage, normalizeDither } from "./dither";
import { egaScreen } from "./ega";
import { HERCULES_LEVELS, herculesLevel, herculesScreen } from "./hercules";
import { SCREENSHOW_DAC, changedScreenColors, screenIntent, screenShowDither, vgaScreenShow } from "./vgaScreenShow";

export { EGA_COLORS } from "./ega";
export { type RGB, colorDistance, formatCssColor, luma, nearestColor, parseCssColor, vgaChannel } from "./color";

export type DisplayMode = "vga" | "ega" | "mono" | "modern";

export const DEFAULT_DISPLAY_MODE: DisplayMode = "vga";

/** Modes in selector order, with their labels. */
export const DISPLAY_MODES: readonly { mode: DisplayMode; label: string }[] = [
  { mode: "vga", label: "VGA ScreenShow (16 colours, dithered)" },
  { mode: "ega", label: "EGA (640×350, 16 of 64 colours, dithered)" },
  { mode: "mono", label: "Hercules monochrome (720×348)" },
  { mode: "modern", label: "Modern (24-bit, as stored)" },
];

export function isDisplayMode(value: unknown): value is DisplayMode {
  return DISPLAY_MODES.some((m) => m.mode === value);
}

/** The VGA ScreenShow colours as RGB (standard DAC). */
const SCREENSHOW_DAC_RGB: readonly RGB[] = SCREENSHOW_DAC.map((c) => parseCssColor(c) ?? [0, 0, 0]);

/**
 * Screen colour of one stored RGB in `mode`. For VGA this is the colour its
 * dither averages to (what the eye blends; `applyDisplayMode` draws the
 * dither itself), and likewise for EGA with its 16 EGA colours. For mono this is the grey the colour's Hercules fill
 * pattern averages to (2 × level sixteenths of white).
 */
export function toScreenColor(rgb: RGB, mode: DisplayMode): RGB {
  switch (mode) {
    case "vga": {
      const avg = ditherAverage(normalizeDither(screenShowDither(rgb)), SCREENSHOW_DAC_RGB);
      return [Math.round(avg[0]), Math.round(avg[1]), Math.round(avg[2])];
    }
    case "ega": {
      const screen = egaScreen();
      const avg = ditherAverage(normalizeDither(screen.dither(rgb)), screen.colors.map((c) => parseCssColor(c) ?? [0, 0, 0]));
      return [Math.round(avg[0]), Math.round(avg[1]), Math.round(avg[2])];
    }
    case "mono": {
      const v = Math.round((255 * herculesLevel(rgb)) / HERCULES_LEVELS);
      return [v, v, v];
    }
    case "modern":
      return [rgb[0], rgb[1], rgb[2]];
  }
}

// ---------------------------------------------------------------------------
// Whole scene
// ---------------------------------------------------------------------------

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
 * The scene as seen on a `mode` display. Pure: the input is not modified.
 * "modern" returns the scene itself.
 */
export function applyDisplayMode(scene: Scene, mode: DisplayMode): Scene {
  if (mode === "vga") return applyScreen(scene, vgaScreenShow(scene.screenColors));
  if (mode === "mono") return applyScreen(scene, herculesScreen());
  if (mode === "ega") return applyScreen(scene, egaScreen(scene.screenColors));
  return applyScreenIntent(scene); // modern
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
