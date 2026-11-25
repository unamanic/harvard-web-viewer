/**
 * What every chart scene builder (tasks 12 to 20) gets: the chart, its
 * palette, a colour helper, the font resolver, a warning sink and the page
 * geometry.
 */
import { type FillGradient, GRADIENT_FILL_PREFIX, type GroupElement, type ParseContext, type SceneElement } from "../../types";
import type { Chart } from "../chart";
import { type FontResolver, createFontResolver } from "../fonts";
import {
  type ResolvedPalette,
  type WarningSink,
  colorForRole,
  resolveChartPalette,
  resolvePaletteOverride,
  rgbToCss,
  uniqueWarningSink,
} from "../palette";
import type { DataLayoutMode } from "./dataLayout";
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
  /**
   * The scene's gradients (Scene.gradients), shared by the chart, its
   * embedded charts and its button chart; add one with `gradient`.
   */
  gradients: Record<string, FillGradient>;
  /** A "gradient:<id>" fill for this gradient (the same id for the same gradient). */
  gradient(from: string, to: string, angle: number): string;
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
  /**
   * When to lay data charts out from their data (dataLayout.ts): from
   * ChartSceneOptions.dataLayout, else ParseContext.layoutFromData, else
   * "auto". Embedded charts and the button chart share the host's.
   */
  dataLayout: DataLayoutMode;
}

/** Options of a chart scene beyond its parse context. */
export interface ChartSceneOptions {
  /**
   * The viewer's palette option (ParseContext.paletteOverride), already
   * resolved by the caller (a show resolves it once for all its slides and
   * reports its warnings itself): a palette to draw with in place of the
   * chart's own, or null to use the chart's own. When absent it is resolved
   * here from `parseContext.paletteOverride`, with its warnings added to the
   * chart's.
   */
  paletteOverride?: ResolvedPalette | null;
  /**
   * When to lay a data chart out from its data instead of (or as well as)
   * drawing the copy stored in its object layer; see dataLayout.ts. When
   * absent, `parseContext.layoutFromData`, else "auto".
   */
  dataLayout?: DataLayoutMode;
}

/** The chart's palette: the viewer's palette option if one applies (task 6c), else its own. */
function chartPalette(
  chart: Chart,
  parseContext: ParseContext | undefined,
  options: ChartSceneOptions,
  warn: WarningSink,
): ResolvedPalette {
  let override = options.paletteOverride;
  if (override === undefined && parseContext?.paletteOverride) {
    const resolved = resolvePaletteOverride(parseContext.paletteOverride, parseContext);
    resolved.warnings.forEach(warn);
    override = resolved.palette;
  }
  if (override) return override;
  const own = resolveChartPalette(chart.fileRefs.paletteName, parseContext);
  own.warnings.forEach(warn);
  return own;
}

/**
 * Build the context and the warnings list it writes to. The palette's own
 * warnings are added first (for a palette option resolved by the caller,
 * none: the caller reports them). Font resolver warnings are not in the list:
 * read `fonts.warnings()` (and `faces.report()`) when the scene is done
 * (both are lazy).
 */
export function createChartSceneContext(
  chart: Chart,
  parseContext: ParseContext | undefined,
  options: ChartSceneOptions = {},
): { context: ChartSceneContext; warnings: string[] } {
  const warnings: string[] = [];
  const warn = uniqueWarningSink(warnings);
  const palette = chartPalette(chart, parseContext, options, warn);
  const fonts = createFontResolver(parseContext);
  const gradients: Record<string, FillGradient> = {};
  const gradientIds = new Map<string, string>();
  const context: ChartSceneContext = {
    chart,
    parseContext,
    palette,
    color(role) {
      const rgb = colorForRole(palette.palette, role, warn);
      return rgb ? rgbToCss(rgb) : null;
    },
    gradients,
    gradient(from, to, angle) {
      const key = `${from} ${to} ${angle}`;
      let id = gradientIds.get(key);
      if (id === undefined) {
        id = `g${gradientIds.size}`;
        gradientIds.set(key, id);
        gradients[id] = { from, to, angle };
      }
      return GRADIENT_FILL_PREFIX + id;
    },
    fonts,
    faces: createTextFaces(fonts, warn),
    warn,
    page: pageGeometry(chart),
    embedChain: parseContext ? [parseContext.path.toUpperCase()] : [],
    dataLayout: options.dataLayout ?? parseContext?.layoutFromData ?? "auto",
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
