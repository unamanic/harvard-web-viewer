/**
 * Harvard Presentation Graphics A.00 ("1.0") charts: the fixed 4716-byte
 * PCOK layout (docs/SPEC-HG1-HG2.md §2). Offsets below are file offsets.
 */
import { Bytes } from "./bytes";
import {
  type BarStyle,
  type ClassicChart,
  type ClassicPie,
  type ClassicSeries,
  type ClassicText,
  type FrameStyle,
  type GraphData,
  type GraphOptions,
  type GridStyle,
  type LabelFormat,
  type LegendLocation,
  type OrgData,
  type Place,
  type SeriesType,
  kindOf,
} from "./model";
import { readOrgBody } from "./org";

/** Size of the fixed block; an annotation trailer may follow (§2.6). */
export const PCOK_BLOCK_SIZE = 4716;

const TEXT_LINES = 51;
const SERIES = 8;
const POINTS = 60;

function place(code: number): Place {
  return code === 1 ? "left" : code === 3 ? "right" : "center";
}

function attrs(b: Bytes, offset: number, length: number): number[] {
  return Array.from(b.slice(offset, length));
}

/** Text chart line k (§2.2). */
function textChartLine(b: Bytes, k: number): ClassicText {
  const text = b.pstring(160 + 42 * k, 42);
  return {
    text,
    size: b.f32(4342 + 4 * k),
    place: place(b.u8(4546 + k)),
    attrs: attrs(b, 2302 + 40 * k, text.length),
  };
}

/** Graph text record r (§2.3): 0 title, 1-2 subtitle, 3-5 footnote, 6 X title, 7 Y title, 8-9 pie titles. */
function graphText(b: Bytes, r: number): ClassicText {
  const o = 160 + 90 * r;
  const text = b.pstring(o, 42);
  return { text, size: b.f32(o + 82), place: place(b.u16(o + 88)), attrs: attrs(b, o + 42, text.length) };
}

const SERIES_TYPES: readonly SeriesType[] = ["bar", "line", "trend", "curve", "point"];
const BAR_STYLES: readonly BarStyle[] = ["cluster", "overlap", "stack", "100%"];
const LEGEND_LOCATIONS: readonly LegendLocation[] = ["top", "bottom", "left", "right", "none"];
const FRAMES: readonly FrameStyle[] = ["full", "half", "quarter", "none"];
const LABEL_FORMATS: readonly LabelFormat[] = ["value", "currency", "percent", "none"];

function pick<T>(list: readonly T[], code: number, fallback: T): T {
  return list[code - 1] ?? fallback;
}

function readGraphOptions(b: Bytes): GraphOptions {
  // Grid (4654): 1 dotted, 2 solid, 3 vertical, 4 cross, 5 none. Which lines
  // "vertical" and "cross" draw is [I]: vertical = X grid only, cross = both.
  const grid = b.u8(4654);
  const gridY: GridStyle = grid === 1 || grid === 4 ? "dotted" : grid === 2 ? "solid" : "none";
  const gridX: GridStyle = grid === 3 || grid === 4 ? "dotted" : "none";
  const justify = b.u8(4655);
  const scale = (o: number) => ({ min: b.value(o), max: b.value(o + 4), increment: b.value(o + 8), log: false });
  return {
    valueLabels: b.u8(4650) === 1 ? "all" : "none",
    horizontal: b.u8(4651) === 1,
    fill: b.u8(4652) || 1,
    barStyle: pick(BAR_STYLES, b.u8(4653), "cluster"),
    enhancement: b.u8(4664) === 1 ? "3d" : "none",
    legendLocation: pick(LEGEND_LOCATIONS, b.u8(4656), "bottom"),
    legendJustify: justify === 1 ? "start" : justify === 3 ? "end" : "center",
    legendInside: false,
    legendFrame: "none",
    frame: pick(FRAMES, b.u8(4657), "full"),
    frameColor: 1,
    frameBackground: 0,
    dataTable: "none",
    gridX,
    gridY1: gridY,
    gridY2: "none",
    xLabels: "normal",
    y1Labels: pick(LABEL_FORMATS, b.u8(4658), "value"),
    y2Labels: "none",
    x: scale(4668),
    y1: scale(4680),
    y2: { min: null, max: null, increment: null, log: false },
    barWidth: null,
    overlap: 0.5,
    depth: 0.25,
  };
}

function readGraph(b: Bytes, subtype: number): GraphData {
  const pointCount = Math.min(b.u16(1302), POINTS);
  const series: ClassicSeries[] = [];
  for (let s = 0; s < SERIES; s++) {
    const values: (number | null)[] = [];
    for (let p = 0; p < pointCount; p++) values.push(b.value(1314 + 240 * s + 4 * p));
    let type = pick(SERIES_TYPES, b.u8(1244 + s), "bar");
    if (subtype === 2) type = "area"; // Area charts store 1 and take the look from the subtype (§2.3).
    series.push({
      index: s + 1,
      name: b.pstring(1060 + 22 * s, 22),
      display: b.u8(1236 + s) === 1,
      type,
      cumulative: b.u8(1252 + s) === 1,
      axis: 1,
      color: b.u8(1260 + s) || s + 2,
      lineStyle: b.u8(1268 + s) || 1,
      marker: b.u8(1276 + s),
      valueLabels: false,
      values,
    });
  }
  const xLabels: string[] = [];
  for (let p = 0; p < pointCount; p++) xLabels.push(b.pstring(3330 + 22 * p, 22));
  return { pointCount, xType: b.u16(1304), xLabels, series, options: readGraphOptions(b) };
}

/** Pie charts (§2.4): pie 1 = series A, pie 2 = series B; labels = X labels. */
function readPies(b: Bytes, graph: GraphData): ClassicPie[] {
  const pies: ClassicPie[] = [];
  for (let k = 0; k < 2; k++) {
    const series = graph.series[k];
    const colors: number[] = [];
    const patterns: number[] = [];
    const cut: boolean[] = [];
    for (let p = 0; p < 12; p++) {
      colors.push(b.u8(3238 + 12 * k + p) || p + 2);
      patterns.push(b.u8(3262 + 12 * k + p) || p + 1);
      cut.push(b.u8((k === 0 ? 3288 : 3300) + p) === 1);
    }
    const styleCode = b.u8(4692 + k);
    const labelCode = b.u8(4694 + k);
    pies.push({
      index: k + 1,
      values: series?.values ?? [],
      labels: graph.xLabels,
      colors,
      patterns,
      cut,
      style: styleCode === 2 ? "column" : styleCode === 3 ? "none" : "pie",
      threeD: b.u8(4664) === 1,
      link: b.u8(4696) === 1,
      proportional: false,
      sort: b.u8(4698 + k) === 1,
      startAngle: 0,
      size: 50,
      showLabel: true,
      labelSize: 3,
      // 4694/4695: 1 value, 2 percent, 3 dollars, 4 none.
      showValue: labelCode === 1 || labelCode === 3,
      valuePlace: "below",
      currency: labelCode === 3,
      showPercent: labelCode === 2,
      percentPlace: "below",
      fill: b.u8(4652) || 1,
      title: [graphText(b, 8 + k)],
    });
  }
  return pies;
}

const ORG_NODES = 32;
const ORG_NODE_BASE = 410;
const ORG_TAIL = 4570;

/** Org charts (§2.5): 32 nodes of 130 bytes; same node and tail layout as 2.x. */
function readOrg(b: Bytes): OrgData {
  return readOrgBody(b, ORG_NODE_BASE, ORG_NODES, ORG_TAIL);
}

export function readPcok(data: Uint8Array, warnings: string[]): ClassicChart {
  const b = new Bytes(data);
  if (data.length < PCOK_BLOCK_SIZE) {
    warnings.push(`The file is ${data.length} bytes, shorter than the ${PCOK_BLOCK_SIZE} a 1.0 chart has; missing fields read as empty.`);
  }
  const chartClass = b.u16(48);
  const subtype = b.u16(50);
  const kind = kindOf(chartClass, subtype);
  const trailerLength = b.u16(58);
  const chart: ClassicChart = {
    version: "1.0",
    kind,
    chartClass,
    subtype,
    description: b.pstring(6, 41),
    title: [],
    footnote: [],
    xAxisTitle: null,
    y1AxisTitle: null,
    y2AxisTitle: null,
    textLines: [],
    graph: null,
    pies: [],
    org: null,
    slots: [],
    hasAnnotations: trailerLength > 0 || data.length > PCOK_BLOCK_SIZE,
  };

  if (chartClass === 1) {
    for (let k = 0; k < TEXT_LINES; k++) chart.textLines.push(textChartLine(b, k));
  } else if (chartClass === 2) {
    chart.title = [graphText(b, 0), graphText(b, 1), graphText(b, 2)];
    chart.footnote = [graphText(b, 3), graphText(b, 4), graphText(b, 5)];
    chart.xAxisTitle = graphText(b, 6);
    chart.y1AxisTitle = graphText(b, 7);
    chart.graph = readGraph(b, subtype);
    if (kind === "pie") chart.pies = readPies(b, chart.graph);
  } else if (chartClass === 3) {
    chart.org = readOrg(b);
    // The org chart's title is the pstring at 160 [I].
    chart.title = [{ text: b.pstring(160, 42), size: 8, place: "center", attrs: [] }];
  } else {
    warnings.push(`Unknown chart class ${chartClass} (subtype ${subtype}).`);
  }
  return chart;
}
