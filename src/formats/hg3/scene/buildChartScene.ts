/**
 * Chart → Scene (SPEC §5.5, §6.5).
 *
 * Drawing order (§6.5 [I]): background, then the data chart (title and
 * footnote text, then the chart-type drawing in the plot area), then the
 * object layer, then the button chart's objects (task 20), then one
 * transparent click area per button (assumptions.ts BUTTON_HIT_AREAS).
 * A data chart with a button chart is shrunk into the part of the page the
 * button chart leaves free (assumptions.ts BUTTON_CHART_FITS_DATA_CHART).
 * The data chart is drawn only when the chart is laid out from its data
 * (dataLayout.ts: by default only when its object layer holds no drawn
 * copy of it, which every sample chart has).
 * Embedded charts (task 13c)
 * are drawn by the object layer through `ctx.drawChart` = drawChartElements,
 * i.e. like a chart of their own minus the background and button overlay. The per-part builders below
 * are stubs that later tasks fill in (numbers from docs/RENDERER_TASKS.md);
 * each takes the shared ChartSceneContext. When a task lands, it replaces its
 * stub and removes its part from NOT_YET_DRAWN.
 */
import type { GroupElement, Matrix, ParseContext, RectElement, Scene, SceneElement, ViewBox } from "../../types";
import {
  BUTTON_CHART_FITS_DATA_CHART,
  BUTTON_CHART_OBJECTS_ONLY,
  DRAW_FRAME_FOR_DRAWINGS,
  DRAW_PAGE_FRAME,
  FALLBACK_BACKGROUND,
  FRAME_STROKE_WIDTH,
} from "../assumptions";
import { type Chart, type PageArea, type PageAreas } from "../chart";
import { DocumentType } from "../container";
import { ROLE } from "../palette";
import { TextSlot } from "../text";
import { type ChartSceneContext, type ChartSceneOptions, createButtonChartContext, createChartSceneContext } from "./context";
import { drawOrgChart } from "./data/org";
import { drawPieChart } from "./data/pie";
import { drawTableChart } from "./data/table";
import { drawXYChart } from "./data/xy";
import { drawBulletChart, drawTitleAndFootnote, drawTitleChart } from "./data/textCharts";
import { type DataLayoutMode, drawsFromData, drawsObjectLayer } from "./dataLayout";
import type { Box } from "../objects";
import { drawObjectLayer, loadReferencedChart, objectLayerPageBox } from "./objectLayer";
import { areaToRect } from "./page";

/**
 * Debug switches (no UI). Set `SCENE_DEBUG.showPageAreas = true` (e.g. from
 * the browser console via a module import, or in a test) to outline the
 * stored page areas (802 to 810) on top of everything.
 */
export const SCENE_DEBUG = { showPageAreas: false };

/** Outline colour per page area for SCENE_DEBUG.showPageAreas. */
const DEBUG_AREA_COLORS: Record<keyof PageAreas, string> = {
  frame: "#ff00ff",
  title: "#00c0ff",
  plot: "#00ff00",
  footnote: "#ffa000",
  legend: "#ff4040",
};

// ---------------------------------------------------------------------------
// Parts that are not drawn yet
// ---------------------------------------------------------------------------

export type ChartPart =
  | "title and footnote text"
  | "XY data"
  | "pie data"
  | "organization data"
  | "title chart text"
  | "bullet data"
  | "table data"
  | "object layer"
  | "button chart overlay";

/**
 * Parts with a stub builder. Each task deletes its entry when it lands.
 * They matter only for charts drawn from their data (dataLayout.ts): a
 * chart with a drawn copy shows every part through its object layer.
 */
const NOT_YET_DRAWN: ReadonlySet<ChartPart> = new Set<ChartPart>([]);

const DATA_PART: ReadonlyMap<number, ChartPart> = new Map<number, ChartPart>([
  [DocumentType.XY, "XY data"],
  [DocumentType.Pie, "pie data"],
  [DocumentType.Organization, "organization data"],
  [DocumentType.Title, "title chart text"],
  [DocumentType.Bullet, "bullet data"],
  [DocumentType.Table, "table data"],
]);

/** The parts this chart actually has, in drawing order (data parts whether or not they are drawn from data). */
export function chartParts(chart: Chart): ChartPart[] {
  const parts: ChartPart[] = [];
  const dataPart = DATA_PART.get(chart.chartType);
  if (dataPart && chart.textLines.some((l) => l.slot === TextSlot.Title || l.slot === TextSlot.Footnote)) {
    parts.push("title and footnote text");
  }
  if (dataPart) parts.push(dataPart);
  if (chart.objectLayer && chart.objectLayer.children.length > 0) parts.push("object layer");
  if (chart.fileRefs.buttonChartName !== null) parts.push("button chart overlay");
  return parts;
}

/**
 * Parts of this chart that no task draws yet, in drawing order: none when
 * the chart is not drawn from its data under `mode` (its drawn copy shows
 * them).
 */
export function notYetDrawn(chart: Chart, mode: DataLayoutMode = "auto"): ChartPart[] {
  if (!drawsFromData(chart, mode)) return [];
  return chartParts(chart).filter((p) => NOT_YET_DRAWN.has(p));
}

// ---------------------------------------------------------------------------
// Background and frame (task 12, SPEC §5.5 step 1)
// ---------------------------------------------------------------------------

function drawFrame(ctx: ChartSceneContext): SceneElement[] {
  const { chart } = ctx;
  const area = chart.areas.frame;
  if (!area || !DRAW_PAGE_FRAME) return [];
  if (chart.chartType === DocumentType.Drawing && !DRAW_FRAME_FOR_DRAWINGS) return [];
  const stroke = ctx.color(ROLE.Frame);
  if (!stroke) return [];
  return [{ kind: "rect", ...areaToRect(area), fill: null, stroke, strokeWidth: FRAME_STROKE_WIDTH }];
}

function drawDebugAreas(ctx: ChartSceneContext): RectElement[] {
  const out: RectElement[] = [];
  for (const [key, area] of Object.entries(ctx.chart.areas) as [keyof PageAreas, PageArea | null][]) {
    if (!area) continue;
    out.push({ kind: "rect", ...areaToRect(area), fill: null, stroke: DEBUG_AREA_COLORS[key], strokeWidth: FRAME_STROKE_WIDTH });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Button chart overlay (task 20, SPEC §4.4, §6.5)
// ---------------------------------------------------------------------------

/** The chart a 404 kind 1 reference names, loaded (with a warning when it cannot be). */
function loadButtonChart(ctx: ChartSceneContext): { chart: Chart; key: string } | null {
  const name = ctx.chart.fileRefs.buttonChartName;
  if (name === null) return null;
  return loadReferencedChart(ctx, name, "button chart", `button chart ${name}`);
}

/**
 * The object layer of the 404 kind 1 chart, on top of the slide, in the
 * host's coordinates and palette (assumptions.ts BUTTON_CHART_OBJECTS_ONLY).
 * Its 618 names stay on their groups, so clicks reach the show player.
 */
function drawButtonChartOverlay(ctx: ChartSceneContext, loaded: { chart: Chart; key: string }): SceneElement[] {
  const child = createButtonChartContext(ctx, loaded.chart, loaded.key);
  return BUTTON_CHART_OBJECTS_ONLY ? drawObjectLayer(child) : drawChartElements(child);
}

/**
 * Scene matrix that shrinks a data chart into the part of the page its
 * button chart leaves free (assumptions.ts BUTTON_CHART_FITS_DATA_CHART), or
 * null when it is drawn full size: a drawing, a button chart with no
 * objects, or one whose objects (page box `buttonBox`) do not form a band
 * entirely above or below the page centre.
 */
export function buttonChartFit(chartType: number, buttonBox: Box | null, viewBox: ViewBox): Matrix | null {
  if (!BUTTON_CHART_FITS_DATA_CHART || chartType === DocumentType.Drawing || !buttonBox) return null;
  const pageTop = -viewBox.minY; // page y is up; the viewBox is centred on (0, 0)
  const pageBottom = -(viewBox.minY + viewBox.height);
  const low = Math.min(buttonBox.y1, buttonBox.y2);
  const high = Math.max(buttonBox.y1, buttonBox.y2);
  let top: number;
  let bottom: number;
  if (low > 0) [top, bottom] = [Math.min(low, pageTop), pageBottom];
  else if (high < 0) [top, bottom] = [pageTop, Math.max(high, pageBottom)];
  else return null;
  const s = (top - bottom) / viewBox.height;
  if (!(s > 0) || s >= 1) return null;
  const centreX = viewBox.minX + viewBox.width / 2;
  const centreY = viewBox.minY + viewBox.height / 2; // scene y (down)
  const freeCentreY = -(top + bottom) / 2;
  return [s, 0, 0, s, centreX * (1 - s), freeCentreY - s * centreY];
}

/** The chart-type drawing in the plot area (SPEC §5.5 step 4). */
function drawDataChart(ctx: ChartSceneContext): SceneElement[] {
  switch (ctx.chart.chartType) {
    case DocumentType.XY:
      return drawXYChart(ctx);
    case DocumentType.Pie:
      return drawPieChart(ctx);
    case DocumentType.Organization:
      return drawOrgChart(ctx);
    case DocumentType.Title:
      return drawTitleChart(ctx);
    case DocumentType.Bullet:
      return drawBulletChart(ctx);
    case DocumentType.Table:
      return drawTableChart(ctx);
    case DocumentType.Drawing:
      return [];
    default:
      ctx.warn(`unknown chart type 0x${ctx.chart.chartType.toString(16).padStart(2, "0")}; only the object layer is drawn`);
      return [];
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * A chart's own elements: frame, title and footnote, data chart and object
 * layer. No background (the scene's) and no button chart overlay (top level
 * only). Also used for embedded charts (task 13c).
 */
export function drawChartElements(ctx: ChartSceneContext): SceneElement[] {
  const fromData = drawsFromData(ctx.chart, ctx.dataLayout);
  return [
    ...drawFrame(ctx),
    ...(fromData ? [...drawTitleAndFootnote(ctx), ...drawDataChart(ctx)] : []),
    ...(drawsObjectLayer(ctx.chart, ctx.dataLayout) ? drawObjectLayer(ctx) : []),
  ];
}

/**
 * Build the scene of a parsed chart. `ctx` is the file set (palette, fonts,
 * bitmaps, button chart). Warnings cover the palette, colours, fonts and
 * drawing, and end with an information line naming what drew each font
 * (TextFaces.report); the chart's parse warnings are not repeated here.
 */
export function buildChartScene(
  chart: Chart,
  ctx: ParseContext | undefined,
  options: ChartSceneOptions = {},
): { scene: Scene; warnings: string[] } {
  const { context, warnings } = createChartSceneContext(chart, ctx, options);
  context.drawChart = drawChartElements;
  const hitAreas: GroupElement[] = [];
  context.buttonHitAreas = hitAreas;

  const background = context.color(ROLE.FrameBkg) ?? FALLBACK_BACKGROUND;
  let slide: SceneElement[] = drawChartElements(context);
  if (SCENE_DEBUG.showPageAreas) slide.push(...drawDebugAreas(context));
  // The slide's own click areas, before the button chart adds its own.
  let slideHitAreas: SceneElement[] = hitAreas.splice(0);
  const buttonChart = loadButtonChart(context);
  let overlay: SceneElement[] = [];
  if (buttonChart) {
    const fit = buttonChartFit(chart.chartType, objectLayerPageBox(buttonChart.chart), context.page.viewBox);
    if (fit) {
      slide = [{ kind: "group", transform: fit, children: slide }];
      if (slideHitAreas.length > 0) slideHitAreas = [{ kind: "group", transform: fit, children: slideHitAreas }];
    }
    overlay = drawButtonChartOverlay(context, buttonChart);
  }
  const elements: SceneElement[] = [...slide, ...overlay, ...slideHitAreas, ...hitAreas];

  context.fonts.warnings().forEach(context.warn);
  const fontReport = context.faces.report();
  if (fontReport) warnings.push(fontReport);
  return { scene: { viewBox: context.page.viewBox, background, elements }, warnings };
}
