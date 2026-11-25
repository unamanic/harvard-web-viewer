/**
 * What every chart scene builder (tasks 12 to 20) gets: the chart, its
 * palette, a colour helper, the font resolver, a warning sink and the page
 * geometry.
 */
import type { GroupElement, ParseContext, SceneElement } from "../../types";
import type { Chart } from "../chart";
import { type FontResolver, createFontResolver } from "../fonts";
import {
  type ResolvedPalette,
  type WarningSink,
  colorForRole,
  resolveChartPalette,
  rgbToCss,
  uniqueWarningSink,
} from "../palette";
import { type PageGeometry, pageGeometry } from "./page";
import { type TextFaces, createTextFaces } from "./textFaces";

export interface ChartSceneContext {
  chart: Chart;
  /** The file set around the chart (bitmaps, button chart); absent when opened alone. */
  parseContext: ParseContext | undefined;
  /** The chart's palette and where it came from (SPEC §3, §7.1). */
  palette: ResolvedPalette;
  /**
   * CSS colour of a colour role (SPEC §6.2), or null for role 0 ("none").
   * Roles missing from the palette fall back to the default palette with a
   * (deduplicated) warning.
   */
  color(role: number): string | null;
  fonts: FontResolver;
  /** Glyphs per font key: original font, clone or CSS look-alike (task 7f). */
  faces: TextFaces;
  /** Adds a warning to the scene's list once (duplicates are dropped). */
  warn: WarningSink;
  page: PageGeometry;
  /**
   * The charts being drawn, outermost first, as upper-case file paths (the
   * top-level chart's path from the parse context, then each embedded
   * chart's; task 13c). Empty when the chart was opened alone.
   */
  embedChain: readonly string[];
  /**
   * Draws a chart's elements without its background: set by buildChartScene
   * so that embedded charts (task 13c) are drawn like charts of their own.
   * When absent, an embedded chart draws only its object layer.
   */
  drawChart?: (ctx: ChartSceneContext) => SceneElement[];
  /**
   * Where the object layer adds one click area per button (task 20,
   * assumptions.ts BUTTON_HIT_AREAS): a group with the button's name around
   * a transparent rect over its bounding box, in scene coordinates. Set by
   * buildChartScene for the chart and its button chart, which draw in the
   * scene's coordinates; absent for embedded charts.
   */
  buttonHitAreas?: GroupElement[];
}

/**
 * Build the context and the warnings list it writes to. The palette's own
 * warnings are added first. Font resolver warnings are not in the list:
 * read `fonts.warnings()` (and `faces.report()`) when the scene is done
 * (both are lazy).
 */
export function createChartSceneContext(
  chart: Chart,
  parseContext: ParseContext | undefined,
): { context: ChartSceneContext; warnings: string[] } {
  const warnings: string[] = [];
  const warn = uniqueWarningSink(warnings);
  const palette = resolveChartPalette(chart.fileRefs.paletteName, parseContext);
  palette.warnings.forEach(warn);
  const fonts = createFontResolver(parseContext);
  const context: ChartSceneContext = {
    chart,
    parseContext,
    palette,
    color(role) {
      const rgb = colorForRole(palette.palette, role, warn);
      return rgb ? rgbToCss(rgb) : null;
    },
    fonts,
    faces: createTextFaces(fonts, warn),
    warn,
    page: pageGeometry(chart),
    embedChain: parseContext ? [parseContext.path.toUpperCase()] : [],
  };
  return { context, warnings };
}

/**
 * Context for a chart embedded in `parent`'s chart (task 13c): shares the
 * parent's palette, colours, fonts, warnings and file set
 * (assumptions.ts EMBEDDED_CHART_DRAWS_BACKGROUND explains the palette) and
 * adds `key` (the embedded file's upper-case path) to the chain.
 */
export function createEmbeddedContext(parent: ChartSceneContext, chart: Chart, key: string): ChartSceneContext {
  const { buttonHitAreas: _drawnTransformed, ...shared } = parent;
  return { ...shared, chart, page: pageGeometry(chart), embedChain: [...parent.embedChain, key] };
}

/**
 * Context for the button chart drawn over `parent`'s chart (task 20): like
 * an embedded chart (host palette, fonts, warnings; `key` added to the
 * chain) but in the host's own scene coordinates, so its buttons add click
 * areas to the host's list.
 */
export function createButtonChartContext(parent: ChartSceneContext, chart: Chart, key: string): ChartSceneContext {
  return { ...parent, chart, page: pageGeometry(chart), embedChain: [...parent.embedChain, key] };
}
