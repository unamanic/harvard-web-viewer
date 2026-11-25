/**
 * Pie legend laid out from data (task 16; 1306, SPEC §5.4). Drawn when 1306
 * byte 0 is Yes in the legend area (810), which the chart stores already
 * placed (and the plot area 806 already shrunk) for the chosen location.
 * Read off the drawn copies of PLEG, PLEGL1 (vertical, right side) and
 * PLEGL2, PLEGL3 (one row, bottom) [C for these four; I elsewhere]:
 *
 * - A box filling the legend area, outlined in 1306 byte 4's role (14 =
 *   Frame) and filled in byte 5's (20 = Legend). Frame styles other than
 *   the default are not decoded [?]; every frame is drawn plain.
 * - One entry per slice of the first pie, in data order: a square swatch in
 *   the slice's colour outlined in role Outlines, then the slice name.
 * - Names use 1308 entry PIE_LEGEND_STYLE_INDEX (size 3.5, role 8 in every
 *   chart), drawn left-justified [I].
 * - Sizes are fractions of the name's line box height h (1200 for size 3.5
 *   in the copies): margin 506, swatch 840 square with its top 60 below the
 *   name box's top, 240 from swatch to name; rows 1560 apart; in a row,
 *   480 between one name and the next swatch.
 * - Locations 5 and 6 (right side) list the entries down from the top
 *   margin; 7 and 8 (bottom) in one row from the left margin, vertically
 *   centred. Other locations: one row when the area is less than two rows
 *   tall, else a column [I].
 */
import type { SceneElement } from "../../../types";
import { lineWidthFor } from "../../assumptions";
import type { FontKey } from "../../fontKey";
import { ROLE } from "../../palette";
import { Justification } from "../../text";
import type { PieLegendOptions, PieSlice } from "../../data/pie";
import type { ChartSceneContext } from "../context";
import { areaToRect } from "../page";
import { type Box, type StyledText, boxOf, drawStack, lineBoxHeight, textWidth } from "./text";

/** 1308 entry for legend names (size 3.5, role 8 in the copies) [I]. */
export const PIE_LEGEND_STYLE_INDEX = 19;
/** Fractions of the name line box height (see the header comment) [C, PLEG to PLEGL3]. */
export const PIE_LEGEND_MARGIN = 506 / 1200;
export const PIE_LEGEND_SWATCH = 840 / 1200;
export const PIE_LEGEND_SWATCH_DROP = 60 / 1200;
export const PIE_LEGEND_GAP = 240 / 1200;
export const PIE_LEGEND_PITCH = 1560 / 1200;
export const PIE_LEGEND_ITEM_GAP = 480 / 1200;
/** 1306 byte 2 locations confirmed as a column (right side) and as a row (bottom) [C]. */
export const PIE_LEGEND_COLUMN_LOCATIONS: readonly number[] = [5, 6];
export const PIE_LEGEND_ROW_LOCATIONS: readonly number[] = [7, 8];
/** Line style of the legend frame and swatch outlines. */
const PIE_LEGEND_LINE_STYLE = 1;

const NO_FONT: FontKey = { source: 0, number: 0, style: 0 };

function rect(b: Box, fill: string | null, stroke: string | null): SceneElement[] {
  if (!fill && !stroke) return [];
  return [{ kind: "rect", ...areaToRect({ x1: b.left, y1: b.bottom, x2: b.right, y2: b.top }), fill, stroke, strokeWidth: lineWidthFor(PIE_LEGEND_LINE_STYLE) }];
}

function nameStyle(ctx: ChartSceneContext): Omit<StyledText, "text"> {
  const entry = ctx.chart.styleTables.get(1308)?.[PIE_LEGEND_STYLE_INDEX];
  const usable = entry && entry.size > 0 ? entry : null;
  return { size: usable?.size ?? 3.5, color: usable?.colorRole || 8, justification: Justification.Left, fontKey: usable?.fontKey ?? NO_FONT };
}

/** Whether the entries go in one row. */
export function legendAcross(location: number, areaHeight: number, h: number, entries: number): boolean {
  if (PIE_LEGEND_ROW_LOCATIONS.includes(location)) return true;
  if (PIE_LEGEND_COLUMN_LOCATIONS.includes(location)) return false;
  return entries > 1 && areaHeight < 2 * PIE_LEGEND_PITCH * h;
}

export function drawPieLegend(ctx: ChartSceneContext, legend: PieLegendOptions | null, slices: readonly PieSlice[]): SceneElement[] {
  const area = ctx.chart.areas.legend;
  if (!legend?.show || !area) return [];
  const box = boxOf(area);
  if (box.right - box.left <= 0 || box.top - box.bottom <= 0) return [];
  const out = rect(box, ctx.color(legend.frameFillRole), ctx.color(legend.frameOutlineRole));
  const style = nameStyle(ctx);
  const entries = slices.map((s) => ({ s, text: s.label.trim() }));
  if (!entries.length) return out;
  const h = lineBoxHeight(ctx, style.size);
  const margin = PIE_LEGEND_MARGIN * h;
  const sw = PIE_LEGEND_SWATCH * h;
  const gap = PIE_LEGEND_GAP * h;
  const outline = ctx.color(ROLE.Outlines);
  const entry = (s: PieSlice, text: string, left: number, top: number): number => {
    const sTop = top - PIE_LEGEND_SWATCH_DROP * h;
    out.push(...rect({ left, right: left + sw, top: sTop, bottom: sTop - sw }, ctx.color(s.colorRole), outline));
    const tl = left + sw + gap;
    const w = text ? textWidth(ctx, text, style.fontKey, style.size) : 0;
    if (text) out.push(...drawStack(ctx, [{ ...style, text }], { left: tl, right: tl + w, top, bottom: top - h }, top).elements);
    return tl + w;
  };
  if (legendAcross(legend.location, box.top - box.bottom, h, entries.length)) {
    const top = (box.top + box.bottom) / 2 + h / 2;
    let x = box.left + margin;
    for (const { s, text } of entries) x = entry(s, text, x, top) + PIE_LEGEND_ITEM_GAP * h;
  } else {
    let top = box.top - margin;
    for (const { s, text } of entries) {
      entry(s, text, box.left + margin, top);
      top -= PIE_LEGEND_PITCH * h;
    }
  }
  return out;
}
