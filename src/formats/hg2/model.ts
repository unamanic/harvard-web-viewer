/**
 * One chart model for Harvard Graphics 1.0 (HPG A.00, "PCOK") and 2.10 /
 * 2.12 / 2.30 ("Falc") charts (docs/SPEC-HG1-HG2.md). Both readers
 * (pcok.ts, falc.ts) fill it; scene.ts draws it. Option codes are turned
 * into names here, so the drawing code does not care which version a chart
 * came from.
 */

/** Which program saved the file. 2.10 and 2.12 write identical files (SPEC §3.2). */
export type ClassicVersion = "1.0" | "2.10/2.12" | "2.30";

export type ClassicKind =
  | "title"
  | "list"
  | "bullet"
  | "columns"
  | "freeform"
  | "pie"
  | "bar"
  | "area"
  | "hlc"
  | "org"
  | "multiple"
  | "unknown";

export type Place = "left" | "center" | "right";

/** One line of text with one attribute byte per character (SPEC §2.2, §4.1). */
export interface ClassicText {
  text: string;
  /** Size as stored (0 = not set). */
  size: number;
  place: Place;
  /** Attribute byte per character of `text` (0x01 no fill, 0x02 bold, 0x04 italic, 0x08 underline, high nibble = colour - 1). */
  attrs: number[];
}

export type SeriesType = "bar" | "line" | "trend" | "curve" | "point" | "area";

export interface ClassicSeries {
  /** 1-based. */
  index: number;
  name: string;
  display: boolean;
  type: SeriesType;
  cumulative: boolean;
  /** 1 = Y1, 2 = Y2. */
  axis: 1 | 2;
  color: number;
  /** 1 solid, 2 double, 3 dotted, 4 dashed. */
  lineStyle: number;
  /** Marker or fill pattern number. */
  marker: number;
  /** Value labels for this series when the chart's value labels are "select" (2.x only). */
  valueLabels: boolean;
  /** One entry per X point; null = missing. */
  values: (number | null)[];
}

export type BarStyle = "cluster" | "overlap" | "stack" | "100%" | "step" | "paired";
export type Enhancement = "3d" | "shadow" | "link" | "none" | "area" | "errorbar";
export type GridStyle = "dotted" | "solid" | "none";
export type FrameStyle = "full" | "half" | "quarter" | "none";
export type LegendLocation = "top" | "bottom" | "left" | "right" | "none";
export type LabelFormat = "value" | "currency" | "percent" | "none";

/** One axis's scale; null = auto. */
export interface AxisScale {
  min: number | null;
  max: number | null;
  increment: number | null;
  log: boolean;
}

export interface GraphOptions {
  valueLabels: "all" | "select" | "none";
  horizontal: boolean;
  /** 1 colour, 2 pattern, 3 both. */
  fill: number;
  barStyle: BarStyle;
  enhancement: Enhancement;
  legendLocation: LegendLocation;
  legendJustify: "start" | "center" | "end";
  legendInside: boolean;
  legendFrame: "single" | "shadow" | "none";
  frame: FrameStyle;
  frameColor: number;
  /** Colour number filling the plot area; 0 = none. */
  frameBackground: number;
  /** Table of the values under the chart (2.x tag 120 [45]). */
  dataTable: "normal" | "framed" | "none";
  gridX: GridStyle;
  gridY1: GridStyle;
  gridY2: GridStyle;
  xLabels: "normal" | "vertical" | "percent" | "none";
  y1Labels: LabelFormat;
  y2Labels: LabelFormat;
  x: AxisScale;
  y1: AxisScale;
  y2: AxisScale;
  /** Fraction of the category width; null = auto. */
  barWidth: number | null;
  overlap: number;
  depth: number;
}

export interface GraphData {
  pointCount: number;
  /** X data type code (1 = Name; others not decoded). */
  xType: number;
  xLabels: string[];
  series: ClassicSeries[];
  options: GraphOptions;
}

export interface ClassicPie {
  /** 1 or 2. */
  index: number;
  values: (number | null)[];
  labels: string[];
  colors: number[];
  patterns: number[];
  cut: boolean[];
  style: "pie" | "column" | "none";
  threeD: boolean;
  link: boolean;
  proportional: boolean;
  sort: boolean;
  /** Degrees. */
  startAngle: number;
  /** Default 50. */
  size: number;
  showLabel: boolean;
  labelSize: number;
  showValue: boolean;
  valuePlace: "below" | "adjacent" | "inside";
  currency: boolean;
  showPercent: boolean;
  percentPlace: "below" | "adjacent" | "inside";
  /** 1 colour, 2 pattern, 3 both. */
  fill: number;
  title: ClassicText[];
}

export interface OrgNode {
  /** 1-based slot number in the file. */
  id: number;
  name: string;
  title: string;
  comment: string;
  abbreviation: string;
  parent: number;
  children: OrgNode[];
  depth: number;
}

export interface OrgOptions {
  /** 0 = all levels, else the number of levels shown. */
  levels: number;
  nameSize: number;
  titleSize: number;
  commentSize: number;
  linesUpper: number;
  linesLast: number;
  titlesUpper: boolean;
  titlesLast: boolean;
  commentsUpper: boolean;
  commentsLast: boolean;
  /** 0 light, 2 bold, 4 italic (bits). */
  nameStyle: number;
  titleStyle: number;
  commentStyle: number;
  nameColor: number;
  titleColor: number;
  commentColor: number;
  abbreviations: boolean;
  lastLevelVertical: boolean;
  shadow: boolean;
}

export interface OrgData {
  root: OrgNode | null;
  nodeCount: number;
  options: OrgOptions;
}

/** One slot of a multiple chart (SPEC §4.7, [I]). */
export interface MultipleSlot {
  slot: number;
  /** The four u16 values after the slot number, as stored. */
  box: [number, number, number, number];
  fileName: string;
  description: string;
}

export interface ClassicChart {
  version: ClassicVersion;
  kind: ClassicKind;
  /** Stored class and subtype (SPEC §2.1, tag 30). */
  chartClass: number;
  subtype: number;
  description: string;
  /** Title (0) and subtitle lines (1, 2) of graph, org and list charts. */
  title: ClassicText[];
  footnote: ClassicText[];
  xAxisTitle: ClassicText | null;
  y1AxisTitle: ClassicText | null;
  y2AxisTitle: ClassicText | null;
  /** Text charts: every line 0..50, by line number (missing lines are empty). */
  textLines: ClassicText[];
  graph: GraphData | null;
  pies: ClassicPie[];
  org: OrgData | null;
  slots: MultipleSlot[];
  /** The file holds drawn annotations (1.0 trailer, 2.x tag 300), which are not decoded. */
  hasAnnotations: boolean;
}

export function emptyText(size = 0, place: Place = "center"): ClassicText {
  return { text: "", size, place, attrs: [] };
}

/** Kind of a chart from its class and subtype (SPEC §2.1, tag 30). */
export function kindOf(chartClass: number, subtype: number): ClassicKind {
  if (chartClass === 1) {
    return (["title", "list", "bullet", "columns", "columns", "freeform"] as const)[subtype] ?? "unknown";
  }
  if (chartClass === 2) return (["pie", "bar", "area", "hlc"] as const)[subtype] ?? "unknown";
  if (chartClass === 3) return "org";
  if (chartClass === 4) return "multiple";
  return "unknown";
}

export function kindLabel(kind: ClassicKind): string {
  switch (kind) {
    case "title":
      return "title chart";
    case "list":
      return "simple list";
    case "bullet":
      return "bullet list";
    case "columns":
      return "column chart";
    case "freeform":
      return "free-form text chart";
    case "pie":
      return "pie chart";
    case "bar":
      return "bar/line chart";
    case "area":
      return "area chart";
    case "hlc":
      return "high/low/close chart";
    case "org":
      return "organization chart";
    case "multiple":
      return "multiple chart";
    default:
      return "chart of an unknown type";
  }
}

/** Attribute bits (SPEC §2.2, §4.1). */
export const ATTR = { noFill: 0x01, bold: 0x02, italic: 0x04, underline: 0x08 } as const;

/** Colour number (1-based) of an attribute byte. */
export function attrColor(attr: number): number {
  return (attr >> 4) + 1;
}
