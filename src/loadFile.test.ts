import { describe, expect, it } from "vitest";
import { FileSet } from "./files/FileSet";
import { DocumentType } from "./formats/hg3/container";
import { block, buildDocument, concat, cstr, f32, i16, leaf, u16 } from "./formats/hg3/testing/bytes";
import { loadFileSet, openFileSet } from "./loadFile";

/** A drawing whose one text line uses Swiss 721 Bold (3:5:0x42a8), which has an outline clone. */
function chartWithText(): Uint8Array {
  const box = concat(i16(0), i16(2000), i16(4000), i16(0));
  const s = cstr("Hi");
  const run = concat(s, [0], u16(2), u16(1), u16(0), u16(1), u16(0), f32(4), u16(1), u16(3), u16(5), u16(0x42a8));
  const data = concat(
    u16(110), u16(110 + run.length - 22), [1, 0, 1, 0, 0, 0, 0, 0, 1, 3], u16(2), u16(1),
    new Uint8Array(8), [1, 0, 1, 0], new Uint8Array(8), box, new Uint8Array(8), box, box, box, u16(0), u16(1),
    concat([1, 0x81, 0, 0], u16(0), u16(0), [2], new Uint8Array(19)), run,
  );
  const sub = (tag: number, d: Uint8Array) => concat(u16(tag), u16(d.length), d);
  const obj = leaf(612, concat(box, new Uint8Array(8), sub(0x10b0, data), sub(0x1fff, new Uint8Array(0))));
  return buildDocument("HGB3", DocumentType.Drawing, [
    block(500, [leaf(400, cstr("demo"))]),
    block(504, [block(516, [obj], new Uint8Array(16)), block(508, [])]),
  ]);
}

describe("loadFileSet", () => {
  it("prepares fonts before parsing, so the first scene already uses the clone", async () => {
    const set = new FileSet([{ path: "A.CH3", bytes: chartWithText() }]);
    expect(openFileSet(set)!.document!.scenes[0]!.elements[0]!.kind).toBe("text");
    const loaded = await loadFileSet(set);
    expect(loaded!.document!.scenes[0]!.elements[0]!.kind).toBe("glyphs");
    expect(loaded!.warnings).toContain("Fonts: Swiss 721 Bold — clone HWV Sans Bold");
  });
});
