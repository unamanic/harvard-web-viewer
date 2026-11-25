import { describe, expect, it } from "vitest";
import { DocumentType } from "../container";
import { ascii, concat, cstr, f32, f64, f64NotSet, leaf, padded, u16, u8 } from "../testing/bytes";
import { chartWith, textLine } from "./testing";
import { AXIS_F64_OFFSETS, fieldString, parseXyData, xyValue } from "./xy";

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

  it("reads every 1402 field of a 3.05 axis record (XLOG .. XTRAIL)", () => {
    const d = new Uint8Array(102);
    d.set([1, 2], 0);
    d.set(f64(2), 2);
    d.set(f64(5), 10);
    d.set(f64(50), 18);
    d.set([2, 3, 1], 26);
    d.set(f64(10), 29);
    d.set(f64(2), 37);
    d.set(f64(12), 45);
    d.set(f64NotSet(), 53);
    d.set([29, 2, 1, 1, 1], 61);
    d.set(f64(2), 66);
    d[74] = 2;
    // Leading "AB"; trailing "CD" after a NUL that hides the leftover "B" of older text.
    d.set(concat(ascii("AB"), [0]), 75);
    d.set(concat([0], ascii("B")), 88);
    d.set(concat(ascii("CD"), [0]), 88);
    const chart = chartWith(DocumentType.XY, [leaf(1402, d)]);
    const w: string[] = [];
    const a = parseXyData(chart, w).axes[0]!;
    expect(w).toEqual([]);
    expect(a).toMatchObject({
      index: 1,
      scaleType: 2,
      scaleFactor: 2,
      minimum: 5,
      maximum: 50,
      gridStyle: 2,
      majorTicks: 3,
      minorTicks: 1,
      increment: 10,
      minorIncrement: 2,
      goalMin: 12,
      goalMax: null,
      goalColorRole: 29,
      showLabels: false,
      percent: true,
      currency: true,
      scientific: true,
      decimals: 2,
      thousands: false,
      leading: "AB",
      trailing: "CD",
    });
  });

  it("ignores bytes after the NUL of a string field", () => {
    expect(fieldString(Uint8Array.from([0x41, 0, 0x42, 0x43]), 0, 4)).toBe("A");
    expect(fieldString(Uint8Array.from([0, 0x42]), 0, 2)).toBe("");
    expect(fieldString(Uint8Array.from([0x41, 0x42]), 0, 13)).toBe("AB");
  });

  it("reads the 1406 series options and the 1404, 1405, 1408, 1410 and 1418 option records", () => {
    const chart = chartWith(DocumentType.XY, [
      leaf(1406, [0, 2, 2, 2, 1, 2, 2, 2, 5, 23, 2, 2, 3, 24, 7]),
      leaf(1404, [2, 15, 16]),
      leaf(1405, [2]),
      leaf(1408, concat([2, 2], f32(60), f32(30), [3, 2, 2, 2, 2], f32(60), f32(30), [19, 33])),
      leaf(1410, [3, 2, 1]),
      leaf(1418, [2, 1, 6, 1, 15, 21]),
    ]);
    const w: string[] = [];
    const d = parseXyData(chart, w);
    expect(w).toEqual([]);
    expect(d.series[0]).toMatchObject({
      show: false,
      type: "line",
      axis: 2,
      cumulative: true,
      dataLabels: false,
      dataTable: false,
      fillStyle: 2,
      fillPattern: 5,
      colorRole: 23,
      lineFit: 2,
      lineStyle: 2,
      lineWidth: 3,
      colorRole2: 24,
      marker: 7,
    });
    expect(d.frame).toEqual({ style: 2, outlineRole: 15, fillRole: 16, showFill: false });
    expect(d.style).toEqual({
      barStyle: 2,
      barShape: 2,
      barWidth: 60,
      barOverlap: 30,
      areaStyle: 3,
      highLowStyle: 2,
      chartStyle: 2,
      style2D: 2,
      style3D: 2,
      objectDepth: 60,
      floorDepth: 30,
      linkRole: 19,
      outlineRole: 33,
    });
    expect(d.table).toEqual({ show: 3, grid: 2, labels: true });
    expect(d.legend).toEqual({ show: false, placement: 1, location: 6, frameStyle: 1, outlineRole: 15, fillRole: 21 });
  });

  it("reads 3.05 X labels from 1426 (u16 row, string[31])", () => {
    // "Feb" is followed by leftover text after its NUL.
    const label = (row: number, text: string, junk = "") => leaf(1426, concat(u16(row), padded(text, 30 - junk.length), [0], ascii(junk)));
    const chart = chartWith(DocumentType.XY, [label(0, "Jan"), label(2, "A longer label of 30 characters"), label(1, "Feb", "old")]);
    const w: string[] = [];
    const d = parseXyData(chart, w);
    expect(w).toEqual([]);
    expect(d.xLabels.map((x) => x.label)).toEqual(["Jan", "Feb", "A longer label of 30 characters".slice(0, 30)]);
    expect(d.rowCount).toBe(3);
  });
});
