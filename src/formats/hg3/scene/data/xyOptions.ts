/**
 * XY chart options from the 1404, 1405, 1408, 1410 and 1418 records (SPEC
 * §5.4), as the XY layout uses them.
 */
import { NO, type XyData } from "../../data/xy";
import { ROLE } from "../../palette";

/** 1408 byte 13 = 2: drop shadows (XS2DST) [I: "the next choice"; the copy draws them]. */
const STYLE_2D_SHADOW = 2;

export type BarMode = "cluster" | "overlap" | "stacked" | "percent" | "step" | "paired";
export type AreaMode = "overlap" | "stacked" | "percent";
export type BarShape = "bar" | "pyramid" | "octagon" | "cylinder";

const BAR_MODES: Record<number, BarMode> = { 1: "cluster", 2: "overlap", 3: "stacked", 4: "percent", 5: "step", 6: "paired" };
const AREA_MODES: Record<number, AreaMode> = { 1: "overlap", 2: "stacked", 3: "percent" };
const BAR_SHAPES: Record<number, BarShape> = { 1: "bar", 2: "pyramid", 3: "octagon", 4: "cylinder" };

export interface XyOptions {
  barMode: BarMode;
  barShape: BarShape;
  /** Bar (cluster) width, percent of the category slot. */
  barWidth: number;
  /** Overlap of overlapped bars, percent of a bar's width. */
  overlap: number;
  areaMode: AreaMode;
  threeD: boolean;
  horizontal: boolean;
  /** 3-D: depth of a bar, percent of its depth lane. */
  barDepth: number;
  /** 3-D: depth of the frame, percent of its height. */
  depth: number;
  /** A data table under the chart (1410 byte 0 = 2) [C]. */
  dataTable: boolean;
  /** The data table alone, without the chart (1410 byte 0 = 3) [C, XDTONLY]. */
  tableOnly: boolean;
  /** Table grid lines (1410 byte 1): 1 vertical, 2 horizontal [C, XDTGRID]. */
  tableGrid: number;
  /** Values printed at the bars and points (1410 byte 2 = 1) [C]. */
  valueLabels: boolean;
  /** High/low style (1408 byte 11): 1 box, 2 band, 3 I bar [I]. */
  highLowStyle: number;
  /** 2D style 2 (1408 byte 13): bars cast a drop shadow (XS2DST) [I]. */
  shadow: boolean;
  /** Bar and swatch outline colour role (1408 byte 24, 32 = Outlines) [C, XSOUT]. */
  outlineRole: number;
  /** Axis frame (1404, 1405): style 1 full, 2 left and bottom edges only [I, XFRST]; roles [C]. */
  frameStyle: number;
  frameRole: number;
  frameFillRole: number;
  frameFill: boolean;
  /** Legend (1418): shown, frame style (1 none [I, XDTNO], 2 plain), frame roles [C]. */
  legendShow: boolean;
  legendFrameStyle: number;
  legendOutlineRole: number;
  legendFillRole: number;
}

function f32(d: Uint8Array, at: number): number | null {
  if (d.length < at + 4) return null;
  const v = new DataView(d.buffer, d.byteOffset + at, 4).getFloat32(0, true);
  return Number.isFinite(v) ? v : null;
}

type OptionRecords = Pick<XyData, "raw1408" | "raw1410" | "raw1418"> & Partial<Pick<XyData, "raw1404" | "raw1405">>;

export function xyOptions(data: OptionRecords): XyOptions {
  const o = data.raw1408 ?? new Uint8Array(0);
  const t = data.raw1410 ?? new Uint8Array(0);
  const g = data.raw1418 ?? new Uint8Array(0);
  const fr = data.raw1404 ?? new Uint8Array(0);
  return {
    barMode: BAR_MODES[o[0] ?? 1] ?? "cluster",
    barShape: BAR_SHAPES[o[1] ?? 1] ?? "bar",
    barWidth: f32(o, 2) ?? 85,
    overlap: f32(o, 6) ?? 50,
    areaMode: AREA_MODES[o[10] ?? 1] ?? "overlap",
    threeD: o[12] === 2,
    horizontal: o[13] === 4,
    barDepth: f32(o, 15) ?? 40,
    depth: f32(o, 19) ?? 15,
    dataTable: t[0] === 2,
    tableOnly: t[0] === 3,
    tableGrid: t[1] ?? 1,
    valueLabels: t[2] === 1,
    highLowStyle: o[11] ?? 1,
    shadow: o[13] === STYLE_2D_SHADOW,
    outlineRole: o[24] || ROLE.Outlines,
    frameStyle: fr[0] ?? 1,
    frameRole: fr[1] || ROLE.Frame,
    frameFillRole: fr[2] || ROLE.FrameBkg,
    frameFill: data.raw1405?.[0] !== NO,
    legendShow: g[0] !== NO,
    legendFrameStyle: g[3] ?? 2,
    legendOutlineRole: g[4] || ROLE.Frame,
    legendFillRole: g[5] || ROLE.Legend,
  };
}
