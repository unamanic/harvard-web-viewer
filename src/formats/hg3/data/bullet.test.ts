import { describe, expect, it } from "vitest";
import { DocumentType } from "../container";
import { concat, f64, f64NotSet, leaf, u8 } from "../testing/bytes";
import { parseBulletData, parseTitleData } from "./bullet";
import { chartWith, textLine } from "./testing";

describe("parseBulletData", () => {
  it("pairs each line with the 1108 entry of its row", () => {
    const entries = concat(
      [1, 2, 16, 1], // row 0: bullet, paragraph 1
      [0, 2, 16, 1], // row 1: continuation
      [0, 0, 0, 1], // row 2: empty
      [7, 2, 16, 2], // row 3: number, paragraph 2
      [100, 0, 0, 2], // unused
    );
    const chart = chartWith(DocumentType.Bullet, [
      textLine(8, 3, 0, "Second"),
      textLine(8, 0, 0, "First"),
      textLine(8, 1, 0, "more"),
      leaf(1106, concat([1, 2, 16, 1, 0], f64NotSet(), f64(1), u8(1))),
      leaf(1108, entries),
    ]);
    const w: string[] = [];
    const d = parseBulletData(chart, w);
    expect(w).toEqual([]);
    expect(d.entries).toHaveLength(5);
    expect(d.lines.map((l) => [l.line.text, l.entry?.shapeName, l.entry?.paragraph, l.entry?.colorRole])).toEqual([
      ["First", "bullet", 1, 16],
      ["more", "continuation", 1, 16],
      ["Second", "number", 2, 16],
    ]);
    expect(d.entries[4]!.shapeName).toBe("unused");
    expect(d.options).toMatchObject({ value5: null, value13: 1, defaults: { shape: 1, colorRole: 16 } });
  });

  it("warns about partial entries and lines without an entry", () => {
    const chart = chartWith(DocumentType.Bullet, [textLine(8, 2, 0, "x"), leaf(1108, [3, 2, 16, 1, 9, 9]), leaf(1106, [1])]);
    const w: string[] = [];
    const d = parseBulletData(chart, w);
    expect(d.entries.map((e) => e.shapeName)).toEqual(["unknown"]);
    expect(d.lines[0]!.entry).toBeNull();
    expect(d.options).toBeNull();
    expect(w).toHaveLength(3);
  });
});

describe("parseTitleData", () => {
  it("splits slot 7 lines into sections at rows 0, 4 and 12", () => {
    const chart = chartWith(DocumentType.Title, [
      textLine(7, 15, 0, "Bottom"),
      textLine(7, 0, 0, "Top"),
      textLine(7, 5, 0, "Middle"),
      textLine(7, 3, 0, "Top 2"),
    ]);
    const d = parseTitleData(chart, []);
    expect(d.sections.map((s) => [s.startRow, s.lines.map((l) => l.text)])).toEqual([
      [0, ["Top", "Top 2"]],
      [4, ["Middle"]],
      [12, ["Bottom"]],
    ]);
    expect(d.lines).toHaveLength(4);
  });
});
