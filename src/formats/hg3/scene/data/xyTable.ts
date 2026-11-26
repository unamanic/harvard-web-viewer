/**
 * The XY data table under the chart (1410), and the table-only chart.
 */
import type { SceneElement } from "../../../../model/scene";
import {
  lineWidthFor,
  textSizeToUnits,
  XY_FRAME_BOTTOM_MARGIN,
  XY_LEGEND_GAP,
  XY_LEGEND_SWATCH,
  XY_LINE_STYLE,
} from "../../assumptions";
import type { XyData, XySeries } from "../../data/xy";
import { ROLE } from "../../palette";
import type { ChartSceneContext } from "../context";
import { type Box, drawnAdvance, layoutEm, lineBoxHeight } from "./text";
import { styled } from "./textCharts";
import {
  drawCentred,
  drawLabel,
  type Label,
  label,
  type Layout,
  line,
  rect,
  tableStyle,
  XY_TABLE_ONLY_BOTTOM,
  XY_TABLE_PAD_EM,
  XY_TABLE_SWATCH_PAD_AFTER_EM,
  XY_TABLE_SWATCH_PAD_EM,
} from "./xyLayout";
import { swatchFor } from "./xyLegend";
import type { XyOptions } from "./xyOptions";

/**
 * A column legend lists the series bottom-up when the bar style is Stack or
 * 100 % and top-down otherwise, whatever the placement (SPEC §5.5, "Legend
 * order": XSTK, XSTKIN, XPCT1, XOVL, XOVLIN, XSTEP) [C]; a row legend always
 * runs left to right (XSTKL8). The data table follows the column legend [I].
 */
export function listedBottomUp(opts: Pick<XyOptions, "barMode">): boolean {
  return opts.barMode === "stacked" || opts.barMode === "percent";
}

interface TableLayout {
  left: number;
  top: number;
  bottom: number;
  rowH: number;
  /** Row pitch: the table is (highest series number + 1) rows high, shared by the drawn series (GALD937, GALD945) [I]. */
  pitch: number;
  names: Label[];
  /** Left edge of the frame and of the first value column. */
  frameLeft: number;
  /** Left edge of the names. */
  nameLeft: number;
  /** Series swatches beside the names (when there is no legend). */
  swatches: boolean;
}

/**
 * Data table geometry, as 3.05 lays it out. With swatches (no legend;
 * XMLEGNO, XLEGNO) [C]: rows one label box high from XY_FRAME_BOTTOM_MARGIN × H
 * above the plot bottom; the box starts at the plot's left edge, the names
 * XY_TABLE_SWATCH_PAD_EM ems in, then XY_TABLE_SWATCH_PAD_AFTER_EM ems, the swatch and the
 * swatch gap up to the frame [I for the padding]. Without swatches
 * (XREV7, XDTGRID) [C]: the box starts at the plot's left edge, the names
 * XY_TABLE_PAD_EM ems in, the frame the same padding after the widest name
 * (its drawn advance). Table only (XDTONLY) [C]: the table fills the plot
 * area down to XY_TABLE_ONLY_BOTTOM × H, its rows sharing the height.
 */
export function tableLayout(ctx: ChartSceneContext, series: XySeries[], plot: Box, H: number, swatches: boolean, only: boolean): TableLayout {
  const names = series.map((s) => label(ctx, s.name?.text ?? "", s.name ? styled(ctx, s.name) : tableStyle(ctx, 13, ROLE.XLabel)));
  const rowH = Math.max(...names.map((n) => n.height), lineBoxHeight(ctx, tableStyle(ctx, 14, ROLE.XLabel).size));
  const rows = series.length ? Math.max(...series.map((s) => s.index)) + 1 : 1;
  const bottom = plot.bottom + (only ? XY_TABLE_ONLY_BOTTOM : XY_FRAME_BOTTOM_MARGIN) * H;
  if (swatches && !only) {
    // 3.05 (SPEC §5.5, "Data table with swatches"): the box from the plot's left edge, the names
    // XY_TABLE_SWATCH_PAD_EM ems in, then the swatch column (XMLEGNO, XLEGNO) [C for the box, I for the pad].
    const nameW = Math.max(0, ...names.map((n) => drawnAdvance(ctx, n.text, n.style.fontKey, n.style.size)));
    const em = Math.max(0, ...names.map((n) => layoutEm(ctx, n.style.size)));
    const pad = XY_TABLE_SWATCH_PAD_EM * em;
    const frameLeft = plot.left + pad + nameW + XY_TABLE_SWATCH_PAD_AFTER_EM * em + (XY_LEGEND_SWATCH + XY_LEGEND_GAP) * rowH;
    const height = rows * rowH;
    return { left: plot.left, top: bottom + height, bottom, rowH, pitch: height / Math.max(1, series.length), names, frameLeft, nameLeft: plot.left + pad, swatches };
  }
  const nameW = Math.max(0, ...names.map((n) => drawnAdvance(ctx, n.text, n.style.fontKey, n.style.size)));
  const em = Math.max(0, ...names.map((n) => textSizeToUnits(n.style.size, ctx.page.shortSide)));
  const pad = XY_TABLE_PAD_EM * em;
  const top = only ? plot.top : bottom + rows * rowH;
  const pitch = (top - bottom) / Math.max(1, series.length);
  return { left: plot.left, top, bottom, rowH, pitch, names, frameLeft: plot.left + 2 * pad + nameW, nameLeft: plot.left + pad, swatches: false };
}

/** A value as the data table prints it. */
export function tableValue(v: number): string {
  return String(Number(v.toFixed(4)));
}

/**
 * The table's box, values, grid and names, the value columns running from
 * t.frameLeft to `right`. Grid lines (1410 byte 1): 1 vertical column lines,
 * 2 horizontal row lines; both with the line after the names (XDTGRID) [C].
 * Lines in the frame outline role (XFROC) [C].
 */
function tableBody(ctx: ChartSceneContext, opts: XyOptions, data: XyData, t: TableLayout, series: XySeries[], right: number, rows: number): SceneElement[] {
  const out: SceneElement[] = [];
  const thin = lineWidthFor(XY_LINE_STYLE);
  const stroke = ctx.color(opts.frameRole);
  // 3.05 leaves the table box unfilled, swatches or not (XREV7, XMLEGNO) [C].
  out.push(...rect({ left: t.left, right, top: t.top, bottom: t.bottom }, null, stroke, thin));
  const style = tableStyle(ctx, 14, ROLE.XLabel);
  const colW = (right - t.frameLeft) / Math.max(1, rows);
  const rowTop = (i: number) => t.top - i * t.pitch - (t.pitch - t.rowH) / 2;
  for (let r = 0; r < rows; r++) {
    const x0 = t.frameLeft + r * colW;
    series.forEach((s, i) => {
      const v = data.values.get(s.index)?.get(r);
      if (v === undefined) return;
      const lab = label(ctx, tableValue(v), style);
      out.push(...drawCentred(ctx, lab, x0 + colW / 2 - lab.width / 2, rowTop(i)));
    });
  }
  // Grid 3 and 4 (Both, None in menu order [I]) are not shown by any copy; drawn as 1 [?].
  if (opts.tableGrid === 2) {
    for (let i = 1; i <= series.length; i++) {
      const y = t.top - i * t.pitch;
      out.push(...line([{ x: t.left, y }, { x: right, y }], stroke, thin));
    }
  } else {
    for (let r = 0; r <= rows; r++) {
      const x = t.frameLeft + r * colW;
      out.push(...line([{ x, y: t.bottom }, { x, y: t.top }], stroke, thin));
    }
  }
  const outline = ctx.color(opts.outlineRole);
  series.forEach((s, i) => {
    const top = rowTop(i);
    const n = t.names[i]!;
    out.push(...drawLabel(ctx, n, t.nameLeft, top));
    if (!t.swatches) return;
    const sw = XY_LEGEND_SWATCH * t.rowH;
    const sl = t.frameLeft - XY_LEGEND_GAP * t.rowH - sw;
    const st = top - (t.rowH - sw) / 2;
    out.push(...swatchFor(ctx, opts, s, { left: sl, right: sl + sw, top: st, bottom: st - sw }, outline, thin));
  });
  out.push(...line([{ x: t.swatches ? t.left : t.frameLeft, y: t.bottom }, { x: t.swatches ? t.left : t.frameLeft, y: t.top }], stroke, thin));
  return out;
}

export function drawTable(l: Layout, t: TableLayout, series: XySeries[]): SceneElement[] {
  return tableBody(l.ctx, l.opts, l.data, t, series, l.outer.right, l.rows);
}

export function drawTableOnly(ctx: ChartSceneContext, opts: XyOptions, data: XyData, t: TableLayout, series: XySeries[], plot: Box): SceneElement[] {
  return tableBody(ctx, opts, data, t, series, plot.right, data.rowCount);
}
