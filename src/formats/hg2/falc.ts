/**
 * Harvard Graphics 2.10, 2.12 and 2.30 charts: the "Falc" tagged record
 * container (docs/SPEC-HG1-HG2.md §3, §4). Offsets below are relative to a
 * record's data.
 */
import { ORG_SUBTITLE_SIZE, ORG_TITLE_SIZE } from "./assumptions";
import { Bytes } from "./bytes";
import {
  type BarStyle,
  type ClassicChart,
  type ClassicPie,
  type ClassicSeries,
  type ClassicText,
  type Enhancement,
  type FrameStyle,
  type GraphData,
  type GraphOptions,
  type GridStyle,
  type LabelFormat,
  type LegendLocation,
  type Place,
  type SeriesType,
  emptyText,
  kindOf,
} from "./model";
import { readOrgBody } from "./org";

export interface FalcRecord {
  tag: number;
  /** File offset of the record header. */
  offset: number;
  data: Uint8Array;
}

/** Tag numbers (§3.1). */
export const FalcTag = {
  EndOfFile: 1,
  Description: 2,
  Version: 0,
  Settings10: 10,
  Unknown15: 15,
  EndOfChart: 31,
  ChartType: 30,
  TextLine: 33,
  SeriesName: 34,
  TextLayout: 50,
  Org: 62,
  MultipleSlot: 90,
  SeriesOptions: 100,
  GraphOptions: 120,
  AxisScales: 121,
  PieColors: 150,
  PiePatterns: 151,
  PieCut: 153,
  PieOptions: 160,
  PointCount: 200,
  Unknown201: 201,
  XLabel: 205,
  XData207: 207,
  Values: 208,
  Annotations: 300,
  Palette316: 316,
} as const;

/** Split a Falc file into records. Stops after tag 1 (end of file). */
export function readFalcRecords(data: Uint8Array, warnings: string[]): FalcRecord[] {
  const b = new Bytes(data);
  const out: FalcRecord[] = [];
  let i = 4;
  while (i + 4 <= data.length) {
    const tag = b.u16(i);
    const len = b.u16(i + 2);
    if (i + 4 + len > data.length) {
      warnings.push(`The file is damaged: record ${tag} at offset ${i} runs past the end of the file. Only the part before it was read.`);
      break;
    }
    out.push({ tag, offset: i, data: data.subarray(i + 4, i + 4 + len) });
    i += 4 + len;
    if (tag === FalcTag.EndOfFile && len === 0) break;
  }
  if (out.length === 0 || out[out.length - 1].tag !== FalcTag.EndOfFile) {
    warnings.push("The file has no end-of-file record (tag 1); it may be cut short.");
  }
  return out;
}

function place(code: number): Place {
  return code === 1 ? "left" : code === 3 ? "right" : "center";
}

/** Run-length attributes after a string (§4.1): u8 field width, then (attribute, count) pairs. */
function readAttrs(b: Bytes, offset: number, textLength: number): number[] {
  const out: number[] = [];
  let o = offset + 1; // skip the field width
  while (out.length < textLength && o + 1 < b.length) {
    const attr = b.u8(o);
    const count = b.u8(o + 1);
    if (count === 0) break;
    for (let k = 0; k < count && out.length < textLength; k++) out.push(attr);
    o += 2;
  }
  while (out.length < textLength) out.push(out[out.length - 1] ?? 0x02);
  return out;
}

interface TextRecord {
  group: number;
  line: number;
  text: ClassicText;
}

function readTextLine(rec: FalcRecord): TextRecord {
  const b = new Bytes(rec.data);
  const text = b.pstring(22);
  return {
    group: b.u16(0),
    line: b.u16(2),
    text: { text, size: b.f32(8), place: place(b.u8(13)), attrs: readAttrs(b, 23 + text.length, text.length) },
  };
}

const SERIES_TYPES: readonly SeriesType[] = ["bar", "line", "trend", "curve", "point", "area"];
const BAR_STYLES: readonly BarStyle[] = ["cluster", "overlap", "stack", "100%", "step", "paired"];
const ENHANCEMENTS: readonly Enhancement[] = ["3d", "shadow", "link", "none", "area", "errorbar"];
const LEGEND_LOCATIONS: readonly LegendLocation[] = ["top", "bottom", "left", "right", "none"];
const FRAMES: readonly FrameStyle[] = ["full", "half", "quarter", "none"];
const GRIDS: readonly GridStyle[] = ["dotted", "solid", "none"];
const LABEL_FORMATS: readonly LabelFormat[] = ["value", "currency", "percent", "none"];

function pick<T>(list: readonly T[], code: number, fallback: T): T {
  return list[code - 1] ?? fallback;
}

export function defaultGraphOptions(): GraphOptions {
  const auto = () => ({ min: null, max: null, increment: null, log: false });
  return {
    valueLabels: "none",
    horizontal: false,
    fill: 1,
    barStyle: "cluster",
    enhancement: "none",
    legendLocation: "bottom",
    legendJustify: "center",
    legendInside: false,
    legendFrame: "none",
    frame: "full",
    frameColor: 1,
    frameBackground: 0,
    dataTable: "none",
    gridX: "none",
    gridY1: "dotted",
    gridY2: "dotted",
    xLabels: "normal",
    y1Labels: "value",
    y2Labels: "value",
    x: auto(),
    y1: auto(),
    y2: auto(),
    barWidth: null,
    overlap: 0.5,
    depth: 0.25,
  };
}

function applyGraphOptions(o: GraphOptions, rec: FalcRecord): void {
  const b = new Bytes(rec.data);
  o.enhancement = pick(ENHANCEMENTS, b.u8(0), "none");
  const labels = b.u8(1);
  o.valueLabels = labels === 1 ? "all" : labels === 2 ? "select" : "none";
  o.horizontal = b.u8(2) === 1;
  o.fill = b.u8(3) || 1;
  o.barStyle = pick(BAR_STYLES, b.u8(4), "cluster");
  const justify = b.u8(8);
  o.legendJustify = justify === 1 ? "start" : justify === 3 ? "end" : "center";
  o.legendLocation = pick(LEGEND_LOCATIONS, b.u8(9), "bottom");
  o.legendInside = b.u8(10) === 1;
  const legendFrame = b.u8(11);
  o.legendFrame = legendFrame === 1 ? "single" : legendFrame === 2 ? "shadow" : "none";
  o.frame = pick(FRAMES, b.u8(12), "full");
  o.frameColor = b.u8(13) || 1;
  o.frameBackground = b.u8(14);
  const table = b.u8(45);
  o.dataTable = table === 1 ? "normal" : table === 2 ? "framed" : "none";
  o.gridX = pick(GRIDS, b.u8(15), "none");
  o.gridY1 = pick(GRIDS, b.u8(16), "dotted");
  o.gridY2 = pick(GRIDS, b.u8(17), "dotted");
  const xl = b.u8(21);
  o.xLabels = xl === 2 ? "vertical" : xl === 3 ? "percent" : xl === 4 ? "none" : "normal";
  o.y1Labels = pick(LABEL_FORMATS, b.u8(22), "value");
  o.y2Labels = pick(LABEL_FORMATS, b.u8(23), "value");
  o.x.log = b.u8(25) === 2;
  o.y1.log = b.u8(26) === 2;
  o.barWidth = b.value(27);
  o.overlap = b.value(31) ?? 0.5;
  o.depth = b.value(35) ?? 0.25;
}

/**
 * Tag 121: minimum X/Y1/Y2 at 4/8/12, maximum at 16/20/24, increment at
 * 28/32/36 (checked against BXMIN, BXMAX, BXINC, BY1MIN, BY1MAX, BY1INC
 * and BY2MIN; the Y2 maximum and increment follow the pattern [I]).
 * Offset 0 is another f32 whose meaning is not known.
 */
function applyScales(o: GraphOptions, rec: FalcRecord): void {
  const b = new Bytes(rec.data);
  const axes = [o.x, o.y1, o.y2];
  axes.forEach((axis, k) => {
    axis.min = b.value(4 + 4 * k);
    axis.max = b.value(16 + 4 * k);
    axis.increment = b.value(28 + 4 * k);
  });
}

function defaultSeries(index: number): ClassicSeries {
  return {
    index,
    name: `Series ${index}`,
    display: true,
    type: "bar",
    cumulative: false,
    axis: 1,
    color: index + 1,
    lineStyle: 1,
    marker: index,
    valueLabels: false,
    values: [],
  };
}

function defaultPie(index: number): ClassicPie {
  return {
    index,
    values: [],
    labels: [],
    colors: Array.from({ length: 12 }, (_, p) => p + 2),
    patterns: Array.from({ length: 12 }, (_, p) => p + 1),
    cut: Array.from({ length: 12 }, () => false),
    style: "pie",
    threeD: false,
    link: false,
    proportional: false,
    sort: false,
    startAngle: 0,
    size: 50,
    showLabel: true,
    labelSize: 3,
    showValue: true,
    valuePlace: "below",
    currency: false,
    showPercent: false,
    percentPlace: "below",
    fill: 1,
    title: [],
  };
}

const PLACES = ["below", "adjacent", "inside"] as const;

function applyPieOptions(pie: ClassicPie, b: Bytes): void {
  pie.threeD = b.u8(3) === 1;
  pie.link = b.u8(4) === 1;
  pie.proportional = b.u8(5) === 1;
  const style = b.u8(6);
  pie.style = style === 2 ? "column" : style === 3 ? "none" : "pie";
  pie.sort = b.u8(7) === 1;
  pie.startAngle = b.value(8) ?? 0;
  pie.size = b.value(12) ?? 50;
  pie.showLabel = b.u8(16) === 1;
  pie.labelSize = b.value(17) ?? 3;
  pie.showValue = b.u8(21) === 1;
  pie.valuePlace = pick(PLACES, b.u8(22), "below");
  pie.currency = b.u8(23) === 1;
  pie.showPercent = b.u8(24) === 1;
  pie.percentPlace = pick(PLACES, b.u8(25), "below");
  pie.fill = b.u8(52) || 1;
}

const ORG_NODE_BASE = 370;
const ORG_NODES = 80;
const ORG_TAIL = 10770;

export function readFalc(data: Uint8Array, warnings: string[]): ClassicChart {
  const records = readFalcRecords(data, warnings);
  const first = (tag: number) => records.find((r) => r.tag === tag);

  const versionRec = first(FalcTag.Version);
  const versionByte = versionRec ? new Bytes(versionRec.data).u8(2) : 0;
  const typeRec = first(FalcTag.ChartType);
  const typeBytes = new Bytes(typeRec?.data ?? new Uint8Array(4));
  const chartClass = typeBytes.u16(0);
  const subtype = typeBytes.u16(2);
  if (!typeRec) warnings.push("The chart has no chart type record (tag 30).");
  const kind = kindOf(chartClass, subtype);
  const descRec = first(FalcTag.Description);

  const chart: ClassicChart = {
    version: versionByte === 2 ? "2.30" : "2.10/2.12",
    kind,
    chartClass,
    subtype,
    description: descRec ? new Bytes(descRec.data).pstring(0) : "",
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
    hasAnnotations: records.some((r) => r.tag === FalcTag.Annotations),
  };

  const options = defaultGraphOptions();
  const series = new Map<number, ClassicSeries>();
  const seriesOf = (n: number) => {
    let s = series.get(n);
    if (!s) {
      s = defaultSeries(n);
      series.set(n, s);
    }
    return s;
  };
  const pies = [defaultPie(1), defaultPie(2)];
  const pieOf = (n: number) => pies[n === 2 ? 1 : 0];
  const xLabels: string[] = [];
  let pointCount = 0;
  let xType = 1;
  let isGraph = chartClass === 2;

  for (const rec of records) {
    const b = new Bytes(rec.data);
    switch (rec.tag) {
      case FalcTag.TextLine: {
        const { group, line, text } = readTextLine(rec);
        if (group === 0) chart.textLines[line] = text;
        else if (group === 1) chart.title[line] = text;
        else if (group === 2 && line >= 1) chart.footnote[line - 1] = text;
        else if (group === 3) {
          if (line === 0) chart.xAxisTitle = text;
          else if (line === 1) chart.y1AxisTitle = text;
          else if (line === 2) chart.y2AxisTitle = text;
        } else if (group === 5 && line >= 1) {
          // Pie titles: lines 1-2 pie 1, lines 3-4 pie 2 [I].
          const pie = pies[line <= 2 ? 0 : 1];
          pie.title[(line - 1) % 2] = text;
        }
        break;
      }
      case FalcTag.SeriesName: {
        const index = b.u16(0);
        if (index >= 1 && index <= 8) seriesOf(index).name = b.pstring(2);
        break;
      }
      case FalcTag.SeriesOptions: {
        const s = seriesOf(b.u16(0));
        s.display = b.u8(2) !== 2;
        s.type = pick(SERIES_TYPES, b.u8(3), "bar");
        s.cumulative = b.u8(4) === 1;
        s.axis = b.u8(5) === 2 ? 2 : 1;
        s.color = b.u8(6) || s.color;
        s.lineStyle = b.u8(7) || 1;
        s.marker = b.u8(8);
        s.valueLabels = b.u8(9) === 1;
        isGraph = true;
        break;
      }
      case FalcTag.GraphOptions:
        applyGraphOptions(options, rec);
        break;
      case FalcTag.AxisScales:
        applyScales(options, rec);
        break;
      case FalcTag.PointCount:
        pointCount = b.u16(0);
        xType = b.u16(2) || 1;
        break;
      case FalcTag.XLabel: {
        const index = b.u16(2);
        if (index >= 1 && index <= 240) xLabels[index - 1] = b.pstring(4);
        break;
      }
      case FalcTag.Values: {
        const s = seriesOf(b.u16(0));
        const count = b.u8(2);
        const values: (number | null)[] = [];
        for (let p = 0; p < count; p++) values.push(b.value(4 + 4 * p));
        s.values = values;
        break;
      }
      case FalcTag.PieColors:
      case FalcTag.PiePatterns:
      case FalcTag.PieCut: {
        const pie = pieOf(b.u16(0));
        for (let p = 0; p < 12; p++) {
          const v = b.u8(2 + p);
          if (rec.tag === FalcTag.PieColors) pie.colors[p] = v || p + 2;
          else if (rec.tag === FalcTag.PiePatterns) pie.patterns[p] = v || p + 1;
          else pie.cut[p] = v === 1;
        }
        break;
      }
      case FalcTag.PieOptions:
        applyPieOptions(pieOf(b.u16(0)), b);
        break;
      case FalcTag.Org:
        chart.org = readOrgBody(b, ORG_NODE_BASE, ORG_NODES, ORG_TAIL);
        // Title at 0 and subtitle at 62 (each a length byte, 40 characters and their attributes).
        if (!chart.title[0] || chart.title[0].text === "") {
          chart.title[0] = { text: b.pstring(0, 40), size: ORG_TITLE_SIZE, place: "center", attrs: [] };
        }
        if (!chart.title[1] || chart.title[1].text === "") {
          chart.title[1] = { text: b.pstring(62, 40), size: ORG_SUBTITLE_SIZE, place: "center", attrs: [] };
        }
        break;
      case FalcTag.MultipleSlot: {
        const fileName = b.pstring(10, 13).replace(/ +\./, ".").trim();
        if (fileName) {
          chart.slots.push({
            slot: b.u16(0),
            box: [b.u16(2), b.u16(4), b.u16(6), b.u16(8)],
            fileName,
            description: b.pstring(34),
          });
        }
        break;
      }
    }
  }

  if (isGraph) {
    pointCount = Math.max(pointCount, xLabels.length);
    const list: ClassicSeries[] = [];
    for (let n = 1; n <= 8; n++) {
      const s = seriesOf(n);
      s.values = Array.from({ length: pointCount }, (_, p) => s.values[p] ?? null);
      if (kind === "area" && s.type === "bar") s.type = "area";
      list.push(s);
    }
    const labels = Array.from({ length: pointCount }, (_, p) => xLabels[p] ?? "");
    const graph: GraphData = { pointCount, xType, xLabels: labels, series: list, options };
    chart.graph = graph;
    if (kind === "pie") {
      pies.forEach((pie, k) => {
        pie.values = list[k].values;
        pie.labels = labels;
      });
      chart.pies = pies;
    }
    if (xType !== 1) {
      warnings.push(`The X axis data type is ${xType}, not Name; only Name is decoded, so the X labels may be missing.`);
    }
  }
  // Fill gaps so line numbers index the arrays.
  for (let k = 0; k < chart.textLines.length; k++) chart.textLines[k] ??= emptyText();
  for (let k = 0; k < chart.title.length; k++) chart.title[k] ??= emptyText();
  for (let k = 0; k < chart.footnote.length; k++) chart.footnote[k] ??= emptyText(0, "left");
  return chart;
}
