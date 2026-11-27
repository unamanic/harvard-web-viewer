/**
 * Bar/line, area and high/low/close charts (SPEC §2.3, §4.3). Layout is the
 * viewer's own: the files hold the options, not the drawing.
 */
import type { Point, SceneElement, TextAnchor } from "../../model/scene";
import { shadeCss } from "../../model/color";
import { DEFAULT_SIZES, classicColor, sizeToUnits } from "./assumptions";
import type { AxisScale, ClassicChart, ClassicSeries, ClassicVersion, ClassicText, GraphData, GridStyle, LabelFormat } from "./model";
import { drawLine, hasText, plainText, textWidth } from "./text";

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Scale {
  min: number;
  max: number;
  step: number;
  log: boolean;
}

/** A 1-2-5 step giving about `ticks` intervals. */
export function niceStep(range: number, ticks: number): number {
  if (!(range > 0)) return 1;
  const raw = range / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const f = raw / mag;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * mag;
}

/**
 * A value axis over the values (and 0 when asked), with the chart's set minimum, maximum and step where given.
 *
 * Both programs pick an automatic step that gives about eight intervals. 2.x then ends the axis at the
 * first step at or above the data; 1.0 (A.00) always draws exactly eight steps from the minimum. A.00
 * also ignores a stored range that does not hold the data (its own story charts save 0 to 8 and draw 0 to 16).
 */
export function makeScale(values: number[], axis: AxisScale, includeZero: boolean, version: ClassicVersion = "2.30"): Scale {
  const finite = values.filter((v) => Number.isFinite(v));
  if (axis.log) {
    const pos = finite.filter((v) => v > 0);
    const lo = axis.min && axis.min > 0 ? axis.min : 10 ** Math.floor(Math.log10(Math.min(...pos, 1)));
    const hi = axis.max && axis.max > lo ? axis.max : 10 ** Math.ceil(Math.log10(Math.max(...pos, lo * 10)));
    return { min: lo, max: hi, step: 10, log: true };
  }
  let lo = Math.min(...finite, includeZero ? 0 : Number.POSITIVE_INFINITY);
  let hi = Math.max(...finite, includeZero ? 0 : Number.NEGATIVE_INFINITY);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
    lo = 0;
    hi = 1;
  }
  if (lo === hi) hi = lo + 1;
  if (version === "1.0" && axis.max !== null && axis.max !== undefined && axis.max < hi) {
    axis = { ...axis, min: null, max: null, increment: null };
  }
  const step = axis.increment && axis.increment > 0 ? axis.increment : niceStep(hi - lo, 8);
  const min = axis.min ?? Math.floor(lo / step) * step;
  let max = axis.max ?? (version === "1.0" ? min + 8 * step : Math.ceil(hi / step) * step);
  if (max <= min) max = min + step;
  return { min, max, step, log: false };
}

/** Tick values: every step, or each decade on a log axis. */
export function ticksOf(s: Scale): number[] {
  const out: number[] = [];
  if (s.log) {
    for (let v = s.min; v <= s.max * 1.0001 && out.length < 40; v *= 10) out.push(v);
    return out;
  }
  const count = Math.round((s.max - s.min) / s.step);
  if (count > 200) return [s.min, s.max];
  for (let k = 0; k <= count; k++) out.push(s.min + k * s.step);
  return out;
}

function fraction(s: Scale, v: number): number {
  const t = s.log ? (Math.log10(Math.max(v, 1e-300)) - Math.log10(s.min)) / (Math.log10(s.max) - Math.log10(s.min)) : (v - s.min) / (s.max - s.min);
  return Math.max(0, Math.min(1, t));
}

export function formatValue(v: number, format: LabelFormat): string {
  if (format === "none") return "";
  const text = Math.abs(v) >= 1e9 || (Math.abs(v) < 1e-3 && v !== 0) ? v.toPrecision(3) : String(Math.round(v * 100) / 100);
  return format === "currency" ? `$${text}` : format === "percent" ? `${text}%` : text;
}

function textSize(line: ClassicText | null, fallback: number): number {
  return sizeToUnits(line && line.size > 0 ? line.size : fallback);
}

function gridColor(style: GridStyle): string {
  return style === "solid" ? classicColor(1) : classicColor(15);
}

const LINE_WIDTH = 60;

function line(a: Point, b: Point, stroke: string, strokeWidth = LINE_WIDTH): SceneElement {
  return { kind: "path", points: [a, b], closed: false, fill: null, stroke, strokeWidth };
}

function rectFrom(a: Point, b: Point, fill: string | null, stroke: string | null = null): SceneElement {
  return { kind: "rect", x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y), fill, stroke };
}

/** A marker shape for marker number n, centred on p. */
function marker(n: number, p: Point, size: number, color: string): SceneElement {
  const r = size / 2;
  switch (((n - 1) % 6 + 6) % 6) {
    case 0:
      return { kind: "rect", x: p.x - r, y: p.y - r, width: size, height: size, fill: color, stroke: null };
    case 1:
      return { kind: "path", points: [{ x: p.x, y: p.y - r }, { x: p.x + r, y: p.y }, { x: p.x, y: p.y + r }, { x: p.x - r, y: p.y }], closed: true, fill: color, stroke: null };
    case 2:
      return { kind: "path", points: [{ x: p.x, y: p.y - r }, { x: p.x + r, y: p.y + r }, { x: p.x - r, y: p.y + r }], closed: true, fill: color, stroke: null };
    case 3:
      return { kind: "ellipse", cx: p.x, cy: p.y, rx: r, ry: r, fill: color, stroke: null };
    case 4:
      return {
        kind: "group",
        children: [line({ x: p.x - r, y: p.y - r }, { x: p.x + r, y: p.y + r }, color), line({ x: p.x - r, y: p.y + r }, { x: p.x + r, y: p.y - r }, color)],
      };
    default:
      return { kind: "group", children: [line({ x: p.x - r, y: p.y }, { x: p.x + r, y: p.y }, color), line({ x: p.x, y: p.y - r }, { x: p.x, y: p.y + r }, color)] };
  }
}

function strokeWidthOf(lineStyle: number): number {
  return lineStyle === 2 ? LINE_WIDTH * 2.5 : lineStyle === 3 || lineStyle === 4 ? LINE_WIDTH * 0.6 : LINE_WIDTH;
}

/** A rotated group holding one text element (for Y axis titles and vertical X labels). */
function rotated(children: SceneElement[], x: number, y: number): SceneElement {
  return { kind: "group", transform: [0, -1, 1, 0, x, y], children };
}

function cumulative(values: (number | null)[]): (number | null)[] {
  let sum = 0;
  return values.map((v) => (v === null ? null : (sum += v)));
}

interface Prepared {
  series: ClassicSeries;
  values: (number | null)[];
  /** Base of each point when stacked (0 otherwise). */
  base: number[];
}

/** Series values after the cumulative option and 100 %, with each point's base where bars (Stack, 100 %) or areas stack. */
function prepareValues(shown: ClassicSeries[], n: number, o: GraphData["options"]): { prepared: Prepared[]; stackBars: boolean } {
  const prepared: Prepared[] = shown.map((s) => ({ series: s, values: s.cumulative ? cumulative(s.values) : [...s.values], base: new Array(n).fill(0) }));
  const stackBars = o.barStyle === "stack" || o.barStyle === "100%";
  if (o.barStyle === "100%") {
    for (let p = 0; p < n; p++) {
      const bars = prepared.filter((q) => q.series.type === "bar");
      const total = bars.reduce((sum, q) => sum + Math.abs(q.values[p] ?? 0), 0);
      for (const q of bars) if (q.values[p] !== null && total > 0) q.values[p] = (100 * Math.abs(q.values[p] as number)) / total;
    }
  }
  for (const group of [stackBars ? "bar" : null, "area"]) {
    if (!group) continue;
    const members = prepared.filter((q) => q.series.type === group);
    for (const axis of [1, 2]) {
      const running = new Array(n).fill(0);
      for (const q of members.filter((m) => m.series.axis === axis)) {
        for (let p = 0; p < n; p++) {
          q.base[p] = running[p];
          running[p] += q.values[p] ?? 0;
        }
      }
    }
  }
  return { prepared, stackBars };
}

/**
 * Everything the parts of a graph chart are drawn from: the series values
 * (cumulative, stacked, 100 %), the value scales, the plot box left after
 * the legend, titles, labels and data table, and the sizes used. Null
 * when no series has data.
 */
function layoutGraph(chart: ClassicChart, graph: GraphData, area: Box, warnings: string[]) {
  const o = graph.options;
  const n = Math.max(1, graph.pointCount);
  const isHlc = chart.kind === "hlc";
  const shown = graph.series.filter((s) => s.display && s.values.some((v) => v !== null));
  if (shown.length === 0) return null;

  const { prepared, stackBars } = prepareValues(shown, n, o);

  // Scales.
  const usesY2 = prepared.some((q) => q.series.axis === 2);
  const collect = (axis: number) => {
    const vals: number[] = [];
    for (const q of prepared.filter((m) => m.series.axis === axis || (axis === 1 && isHlc))) {
      for (let p = 0; p < n; p++) {
        const v = q.values[p];
        if (v === null) continue;
        vals.push(q.base[p] + v, q.base[p]);
      }
    }
    return vals;
  };
  const includeZero = !isHlc && prepared.some((q) => q.series.type === "bar" || q.series.type === "area");
  const y1 = makeScale(collect(1), o.y1, includeZero, chart.version);
  const y2 = usesY2 ? makeScale(collect(2), o.y2, includeZero, chart.version) : y1;
  const scaleOf = (axis: number) => (axis === 2 ? y2 : y1);

  // Space for the legend, axis titles and labels.
  const labelSize = sizeToUnits(DEFAULT_SIZES.axisLabel);
  const legendSize = sizeToUnits(DEFAULT_SIZES.legend);
  const plot: Box = { ...area };
  const legendEntries = isHlc ? [] : prepared.map((q) => q.series).filter((s) => s.name.trim() !== "");
  const swatch = legendSize * 0.8;
  const entryWidth = (s: ClassicSeries) => swatch * 1.5 + textWidth(s.name, legendSize) + legendSize;
  const legendRowWidth = legendEntries.reduce((w, s) => w + entryWidth(s), 0);
  const legendColumnWidth = Math.max(0, ...legendEntries.map(entryWidth));
  const legend = legendEntries.length > 0 ? o.legendLocation : "none";
  if (!o.legendInside) {
    if (legend === "top") plot.top += legendSize * 2;
    else if (legend === "bottom") plot.bottom -= legendSize * 2;
    else if (legend === "left") plot.left += legendColumnWidth;
    else if (legend === "right") plot.right -= legendColumnWidth;
  }

  const xTitleSize = textSize(chart.xAxisTitle, DEFAULT_SIZES.axisTitle);
  const y1TitleSize = textSize(chart.y1AxisTitle, DEFAULT_SIZES.axisTitle);
  const y2TitleSize = textSize(chart.y2AxisTitle, DEFAULT_SIZES.axisTitle);
  const catTitle = hasText(chart.xAxisTitle) ? chart.xAxisTitle : null;
  const valTitle = hasText(chart.y1AxisTitle) ? chart.y1AxisTitle : null;
  const val2Title = usesY2 && hasText(chart.y2AxisTitle) ? chart.y2AxisTitle : null;

  const valueLabelText = (s: Scale, format: LabelFormat) => ticksOf(s).map((v) => formatValue(v, format));
  const y1Labels = valueLabelText(y1, o.y1Labels);
  const y2Labels = usesY2 ? valueLabelText(y2, o.y2Labels) : [];
  const maxChars = (list: string[]) => Math.max(0, ...list.map((t) => t.length));
  const catLabels = o.xLabels === "none" ? [] : graph.xLabels;
  const verticalCat = o.xLabels === "vertical";

  // Data table under the chart: one row per series (2.x tag 120 [45]); not with horizontal bars.
  const tableSeries = o.dataTable !== "none" && !o.horizontal && !isHlc ? prepared.map((q) => q.series) : [];
  const tableRowH = labelSize * 1.4;
  const tableNameWidth = Math.max(0, ...tableSeries.map((s) => textWidth(s.name, labelSize))) + labelSize;
  if (!o.horizontal) {
    if (tableSeries.length > 0) {
      plot.bottom -= tableSeries.length * tableRowH;
      plot.left = Math.max(plot.left, area.left + tableNameWidth + (valTitle ? y1TitleSize * 1.6 : 0));
    }
    if (catTitle) plot.bottom -= xTitleSize * 1.6;
    // 1.0 and 2.x set the Y1 title flat over the top of the value axis, not turned up the side.
    if (valTitle) plot.top += y1TitleSize * 1.4;
    if (val2Title) plot.right -= y2TitleSize * 1.6;
    if (catLabels.length > 0) plot.bottom -= verticalCat ? textWidth("M".repeat(maxChars(catLabels)), labelSize) + labelSize : labelSize * 1.8;
    plot.left += textWidth("M".repeat(maxChars(y1Labels)), labelSize) + labelSize * 0.6;
    if (usesY2) plot.right -= textWidth("M".repeat(maxChars(y2Labels)), labelSize) + labelSize * 0.6;
    else plot.right -= labelSize;
    plot.top += labelSize * 0.8;
  } else {
    if (catTitle) plot.left += xTitleSize * 1.6;
    if (valTitle) plot.bottom -= y1TitleSize * 1.6;
    if (val2Title) plot.top += y2TitleSize * 1.6;
    plot.left += textWidth("M".repeat(maxChars(catLabels)), labelSize) + labelSize * 0.6;
    plot.bottom -= labelSize * 1.8;
    if (usesY2) plot.top += labelSize * 1.8;
    else plot.top += labelSize * 0.8;
    plot.right -= textWidth("M".repeat(Math.max(1, maxChars(y1Labels))), labelSize) / 2 + labelSize;
  }
  if (plot.right - plot.left < 2000 || plot.bottom - plot.top < 2000) {
    warnings.push("The chart's labels leave little room for the plot; it is drawn small.");
    plot.right = Math.max(plot.right, plot.left + 2000);
    plot.bottom = Math.max(plot.bottom, plot.top + 2000);
  }
  const plotW = plot.right - plot.left;
  const plotH = plot.bottom - plot.top;

  // Category position c in [0, n], value v on an axis -> point.
  const pt = (c: number, v: number, axis: number): Point => {
    const t = fraction(scaleOf(axis), v);
    return o.horizontal ? { x: plot.left + t * plotW, y: plot.top + (c / n) * plotH } : { x: plot.left + (c / n) * plotW, y: plot.bottom - t * plotH };
  };
  const catWidth = (o.horizontal ? plotH : plotW) / n;

  // Series.
  const enh = o.enhancement;
  const depth = enh === "3d" ? catWidth * Math.max(0.1, Math.min(o.depth, 1)) * 0.5 : 0;
  const valueLabelFor = (s: ClassicSeries) => o.valueLabels === "all" || (o.valueLabels === "select" && s.valueLabels);
  const valueLabelSize = sizeToUnits(DEFAULT_SIZES.valueLabel);
  const axisFormat = (s: ClassicSeries) => (s.axis === 2 ? o.y2Labels : o.y1Labels) === "currency" ? "currency" : o.barStyle === "100%" ? "percent" : "value";
  return {
    graph, area, o, n, isHlc, prepared, stackBars, usesY2, y1, y2, scaleOf, labelSize, legendSize, plot,
    legendEntries, swatch, entryWidth, legendRowWidth, legendColumnWidth, legend, xTitleSize, y1TitleSize,
    y2TitleSize, catTitle, valTitle, val2Title, y1Labels, y2Labels, maxChars, catLabels, verticalCat,
    tableSeries, tableRowH, tableNameWidth, plotW, plotH, pt, catWidth, enh, depth, valueLabelFor,
    valueLabelSize, axisFormat,
  };
}

type GraphLayout = NonNullable<ReturnType<typeof layoutGraph>>;

/** The plot background (2.x tag 120 byte 14). */
function drawPlotBackground(g: GraphLayout): SceneElement[] {
  const { o, plot, plotW, plotH } = g;
  const out: SceneElement[] = [];
  if (o.frameBackground > 0) out.push({ kind: "rect", x: plot.left, y: plot.top, width: plotW, height: plotH, fill: classicColor(o.frameBackground), stroke: null });
  return out;
}

/** Value axis grid lines and labels, and the category grid. */
function drawValueAxes(g: GraphLayout): SceneElement[] {
  const { o, n, usesY2, y1, y2, labelSize, plot, y1Labels, y2Labels, pt } = g;
  const out: SceneElement[] = [];
  // Grid and value labels.
  const drawValueAxis = (s: Scale, labels: string[], grid: GridStyle, axis: number, far: boolean) => {
    ticksOf(s).forEach((v, k) => {
      const a = pt(0, v, axis);
      const b = pt(n, v, axis);
      if (grid !== "none" && !far) out.push(line(a, b, gridColor(grid), grid === "solid" ? 30 : 20));
      const text = labels[k];
      if (!text) return;
      if (!o.horizontal) {
        const x = far ? plot.right + labelSize * 0.4 : plot.left - labelSize * 0.4;
        out.push(plainText(text, x, a.y + labelSize * 0.35, labelSize, classicColor(1), far ? "start" : "end"));
      } else {
        const y = far ? plot.top - labelSize * 0.5 : plot.bottom + labelSize * 1.2;
        out.push(plainText(text, a.x, y, labelSize, classicColor(1), "middle"));
      }
    });
  };
  drawValueAxis(y1, y1Labels, o.gridY1, 1, false);
  if (usesY2) drawValueAxis(y2, y2Labels, o.gridY2, 2, true);
  if (o.gridX !== "none") {
    for (let p = 0; p < n; p++) out.push(line(pt(p + 0.5, y1.min, 1), pt(p + 0.5, y1.max, 1), gridColor(o.gridX), 20));
  }
  return out;
}

/** Category (X) labels. */
function drawCategoryLabels(g: GraphLayout): SceneElement[] {
  const { o, y1, labelSize, plot, catLabels, verticalCat, pt } = g;
  const out: SceneElement[] = [];
  // Category labels.
  catLabels.forEach((label, p) => {
    if (!label.trim()) return;
    const c = pt(p + 0.5, y1.min, 1);
    if (o.horizontal) {
      out.push(plainText(label, plot.left - labelSize * 0.4, c.y + labelSize * 0.35, labelSize, classicColor(1), "end"));
    } else if (verticalCat) {
      out.push(rotated([plainText(label, 0, 0, labelSize, classicColor(1), "end")], c.x + labelSize * 0.35, plot.bottom + labelSize * 0.4));
    } else {
      out.push(plainText(label, c.x, plot.bottom + labelSize * 1.2, labelSize, classicColor(1), "middle", 400, false));
    }
  });
  return out;
}

/** High/low/close series: a bar from low to high, ticks for close and open. */
function drawHighLow(g: GraphLayout): SceneElement[] {
  const { graph, o, n, pt, catWidth } = g;
  const out: SceneElement[] = [];
  const [hi, lo, close, open] = [0, 1, 2, 3].map((k) => graph.series[k]);
  const color = classicColor(hi?.color ?? 2);
  const tick = catWidth * 0.2;
  for (let p = 0; p < n; p++) {
    const h = hi?.values[p] ?? null;
    const l = lo?.values[p] ?? null;
    if (h !== null && l !== null) out.push(line(pt(p + 0.5, l, 1), pt(p + 0.5, h, 1), color, LINE_WIDTH * 1.5));
    const c = close?.display ? (close.values[p] ?? null) : null;
    if (c !== null) {
      const a = pt(p + 0.5, c, 1);
      out.push(line(a, o.horizontal ? { x: a.x, y: a.y + tick } : { x: a.x + tick, y: a.y }, color, LINE_WIDTH * 1.5));
    }
    const op = open?.display ? (open.values[p] ?? null) : null;
    if (op !== null) {
      const a = pt(p + 0.5, op, 1);
      out.push(line(a, o.horizontal ? { x: a.x, y: a.y - tick } : { x: a.x - tick, y: a.y }, color, LINE_WIDTH * 1.5));
    }
  }
  return out;
}

/** Area series: stacked polygons through the category centres. */
function drawAreas(g: GraphLayout): SceneElement[] {
  const { n, prepared, pt } = g;
  const out: SceneElement[] = [];
  for (const q of prepared.filter((m) => m.series.type === "area")) {
    const color = classicColor(q.series.color);
    const top: Point[] = [];
    const bottom: Point[] = [];
    for (let p = 0; p < n; p++) {
      const v = q.values[p] ?? 0;
      top.push(pt(p + 0.5, q.base[p] + v, q.series.axis));
      bottom.push(pt(p + 0.5, q.base[p], q.series.axis));
    }
    if (n === 1) {
      top.unshift(pt(0, q.base[0] + (q.values[0] ?? 0), q.series.axis));
      bottom.unshift(pt(0, q.base[0], q.series.axis));
    }
    out.push({ kind: "path", points: [...top, ...bottom.reverse()], closed: true, fill: color, stroke: null });
  }
  return out;
}

/** Bar series: clustered, overlapped or stacked, with shadows, 3-D sides and value labels. */
function drawBars(g: GraphLayout): SceneElement[] {
  const { o, n, prepared, stackBars, scaleOf, pt, catWidth, enh, depth, valueLabelFor, valueLabelSize, axisFormat } = g;
  const out: SceneElement[] = [];
  // Bars.
  const bars = prepared.filter((m) => m.series.type === "bar");
  const nb = bars.length;
  const widthFraction = o.barWidth !== null && o.barWidth > 0 && o.barWidth <= 1 ? o.barWidth : o.barStyle === "step" ? 1 : 0.7;
  const groupWidth = widthFraction * n > 0 ? widthFraction : 0.7;
  bars.forEach((q, k) => {
    const color = classicColor(q.series.color);
    let w: number;
    let offset: number;
    if (stackBars || nb === 0) {
      w = groupWidth;
      offset = (1 - w) / 2;
    } else if (o.barStyle === "overlap") {
      const ov = Math.max(0, Math.min(0.9, o.overlap));
      w = groupWidth / (1 + (nb - 1) * (1 - ov));
      offset = (1 - groupWidth) / 2 + k * w * (1 - ov);
    } else {
      w = groupWidth / nb;
      offset = (1 - groupWidth) / 2 + k * w;
    }
    for (let p = 0; p < n; p++) {
      const v = q.values[p];
      if (v === null) continue;
      const base = q.base[p];
      const scale = scaleOf(q.series.axis);
      const a = pt(p + offset, scale.log ? Math.max(base, scale.min) : base, q.series.axis);
      const b = pt(p + offset + w, base + v, q.series.axis);
      if (enh === "shadow") {
        const d = catWidth * w * 0.15;
        out.push(rectFrom({ x: a.x + d, y: a.y + d }, { x: b.x + d, y: b.y + d }, classicColor(15)));
      }
      out.push(rectFrom(a, b, color));
      if (depth > 0) {
        const x0 = Math.min(a.x, b.x);
        const x1 = Math.max(a.x, b.x);
        const y0 = Math.min(a.y, b.y);
        const y1p = Math.max(a.y, b.y);
        const dx = depth;
        const dy = -depth;
        out.push({ kind: "path", points: [{ x: x0, y: y0 }, { x: x0 + dx, y: y0 + dy }, { x: x1 + dx, y: y0 + dy }, { x: x1, y: y0 }], closed: true, fill: shadeCss(color, 0.8), stroke: null });
        out.push({ kind: "path", points: [{ x: x1, y: y0 }, { x: x1 + dx, y: y0 + dy }, { x: x1 + dx, y: y1p + dy }, { x: x1, y: y1p }], closed: true, fill: shadeCss(color, 0.55), stroke: null });
      }
      if (valueLabelFor(q.series)) {
        const tip = pt(p + offset + w / 2, base + v, q.series.axis);
        const text = formatValue(v, axisFormat(q.series));
        if (o.horizontal) out.push(plainText(text, tip.x + valueLabelSize * 0.3, tip.y + valueLabelSize * 0.35, valueLabelSize, classicColor(1), "start"));
        else out.push(plainText(text, tip.x, tip.y - valueLabelSize * 0.4, valueLabelSize, classicColor(1), "middle"));
      }
    }
  });
  return out;
}

/** Line, trend, curve and point series, with markers and value labels. */
function drawLines(g: GraphLayout): SceneElement[] {
  const { o, n, prepared, labelSize, plot, pt, enh, valueLabelFor, valueLabelSize, axisFormat } = g;
  const out: SceneElement[] = [];
  // Lines, trends, curves and points.
  for (const q of prepared.filter((m) => m.series.type !== "bar" && m.series.type !== "area")) {
    const s = q.series;
    const color = classicColor(s.color);
    const strokeWidth = strokeWidthOf(s.lineStyle);
    const points: (Point | null)[] = q.values.map((v, p) => (v === null ? null : pt(p + 0.5, q.base[p] + v, s.axis)));
    if (s.type === "trend") {
      const xs: number[] = [];
      const ys: number[] = [];
      q.values.forEach((v, p) => {
        if (v !== null) {
          xs.push(p);
          ys.push(v);
        }
      });
      if (xs.length >= 2) {
        const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
        const my = ys.reduce((a, b) => a + b, 0) / ys.length;
        const sxx = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
        const slope = sxx > 0 ? xs.reduce((a, x, k) => a + (x - mx) * (ys[k] - my), 0) / sxx : 0;
        const at = (x: number) => my + slope * (x - mx);
        out.push({ kind: "path", points: [pt(0.5, at(0), s.axis), pt(n - 0.5, at(n - 1), s.axis)], closed: false, fill: null, stroke: color, strokeWidth });
      }
    } else if (s.type !== "point") {
      let run: Point[] = [];
      const flush = () => {
        if (run.length >= 2) {
          if (enh === "area") {
            const base = run.map((p) => (o.horizontal ? { x: plot.left, y: p.y } : { x: p.x, y: plot.bottom }));
            out.push({ kind: "path", points: [...run, ...base.reverse()], closed: true, fill: shadeCss(color, 0.6), stroke: null });
          }
          out.push({ kind: "path", points: run, closed: false, smooth: s.type === "curve", fill: null, stroke: color, strokeWidth });
        }
        run = [];
      };
      for (const p of points) {
        if (p) run.push(p);
        else flush();
      }
      flush();
    }
    if (s.type !== "trend" && (s.type === "point" || s.marker > 0)) {
      for (const p of points) if (p) out.push(marker(s.marker || s.index, p, labelSize * 0.6, color));
    }
    if (valueLabelFor(s)) {
      q.values.forEach((v, p) => {
        const at = points[p];
        if (v === null || !at) return;
        out.push(plainText(formatValue(v, axisFormat(s)), at.x, at.y - valueLabelSize * 0.6, valueLabelSize, classicColor(1), "middle"));
      });
    }
  }
  return out;
}

/** The frame, drawn over the data as an axis would be. */
function drawFrame(g: GraphLayout): SceneElement[] {
  const { o, plot, plotW, plotH } = g;
  const out: SceneElement[] = [];
  // Frame (drawn over the data, as an axis would be).
  const frameColor = classicColor(o.frameColor);
  const corners = {
    tl: { x: plot.left, y: plot.top },
    tr: { x: plot.right, y: plot.top },
    bl: { x: plot.left, y: plot.bottom },
    br: { x: plot.right, y: plot.bottom },
  };
  if (o.frame === "full") out.push({ kind: "rect", x: plot.left, y: plot.top, width: plotW, height: plotH, fill: null, stroke: frameColor, strokeWidth: LINE_WIDTH });
  else if (o.frame === "half") out.push({ kind: "path", points: [corners.tl, corners.bl, corners.br], closed: false, fill: null, stroke: frameColor, strokeWidth: LINE_WIDTH });
  else if (o.frame === "quarter") out.push(line(o.horizontal ? corners.tl : corners.bl, o.horizontal ? corners.bl : corners.br, frameColor));
  return out;
}

/** The data table under the chart. */
function drawTable(g: GraphLayout): SceneElement[] {
  const { o, n, prepared, y1, labelSize, plot, maxChars, catLabels, verticalCat, tableSeries, tableRowH, tableNameWidth, pt } = g;
  const out: SceneElement[] = [];
  // Data table.
  if (tableSeries.length > 0) {
    const top = plot.bottom + (catLabels.length > 0 ? (verticalCat ? textWidth("M".repeat(maxChars(catLabels)), labelSize) + labelSize : labelSize * 1.8) : 0);
    tableSeries.forEach((s, r) => {
      const q = prepared.find((p) => p.series === s);
      const baseline = top + (r + 1) * tableRowH - labelSize * 0.35;
      out.push(plainText(s.name, plot.left - labelSize * 0.5, baseline, labelSize, classicColor(s.color), "end"));
      for (let p = 0; p < n; p++) {
        const v = q?.values[p] ?? null;
        if (v === null) continue;
        out.push(plainText(formatValue(v, s.axis === 2 ? o.y2Labels : o.y1Labels) || formatValue(v, "value"), pt(p + 0.5, y1.min, 1).x, baseline, labelSize, classicColor(1), "middle"));
      }
    });
    if (o.dataTable === "framed") {
      const height = tableSeries.length * tableRowH;
      const left = plot.left - tableNameWidth;
      out.push({ kind: "rect", x: left, y: top, width: plot.right - left, height, fill: null, stroke: classicColor(1), strokeWidth: 30 });
      for (let r = 1; r < tableSeries.length; r++) out.push(line({ x: left, y: top + r * tableRowH }, { x: plot.right, y: top + r * tableRowH }, classicColor(1), 20));
      for (let p = 0; p <= n; p++) out.push(line(pt(p, y1.min, 1), { x: pt(p, y1.min, 1).x, y: top + height }, classicColor(1), 20));
    }
  }
  return out;
}

/** The axis titles. */
function drawAxisTitles(g: GraphLayout): SceneElement[] {
  const { area, o, legendSize, plot, legendColumnWidth, legend, xTitleSize, y1TitleSize, y2TitleSize, catTitle, valTitle, val2Title, plotW, plotH } = g;
  const out: SceneElement[] = [];
  // Axis titles.
  const midX = (plot.left + plot.right) / 2;
  const midY = (plot.top + plot.bottom) / 2;
  const leftEdge = area.left + (o.legendLocation === "left" && !o.legendInside ? legendColumnWidth : 0);
  const rightEdge = area.right - (o.legendLocation === "right" && !o.legendInside ? legendColumnWidth : 0);
  const bottomEdge = area.bottom - (legend === "bottom" && !o.legendInside ? legendSize * 2 : 0);
  const topEdge = area.top + (legend === "top" && !o.legendInside ? legendSize * 2 : 0);
  const horizontalTitle = (t: ClassicText, size: number, y: number) => out.push(...drawLine(t, { x: midX, y, size, anchor: "middle", maxWidth: plotW }));
  const verticalTitle = (t: ClassicText, size: number, x: number) => out.push(rotated(drawLine(t, { x: 0, y: 0, size, anchor: "middle", maxWidth: plotH }), x, midY));
  if (!o.horizontal) {
    if (catTitle) horizontalTitle(catTitle, xTitleSize, bottomEdge - xTitleSize * 0.4);
    if (valTitle) out.push(...drawLine(valTitle, { x: plot.left, y: plot.top - g.labelSize * 0.7, size: y1TitleSize, anchor: "start", maxWidth: plotW }));
    if (val2Title) verticalTitle(val2Title, y2TitleSize, rightEdge - y2TitleSize * 0.3);
  } else {
    if (catTitle) verticalTitle(catTitle, xTitleSize, leftEdge + xTitleSize);
    if (valTitle) horizontalTitle(valTitle, y1TitleSize, bottomEdge - y1TitleSize * 0.4);
    if (val2Title) horizontalTitle(val2Title, y2TitleSize, topEdge + y2TitleSize);
  }
  return out;
}

/** The legend. */
function drawLegend(g: GraphLayout): SceneElement[] {
  const { area, o, legendSize, plot, legendEntries, swatch, entryWidth, legendRowWidth, legendColumnWidth, legend } = g;
  const out: SceneElement[] = [];
  // Legend.
  if (legend !== "none") {
    const entry = (s: ClassicSeries, x: number, baseline: number): SceneElement[] => {
      const color = classicColor(s.color);
      const sw: SceneElement =
        s.type === "bar" || s.type === "area"
          ? { kind: "rect", x, y: baseline - swatch, width: swatch, height: swatch, fill: color, stroke: null }
          : line({ x, y: baseline - swatch / 2 }, { x: x + swatch, y: baseline - swatch / 2 }, color, strokeWidthOf(s.lineStyle));
      return [sw, plainText(s.name, x + swatch * 1.5, baseline, legendSize, classicColor(1), "start")];
    };
    const items: SceneElement[] = [];
    let box: Box;
    if (legend === "top" || legend === "bottom") {
      const width = Math.min(legendRowWidth, area.right - area.left);
      const left =
        o.legendJustify === "start" ? plot.left : o.legendJustify === "end" ? plot.right - width : (plot.left + plot.right) / 2 - width / 2;
      const baseline = o.legendInside
        ? legend === "top"
          ? plot.top + legendSize * 1.4
          : plot.bottom - legendSize * 0.6
        : legend === "top"
          ? area.top + legendSize * 1.3
          : area.bottom - legendSize * 0.5;
      let x = left;
      for (const s of legendEntries) {
        items.push(...entry(s, x, baseline));
        x += entryWidth(s);
      }
      box = { left: left - legendSize * 0.4, right: left + width, top: baseline - legendSize * 1.3, bottom: baseline + legendSize * 0.5 };
    } else {
      const height = legendEntries.length * legendSize * 1.5;
      const top =
        o.legendJustify === "start" ? plot.top : o.legendJustify === "end" ? plot.bottom - height : (plot.top + plot.bottom) / 2 - height / 2;
      const left = o.legendInside
        ? legend === "left"
          ? plot.left + legendSize * 0.5
          : plot.right - legendColumnWidth
        : legend === "left"
          ? area.left
          : area.right - legendColumnWidth + legendSize * 0.5;
      legendEntries.forEach((s, k) => items.push(...entry(s, left, top + legendSize * (1.2 + 1.5 * k))));
      box = { left: left - legendSize * 0.4, right: left + legendColumnWidth - legendSize * 0.5, top: top, bottom: top + height + legendSize * 0.3 };
    }
    if (o.legendFrame !== "none") {
      if (o.legendFrame === "shadow") {
        const d = legendSize * 0.3;
        out.push({ kind: "rect", x: box.left + d, y: box.top + d, width: box.right - box.left, height: box.bottom - box.top, fill: classicColor(15), stroke: null });
      }
      out.push({ kind: "rect", x: box.left, y: box.top, width: box.right - box.left, height: box.bottom - box.top, fill: o.legendInside || o.legendFrame === "shadow" ? "#000000" : null, stroke: classicColor(1), strokeWidth: 30 });
    }
    out.push(...items);
  }
  return out;
}

/**
 * Draws a graph chart into `area` (the space left after titles and
 * footnotes). Returns the elements.
 */
export function drawGraph(chart: ClassicChart, graph: GraphData, area: Box, warnings: string[]): SceneElement[] {
  const g = layoutGraph(chart, graph, area, warnings);
  if (!g) return [plainText("(no data)", (area.left + area.right) / 2, (area.top + area.bottom) / 2, sizeToUnits(4), classicColor(8), "middle")];
  const series = g.isHlc ? drawHighLow(g) : [...drawAreas(g), ...drawBars(g), ...drawLines(g)];
  return [
    ...drawPlotBackground(g),
    ...drawValueAxes(g),
    ...drawCategoryLabels(g),
    ...series,
    ...drawFrame(g),
    ...drawTable(g),
    ...drawAxisTitles(g),
    ...drawLegend(g),
  ];
}

export type { TextAnchor };
