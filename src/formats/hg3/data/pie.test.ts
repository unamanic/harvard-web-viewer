import { describe, expect, it } from "vitest";
import { DocumentType } from "../container";
import { concat, f32, f64, f64NotSet, leaf, padded, u16, u8 } from "../testing/bytes";
import { LabelPlace, PieFill, PieShowAs, SlicePointer, fieldString, parsePieData, readLegend, readPercents, readStyle, readValues } from "./pie";
import { chartWith, textLine } from "./testing";

function slice(pie: number, n: number, value: number, label: string, explode = 2): ReturnType<typeof leaf> {
  return leaf(1316, concat([pie, n, explode, 21 + n, n], f32(value), padded(label, 23)));
}

function pieOptions(pie: number, style = 1): ReturnType<typeof leaf> {
  return leaf(1310, concat([pie, 1, style, 2, 2], f32(30), new Uint8Array(4), f32(100), u8(1)));
}

describe("parsePieData", () => {
  it("groups slices into pies with fractions, titles by column and options", () => {
    const chart = chartWith(DocumentType.Pie, [
      textLine(5, 0, 0, "Last Year"),
      textLine(5, 0, 1, "This Year"),
      leaf(1304, [2, 1, 2, 1, 1, 0x20, 0x12]),
      leaf(1306, [2, 2, 12, 2, 14, 20]),
      pieOptions(0),
      pieOptions(1, 2),
      leaf(1312, concat([0], new Uint8Array(30))),
      leaf(1314, concat([1], new Uint8Array(42))),
      slice(0, 0, 60, "Apples"),
      slice(0, 1, 30, "Pears", 1),
      slice(0, 2, 10, "Plums"),
      slice(1, 1, 5, "B"),
      slice(1, 0, 15, "A"),
    ]);
    const w: string[] = [];
    const d = parsePieData(chart, w);
    expect(w).toEqual([]);
    expect(d.threeD).toBe(true);
    expect(d.proportional).toBe(true);
    expect(d.raw1306).toEqual(Uint8Array.from([2, 2, 12, 2, 14, 20]));
    expect(d.pies.map((p) => p.index)).toEqual([0, 1]);
    const [p0, p1] = d.pies;
    expect(p0!.title?.text).toBe("Last Year");
    expect(p1!.title?.text).toBe("This Year");
    expect(p0!.total).toBe(100);
    expect(p0!.slices.map((s) => [s.label, s.value, s.fraction, s.colorRole, s.exploded])).toEqual([
      ["Apples", 60, 0.6, 21, false],
      ["Pears", 30, 0.3, 22, true],
      ["Plums", 10, 0.1, 23, false],
    ]);
    expect(p1!.slices.map((s) => s.label)).toEqual(["A", "B"]);
    expect(p0!.options).toMatchObject({ show: true, showAs: PieShowAs.Pie, sort: false, pointer: SlicePointer.Short, depth: 30, startAngle: 0, size: 100, showLabels: true });
    expect(p1!.options?.showAs).toBe(PieShowAs.Column);
    expect(p0!.slices.map((s) => s.pattern)).toEqual([0, 1, 2]);
    expect(d.style).toMatchObject({ sharePie1Labels: false, threeD: true, linkPies: false, proportional: true, fill: PieFill.Color, outlineRole: 32, linkLineRole: 18 });
    expect(d.legend).toMatchObject({ show: false, placement: 2, location: 12, frameStyle: 2, frameOutlineRole: 14, frameFillRole: 20 });
    expect(p0!.raw1312?.length).toBe(31);
    expect(p0!.raw1314).toBeNull();
    expect(p1!.raw1314?.length).toBe(43);
  });

  it("decodes 1310 pie options (PNOPIE, PCOLUMN, PUNSSRT, PPTRL, PDEPTH6, PANG45, PSIZE50, PNOLAB)", () => {
    const chart = chartWith(DocumentType.Pie, [
      leaf(1310, concat([0, 2, 2, 1, 4], f32(60), f32(45), f32(50), u8(2))),
      leaf(1310, concat([1, 1, 1, 2, 1], f32(Number.NaN), f32(0), f32(100), u8(1))),
      slice(0, 0, 1, "a"),
      slice(1, 0, 1, "b"),
    ]);
    const w: string[] = [];
    const [p0, p1] = parsePieData(chart, w).pies;
    expect(w).toEqual([]);
    expect(p0!.options).toMatchObject({ show: false, showAs: PieShowAs.Column, sort: true, pointer: SlicePointer.Long, depth: 60, startAngle: 45, size: 50, showLabels: false });
    // A blank (NaN) depth falls back to the default 30.
    expect(p1!.options).toMatchObject({ show: true, showAs: PieShowAs.Pie, sort: false, pointer: SlicePointer.None, depth: 30 });
  });

  it("decodes 1304 style and 1306 legend bytes", () => {
    expect(readStyle(Uint8Array.from([1, 1, 1, 1, 3, 33, 19]))).toMatchObject({
      sharePie1Labels: true,
      threeD: true,
      linkPies: true,
      proportional: true,
      fill: PieFill.Both,
      outlineRole: 33,
      linkLineRole: 19,
    });
    expect(readStyle(Uint8Array.from([2, 2]))).toMatchObject({ threeD: false, fill: PieFill.Color, outlineRole: 32, linkLineRole: 18 });
    expect(readLegend(Uint8Array.from([1, 2, 8, 2, 14, 20]))).toMatchObject({ show: true, location: 8 });
    expect(readLegend(Uint8Array.from([2]))).toMatchObject({ show: false, placement: 2, location: 5, frameOutlineRole: 14, frameFillRole: 20 });
  });

  it("decodes 1312 percents, ignoring leftovers after the NUL (PPCTT)", () => {
    const tail = concat(padded("", 2), [0x42], padded("", 10)); // leading "" with an old "B" left at byte 7
    const d = concat([0, 1, LabelPlace.Inside], u16(1), tail, padded("XY", 13));
    expect(d.length).toBe(31);
    expect(readPercents(d)).toMatchObject({ show: true, place: LabelPlace.Inside, decimals: 1, leading: "", trailing: "XY" });
    expect(readPercents(concat([0, 2, 1], u16(0), padded("AB", 13), padded("", 13)))).toMatchObject({ show: false, place: LabelPlace.Below, decimals: 0, leading: "AB" });
  });

  it("decodes 1314 values: NaN decimals = automatic, f64 scale, strings", () => {
    const base = (dec: Uint8Array, scale: Uint8Array) => concat([0, 1, LabelPlace.Adjacent, 1], dec, [1], scale, padded("AB", 13), padded("XY ", 13));
    const v = readValues(base(Uint8Array.from([0, 0, 0xf0, 0xff]), f64(10)));
    expect(v).toMatchObject({ show: true, place: LabelPlace.Adjacent, currency: true, decimals: null, thousands: true, scale: 10, leading: "AB", trailing: "XY " });
    expect(readValues(base(f32(2), f64NotSet())).decimals).toBe(2);
    expect(readValues(base(f32(2), f64NotSet())).scale).toBeNull();
    expect(readValues(concat([0, 2, 1, 2]))).toMatchObject({ show: false, currency: false, decimals: null, scale: null, leading: "" });
  });

  it("reads NUL-terminated fields", () => {
    expect(fieldString(Uint8Array.from([0x41, 0x42, 0, 0x43]), 0, 4)).toBe("AB");
    expect(fieldString(Uint8Array.from([0x41, 0x20]), 0, 13)).toBe("A ");
    expect(fieldString(Uint8Array.from([0x41]), 5, 13)).toBe("");
  });

  it("warns about negative values and short records, keeping going", () => {
    const chart = chartWith(DocumentType.Pie, [slice(0, 0, -5, "Neg"), slice(0, 1, 5, "Pos"), leaf(1316, [0, 2, 2])]);
    const w: string[] = [];
    const d = parsePieData(chart, w);
    expect(d.pies[0]!.slices).toHaveLength(2);
    expect(w.some((x) => x.includes("negative value -5"))).toBe(true);
    expect(w.some((x) => x.includes("too short"))).toBe(true);
    expect(d.threeD).toBeNull();
  });

  it("reads a truncated label and keeps unknown records", () => {
    const chart = chartWith(DocumentType.Pie, [
      leaf(1316, concat([0, 0, 2, 21, 0], f32(1), padded("Short", 5))),
      leaf(1399, [1, 2, 3]),
    ]);
    const w: string[] = [];
    const d = parsePieData(chart, w);
    expect(d.pies[0]!.slices[0]!.label).toBe("Short");
    expect(w).toHaveLength(1);
    expect(d.otherRecords.map((r) => r.tag)).toEqual([1399]);
  });
});
