/**
 * Table charts drawn from their data (task 19; SPEC §5.4): columns from
 * 1208 and row bands from 1214 (page percentages), cell text from slot 6,
 * cell backgrounds from the 1212 value ranges, and the rule under the
 * header that the sample copies draw. Guesses are in assumptions.ts
 * ("Tasks 14, 15, 19").
 */
import type { SceneElement } from "../../../types";
import {
  TABLE_CELL_MARGIN_EM,
  TABLE_CELL_OUTLINE_STYLE,
  TABLE_HEADER_RULE_STYLE,
  TABLE_NUMBERS_RIGHT_ALIGNED,
  lineWidthFor,
  textSizeToUnits,
} from "../../assumptions";
import { type TableData, parseTableData, tablePercentHeight, tablePercentToX, tablePercentToY } from "../../data/table";
import { ROLE } from "../../palette";
import { type TextLine, Justification } from "../../text";
import type { ChartSceneContext } from "../context";
import { areaToRect, toScene } from "../page";
import { type Box, anchorOf, baselineBelow, boxOf, drawnAdvance, fitScale, lineBoxHeight, pageBox, textElement } from "./text";
import { styled } from "./textCharts";

/** A cell's number, or null when its text is not a plain number (thousands separators and a % allowed). */
export function cellNumber(text: string): number | null {
  const t = text.trim().replace(/,/g, "").replace(/%$/, "");
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(t)) return null;
  return Number(t);
}

interface Span {
  lo: number;
  hi: number;
}

/**
 * Which row band each stored row starts [I]: a row with cells takes one
 * band and spans raw6 rows (a two-row header is one band); an empty row
 * takes a band of its own. Matches both sample tables (GALD171 has an empty
 * row between its data and its total, with its own shorter band).
 */
export function rowBandIndex(data: Pick<TableData, "grid" | "rowCount">): Map<number, number> {
  const out = new Map<number, number>();
  let band = 0;
  for (let r = 0; r < data.rowCount; ) {
    const cells = (data.grid[r] ?? []).filter((c): c is TextLine => c !== null);
    out.set(r, band++);
    r += cells.length ? Math.max(1, ...cells.map((c) => c.raw6)) : 1;
  }
  return out;
}

function columnSpans(ctx: ChartSceneContext, data: TableData, plot: Box): Span[] {
  const set = data.columns.map((c) => ({ lo: tablePercentToX(c.left!), hi: tablePercentToX(c.right!) }));
  if (set.length >= data.columnCount && set.length > 0) return set;
  if (set.length) ctx.warn(`table has ${data.columnCount} columns but 1208 sets ${set.length}; columns spread evenly`);
  const n = Math.max(1, data.columnCount);
  const w = (plot.right - plot.left) / n;
  return Array.from({ length: n }, (_, i) => ({ lo: plot.left + i * w, hi: plot.left + (i + 1) * w }));
}

function bandSpans(ctx: ChartSceneContext, data: TableData, bands: number, plot: Box): Span[] {
  const s = ctx.chart.pageSetup;
  const height = s ? tablePercentHeight(s.widthIn, s.heightIn) : undefined;
  const set = data.rowBands.map((b) => ({ hi: tablePercentToY(b.top!, height), lo: tablePercentToY(b.bottom!, height) }));
  if (set.length >= bands && set.length > 0) return set;
  if (set.length) ctx.warn(`table has ${bands} row bands but 1214 sets ${set.length}; rows spread evenly`);
  const n = Math.max(1, bands);
  const h = (plot.top - plot.bottom) / n;
  return Array.from({ length: n }, (_, i) => ({ hi: plot.top - i * h, lo: plot.top - (i + 1) * h }));
}

/** The 1212 colour role for a value, or null (ranges off, or no range holds it). */
function rangeRole(data: TableData, value: number): number | null {
  const ranges = data.colorRanges;
  if (!ranges?.enabled) return null;
  const hit = ranges.ranges.find((r) => r.low !== null && r.high !== null && value >= r.low && value <= r.high);
  return hit && hit.colorRole > 0 ? hit.colorRole : null;
}

export function drawTableChart(ctx: ChartSceneContext): SceneElement[] {
  const data = parseTableData(ctx.chart, []);
  if (data.cells.length === 0) return [];
  const plot = ctx.chart.areas.plot ? boxOf(ctx.chart.areas.plot) : pageBox(ctx);
  const bandOf = rowBandIndex(data);
  const columns = columnSpans(ctx, data, plot);
  const bands = bandSpans(ctx, data, bandOf.size, plot);
  const backgrounds: SceneElement[] = [];
  const texts: SceneElement[] = [];
  const outline = ctx.color(ROLE.Outlines);
  let headerMargin = 0;

  const placed = data.cells.flatMap((cell) => {
    const col = columns[cell.column];
    const band = bands[bandOf.get(cell.row) ?? -1];
    return col && band ? [{ cell, col, band, t: styled(ctx, cell) }] : [];
  });
  // One shrink factor for every cell when some text (its drawn advance plus margins) would not fit its cell [I].
  const marginOf = (size: number) => TABLE_CELL_MARGIN_EM * textSizeToUnits(size, ctx.page.shortSide);
  const k = fitScale((k) =>
    placed.every(({ col, band, t }) => {
      const size = t.size * k;
      const m = marginOf(size);
      return (
        drawnAdvance(ctx, t.text.trim(), t.fontKey, size) + 2 * m <= col.hi - col.lo + 1 &&
        lineBoxHeight(ctx, size) + 2 * m <= band.hi - band.lo + 1
      );
    }),
  );

  for (const { cell, col, band, t: natural } of placed) {
    const t = { ...natural, size: natural.size * k };
    const margin = marginOf(t.size);
    if (bandOf.get(cell.row) === 0) headerMargin = Math.max(headerMargin, margin);
    const value = cellNumber(t.text);
    if (value !== null) {
      const role = rangeRole(data, value);
      const fill = role === null ? null : ctx.color(role);
      if (fill) {
        backgrounds.push({
          kind: "rect",
          ...areaToRect({ x1: col.lo, y1: band.lo, x2: col.hi, y2: band.hi }),
          fill,
          stroke: outline,
          strokeWidth: lineWidthFor(TABLE_CELL_OUTLINE_STYLE),
        });
      }
    }
    const justification = value !== null && TABLE_NUMBERS_RIGHT_ALIGNED ? Justification.Right : t.justification;
    const anchor = anchorOf(justification);
    const x = anchor === "middle" ? (col.lo + col.hi) / 2 : anchor === "end" ? col.hi - margin : col.lo + margin;
    const top = (band.lo + band.hi) / 2 + lineBoxHeight(ctx, t.size) / 2;
    const el = textElement(ctx, t, anchor, x, baselineBelow(ctx, top, t.size));
    if (el) texts.push(el);
  }

  const rules: SceneElement[] = [];
  const stroke = ctx.color(ROLE.Lines);
  const header = bands[0];
  if (stroke && header && bands.length > 1 && columns.length) {
    const left = Math.min(...columns.map((c) => c.lo)) + headerMargin;
    const right = Math.max(...columns.map((c) => c.hi)) - headerMargin;
    rules.push({
      kind: "path",
      points: [toScene(left, header.lo), toScene(right, header.lo)],
      closed: false,
      fill: null,
      stroke,
      strokeWidth: lineWidthFor(TABLE_HEADER_RULE_STYLE),
    });
  }
  return [...rules, ...backgrounds, ...texts];
}
