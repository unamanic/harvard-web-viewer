/**
 * XY charts drawn from their data (task 17; SPEC §5.4, §5.5, §6.2).
 *
 * Fallback layout for charts without a drawn copy, fitted to the copies of
 * the 141 sample XY charts (constants and their evidence in assumptions.ts,
 * "Task 17"). In short:
 *
 * - Options: 1408 byte 0 bar style (cluster, overlap, stacked, 100 %,
 *   step, paired), byte 1 bar shape (bar, pyramid, octagon, cylinder),
 *   f32 at 2 bar width %, f32 at 6 overlap %, byte 10 area style (overlap,
 *   stacked, 100 %), byte 12 = 2 3-D, byte 13 = 4 horizontal, f32 at 15
 *   3-D bar depth % of a depth lane, f32 at 19 3-D depth % of the frame
 *   height; 1410 byte 0 = 2 a data table, byte 2 = 1 value labels. A
 *   column legend lists Stack and 100 % bars bottom-up (SPEC §5.5).
 * - 3.05 options (SPEC §5.4, checked against the drawn copies of the test
 *   charts in samples/option-tests/xy; rules marked at their constants):
 *   1402 scale type, factor, min/max, grid style, tick marks, increments,
 *   show labels and number format (xyFormat.ts); 1404/1405 axis frame;
 *   1406 show, Y axis, cumulative, data labels, data table; 1408 2D style
 *   2 shadows and outline role; 1410 table grid and table only; 1418 show
 *   and frame style. X labels come from 1426 in files saved by 3.05.
 * - The frame sits in the plot area with margins of 9 % of the plot size
 *   at the right and top and 9 % plus the widest Y1 label at the left;
 *   4.5 % plus the label height at the bottom; Y2 labels and Y axis titles
 *   take more room. In 3-D the frame's back wall is shifted up and right
 *   by the depth; values are measured on the front face.
 * - Value axes: from the data (stacked sums, 100 % for percent charts) or
 *   the 1402 minimum; step = range / 5 rounded to 1, 2 or 5 × 10^k,
 *   top = the next step above max + 3 % of the range.
 * - Bars fill the 1408 bar width of their category slot, split among the bar
 *   series (cluster), stacked, or overlapped; lines and areas run through
 *   the category centres when there are bars, else edge to edge.
 * - The legend fills its 810 area: swatch, gap, name per series.
 */
import type { SceneElement } from "../../../../model/scene";
import {
  lineWidthFor,
  textSizeToUnits,
  XY_FRAME_BOTTOM_MARGIN,
  XY_FRAME_MARGIN,
  XY_HTITLE_GAP_EM,
  XY_LABEL_GAP,
  XY_LINE_STYLE,
  XY_TITLE_GAP,
} from "../../assumptions";
import { parseXyData, type XyAxis, type XyData, type XySeries } from "../../data/xy";
import { ROLE } from "../../palette";
import type { ChartSceneContext } from "../context";
import { type Box, boxOf, lineBoxHeight, pageBox } from "./text";
import { styled } from "./textCharts";
import { drawFrame } from "./xyFrame";
import {
  at,
  AXIS_LOG,
  axisOf,
  dataRange,
  drawLabel,
  isBar,
  isHighLow,
  type Label,
  label,
  type Layout,
  NUMERIC_X,
  rowAt,
  rowsOf,
  shift,
  tableStyle,
  TICK_BOTH,
  TICK_OUT,
  ticksOf,
  valueAt,
  XY_TABLE_GAP,
  XY_TICK_OUT_SHIFT,
  xyTextWidth,
} from "./xyLayout";
import { drawLegend } from "./xyLegend";
import { xyOptions } from "./xyOptions";
import { autoScale, type AxisScale, logScale, niceStep, tickLabel, tickValues } from "./xyScale";
import { drawSeries, seriesGroups } from "./xySeries";
import { drawTable, drawTableOnly, listedBottomUp, tableLayout } from "./xyTable";

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/** Series values with cumulative series (1406 byte 4) replaced by their running sums over the rows (XS6CU) [C]. */
export function withCumulative(data: XyData): XyData {
  if (!data.series.some((s) => s.cumulative)) return data;
  const values = new Map(data.values);
  for (const s of data.series) {
    const m = data.values.get(s.index);
    if (!s.cumulative || !m) continue;
    let acc = 0;
    const out = new Map<number, number>();
    for (const [r, v] of [...m].sort((a, b) => a[0] - b[0])) out.set(r, (acc += v));
    values.set(s.index, out);
  }
  return { ...data, values };
}

export function drawXYChart(ctx: ChartSceneContext): SceneElement[] {
  const data = withCumulative(parseXyData(ctx.chart, []));
  const opts = xyOptions(data);
  const withData = data.series.filter((s) => (data.values.get(s.index)?.size ?? 0) > 0);
  // Hidden series (1406 byte 1 = 2) are left out everywhere but keep their legend row (XS6SH) [C].
  const series = withData.filter((s) => s.show);
  if (series.length === 0 || data.rowCount === 0) return [];
  const plot = ctx.chart.areas.plot ? boxOf(ctx.chart.areas.plot) : pageBox(ctx);
  const W = plot.right - plot.left;
  const H = plot.top - plot.bottom;
  const xAxis = axisOf(data, 0);
  const y1Axis = axisOf(data, 1);
  const y2Axis = axisOf(data, 2);
  const tableSeriesAll = series.filter((s) => s.dataTable);
  // The data table lists the series bottom-up when the legend would (see listedBottomUp) [I].
  const tableSeries = listedBottomUp(opts) ? [...tableSeriesAll].reverse() : tableSeriesAll;
  // Without a legend the data table carries the series swatches (XLEGNO vs XREV7; every sample table) [C].
  const legendShown = opts.legendShow && !!ctx.chart.areas.legend;
  const swatches = !opts.legendShow;

  if (opts.tableOnly) {
    // Table only: no chart; the table fills the plot area (XDTONLY) [C].
    const t = tableLayout(ctx, tableSeries, plot, H, swatches, true);
    return drawTableOnly(ctx, opts, data, t, tableSeries, plot);
  }

  // Value axes.
  const onY2 = series.filter((s) => s.axis === 2);
  const onY1 = series.filter((s) => s.axis !== 2);
  const scaleFor = (list: XySeries[], index: number): AxisScale | null => {
    if (!list.length) return null;
    const r = dataRange(data, opts, list);
    if (r.percent) return { min: 0, max: 100, step: 25, percent: true };
    const a = axisOf(data, index);
    if (a?.scaleType === AXIS_LOG) return logScale(r.min, r.max);
    const sc = autoScale(r.min, r.max, a?.minimum ?? null, a?.maximum ?? null);
    // A set major increment changes the tick step, not the range (XMAJI10: 0..35 labelled 0, 10, 20, 30) [C].
    const inc = a?.increment ?? null;
    if (inc !== null && inc > 0 && (sc.max - sc.min) / inc <= 1000) sc.step = inc;
    return sc;
  };
  // A numeric X axis (1414 byte 0 = 13): rows sit at their X label's value on a scale like a value axis [I].
  const xNumbers = new Map<number, number>();
  if (data.raw1414?.[0] === NUMERIC_X) {
    for (const x of data.xLabels) {
      const n = Number(x.label.trim());
      if (x.label.trim() && Number.isFinite(n)) xNumbers.set(x.row, n);
    }
  }
  // With bars it is rounded like a value axis (GALD371: 1..28 gives 0..30); otherwise it runs from the first
  // to the last value with ticks every step from the first (GALD461: 1, 6 .. 26; GALD481: 0, 2 .. 10 of 0..11) [I].
  const xMin = Math.min(...xNumbers.values());
  const xMax = Math.max(...xNumbers.values());
  const xScale = !xNumbers.size
    ? null
    : series.some(isBar)
      ? autoScale(xMin, xMax, null, null)
      : { min: xMin, max: xMax > xMin ? xMax : xMin + 1, step: niceStep(xMax - xMin), percent: false };
  const y1OnY2 = !onY1.length;
  const y1 = (scaleFor(onY1, 1) ?? scaleFor(onY2, 2))!;
  const y2 = onY1.length ? scaleFor(onY2, 2) : null;
  // The axis record that formats and styles the left axis (Y2's when only Y2 has series).
  const leftAxis = y1OnY2 ? y2Axis : y1Axis;

  // Labels; "Show axis labels" No (1402 byte 62) leaves them out (XLBLNO) [C].
  const y1Labels = leftAxis?.showLabels === false ? [] : tickValues(y1).map((v) => label(ctx, tickLabel(v, y1, leftAxis ?? null), tableStyle(ctx, 11, ROLE.Y1Label)));
  const y2Labels = y2 && y2Axis?.showLabels !== false ? tickValues(y2).map((v) => label(ctx, tickLabel(v, y2, y2Axis ?? null), tableStyle(ctx, 12, ROLE.Y2Label))) : [];
  const xByRow = new Map(data.xLabels.map((x) => [x.row, x.label]));
  const xStyle = tableStyle(ctx, 10, ROLE.XLabel);
  const showX = xAxis?.showLabels !== false;
  const xLabels = xScale || !showX ? [] : rowsOf(data).map((r) => label(ctx, xByRow.get(r) ?? "", xStyle));
  const xTicks = xScale && showX ? tickValues(xScale).map((v) => label(ctx, tickLabel(v, xScale), xStyle)) : [];
  // Percent labels of a 100 % axis take the width of their number only (GALD351) [I]; formatted labels
  // take their full width (XPCT) [C].
  const widthOf = (l: Label, sc: AxisScale | null) =>
    sc?.percent && l.text.endsWith("%") ? xyTextWidth(ctx, l.text.slice(0, -1), l.style.fontKey, l.style.size) : l.width;
  const maxW = (ls: Label[], sc: AxisScale | null = null) => Math.max(0, ...ls.map((l) => widthOf(l, sc)));
  const maxH = (ls: Label[]) => Math.max(0, ...ls.map((l) => l.height));

  // Axis titles (slot 3: row 0 X, 1 Y1, 2 Y2).
  const titleOf = (row: number): Label | null => {
    const t = data.axisTitles.find((x) => x.row === row && x.text.trim());
    return t ? label(ctx, t.text, styled(ctx, t)) : null;
  };
  const yTitles = [titleOf(1), titleOf(2)].filter((t): t is Label => t !== null);
  const yTitleH = maxH(yTitles);

  // Frame: the category labels go at the left in horizontal charts, the value labels at the bottom.
  const leftW = opts.horizontal ? maxW(xScale ? xTicks : xLabels) : maxW(y1Labels, y1);
  const bottomH = opts.horizontal ? maxH(y1Labels) : xLabels.length || xTicks.length ? lineBoxHeight(ctx, xStyle.size) : 0;
  // A data table (1410 byte 0 = 2) takes the bottom of the plot area: one row per series under the frame,
  // the series names in a column at its left.
  const table = opts.dataTable ? tableLayout(ctx, tableSeries, plot, H, swatches, false) : null;
  // Tick marks (2-D vertical charts): outward major ticks move the frame edge in (XMAJOUT) [I].
  const flat2d = !opts.threeD && !opts.horizontal;
  const shiftFor = (a: XyAxis | undefined) => (flat2d && (a?.majorTicks === TICK_OUT || a?.majorTicks === TICK_BOTH) ? XY_TICK_OUT_SHIFT * W : 0);
  // Horizontal charts: Y2 labels above the frame, the Y1 title under the Y1 labels and the Y2 title above
  // the Y2 labels, both centred (GALD871) [I].
  const t1 = titleOf(1);
  const t2 = titleOf(2);
  // 3.05 leaves the same gap above every table, swatches or not (XREV7, XMLEGNO, XLEGNO) [C].
  const tableBottomGap = table ? XY_TABLE_GAP : XY_FRAME_BOTTOM_MARGIN;
  const outer: Box = opts.horizontal
    ? {
        left: plot.left + XY_FRAME_MARGIN * W + leftW,
        right: plot.right - XY_FRAME_MARGIN * W,
        top: plot.top - XY_FRAME_MARGIN * H - maxH(y2Labels) - (t2?.height ?? 0),
        bottom: (table ? table.top : plot.bottom) + tableBottomGap * H + bottomH + (t1?.height ?? 0),
      }
    : {
        left: (table ? table.frameLeft : plot.left + XY_FRAME_MARGIN * W + leftW) + shiftFor(leftAxis),
        right: plot.right - XY_FRAME_MARGIN * W - maxW(y2Labels) - (y2 ? shiftFor(y2Axis) : 0),
        top: plot.top - XY_FRAME_MARGIN * H - yTitleH,
        bottom: (table ? table.top : plot.bottom) + tableBottomGap * H + bottomH,
      };
  // Horizontal "3-D" charts have no depth walls: their copies draw flat frames with drop-shadow bars
  // (0x1070 style 5), whose geometry is not decoded; they are drawn flat [?].
  const depth = opts.threeD && !opts.horizontal ? (opts.depth / 100) * (outer.top - outer.bottom) : 0;
  const frame: Box = { ...outer, right: outer.right - depth, top: outer.top - depth };
  const thin = lineWidthFor(XY_LINE_STYLE);
  const barCount = series.filter(isBar).length;
  const lanes = depth > 0 ? Math.max(1, seriesGroups(series, { ...opts, threeD: true }).length) : 1;
  const FW = frame.right - frame.left;
  const FH = frame.top - frame.bottom;
  const leftTicks = flat2d ? ticksOf(leftAxis, FW) : ticksOf(undefined, FW);
  const rightTicks = flat2d && y2 ? ticksOf(y2Axis, FW) : ticksOf(undefined, FW);
  const l: Layout = {
    ctx,
    data,
    opts,
    plot,
    outer,
    frame,
    depth,
    rows: data.rowCount,
    slots: barCount > 0 || series.some(isHighLow),
    y1,
    y2,
    thin,
    lanes,
    xScale,
    xNumbers,
    y1Axis: leftAxis,
    y2Axis,
    leftTicks,
    rightTicks,
  };

  const out: SceneElement[] = [];
  out.push(...drawFrame(l));
  out.push(...drawSeries(l, series));

  // Value labels, centred on their ticks: Y1 at the left (horizontal: below), Y2 at the right on the back plane.
  y1Labels.forEach((lab, i) => {
    const v = tickValues(y1)[i]!;
    const p = at(l, 0, valueAt(y1, v));
    if (opts.horizontal) out.push(...drawLabel(ctx, lab, p.x - lab.width / 2, frame.bottom - XY_LABEL_GAP * FW));
    else out.push(...drawLabel(ctx, lab, frame.left - XY_LABEL_GAP * FW - leftTicks.out - lab.width, p.y + lab.height / 2));
  });
  if (y2) {
    y2Labels.forEach((lab, i) => {
      const v = tickValues(y2)[i]!;
      const p = shift(at(l, 1, valueAt(y2, v)), depth);
      if (opts.horizontal) out.push(...drawLabel(ctx, lab, p.x - lab.width / 2, outer.top + XY_LABEL_GAP * FW + lab.height));
      else out.push(...drawLabel(ctx, lab, outer.right + XY_LABEL_GAP * FW + rightTicks.out, p.y + lab.height / 2));
    });
  }
  if (xScale) {
    xTicks.forEach((lab, i) => {
      const v = tickValues(xScale)[i]!;
      const p = at(l, valueAt(xScale, v), 0);
      if (opts.horizontal) out.push(...drawLabel(ctx, lab, frame.left - XY_LABEL_GAP * FH - lab.width, p.y + lab.height / 2));
      else out.push(...drawLabel(ctx, lab, p.x - lab.width / 2, frame.bottom - XY_LABEL_GAP * FH));
    });
  }
  // Category labels, every nth (1402 X offset 29).
  const every = Math.max(1, Math.round(xAxis?.increment ?? 1));
  xLabels.forEach((lab, r) => {
    if (!lab.text || r % every !== 0) return;
    const p = at(l, rowAt(l, r), 0);
    if (opts.horizontal) out.push(...drawLabel(ctx, lab, frame.left - XY_LABEL_GAP * FH - lab.width, p.y + lab.height / 2));
    else out.push(...drawLabel(ctx, lab, p.x - lab.width / 2, frame.bottom - XY_LABEL_GAP * FH));
  });
  if (opts.horizontal) {
    const cx = (frame.left + frame.right) / 2;
    const em = (t: Label) => XY_HTITLE_GAP_EM * textSizeToUnits(t.style.size, ctx.page.shortSide);
    if (t1) out.push(...drawLabel(ctx, t1, cx - t1.width / 2, frame.bottom - XY_LABEL_GAP * FW - maxH(y1Labels) - em(t1)));
    if (t2) out.push(...drawLabel(ctx, t2, cx - t2.width / 2, outer.top + XY_LABEL_GAP * FW + maxH(y2Labels) + em(t2) + t2.height));
  } else {
    // Y axis titles above the frame (Y1 at its left edge, Y2 at its right edge).
    const titleTop = outer.top + XY_TITLE_GAP * H + yTitleH;
    if (t1) out.push(...drawLabel(ctx, t1, outer.left, titleTop));
    if (t2) out.push(...drawLabel(ctx, t2, outer.right - t2.width, titleTop));
  }

  if (table) out.push(...drawTable(l, table, tableSeries));
  if (legendShown) out.push(...drawLegend(ctx, opts, withData));
  return out;
}
