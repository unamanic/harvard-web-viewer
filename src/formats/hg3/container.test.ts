import { describe, expect, it } from "vitest";
import { TruncatedError } from "../ByteReader";
import {
  BLOCKS,
  type BlockRecord,
  DocumentType,
  FileReferenceKind,
  NotHg3Error,
  type RecordNode,
  childrenOf,
  documentTypeName,
  findAll,
  findBlock,
  readContainer,
  readDescription,
  readFileReference,
} from "./container";
import {
  END,
  ascii,
  block,
  buildDocument,
  buildFile,
  concat,
  cstr,
  i16,
  leaf,
  raw,
  u16,
  versionRecord,
} from "./testing/bytes";

/** Compact shape of a tree: tags for leaves, [open, ...children] for blocks. */
type Shape = number | [number, ...Shape[]];
const shape = (nodes: RecordNode[]): Shape[] =>
  nodes.map((n) => (n.type === "record" ? n.tag : ([n.openTag, ...shape(n.children)] as Shape)));

const fileRef = (kind: number, index: number, name: string) => concat(u16(kind), u16(index), cstr(name));

describe("readContainer: well-formed documents", () => {
  it("parses a minimal chart to the last byte", () => {
    const boxes = concat(i16(0), i16(0), i16(100), i16(50), i16(-10), i16(-20), i16(9999), i16(6999));
    const bytes = buildDocument("HGB3", DocumentType.Title, [
      block(500, [leaf(400, cstr("Quarterly")), leaf(402, new Uint8Array(684))]),
      leaf(404, fileRef(FileReferenceKind.Palette, 0, "HG3.PL3")),
      block(504, [block(508, [leaf(800, [1, 2, 3])]), block(516, [leaf(612, [9])], boxes)]),
    ]);
    const c = readContainer(bytes);
    expect(c.kind).toBe("chart");
    expect(c.signature).toBe("HGB3");
    expect(c.version).toEqual({ major: 0, minor: 3, patch: 0, documentType: 0x1f });
    expect(c.warnings).toEqual([]);
    expect(c.damaged).toBe(false);
    expect(c.endOffset).toBe(bytes.length);
    expect(shape(c.root)).toEqual([0, [500, 400, 402], 404, [504, [508, 800], [516, 612]], 1]);

    const layer = findBlock(c.root, 516)!;
    expect(layer.closeTag).toBe(517);
    expect(Array.from(layer.data)).toEqual(Array.from(boxes));
    expect(findBlock(c.root, 504)!.data.length).toBe(0);
    expect(readDescription(findAll(c.root, 400)[0].data)).toBe("Quarterly");
  });

  it("records absolute offsets of record headers", () => {
    const bytes = buildDocument("HGB3", DocumentType.XY, [block(500, [leaf(400, cstr("ab"))])]);
    const c = readContainer(bytes);
    // signature 4, version record 8 => 500 at 12, 400 at 16, 501 at 23, end at 27
    expect(c.root.map((n) => n.offset)).toEqual([4, 12, 27]);
    expect((c.root[1] as BlockRecord).children[0].offset).toBe(16);
  });

  it("parses a minimal show", () => {
    const bytes = buildDocument("HGB1", DocumentType.Show, [
      block(500, [leaf(400, cstr(""))]),
      block(520, [leaf(404, fileRef(20, 1, "A.CH3")), leaf(702, new Uint8Array(20)), leaf(404, fileRef(20, 2, "B.CH3"))]),
    ]);
    const c = readContainer(bytes);
    expect(c.kind).toBe("show");
    expect(c.warnings).toEqual([]);
    expect(c.endOffset).toBe(bytes.length);
    expect(shape(c.root)).toEqual([0, [500, 400], [520, 404, 702, 404], 1]);
    expect(findAll(childrenOf(c.root, 520), 404).map((r) => readFileReference(r.data))).toEqual([
      { kind: 20, index: 1, name: "A.CH3" },
      { kind: 20, index: 2, name: "B.CH3" },
    ]);
    expect(readDescription(findAll(c.root, 400)[0].data)).toBe("");
  });

  it("parses a minimal palette", () => {
    const bytes = buildDocument("HGA2", DocumentType.CustomPalette, [block(524, [leaf(1000, [1, 2, 3, 4])])]);
    const c = readContainer(bytes);
    expect(c.kind).toBe("palette");
    expect(documentTypeName(c.version.documentType)).toBe("CustomPalette");
    expect(c.warnings).toEqual([]);
    expect(c.endOffset).toBe(bytes.length);
    expect(shape(c.root)).toEqual([0, [524, 1000], 1]);
  });

  it("nests 608/610 object groups", () => {
    const bytes = buildDocument("HGB3", DocumentType.Drawing, [
      block(504, [block(516, [leaf(612), block(608, [leaf(612), block(608, [leaf(612)], new Uint8Array(16))], new Uint8Array(16))], new Uint8Array(16))]),
    ]);
    const c = readContainer(bytes);
    expect(c.warnings).toEqual([]);
    expect(shape(c.root)).toEqual([0, [504, [516, 612, [608, 612, [608, 612]]]], 1]);
    expect(findBlock(c.root, 608)!.closeTag).toBe(610);
    expect(findBlock(c.root, 608)!.data.length).toBe(16);
    expect(findAll(c.root, 612)).toHaveLength(3);
  });

  it("keeps unknown tags as raw leaf records", () => {
    const bytes = buildDocument("HGB3", DocumentType.XY, [leaf(0x7777, [0xde, 0xad]), block(504, [leaf(9999)])]);
    const c = readContainer(bytes);
    expect(c.warnings).toEqual([]);
    const unknown = findAll(c.root, 0x7777);
    expect(unknown).toHaveLength(1);
    expect(Array.from(unknown[0].data)).toEqual([0xde, 0xad]);
    expect(findAll(c.root, 9999)).toHaveLength(1);
  });

  it("exports the block table and document types", () => {
    expect(BLOCKS.map((b) => [b.open, b.close])).toEqual([
      [500, 501], [504, 505], [508, 509], [516, 517], [520, 521], [524, 525], [608, 610],
    ]);
    expect(DocumentType.Pie).toBe(0x15);
    expect(documentTypeName(0x99)).toBeUndefined();
  });
});

describe("readContainer: rejection (SPEC §7.1)", () => {
  it.each([
    ["empty", new Uint8Array(0)],
    ["short signature", ascii("HGB")],
    ["wrong signature", buildFile("HGB2", [versionRecord(1), END])],
    ["HG2-like bytes", concat(ascii("HG\x1a\x00"), new Uint8Array(20))],
    ["no records", ascii("HGB3")],
    ["first record not version", buildFile("HGB3", [leaf(400, cstr("x")), versionRecord(1), END])],
    ["version wrong length", buildFile("HGB3", [leaf(0, [0, 3, 0]), END])],
    ["version truncated", concat(ascii("HGB3"), u16(0), u16(4), [0, 3])],
  ])("%s", (_name, bytes) => {
    expect(() => readContainer(bytes)).toThrow(NotHg3Error);
    expect(() => readContainer(bytes)).toThrow(/not a Harvard Graphics 3 file.*\.CHT, \.SHW/);
  });
});

describe("readContainer: damage and warnings (SPEC §7.1)", () => {
  it("stops at a record whose length runs past EOF", () => {
    const bytes = buildFile("HGB3", [versionRecord(1), block(500, [leaf(400, cstr("ok"))]), leaf(404, [1, 2], 50)]);
    const c = readContainer(bytes);
    expect(c.damaged).toBe(true);
    expect(c.warnings.some((w) => /damaged/.test(w) && /404/.test(w))).toBe(true);
    expect(shape(c.root)).toEqual([0, [500, 400]]);
    expect(c.endOffset).toBe(bytes.length - 6);
  });

  it("treats a truncated record header as damage", () => {
    const bytes = buildFile("HGB3", [versionRecord(1), raw([0x90, 0x01])]);
    const c = readContainer(bytes);
    expect(c.damaged).toBe(true);
    expect(c.endOffset).toBe(bytes.length - 2);
  });

  it("closes blocks left open by damage", () => {
    const bytes = concat(buildFile("HGB3", [versionRecord(1)]), u16(504), u16(0), u16(612), u16(100));
    const c = readContainer(bytes);
    expect(c.damaged).toBe(true);
    expect(shape(c.root)).toEqual([0, [504]]);
    expect(c.warnings.some((w) => /504.*not closed/.test(w))).toBe(true);
  });

  it("warns (not damaged) when the end record is missing", () => {
    const bytes = buildFile("HGB3", [versionRecord(1), block(500, [leaf(400, cstr(""))])]);
    const c = readContainer(bytes);
    expect(c.damaged).toBe(false);
    expect(c.warnings).toEqual([expect.stringMatching(/no end record/)]);
    expect(c.endOffset).toBe(bytes.length);
    expect(shape(c.root)).toEqual([0, [500, 400]]);
  });

  it("warns about data after the end record", () => {
    const doc = buildDocument("HGA2", DocumentType.Palette, [block(524)]);
    const bytes = concat(doc, [1, 2, 3]);
    const c = readContainer(bytes);
    expect(c.damaged).toBe(false);
    expect(c.endOffset).toBe(doc.length);
    expect(c.warnings).toEqual([expect.stringMatching(/3 byte\(s\) after the end record/)]);
  });

  it("closes unclosed blocks at the end record", () => {
    const bytes = buildFile("HGB3", [versionRecord(1), leaf(504), leaf(508), leaf(800), END]);
    const c = readContainer(bytes);
    expect(shape(c.root)).toEqual([0, [504, [508, 800]], 1]);
    expect(c.warnings).toHaveLength(2);
    expect(c.endOffset).toBe(bytes.length);
  });

  it("a close tag matching an outer block closes the inner ones", () => {
    const bytes = buildFile("HGB3", [versionRecord(1), leaf(504), leaf(508), leaf(800), leaf(505), leaf(404, fileRef(2, 0, "X.PL3")), END]);
    const c = readContainer(bytes);
    expect(shape(c.root)).toEqual([0, [504, [508, 800]], 404, 1]);
    expect(c.warnings).toEqual([expect.stringMatching(/508.*not closed.*505/)]);
  });

  it("keeps a stray close tag as a leaf record", () => {
    const bytes = buildFile("HGB3", [versionRecord(1), leaf(504), leaf(509), leaf(505), END]);
    const c = readContainer(bytes);
    expect(shape(c.root)).toEqual([0, [504, 509], 1]);
    expect(c.warnings).toEqual([expect.stringMatching(/stray block close 509/)]);
  });

  it("warns when 516 does not carry 16 bytes", () => {
    const bytes = buildDocument("HGB3", DocumentType.Drawing, [block(516, [], [1, 2])]);
    const c = readContainer(bytes);
    expect(findBlock(c.root, 516)!.data.length).toBe(2);
    expect(c.warnings).toEqual([expect.stringMatching(/516.*expected 16/)]);
  });

  it("warns about an unknown document type", () => {
    const c = readContainer(buildDocument("HGB3", 0x42, []));
    expect(c.warnings).toEqual([expect.stringMatching(/unknown document type 0x42/)]);
  });
});

describe("header decoders", () => {
  it("reads a 404 file reference", () => {
    expect(readFileReference(fileRef(5, 0, "BACK.PCX"))).toEqual({ kind: 5, index: 0, name: "BACK.PCX" });
    expect(readFileReference(fileRef(20, 7, "SLIDE7.CH3"))).toEqual({ kind: 20, index: 7, name: "SLIDE7.CH3" });
    // Name without terminator still decodes.
    expect(readFileReference(concat(u16(2), u16(0), ascii("HG3.PL3"))).name).toBe("HG3.PL3");
    expect(() => readFileReference(Uint8Array.of(2, 0))).toThrow(TruncatedError);
  });

  it("reads a 400 description in CP437", () => {
    expect(readDescription(concat(ascii("Caf"), [0x82], [0]))).toBe("Café");
    expect(readDescription(new Uint8Array(0))).toBe("");
  });
});
