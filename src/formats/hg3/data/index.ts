/**
 * Chart data parsing (SPEC §5.4, task 11): interprets `chart.dataRecords`
 * and the type-specific text slots for each data chart type. The result is
 * the input for laying out a chart from its data (tasks 14 to 19); every
 * sample chart also stores a drawn copy in its object layer (§5.1).
 *
 * Never throws: damaged or short records become warnings and stay raw
 * (SPEC §7.1).
 */
import type { Chart } from "../chart";
import { DocumentType } from "../container";
import { type BulletData, type TitleData, parseBulletData, parseTitleData } from "./bullet";
import type { RawRecord } from "./common";
import { type OrgData, parseOrgData } from "./org";
import { type PieData, parsePieData } from "./pie";
import { type TableData, parseTableData } from "./table";
import { type XyData, parseXyData } from "./xy";

/** Drawings, and any type without data records: the data records are kept raw. */
export interface NoChartData {
  kind: "none";
  chartType: number;
  otherRecords: RawRecord[];
}

export type ChartData = PieData | XyData | OrgData | TitleData | BulletData | TableData | NoChartData;
export type ChartDataKind = ChartData["kind"];

export function parseChartData(chart: Chart): { data: ChartData; warnings: string[] } {
  const warnings: string[] = [];
  let data: ChartData;
  try {
    data = dispatch(chart, warnings);
  } catch (e) {
    // Guard: the parsers check lengths, so this should not happen.
    warnings.push(`chart data could not be parsed: ${e instanceof Error ? e.message : String(e)}`);
    data = { kind: "none", chartType: chart.chartType, otherRecords: [...chart.dataRecords] };
  }
  return { data, warnings };
}

function dispatch(chart: Chart, warnings: string[]): ChartData {
  switch (chart.chartType) {
    case DocumentType.Pie:
      return parsePieData(chart, warnings);
    case DocumentType.XY:
      return parseXyData(chart, warnings);
    case DocumentType.Organization:
      return parseOrgData(chart, warnings);
    case DocumentType.Title:
      return parseTitleData(chart, warnings);
    case DocumentType.Bullet:
      return parseBulletData(chart, warnings);
    case DocumentType.Table:
      return parseTableData(chart, warnings);
    default:
      return { kind: "none", chartType: chart.chartType, otherRecords: [...chart.dataRecords] };
  }
}

export type { BulletData, BulletEntry, BulletLine, TitleData, TitleSection } from "./bullet";
export type { OrgBox, OrgData, OrgField } from "./org";
export type { Pie, PieData, PieOptions, PieSlice } from "./pie";
export type { TableColorRange, TableColumn, TableData, TableRowBand } from "./table";
export type { XLabel, XyAxis, XyData, XySeries, XySeriesType } from "./xy";
export { xyValue } from "./xy";
export { tablePercentHeight, tablePercentToX, tablePercentToY } from "./table";
