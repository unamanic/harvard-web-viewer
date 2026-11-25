import { describe, expect, it } from "vitest";
import { DocumentType } from "../container";
import { concat, f64, f64NotSet, leaf } from "../testing/bytes";
import { parseTableData, tablePercentHeight, tablePercentToX, tablePercentToY } from "./table";
import { chartWith, textLine } from "./testing";

function column(left: number | null, right: number | null, just = 1): Uint8Array {
  const v = (x: number | null): Uint8Array => (x === null ? f64NotSet() : f64(x));
  return concat(v(left), v(right), [just, 3, 2], f64NotSet(), [2], f64NotSet(), [2, 1, 2]);
}

function range(low: number | null, high: number | null, role: number): Uint8Array {
  const v = (x: number | null): Uint8Array => (x === null ? f64NotSet() : f64(x));
  return concat(new Uint8Array(23), v(low), v(high), [role]);
}

describe("parseTableData", () => {
  it("builds the cell grid and decodes columns, rows and colour ranges", () => {
    const chart = chartWith(DocumentType.Table, [
      textLine(6, 0, 0, "Dept."),
      textLine(6, 0, 1, "Cost"),
      textLine(6, 2, 1, "45"),
      textLine(6, 2, 0, "Sales"),
      leaf(1206, [1, 2, 2, 1, 2, 0x12, 0, 0]),
      leaf(1208, concat(column(10, 40), column(40, 60, 2), column(null, null))),
      leaf(1210, [2, 1, 2, 14, 20]),
      leaf(1212, concat([1, 1, 2], range(0, 9, 33), range(10, 19, 34))),
      leaf(1214, concat(f64(20), f64(30), f64(30), f64(40), f64NotSet(), f64NotSet())),
    ]);
    const w: string[] = [];
    const d = parseTableData(chart, w);
    expect(w).toEqual([]);
    expect(d.rowCount).toBe(3);
    expect(d.columnCount).toBe(2);
    expect(d.grid[0]!.map((c) => c?.text)).toEqual(["Dept.", "Cost"]);
    expect(d.grid[1]).toEqual([null, null]);
    expect(d.grid[2]!.map((c) => c?.text)).toEqual(["Sales", "45"]);
    expect(d.cells.map((c) => c.text)).toEqual(["Dept.", "Cost", "Sales", "45"]);
    expect(d.allColumns).toHaveLength(3);
    expect(d.columns.map((c) => [c.left, c.right, c.justification])).toEqual([
      [10, 40, 1],
      [40, 60, 2],
    ]);
    expect(d.rowBands.map((r) => [r.top, r.bottom])).toEqual([
      [20, 30],
      [30, 40],
    ]);
    expect(d.colorRanges?.enabled).toBe(true);
    expect(d.colorRanges?.ranges.map((r) => [r.low, r.high, r.colorRole])).toEqual([
      [0, 9, 33],
      [10, 19, 34],
    ]);
    expect(d.raw1206?.length).toBe(8);
    expect(d.raw1210?.length).toBe(5);
  });

  it("warns about partial entries", () => {
    const w: string[] = [];
    const d = parseTableData(chartWith(DocumentType.Table, [leaf(1214, f64(1)), leaf(1212, [2])]), w);
    expect(d.rowBands).toEqual([]);
    expect(d.colorRanges).toBeNull();
    expect(w).toHaveLength(2);
  });

  it("maps percentages to page coordinates", () => {
    expect(tablePercentToX(0)).toBe(-16384);
    expect(tablePercentToX(100)).toBe(16384);
    expect(tablePercentToY(0)).toBe(12288);
    expect(tablePercentToY(50)).toBe(0);
    expect(tablePercentHeight(10, 7.5)).toBe(24576);
    expect(Math.round(tablePercentHeight(11, 8.5))).toBe(25321);
  });
});
