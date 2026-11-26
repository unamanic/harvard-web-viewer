/** The 1.0 (PCOK) and 2.x (Falc) readers on synthetic bytes: structure, damage and unknown records. */
import { describe, expect, it } from "vitest";
import { FalcTag, readFalcRecords } from "./falc";
import { PCOK_BLOCK_SIZE } from "./pcok";
import { NotClassicChartError, readClassicChart } from "./read";

const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
const u16 = (v: number) => [v & 0xff, v >> 8];
const pstring = (s: string, field = s.length + 1) => {
  const out = [s.length, ...ascii(s)];
  while (out.length < field) out.push(0);
  return out;
};
const f32 = (v: number) => Array.from(new Uint8Array(new Float32Array([v]).buffer));

/** A Falc file from (tag, data) records; ends with tag 1 unless `end` is false. */
function falc(records: [number, number[]][], end = true): Uint8Array {
  const out = ascii("Falc");
  for (const [tag, data] of [...records, ...(end ? ([[FalcTag.EndOfFile, []]] as [number, number[]][]) : [])]) {
    out.push(...u16(tag), ...u16(data.length), ...data);
  }
  return new Uint8Array(out);
}

/** A 2.x text line record (tag 33): group, line, size, place, then the string and run-length attributes. */
function textLine(group: number, line: number, text: string, size: number, attr = 0x02): number[] {
  const head = [...u16(group), ...u16(line), 0, 0, 0, 0, ...f32(size), 0, 2, ...new Array(8).fill(0)];
  return [...head, ...pstring(text), 40, attr, text.length, 0, 0];
}

describe("2.x records", () => {
  it("splits the file into records and stops at the end-of-file record", () => {
    const warnings: string[] = [];
    const bytes = falc([[FalcTag.Description, pstring("Sales")]]);
    const extra = new Uint8Array([...bytes, ...u16(2), ...u16(0)]);
    const recs = readFalcRecords(extra, warnings);
    expect(recs.map((r) => r.tag)).toEqual([FalcTag.Description, FalcTag.EndOfFile]);
    expect(recs[0]).toMatchObject({ offset: 4 });
    expect(warnings).toEqual([]);
  });

  it("keeps the records before one that runs past the end, and says so", () => {
    const warnings: string[] = [];
    const good = falc([[FalcTag.Description, pstring("A")]], false);
    const cut = new Uint8Array([...good, ...u16(33), ...u16(50), 1, 2, 3]);
    const recs = readFalcRecords(cut, warnings);
    expect(recs.map((r) => r.tag)).toEqual([FalcTag.Description]);
    expect(warnings.join(" ")).toMatch(/record 33 at offset \d+ runs past the end/);
    expect(warnings.join(" ")).toMatch(/no end-of-file record/);
  });
});

describe("2.x charts", () => {
  it("reads the version, type, description and text lines", () => {
    const warnings: string[] = [];
    const chart = readClassicChart(
      falc([
        [FalcTag.Version, [0, 2, 2, 1]],
        [FalcTag.ChartType, [...u16(1), ...u16(0)]],
        [FalcTag.Description, pstring("Q1 plan")],
        [FalcTag.TextLine, textLine(0, 1, "Hello", 8)],
      ]),
      warnings,
    );
    expect(warnings).toEqual([]);
    expect(chart).toMatchObject({ version: "2.30", kind: "title", chartClass: 1, subtype: 0, description: "Q1 plan" });
    expect(chart.textLines[0]).toMatchObject({ text: "" });
    expect(chart.textLines[1]).toMatchObject({ text: "Hello", size: 8, place: "center", attrs: [2, 2, 2, 2, 2] });
  });

  it("ignores records it does not know and notes a missing chart type", () => {
    const warnings: string[] = [];
    const chart = readClassicChart(falc([[999, [1, 2, 3]], [FalcTag.Version, [0, 2, 0, 1]]]), warnings);
    expect(chart.version).toBe("2.10/2.12");
    expect(chart.kind).toBe("unknown");
    expect(warnings).toEqual(["The chart has no chart type record (tag 30)."]);
  });

  it("reads bar chart series, values (1e30 as missing) and X labels", () => {
    const warnings: string[] = [];
    const chart = readClassicChart(
      falc([
        [FalcTag.ChartType, [...u16(2), ...u16(1)]],
        [FalcTag.PointCount, [...u16(2), ...u16(1)]],
        [FalcTag.XLabel, [0, 0, ...u16(1), ...pstring("Jan")]],
        [FalcTag.XLabel, [0, 0, ...u16(2), ...pstring("Feb")]],
        [FalcTag.SeriesName, [...u16(1), ...pstring("North")]],
        [FalcTag.Values, [...u16(1), 2, 0, ...f32(10), 0xca, 0xf2, 0x49, 0x71]],
      ]),
      warnings,
    );
    expect(chart.kind).toBe("bar");
    expect(chart.graph?.xLabels).toEqual(["Jan", "Feb"]);
    expect(chart.graph?.series[0]).toMatchObject({ name: "North", values: [10, null] });
    expect(chart.graph?.series).toHaveLength(8);
  });
});

describe("1.0 charts", () => {
  function pcok(fill: (b: Uint8Array) => void, length = PCOK_BLOCK_SIZE): Uint8Array {
    const b = new Uint8Array(length);
    b.set(ascii("PCOK"));
    fill(b);
    return b;
  }

  it("reads the class, subtype, description and text chart lines", () => {
    const warnings: string[] = [];
    const chart = readClassicChart(
      pcok((b) => {
        b.set(u16(1), 48);
        b.set(u16(1), 50);
        b.set(pstring("Agenda"), 6);
        b.set(pstring("First"), 160);
        b.set(f32(6), 4342);
        b.set([1], 4546);
      }),
      warnings,
    );
    expect(warnings).toEqual([]);
    expect(chart).toMatchObject({ version: "1.0", kind: "list", description: "Agenda", hasAnnotations: false });
    expect(chart.textLines).toHaveLength(51);
    expect(chart.textLines[0]).toMatchObject({ text: "First", size: 6, place: "left" });
  });

  it("reads a short file with empty fields and a warning", () => {
    const warnings: string[] = [];
    const chart = readClassicChart(pcok((b) => b.set(u16(2), 48), 100), warnings);
    expect(chart.kind).toBe("pie");
    expect(warnings[0]).toMatch(/shorter than the 4716/);
  });

  it("notes an unknown chart class", () => {
    const warnings: string[] = [];
    readClassicChart(pcok((b) => b.set(u16(7), 48)), warnings);
    expect(warnings).toEqual(["Unknown chart class 7 (subtype 0)."]);
  });

  it("counts bytes after the block as annotations", () => {
    expect(readClassicChart(pcok(() => {}, PCOK_BLOCK_SIZE + 10), []).hasAnnotations).toBe(true);
  });
});

describe("neither", () => {
  it("throws for other files", () => {
    expect(() => readClassicChart(new Uint8Array(ascii("HGB3....")), [])).toThrow(NotClassicChartError);
  });
});
