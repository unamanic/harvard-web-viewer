/**
 * Chart → Scene (SPEC §5.5, §6.5).
 *
 * Drawing order (§6.5 [I]): background, then the data chart (title and
 * footnote text, then the chart-type drawing in the plot area), then the
 * object layer, then the button chart's objects (task 20), then one
 * transparent click area per button (assumptions.ts BUTTON_HIT_AREAS).
 * Embedded charts (task 13c)
 * are drawn by the object layer through `ctx.drawChart` = drawChartElements,
 * i.e. like a chart of their own minus the background and button overlay. The per-part builders below
 * are stubs that later tasks fill in (numbers from docs/RENDERER_TASKS.md);
 * each takes the shared ChartSceneContext. When a task lands, it replaces its
 * stub and removes its part from NOT_YET_DRAWN.
 */
import type { GroupElement, ParseContext, RectElement, Scene, SceneElement } from "../../types";
import {
  BUTTON_CHART_OBJECTS_ONLY,
  DRAW_FRAME_FOR_DRAWINGS,
  FALLBACK_BACKGROUND,
  FRAME_STROKE_WIDTH,
} from "../assumptions";
import { type Chart, type PageArea, type PageAreas } from "../chart";
import { DocumentType } from "../container";
import { ROLE } from "../palette";
import { TextSlot } from "../text";
import { type ChartSceneContext, createButtonChartContext, createChartSceneContext } from "./context";
import { drawObjectLayer, loadReferencedChart } from "./objectLayer";
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

/** Parts with a stub builder. Each task deletes its entry when it lands. */
const NOT_YET_DRAWN: ReadonlySet<ChartPart> = new Set<ChartPart>([
  "title and footnote text", // task 14
  "XY data", // task 17
  "pie data", // task 16
  "organization data", // task 18
  "title chart text", // task 15
  "bullet data", // task 15
  "table data", // task 19
]);

const DATA_PART: ReadonlyMap<number, ChartPart> = new Map<number, ChartPart>([
  [DocumentType.XY, "XY data"],
  [DocumentType.Pie, "pie data"],
  [DocumentType.Organization, "organization data"],
  [DocumentType.Title, "title chart text"],
  [DocumentType.Bullet, "bullet data"],
  [DocumentType.Table, "table data"],
]);

/** The parts this chart actually has, in drawing order. */
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

/** Parts of this chart that no task draws yet, in drawing order. */
export function notYetDrawn(chart: Chart): ChartPart[] {
  return chartParts(chart).filter((p) => NOT_YET_DRAWN.has(p));
}

// ---------------------------------------------------------------------------
// Background and frame (task 12, SPEC §5.5 step 1)
// ---------------------------------------------------------------------------

function drawFrame(ctx: ChartSceneContext): SceneElement[] {
  const { chart } = ctx;
  const area = chart.areas.frame;
  if (!area) return [];
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
// Stubs for later tasks
// ---------------------------------------------------------------------------

/** Task 14: slot 1 text in the title area, slot 2 in the footnote area. */
function drawTitleAndFootnote(_ctx: ChartSceneContext): SceneElement[] {
  return [];
}
/** Task 17. */
function drawXYChart(_ctx: ChartSceneContext): SceneElement[] {
  return [];
}
/** Task 16. */
function drawPieChart(_ctx: ChartSceneContext): SceneElement[] {
  return [];
}
/** Task 18. */
function drawOrgChart(_ctx: ChartSceneContext): SceneElement[] {
  return [];
}
/** Task 15. */
function drawTitleChart(_ctx: ChartSceneContext): SceneElement[] {
  return [];
}
/** Task 15. */
function drawBulletChart(_ctx: ChartSceneContext): SceneElement[] {
  return [];
}
/** Task 19. */
function drawTableChart(_ctx: ChartSceneContext): SceneElement[] {
  return [];
}

// ---------------------------------------------------------------------------
// Button chart overlay (task 20, SPEC §4.4, §6.5)
// ---------------------------------------------------------------------------

/**
 * The object layer of the 404 kind 1 chart, on top of the slide, in the
 * host's coordinates and palette (assumptions.ts BUTTON_CHART_OBJECTS_ONLY).
 * Its 618 names stay on their groups, so clicks reach the show player.
 */
function drawButtonChartOverlay(ctx: ChartSceneContext): SceneElement[] {
  const name = ctx.chart.fileRefs.buttonChartName;
  if (name === null) return [];
  const loaded = loadReferencedChart(ctx, name, "button chart", `button chart ${name}`);
  if (!loaded) return [];
  const child = createButtonChartContext(ctx, loaded.chart, loaded.key);
  return BUTTON_CHART_OBJECTS_ONLY ? drawObjectLayer(child) : drawChartElements(child);
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
  return [...drawFrame(ctx), ...drawTitleAndFootnote(ctx), ...drawDataChart(ctx), ...drawObjectLayer(ctx)];
}

/**
 * Build the scene of a parsed chart. `ctx` is the file set (palette, fonts,
 * bitmaps, button chart). Warnings cover the palette, colours, fonts and
 * drawing, and end with an information line naming what drew each font
 * (TextFaces.report); the chart's parse warnings are not repeated here.
 */
export function buildChartScene(chart: Chart, ctx: ParseContext | undefined): { scene: Scene; warnings: string[] } {
  const { context, warnings } = createChartSceneContext(chart, ctx);
  context.drawChart = drawChartElements;
  const hitAreas: GroupElement[] = [];
  context.buttonHitAreas = hitAreas;

  const background = context.color(ROLE.FrameBkg) ?? FALLBACK_BACKGROUND;
  const elements: SceneElement[] = [...drawChartElements(context), ...drawButtonChartOverlay(context), ...hitAreas];
  if (SCENE_DEBUG.showPageAreas) elements.push(...drawDebugAreas(context));

  context.fonts.warnings().forEach(context.warn);
  const fontReport = context.faces.report();
  if (fontReport) warnings.push(fontReport);
  return { scene: { viewBox: context.page.viewBox, background, elements }, warnings };
}
