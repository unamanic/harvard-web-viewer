import { describe, expect, it } from "vitest";
import { DocumentType } from "../container";
import { concat, f32, leaf, padded, u8 } from "../testing/bytes";
import { parsePieData } from "./pie";
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
    expect(p0!.options).toMatchObject({ styleCode: 1, value5: 30, value13: 100 });
    expect(p1!.options?.styleCode).toBe(2);
    expect(p0!.raw1312?.length).toBe(31);
    expect(p0!.raw1314).toBeNull();
    expect(p1!.raw1314?.length).toBe(43);
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
