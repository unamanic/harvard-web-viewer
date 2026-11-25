import { describe, expect, it } from "vitest";
import { LANDSCAPE_VIEW_BOX, UnsupportedFormatError } from "../types";
import { DocumentType } from "./container";
import { ascii, block, buildDocument, buildFile, concat, cstr, f32, leaf, u16, versionRecord } from "./testing/bytes";
import { hg3Parser } from "./index";

describe("hg3Parser.parse", () => {
  it.each([
    ["HGA2", DocumentType.Palette, "Harvard Graphics 3 palette", "Palette (Palette, type 0x33)"],
  ])("reads a synthetic %s file", (signature, type, formatName, what) => {
    const bytes = buildDocument(signature, type, [block(500, [leaf(400, cstr("demo"))])]);
    const doc = hg3Parser.parse(bytes, "demo");
    expect(doc.formatName).toBe(formatName);
    expect(doc.scenes).toEqual([]);
    expect(doc.warnings).toEqual([`${what}: drawing is not implemented yet.`]);
  });

  it("reads a synthetic show as a presentation", () => {
    const bytes = buildDocument("HGB1", DocumentType.Show, [block(500, [leaf(400, cstr("demo"))])]);
    const doc = hg3Parser.parse(bytes, "demo.sh3");
    expect(doc.formatName).toBe("Harvard Graphics 3 show");
    expect(doc.scenes).toEqual([]);
    expect(doc.presentation).toMatchObject({ id: "demo.sh3", title: "demo", slides: [], firstSlide: 1 });
    expect(doc.warnings).toContain("show has no slides");
  });

  it("builds one scene for a chart and lists the parts not drawn yet", () => {
    const textLine = (slot: number, text: string) =>
      leaf(
        800,
        concat(
          concat(u16(slot), u16(0), u16(0), [0, 0x10], cstr(text), u16(text.length)),
          concat(u16(1), u16(0), u16(1), u16(0), f32(9), u16(2), u16(3), u16(3), u16(0x4268)),
        ),
      );
    const bytes = buildDocument("HGB3", DocumentType.XY, [
      block(500, [leaf(400, cstr("demo"))]),
      block(504, [block(516, [leaf(616, new Uint8Array(4))], new Uint8Array(16)), block(508, [textLine(1, "Title")])]),
    ]);
    const doc = hg3Parser.parse(bytes, "PIE.CH3");
    expect(doc.formatName).toBe("Harvard Graphics 3 chart");
    expect(doc.scenes).toHaveLength(1);
    expect(doc.scenes[0].viewBox).toEqual(LANDSCAPE_VIEW_BOX);
    // The object layer is drawn (task 13); its stray 616 adds object layer warnings first.
    // It holds no drawn copy, so the chart is laid out from data: title text yes (task 14), XY data not yet.
    expect(doc.warnings).toContain("Not drawn yet: XY data.");
  });

  it("collects chart and palette warnings and omits the info when nothing is left to draw", () => {
    const bytes = buildDocument("HGB3", DocumentType.Drawing, [
      block(504, [block(508, [leaf(404, concat(u16(2), u16(0), cstr("GONE.PL3")))])]),
    ]);
    const doc = hg3Parser.parse(bytes, "D.CH3", { path: "D.CH3", resolve: () => null });
    expect(doc.scenes).toHaveLength(1);
    expect(doc.warnings).toContain("chart has no object layer (516)");
    expect(doc.warnings).toContain("palette file GONE.PL3 not found");
    expect(doc.warnings.some((w) => w.startsWith("Not drawn yet"))).toBe(false);
  });

  it("rejects a Harvard Graphics 2 file named .CH3 with the §7.1 message", () => {
    // HG2 charts start with a different header; anything but an HG3 signature.
    const bytes = concat(ascii("HG20"), new Uint8Array(32));
    expect(() => hg3Parser.parse(bytes, "OLD.CH3")).toThrow(UnsupportedFormatError);
    expect(() => hg3Parser.parse(bytes, "OLD.CH3")).toThrow(
      /not a Harvard Graphics 3 file.*Harvard Graphics 2 files \(\.CHT, \.SHW\) are a different format/,
    );
  });

  it("reports a damaged file and keeps the container warnings", () => {
    const bytes = buildFile("HGB3", [versionRecord(DocumentType.Title), leaf(400, cstr("x"), 200)]);
    const doc = hg3Parser.parse(bytes, "BROKEN.CH3");
    expect(doc.formatName).toBe("Harvard Graphics 3 chart");
    expect(doc.warnings[0]).toMatch(/^The file is damaged/);
    expect(doc.warnings.some((w) => w.startsWith("damaged: record 400"))).toBe(true);
    expect(doc.warnings.some((w) => w.startsWith("Not drawn yet"))).toBe(false);
    expect(doc.scenes).toHaveLength(1);
  });
});
