import { describe, expect, it } from "vitest";
import type { GlyphsElement, TextElement } from "../../model/scene";
import { CHAR_WIDTH, FONT_FAMILY } from "./assumptions";
import { emptyText } from "./model";
import { drawLine, loadTextFaces, plainText, textWidth } from "./text";

// The faces are cached for the whole module, so the fallback is tested first.
describe("1.x/2.x text", () => {
  it("falls back to CSS text with an estimated width before the faces load", () => {
    expect(textWidth("ABCD", 100)).toBe(4 * CHAR_WIDTH * 100);
    const el = plainText("Hi", 10, 20, 100, "#fff", "middle", 700) as TextElement;
    expect(el).toMatchObject({ kind: "text", text: "Hi", fontFamily: FONT_FAMILY, fontWeight: 700, anchor: "middle" });
  });

  it("draws glyphs measured from the clone faces once loaded", async () => {
    await loadTextFaces();
    const width = textWidth("Total", 1000);
    expect(width).toBeGreaterThan(0);
    expect(width).not.toBe(5 * CHAR_WIDTH * 1000);
    expect(textWidth("MMMM", 1000, true)).toBeGreaterThan(textWidth("MMMM", 1000));

    const el = plainText("Total", 500, 300, 1000, "#ff0000", "end") as GlyphsElement;
    expect(el.kind).toBe("glyphs");
    expect(el.text).toBe("Total");
    expect(el.fill).toBe("#ff0000");
    // Right-aligned: the line ends at x = 500.
    expect(el.transform![4] + (el.advance * el.transform![0])).toBeCloseTo(500, 6);
    expect((el.advance * 1000) / el.em).toBeCloseTo(width, 6);
  });

  it("lays out attribute runs one after the other, underlining at the run's width", async () => {
    await loadTextFaces();
    const line = { ...emptyText(), text: "ab", attrs: [0x02 | 0x08, 0] }; // "a" bold and underlined, "b" plain
    const els = drawLine(line, { x: 0, y: 0, size: 1000, anchor: "start" });
    const [a, underline, b] = els as [GlyphsElement, { kind: string; width: number }, GlyphsElement];
    expect(underline.kind).toBe("rect");
    expect(underline.width).toBeCloseTo(textWidth("a", 1000, true), 6);
    expect(b.transform![4]).toBeCloseTo(a.transform![4] + underline.width, 6);
  });
});
