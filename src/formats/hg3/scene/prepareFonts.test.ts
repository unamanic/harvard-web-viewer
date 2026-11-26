import { describe, expect, it } from "vitest";
import type { SceneElement } from "../../../model/scene";
import type { ParseContext, ResolvedFile } from "../../parser";
import { DocumentType } from "../container";
import { hg3Parser } from "../index";
import { type RecordSpec, block, buildDocument, concat, cstr, f32, i16, leaf, u16 } from "../testing/bytes";
import { documentFontKeys } from "./prepareFonts";

/** Dutch 801 Bold: a Speedo key with an outline clone (HWV Serif Bold). */
const DUTCH_BOLD = { source: 3, number: 13, style: 0x42a8 };

const box = (x1: number, y1: number, x2: number, y2: number) => concat(i16(x1), i16(y1), i16(x2), i16(y2));
const sub = (tag: number, data: Uint8Array) => concat(u16(tag), u16(data.length), data);

function textObject(text: string, key: { source: number; number: number; style: number }): RecordSpec {
  const s = cstr(text);
  const run = concat(s, s.length % 2 ? [0] : [], u16(text.length), u16(1), u16(0), u16(1), u16(0), f32(4), u16(1), u16(key.source), u16(key.number), u16(key.style));
  const headerLength = 110;
  const b = box(0, 2000, 4000, 0);
  const data = concat(
    u16(headerLength), u16(headerLength + run.length - 22), [1, 0, 1, 0, 0, 0, 0, 0, 1, 3], u16(text.length), u16(1),
    new Uint8Array(8), [1, 0, 1, 0], new Uint8Array(8), b, new Uint8Array(8), b, b, b, u16(0), u16(1),
    concat([1, 0x81, 0, 0], u16(0), u16(0), [text.length], new Uint8Array(19)), run,
  );
  return leaf(612, concat(box(0, 0, 10, 10), new Uint8Array(8), sub(0x10b0, data), sub(0x1fff, new Uint8Array(0))));
}

function chart(objects: RecordSpec[], refs: RecordSpec[] = []): Uint8Array {
  return buildDocument("HGB3", DocumentType.Drawing, [
    block(500, [leaf(400, cstr("demo")), ...refs]),
    block(504, [block(516, objects, new Uint8Array(16)), block(508, [])]),
  ]);
}

function context(files: Record<string, Uint8Array>): ParseContext {
  return {
    path: "MAIN.CH3",
    resolve(name: string): ResolvedFile | null {
      const base = name.replace(/^.*[\\/:]/, "").toUpperCase();
      return files[base] ? { path: base, name: base, bytes: files[base]! } : null;
    },
  };
}

const kinds = (els: SceneElement[]) => els.map((e) => e.kind);

describe("font preparation", () => {
  const bytes = chart([textObject("Title", DUTCH_BOLD)]);

  it("lists the font keys a chart's text uses", () => {
    expect(documentFontKeys(bytes, undefined)).toEqual([DUTCH_BOLD]);
    expect(documentFontKeys(new Uint8Array([1, 2, 3]), undefined)).toEqual([]);
  });

  it("follows embedded charts", () => {
    const inner = chart([textObject("x", { source: 2, number: 16, style: 0x5848 })]);
    // 404 kind 4 reference in the chart header (ChartFileRefs.embeddedChartNames).
    const ref = leaf(404, concat(u16(4), u16(0), cstr("INNER.CH3")));
    const outer = chart([textObject("y", DUTCH_BOLD)], [ref]);
    const keys = documentFontKeys(outer, context({ "INNER.CH3": inner }));
    expect(keys).toContainEqual(DUTCH_BOLD);
    expect(keys).toContainEqual({ source: 2, number: 16, style: 0x5848 });
  });

  it("parse works synchronously without preparation (CSS fallback), then draws glyphs once prepared", async () => {
    const before = hg3Parser.parse(bytes, "MAIN.CH3");
    expect(kinds(before.scenes[0]!.elements)).toEqual(["text"]);
    expect(before.warnings.at(-1)).toBe("Fonts: Dutch 801 Bold — look-alike Times New Roman (CSS, clone not loaded)");

    await hg3Parser.prepare!(bytes, "MAIN.CH3");
    const after = hg3Parser.parse(bytes, "MAIN.CH3");
    expect(kinds(after.scenes[0]!.elements)).toEqual(["glyphs"]);
    expect(after.warnings.at(-1)).toBe("Fonts: Dutch 801 Bold — clone HWV Serif Bold");
  });

  it("prepare never rejects on bad input", async () => {
    await expect(hg3Parser.prepare!(new Uint8Array([0, 1, 2]), "X.CH3")).resolves.toBeUndefined();
  });
});
