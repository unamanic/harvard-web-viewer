import { describe, expect, it } from "vitest";
import { DocumentType } from "../container";
import { concat, cstr, f64, f64NotSet, leaf, padded, u16, u8 } from "../testing/bytes";
import { chartWith, textLine } from "./testing";
import { AXIS_F64_OFFSETS, parseXyData, xyValue } from "./xy";

function series(n: number, type: number, axis = 1): ReturnType<typeof leaf> {
  const colour = 21 + (n % 6);
  return leaf(1406, [n, 1, type, axis, 2, 1, 1, 1, n % 12, colour, 1, 1, 0, colour + 1, n + 1]);
}

function axis(n: number, set: Record<number, number> = {}): ReturnType<typeof leaf> {
  const data = new Uint8Array(102);
  data[0] = n;
  data[1] = 1;
  for (const at of AXIS_F64_OFFSETS) data.set(at in set ? f64(set[at]!) : f64NotSet(), at);
  return leaf(1402, data);
}

const value = (s: number, row: number, v: Uint8Array): ReturnType<typeof leaf> => leaf(1424, concat(u8(s), u16(row), v));

describe("parseXyData", () => {
  it("reads series, names, labels, a sparse grid and axes", () => {
    const chart = chartWith(DocumentType.XY, [
      textLine(3, 1, 0, "Dollars"),
      textLine(4, 0, 0, "Sales"),
      textLine(4, 1, 0, "Costs"),
      leaf(1404, [1, 14, 15]),
      leaf(1414, [1, 0x82, 0x30, 0x27]),
      axis(0, { 29: 7 }),
      axis(1, { 10: 6 }),
      axis(2),
      series(1, 2, 2),
      series(0, 1),
      leaf(1422, concat(u16(0), padded("Q1", 23))),
      leaf(1422, concat(u16(2), padded("Q3", 23))),
      value(0, 0, f64(10)),
      value(0, 2, f64(-4.5)),
      value(1, 1, f64(28)),
      value(1, 3, f64NotSet()),
      leaf(1420, concat(u8(5), cstr("@n(#3,5,5)"))),
    ]);
    const w: string[] = [];
    const d = parseXyData(chart, w);
    expect(w).toEqual([]);
    expect(d.series.map((s) => [s.index, s.type, s.axis, s.colorRole, s.colorRole2, s.marker, s.name?.text])).toEqual([
      [0, "bar", 1, 21, 22, 1, "Sales"],
      [1, "line", 2, 22, 23, 2, "Costs"],
    ]);
    expect(d.xLabels).toEqual([
      { row: 0, label: "Q1" },
      { row: 2, label: "Q3" },
    ]);
    expect(xyValue(d, 0, 0)).toBe(10);
    expect(xyValue(d, 0, 2)).toBe(-4.5);
    expect(xyValue(d, 0, 1)).toBeUndefined();
    expect(xyValue(d, 1, 1)).toBe(28);
    expect(xyValue(d, 1, 3)).toBeUndefined();
    expect(d.blankValues).toEqual([{ series: 1, row: 3 }]);
    expect(d.rowCount).toBe(4);
    expect(d.axes.map((a) => [a.index, a.minimum, a.maximum, a.increment])).toEqual([
      [0, null, null, 7],
      [1, 6, null, null],
      [2, null, null, null],
    ]);
    expect(d.axes[0]!.values.size).toBe(AXIS_F64_OFFSETS.length);
    expect(d.axisTitles.map((l) => l.text)).toEqual(["Dollars"]);
    expect(d.calculations).toMatchObject([{ raw0: 5, text: "@n(#3,5,5)" }]);
    expect(d.raw1404).toEqual(Uint8Array.from([1, 14, 15]));
    expect(d.raw1414?.length).toBe(4);
    expect(d.raw1408).toBeNull();
  });

  it("warns about values without a series, duplicates and short records", () => {
    const chart = chartWith(DocumentType.XY, [
      series(0, 9),
      value(0, 0, f64(1)),
      value(0, 0, f64(2)),
      value(5, 0, f64(3)),
      leaf(1424, [0, 1]),
      leaf(1406, [1, 1]),
    ]);
    const w: string[] = [];
    const d = parseXyData(chart, w);
    expect(d.series[0]!.type).toBe("unknown");
    expect(xyValue(d, 0, 0)).toBe(1);
    expect(xyValue(d, 5, 0)).toBe(3);
    expect(w.some((x) => x.includes("repeated"))).toBe(true);
    expect(w.some((x) => x.includes("series 5, which has no series record"))).toBe(true);
    expect(w.filter((x) => x.includes("too short"))).toHaveLength(2);
  });
});
