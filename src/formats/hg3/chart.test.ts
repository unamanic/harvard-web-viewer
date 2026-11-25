import { describe, expect, it } from "vitest";
import { effectiveStyle, linesBySlot, parseChart, styleEntryFor, styleIndexFor } from "./chart";
import { DocumentType, readContainer } from "./container";
import { type RecordSpec, block, buildDocument, concat, cstr, f32, f64, i16, leaf, padded, u16, u8 } from "./testing/bytes";
import { Justification, TextSlot } from "./text";

const SWISS = [3, 3, 0x4268];
const DUTCH = [3, 13, 0x42a8];

function textLine(
  slot: number,
  row: number,
  column: number,
  text: Uint8Array | string,
  o: { len?: number; color?: number; size?: number; just?: number; key?: number[] } = {},
): RecordSpec {
  const bytes = typeof text === "string" ? cstr(text) : text;
  const [s, n, st] = o.key ?? SWISS;
  return leaf(
    800,
    concat(
      u16(slot),
      u16(row),
      u16(column),
      u8(0),
      u8(0x10),
      bytes,
      u16(o.len ?? bytes.length - 1),
      u16(o.color ?? 1),
      u16(0),
      u16(o.color ?? 1),
      u16(0),
      f32(o.size ?? 9),
      u16(o.just ?? 2),
      u16(s),
      u16(n),
      u16(st),
    ),
  );
}

const area = (tag: number, x1: number, y1: number, x2: number, y2: number) =>
  leaf(tag, concat(i16(x1), i16(y1), i16(x2), i16(y2), u16(0)));
const ref = (kind: number, name: string) => leaf(404, concat(u16(kind), u16(0), cstr(name)));
const styleEntry = (size: number, role: number, just: number, key = SWISS) =>
  concat(f64(size), u8(role), u8(just), u16(key[0]), u16(key[1]), u16(key[2]));

function pieChart(extra: RecordSpec[] = []) {
  const styles = concat(
    styleEntry(9, 1, 2),
    styleEntry(5, 2, 2),
    styleEntry(5, 3, 2),
    styleEntry(3.5, 7, 1),
    styleEntry(3.5, 7, 1),
    styleEntry(3.5, 7, 1),
    styleEntry(4, 2, 1),
    styleEntry(4, 2, 1, DUTCH),
  );
  return buildDocument("HGB3", DocumentType.Pie, [
    block(500, [leaf(400, cstr("Sales by region")), leaf(402, new Uint8Array(684))]),
    block(504, [
      leaf(814, concat(padded("NEXT  ", 13), u8(3), padded("BACK", 13), u8(4))),
      block(516, [leaf(616, new Uint8Array(4))], new Uint8Array(16)),
      block(508, [
        textLine(1, 1, 0, "Subtitle", { color: 2, size: 5 }),
        textLine(1, 0, 0, "Title"),
        textLine(2, 0, 0, "Footnote", { color: 7, size: 3.5, just: 1 }),
        textLine(5, 1, 0, "Pie two", { size: 0, color: 0, just: 0, key: [0, 0, 0] }),
        textLine(5, 0, 0, Uint8Array.of(0x81, 0x62, 0x65, 0x72, 0), { len: 9 }),
        area(802, 0, 0, 10000, 7500),
        area(804, 0, 5600, 10000, 7500),
        area(806, 500, 1000, 9500, 5600),
        area(808, 0, 0, 5000, 1000),
        area(810, 0, 0, 0, 0),
        leaf(816, concat(u8(2), u8(1), f32(8.5), f32(11))),
        ref(1, "galbutn1.ch3"),
        ref(2, "HG3.PL3"),
        ref(4, "PORTRAIT.CH3"),
        ref(5, "BACK.PCX"),
        ref(5, "PATT01.PCC"),
        leaf(820, [2, 2, 2, 12, 1, 1, 12, 12, 12, 15, 15, 15]),
        leaf(822, new Uint8Array(19)),
        leaf(824, [0x55, 0]),
        leaf(1304, new Uint8Array(7)),
        leaf(1308, styles),
        leaf(1316, new Uint8Array(32)),
        ...extra,
      ]),
    ]),
  ]);
}

describe("parseChart", () => {
  it("reads the common records", () => {
    const { chart, warnings } = parseChart(readContainer(pieChart()));
    expect(chart.chartType).toBe(DocumentType.Pie);
    expect(chart.name).toBe("Pie");
    expect(chart.description).toBe("Sales by region");
    expect(chart.fileRefs).toMatchObject({
      paletteName: "HG3.PL3",
      buttonChartName: "galbutn1.ch3",
      embeddedChartNames: ["PORTRAIT.CH3"],
      bitmapNames: ["BACK.PCX", "PATT01.PCC"],
    });
    expect(chart.fileRefs.all).toHaveLength(5);
    expect(chart.areas.frame).toEqual({ x1: 0, y1: 0, x2: 10000, y2: 7500, trailer: 0 });
    expect(chart.areas.title?.y1).toBe(5600);
    expect(chart.areas.plot?.x1).toBe(500);
    expect(chart.areas.footnote?.x2).toBe(5000);
    expect(chart.areas.legend).toBeNull();
    expect(chart.pageSetup).toEqual({ orientation: "portrait", orientationCode: 2, paperSize: 1, widthIn: 8.5, heightIn: 11 });
    expect(chart.buttonNames).toEqual([
      { name: "NEXT", destination: 3 },
      { name: "BACK", destination: 4 },
    ]);
    expect(chart.textLines).toHaveLength(5);
    expect(chart.textLines[4].text).toBe("über");
    expect(chart.styleTables.get(1308)).toHaveLength(8);
    expect(Array.from(chart.raw824!)).toEqual([0x55, 0]);
    expect(chart.raw820).toHaveLength(12);
    expect(chart.raw822).toHaveLength(19);
    expect(chart.raw1700).toBeNull();
    expect(chart.dataRecords.map((r) => r.tag)).toEqual([1304, 1316]);
    expect(chart.objectLayer?.openTag).toBe(516);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/declares text length 9 but the text has 4/);
  });

  it("lists every embedded chart (404 kind 4) without a warning", () => {
    const { chart, warnings } = parseChart(readContainer(pieChart([ref(4, "LANDSCAP.CH3")])));
    expect(chart.fileRefs.embeddedChartNames).toEqual(["PORTRAIT.CH3", "LANDSCAP.CH3"]);
    expect(warnings.filter((w) => /file references of kind/.test(w))).toEqual([]);
  });

  it("decodes file names as stored, not in the HG3 set", () => {
    const { chart } = parseChart(readContainer(pieChart([ref(5, "LOGO\u00e9.PCX")])));
    // cstr writes char codes as bytes; 0xE9 is Ú in the HG3 set, é in ISO 8859-1.
    expect(chart.fileRefs.bitmapNames.at(-1)).toBe("LOGO\u00e9.PCX");
  });

  it("orders lines by row then column", () => {
    const { chart } = parseChart(
      readContainer(
        buildDocument("HGB3", DocumentType.Table, [
          block(504, [
            block(516, [], new Uint8Array(16)),
            block(508, [
              textLine(6, 1, 1, "b1"),
              textLine(6, 0, 1, "a1"),
              textLine(6, 1, 0, "b0"),
              textLine(1, 0, 0, "T"),
              textLine(6, 0, 0, "a0"),
            ]),
          ]),
        ]),
      ),
    );
    expect(linesBySlot(chart, TextSlot.TableCells).map((l) => l.text)).toEqual(["a0", "a1", "b0", "b1"]);
    expect(linesBySlot(chart, TextSlot.Title).map((l) => l.text)).toEqual(["T"]);
    expect(linesBySlot(chart, TextSlot.BulletList)).toEqual([]);
  });

  it("fills missing values from the style table", () => {
    const { chart } = parseChart(readContainer(pieChart()));
    const pie2 = linesBySlot(chart, TextSlot.PieTitles)[1];
    expect(pie2.text).toBe("Pie two");
    const entry = styleEntryFor(chart, pie2);
    expect(entry).toMatchObject({ size: 4, colorRole: 2 });
    const s = effectiveStyle(pie2, entry);
    expect(s).toEqual({
      size: 4,
      color: 2,
      justification: Justification.Left,
      fontKey: { source: 3, number: 13, style: 0x42a8 },
      fromStyleTable: ["size", "color", "justification", "fontKey"],
    });
    // A line with its own values keeps them.
    const title = linesBySlot(chart, TextSlot.Title)[0];
    const own = effectiveStyle(title, styleEntryFor(chart, title));
    expect(own).toMatchObject({ size: 9, color: 1, justification: 2, fromStyleTable: [] });
    // No entry: values unchanged.
    expect(effectiveStyle(pie2).size).toBe(0);
    // An unused entry (size 0) supplies nothing.
    expect(effectiveStyle(pie2, { size: 0, colorRole: 5, justification: 1, fontKey: { source: 3, number: 3, style: 1 } }).color).toBe(0);
  });

  it("maps slots to style entries", () => {
    expect(styleIndexFor(1412, TextSlot.Title, 1)).toBe(1);
    expect(styleIndexFor(1412, TextSlot.Title, 7)).toBe(2);
    expect(styleIndexFor(1412, TextSlot.AxisTitles, 2)).toBe(8);
    expect(styleIndexFor(1412, TextSlot.SeriesNames, 11)).toBe(15);
    expect(styleIndexFor(1308, TextSlot.PieTitles, 3)).toBe(9);
    expect(styleIndexFor(906, TextSlot.Footnote, 0)).toBe(6);
    expect(styleIndexFor(1102, TextSlot.BulletList, 20)).toBe(3);
    expect(styleIndexFor(1202, TextSlot.TableCells, 2)).toBe(3);
    expect(styleIndexFor(1002, TextSlot.TitleChart, 0)).toBe(0);
    expect(styleIndexFor(1002, TextSlot.TitleChart, 5)).toBe(1);
    expect(styleIndexFor(1002, TextSlot.TitleChart, 15)).toBe(2);
    expect(styleIndexFor(1002, TextSlot.Title, 0)).toBeUndefined();
    expect(styleIndexFor(1412, TextSlot.TableCells, 0)).toBeUndefined();
  });

  it("warns about short records and keeps going", () => {
    const { chart, warnings } = parseChart(
      readContainer(
        pieChart([leaf(800, new Uint8Array(12)), leaf(404, [1]), textLine(1, 2, 0, "Sub 2", { color: 3, size: 5 })]),
      ),
    );
    expect(chart.textLines).toHaveLength(6);
    expect(warnings.some((w) => /text line \(800\).*too short/.test(w))).toBe(true);
    expect(warnings.some((w) => /file reference \(404\).*too short/.test(w))).toBe(true);
  });

  it("survives a chart with nothing in it", () => {
    const { chart, warnings } = parseChart(readContainer(buildDocument("HGB3", DocumentType.Drawing, [])));
    expect(chart.textLines).toEqual([]);
    expect(chart.pageSetup).toBeNull();
    expect(chart.fileRefs.paletteName).toBeNull();
    expect(chart.objectLayer).toBeNull();
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("warns about short page records", () => {
    const { chart, warnings } = parseChart(
      readContainer(
        buildDocument("HGB3", DocumentType.Drawing, [
          block(504, [block(516, [], new Uint8Array(16)), block(508, [leaf(802, [1, 2]), leaf(816, [1, 1]), leaf(814, new Uint8Array(15))])]),
        ]),
      ),
    );
    expect(chart.areas.frame).toBeNull();
    expect(chart.pageSetup).toBeNull();
    expect(chart.buttonNames).toHaveLength(1);
    expect(warnings).toHaveLength(3);
  });

  it("rejects non-chart containers", () => {
    expect(() => parseChart(readContainer(buildDocument("HGB1", DocumentType.Show, [])))).toThrow(/not a chart/);
  });
});
