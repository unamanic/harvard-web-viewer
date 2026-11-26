/**
 * When to lay a data chart out from its data (tasks 14 to 19) and when to
 * draw only the drawn copy it stores in its object layer (SPEC §5.1).
 *
 * Every sample data chart (171 of 171) stores a drawn copy of itself as
 * objects, and drawing the object layer alone reproduces the chart; laying
 * the chart out from its data is the fallback for a chart without a copy.
 *
 * Modes (ChartSceneOptions.dataLayout, ParseContext.layoutFromData):
 *
 * - "auto" (default): lay out from data only when the chart has no drawn
 *   copy (`hasDrawnCopy`); the object layer is drawn either way.
 * - "always": lay out from data and do NOT draw the object layer (it would
 *   draw the copy on top). For comparing our layout with the stored copy;
 *   annotations the user added to the object layer are lost too, since they
 *   cannot be told apart from the copy. Drawings (no data) still draw their
 *   object layer.
 * - "never": object layer only, as before tasks 14 to 19.
 */
import type { LayoutFromData } from "../../parser";
import type { Chart } from "../chart";
import { DocumentType } from "../container";
import { type ObjectLayer, allObjects, parseObjectLayer } from "../objects";
import { textBlockLines } from "./objectLayer";

export type DataLayoutMode = LayoutFromData;

/** Chart types that store data (SPEC §5.4); drawings and unknown types do not. */
const DATA_CHART_TYPES: ReadonlySet<number> = new Set<number>([
  DocumentType.XY,
  DocumentType.Pie,
  DocumentType.Organization,
  DocumentType.Title,
  DocumentType.Bullet,
  DocumentType.Table,
]);

export function isDataChart(chart: Pick<Chart, "chartType">): boolean {
  return DATA_CHART_TYPES.has(chart.chartType);
}

const layerCache = new WeakMap<object, ObjectLayer>();

function layerOf(chart: Chart): ObjectLayer | null {
  if (!chart.objectLayer) return null;
  let layer = layerCache.get(chart.objectLayer);
  if (!layer) {
    layer = parseObjectLayer(chart.objectLayer).layer;
    layerCache.set(chart.objectLayer, layer);
  }
  return layer;
}

/** Text compared without surrounding white space (copies keep the lines' spaces, but be lenient). */
const norm = (s: string) => s.trim();

/**
 * True when the chart's object layer holds a drawn copy of the chart [I]:
 * the layer has at least one item AND, if the chart has any non-blank text
 * line (800), some text block of the layer has a line equal to one of them
 * (ignoring surrounding spaces). A chart with no text lines at all counts
 * as having a copy when its layer is not empty (nothing to check against).
 *
 * In the samples every data chart's copy holds all of its text lines, so
 * the test is true for all 171; a chart whose layer holds only user
 * annotations (text the data does not have) or nothing is laid out from
 * data. Checking the text rather than "layer not empty" keeps charts with
 * a few annotations but no copy (none in the samples) drawable.
 */
export function hasDrawnCopy(chart: Chart): boolean {
  const layer = layerOf(chart);
  if (!layer || layer.items.length === 0) return false;
  const wanted = new Set(chart.textLines.map((l) => norm(l.text)).filter((t) => t.length > 0));
  if (wanted.size === 0) return true;
  for (const obj of allObjects(layer.items)) {
    for (const { shape } of obj.shapes) {
      if (shape.kind !== "text") continue;
      if (wanted.has(norm(shape.runs.map((r) => r.text).join("")))) return true;
      for (const line of textBlockLines(shape)) if (wanted.has(norm(line.text))) return true;
    }
  }
  return false;
}

/** Whether this chart is laid out from its data under `mode`. */
export function drawsFromData(chart: Chart, mode: DataLayoutMode): boolean {
  if (!isDataChart(chart) || mode === "never") return false;
  return mode === "always" || !hasDrawnCopy(chart);
}

/** Whether the object layer is drawn under `mode` (all but data charts in "always"). */
export function drawsObjectLayer(chart: Chart, mode: DataLayoutMode): boolean {
  return !(mode === "always" && isDataChart(chart));
}
