import { describe, expect, it } from "vitest";
import { type BlockRecord, DocumentType, findBlock, readContainer } from "./container";
import {
  type DrawnObject,
  type ObjectGroup,
  type Shape,
  allObjects,
  applyTransform,
  objectColors,
  parseObjectLayer,
  shapeColors,
} from "./objects";
import { type ByteSource, type RecordSpec, block, buildDocument, concat, cstr, f32, i16, leaf, u16 } from "./testing/bytes";

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

const box = (x1: number, y1: number, x2: number, y2: number): Uint8Array => concat(i16(x1), i16(y1), i16(x2), i16(y2));
const sub = (tag: number, data: ByteSource): Uint8Array => concat(u16(tag), u16(data.length), data);
const END = sub(0x1fff, []);
const transform = (t: number[]): RecordSpec => leaf(616, concat(...t.map(f32)));
const IDENT = [1, 0, 0, 1, 0, 0];

function object612(bbox: number[], subs: Uint8Array[], flags: number[] = [0, 0, 0, 0, 0, 0, 0, 0]): RecordSpec {
  return leaf(612, concat(box(bbox[0]!, bbox[1]!, bbox[2]!, bbox[3]!), flags, ...subs));
}

/** 616 + 612 with the given sub-records and a closing 0x1FFF. */
function obj(subs: Uint8Array[], t: number[] = IDENT, bbox = [0, 0, 10, 10]): RecordSpec[] {
  return [transform(t), object612(bbox, [...subs, END])];
}

function layerBlock(children: RecordSpec[], data: Uint8Array = concat(box(-5, -6, 7, 8), box(-16137, -11037, 16137, 12041))): BlockRecord {
  const bytes = buildDocument("HGB3", DocumentType.Drawing, [block(504, [block(516, children, data)])]);
  const b = findBlock(readContainer(bytes).root, 516);
  if (!b) throw new Error("no 516");
  return b;
}

function parse(children: RecordSpec[]) {
  return parseObjectLayer(layerBlock(children));
}

function single(subs: Uint8Array[]): { o: DrawnObject; warnings: string[] } {
  const { layer, warnings } = parse(obj(subs));
  const o = layer.items[0];
  if (o?.kind !== "object") throw new Error("expected an object");
  return { o, warnings };
}

function shapeOf(subs: Uint8Array[]): Shape {
  const { o } = single(subs);
  if (!o.shape) throw new Error("no shape");
  return o.shape;
}

const pts = (...p: number[]): Uint8Array => concat(...p.map(i16));
const countedPoints = (n: number, p: Uint8Array): Uint8Array => concat(u16(n), u16(1), u16(n), p);

/** 22-byte text tail (SPEC §5.3). */
function tail(len: number, color: number, size: number, just: number): Uint8Array {
  return concat(u16(len), u16(color), u16(0), u16(color), u16(0), f32(size), u16(just), u16(3), u16(3), u16(0x4268));
}

/** A run: string, NUL, pad to even, tail. */
function run(text: string, color = 1, size = 3.5, just = 1): Uint8Array {
  const s = cstr(text);
  return concat(s, s.length % 2 ? [0] : [], tail(text.length, color, size, just));
}

/** A text block 0x10B0 with the header layout found in the samples. */
function textBlock(runs: Uint8Array[], lines: [start: number, length: number][], textBox: number[]): Uint8Array {
  const headerLength = 82 + 28 * lines.length;
  const body = concat(...runs);
  const total = headerLength + body.length;
  const textLength = lines.reduce((n, [, l]) => n + l, 0);
  const header = concat(
    u16(headerLength),
    u16(total - 22),
    [1, 0, 1, 0, 0, 0, 0, 0, 1, 3],
    u16(textLength),
    u16(runs.length),
    new Uint8Array(8),
    [1, 0, 1, 0],
    new Uint8Array(8), // 30: stale bytes
    box(textBox[0]!, textBox[1]!, textBox[2]!, textBox[3]!), // 38
    new Uint8Array(8), // 46
    box(textBox[0]!, textBox[1]!, textBox[2]!, textBox[3]!), // 54
    box(1, 2, 3, 4), // 62
    box(1, 2, 3, 4), // 70
    u16(0), // 78
    u16(lines.length), // 80
    ...lines.map(([start, length]) => concat([1, 0x81, 0, 0], u16(start), u16(0), [length], new Uint8Array(19))),
  );
  expect(header.length).toBe(headerLength);
  return concat(header, body);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("parseObjectLayer: layer and grouping", () => {
  it("returns an empty layer for a null block", () => {
    const { layer, warnings } = parseObjectLayer(null);
    expect(layer).toEqual({ extent: null, canvas: null, items: [], otherRecords: [] });
    expect(warnings).toEqual([]);
  });

  it("reads the 516 boxes", () => {
    const { layer, warnings } = parse([]);
    expect(layer.extent).toEqual({ x1: -5, y1: -6, x2: 7, y2: 8 });
    expect(layer.canvas).toEqual({ x1: -16137, y1: -11037, x2: 16137, y2: 12041 });
    expect(warnings).toEqual([]);
  });

  it("reads transform, bbox, flags and button name", () => {
    const { layer, warnings } = parse([
      transform([2, 0, 0, 3, 100, -50]),
      leaf(618, cstr("  Next  ")),
      object612([1, 2, 3, 4], [sub(0x1021, pts(0, 0, 5, 6)), END], [5, 0, 0, 0, 0, 0, 0, 9]),
    ]);
    expect(warnings).toEqual([]);
    const o = layer.items[0] as DrawnObject;
    expect(o.kind).toBe("object");
    expect(o.transform).toEqual([2, 0, 0, 3, 100, -50]);
    expect(o.transformMissing).toBe(false);
    expect(o.buttonName).toBe("Next");
    expect(o.bbox).toEqual({ x1: 1, y1: 2, x2: 3, y2: 4 });
    expect([...o.flags]).toEqual([5, 0, 0, 0, 0, 0, 0, 9]);
    expect(o.terminated).toBe(true);
    expect(applyTransform(o.transform, { x: 1, y: 1 })).toEqual({ x: 102, y: -47 });
  });

  it("uses the identity transform, without a warning, for a 612 with no 616", () => {
    const { layer, warnings } = parse([object612([0, 0, 1, 1], [sub(0x1021, pts(0, 0, 1, 1)), END])]);
    const o = layer.items[0] as DrawnObject;
    expect(o.transform).toEqual([1, 0, 0, 1, 0, 0]);
    expect(o.transformMissing).toBe(true);
    expect(warnings).toEqual([]);
  });

  it("warns on a 616 with no following 612", () => {
    const { layer, warnings } = parse([...obj([sub(0x1021, pts(0, 0, 1, 1))]), transform(IDENT)]);
    expect(layer.items).toHaveLength(1);
    expect(warnings.join("\n")).toMatch(/616 at offset \d+ not followed by an object \(612\) at the end of the block/);
  });

  it("warns on two 616s in a row and keeps the second", () => {
    const { layer, warnings } = parse([transform([9, 0, 0, 9, 0, 0]), ...obj([sub(0x1021, pts(0, 0, 1, 1))], [2, 0, 0, 2, 0, 0])]);
    expect((layer.items[0] as DrawnObject).transform).toEqual([2, 0, 0, 2, 0, 0]);
    expect(warnings).toHaveLength(1);
  });

  it("parses nested groups with their 608 data", () => {
    const g1 = concat(box(-10, -20, 30, 40), new Uint8Array(8));
    const g2 = concat(box(1, 2, 3, 4), box(5, 6, 7, 8));
    const ell = sub(0x1021, pts(0, 0, 1, 1));
    const { layer, warnings } = parse([
      ...obj([ell]),
      block(608, [...obj([ell]), block(608, [...obj([ell]), ...obj([ell])], g2)], g1),
      ...obj([ell]),
    ]);
    expect(warnings).toEqual([]);
    expect(layer.items.map((i) => i.kind)).toEqual(["object", "group", "object"]);
    const outer = layer.items[1] as ObjectGroup;
    expect([...outer.raw608]).toEqual([...g1]);
    expect(outer.box).toEqual({ x1: -10, y1: -20, x2: 30, y2: 40 });
    expect(outer.box2).toEqual({ x1: 0, y1: 0, x2: 0, y2: 0 });
    expect(outer.items.map((i) => i.kind)).toEqual(["object", "group"]);
    const inner = outer.items[1] as ObjectGroup;
    expect(inner.box).toEqual({ x1: 1, y1: 2, x2: 3, y2: 4 });
    expect(inner.box2).toEqual({ x1: 5, y1: 6, x2: 7, y2: 8 });
    expect(inner.items).toHaveLength(2);
    expect([...allObjects(layer.items)]).toHaveLength(5);
  });

  it("gives a 616, 618 and 404 before a 608 to the group", () => {
    const { layer, warnings } = parse([
      transform([0.5, 0, 0, 0.5, 10, 20]),
      leaf(618, cstr("Btn")),
      leaf(404, concat(u16(5), u16(0), cstr("A.PCX"))),
      block(608, [], new Uint8Array(16)),
    ]);
    expect(warnings).toEqual([]);
    const g = layer.items[0] as ObjectGroup;
    expect(g.transform).toEqual([0.5, 0, 0, 0.5, 10, 20]);
    expect(g.buttonName).toBe("Btn");
    expect(g.extraRecords.map((r) => r.tag)).toEqual([404]);
  });

  it("keeps a 404 between 616 and 612 on the object", () => {
    const { layer } = parse([
      transform(IDENT),
      leaf(404, concat(u16(5), u16(0), cstr("B.PCX"))),
      object612([0, 0, 1, 1], [sub(0x1140, new Uint8Array(8)), sub(0x1071, concat(u16(1), u16(0), box(0, 0, 1, 1))), END]),
    ]);
    const o = layer.items[0] as DrawnObject;
    expect(o.extraRecords.map((r) => r.tag)).toEqual([404]);
    expect(o.attributes[0]).toMatchObject({ kind: "bitmap", subTag: 0x1140 });
  });

  it("merges a 614 that continues an unterminated 612", () => {
    const ell = sub(0x1021, pts(0, 0, 1, 1));
    const line = sub(0x1100, [18, 1, 0, 0]);
    const { layer, warnings } = parse([
      block(608, [object612([0, 0, 1, 1], [line, ell]), leaf(614, concat(sub(0x1050, countedPoints(2, pts(0, 0, 4, 4))), END))], new Uint8Array(16)),
    ]);
    expect(warnings).toEqual([]);
    const o = (layer.items[0] as ObjectGroup).items[0] as DrawnObject;
    expect(o.terminated).toBe(true);
    expect(o.raw614Position).toBe("continuation");
    expect(o.shapes.map((e) => e.shape.kind)).toEqual(["ellipse", "polyline"]);
    expect(o.shapes[1]!.in614).toBe(true);
    // The drawing state carries over into the continuation.
    expect(o.shapes[1]!.state.map((a) => a.subTag)).toEqual([0x1100]);
  });

  it("accepts a 614 before the 612 as SPEC §5.6 describes", () => {
    const { layer, warnings } = parse([
      transform(IDENT),
      leaf(614, sub(0x1021, pts(1, 1, 1, 1))),
      object612([0, 0, 1, 1], [sub(0x1021, pts(0, 0, 1, 1)), END]),
    ]);
    expect(warnings).toEqual([]);
    const o = layer.items[0] as DrawnObject;
    expect(o.raw614Position).toBe("before");
    expect(o.list614?.shapes[0]?.shape.kind).toBe("ellipse");
    expect(o.shapes).toHaveLength(1);
  });

  it("stops at the end of the 612 when 0x1FFF is missing", () => {
    const { layer, warnings } = parse([transform(IDENT), object612([0, 0, 1, 1], [sub(0x1021, pts(0, 0, 1, 1))])]);
    const o = layer.items[0] as DrawnObject;
    expect(o.terminated).toBe(false);
    expect(o.shape?.kind).toBe("ellipse");
    expect(warnings.join("\n")).toMatch(/no 0x1FFF end/);
  });

  it("warns on a truncated sub-record and a short 612", () => {
    const { layer, warnings } = parse([
      transform(IDENT),
      object612([0, 0, 1, 1], [concat(u16(0x1021), u16(8), pts(1, 2))]),
      leaf(612, box(0, 0, 1, 1)),
    ]);
    expect(layer.items).toHaveLength(2);
    expect(warnings.join("\n")).toMatch(/declares 8 bytes, 4 left/);
    expect(warnings.join("\n")).toMatch(/only 8 bytes/);
  });
});

describe("shapes", () => {
  it("ellipse (all three sub-tags)", () => {
    for (const tag of [0x1021, 0x1022, 0x1028]) {
      expect(shapeOf([sub(tag, pts(10, 20, 30, 40))])).toMatchObject({ kind: "ellipse", subTag: tag, cx: 10, cy: 20, rx: 30, ry: 40 });
    }
  });

  it("arc with angles in tenths and degrees", () => {
    const s = shapeOf([sub(0x1031, concat(pts(1, 2, 3, 4), u16(1), i16(900), i16(2250)))]);
    expect(s).toMatchObject({
      kind: "arc",
      subTag: 0x1031,
      cx: 1,
      cy: 2,
      rx: 3,
      ry: 4,
      raw8: 1,
      start: { tenths: 900, degrees: 90 },
      end: { tenths: 2250, degrees: 225 },
    });
  });

  it("band", () => {
    const s = shapeOf([sub(0x1041, concat(pts(1, 2, 3, 4), i16(1800), i16(3600), u16(250)))]);
    expect(s).toMatchObject({ kind: "band", cx: 1, ry: 4, start: { degrees: 180 }, end: { degrees: 360 }, depth: 250 });
  });

  it("polyline, polygon, curve and closed curve", () => {
    const cases: [number, string][] = [
      [0x1050, "polyline"],
      [0x1061, "polygon"],
      [0x1068, "polygon"],
      [0x1080, "curve"],
      [0x1091, "closedCurve"],
      [0x1098, "closedCurve"],
    ];
    for (const [tag, kind] of cases) {
      const s = shapeOf([sub(tag, countedPoints(3, pts(0, 0, 10, 0, 10, 10)))]);
      expect(s).toMatchObject({ kind, subTag: tag, count: 3, partCount: 1, partCounts: [3] });
      expect((s as { points: unknown }).points).toEqual([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ]);
    }
  });

  it("multi-part polyline: u16 n, u16 k, k part counts, n points", () => {
    const s = shapeOf([sub(0x1050, concat(u16(4), u16(2), u16(2), u16(2), pts(0, 0, 1, 1, 5, 5, 6, 6)))]);
    expect(s).toMatchObject({ kind: "polyline", count: 4, partCount: 2, partCounts: [2, 2] });
  });

  it("truncates a point list that does not fit, with a warning", () => {
    const { o, warnings } = single([sub(0x1061, countedPoints(5, pts(0, 0, 1, 1)))]);
    expect(o.shape).toMatchObject({ kind: "polygon", count: 5, partCounts: [2] });
    expect((o.shape as { points: unknown[] }).points).toHaveLength(2);
    expect(warnings.join("\n")).toMatch(/declares 5 points but only 2 fit/);
  });

  it("box (0x1070 to 0x1078)", () => {
    for (const tag of [0x1070, 0x1071, 0x1077, 0x1078]) {
      expect(shapeOf([sub(tag, concat(u16(6), u16(466), box(-1, -2, 3, 4)))])).toMatchObject({
        kind: "box",
        subTag: tag,
        style: 6,
        cornerSize: 466,
        x1: -1,
        y1: -2,
        x2: 3,
        y2: 4,
      });
    }
  });

  it("curveA with its 6-byte trailer", () => {
    for (const tag of [0x10a0, 0x10a1]) {
      const s = shapeOf([sub(tag, concat(u16(2), pts(1, 2, 3, 4), [0x76, 2, 0, 0, 1, 0]))]);
      expect(s).toMatchObject({ kind: "curveA", subTag: tag, count: 2, points: [{ x: 1, y: 2 }, { x: 3, y: 4 }] });
      expect([...(s as { trailer: Uint8Array }).trailer]).toEqual([0x76, 2, 0, 0, 1, 0]);
    }
  });

  it("text block with two runs and two layout lines", () => {
    const data = textBlock([run("Hello", 1, 3.5, 2), run("Worlds", 7, 9, 1)], [[0, 5], [5, 6]], [-100, 50, 100, -50]);
    const { o, warnings } = single([sub(0x10b0, data)]);
    expect(warnings).toEqual([]);
    const s = o.shape;
    if (s?.kind !== "text") throw new Error("expected text");
    expect(s.headerLength).toBe(82 + 56);
    expect(s.lengthMinus22).toBe(data.length - 22);
    expect(s.header).toHaveLength(138);
    expect(s.textLength).toBe(11);
    expect(s.runCount).toBe(2);
    expect(s.textBox).toEqual({ x1: -100, y1: 50, x2: 100, y2: -50 });
    expect(s.otherBoxes[1]).toEqual({ x1: 1, y1: 2, x2: 3, y2: 4 });
    expect(s.lines.map((l) => [l.start, l.length])).toEqual([
      [0, 5],
      [5, 6],
    ]);
    expect(s.runs.map((r) => [r.text, r.color, r.size, r.justification])).toEqual([
      ["Hello", 1, 3.5, 2],
      ["Worlds", 7, 9, 1],
    ]);
    expect(s.runs[0]!.fontKey).toEqual({ source: 3, number: 3, style: 0x4268 });
    expect(s.extra).toHaveLength(0);
  });

  it("text block with a truncated run keeps the rest as extra", () => {
    const data = textBlock([run("Hi"), cstr("broken")], [[0, 2]], [0, 0, 1, 1]);
    const { o, warnings } = single([sub(0x10b0, data)]);
    if (o.shape?.kind !== "text") throw new Error("expected text");
    expect(o.shape.runs.map((r) => r.text)).toEqual(["Hi"]);
    expect(o.shape.extra).toHaveLength(7);
    expect(warnings.join("\n")).toMatch(/incomplete text run/);
  });

  it("keeps an unknown shape sub-tag raw", () => {
    const { o, warnings } = single([sub(0x1099, [1, 2, 3]), sub(0x1021, pts(0, 0, 1, 1))]);
    expect(o.shape?.kind).toBe("ellipse");
    expect(o.unknownSubRecords).toHaveLength(1);
    expect(o.unknownSubRecords[0]!.subTag).toBe(0x1099);
    expect([...o.unknownSubRecords[0]!.data]).toEqual([1, 2, 3]);
    expect(warnings.join("\n")).toMatch(/unknown shape sub-tag 0x1099/);
  });

  it("keeps a sub-tag outside both ranges raw", () => {
    const { o, warnings } = single([sub(0x2000, [9])]);
    expect(o.unknownSubRecords.map((s) => s.subTag)).toEqual([0x2000]);
    expect(warnings.join("\n")).toMatch(/unknown sub-tag 0x2000/);
  });

  it("keeps a too-short shape raw with a warning", () => {
    const { o, warnings } = single([sub(0x1021, pts(1, 2))]);
    expect(o.shape).toBeNull();
    expect(o.unknownSubRecords[0]!.subTag).toBe(0x1021);
    expect(warnings.join("\n")).toMatch(/need at least 8/);
  });
});

describe("attributes and display list", () => {
  it("decodes 0x1100, 0x110B and 0x1140 and keeps others raw", () => {
    const { o } = single([
      sub(0x112d, [1, 0]),
      sub(0x1100, [32, 2, 0, 0]),
      sub(0x110b, [24, 0, 0, 0]),
      sub(0x1110, [0xff, 0, 0, 0x20, 0xff, 0, 0, 0x40, 0, 0]),
      sub(0x1071, concat(u16(1), u16(0), box(0, 0, 1, 1))),
    ]);
    expect(o.attributes.map((a) => a.kind)).toEqual(["raw", "line", "fill", "raw"]);
    expect(o.attributes[0]).toMatchObject({ subTag: 0x112d });
    expect(o.attributes[1]).toMatchObject({ subTag: 0x1100, lineColor: 32, lineStyle: 2, rgb: null });
    expect(o.attributes[2]).toMatchObject({ subTag: 0x110b, fillColor: 24, rgb: null });
    expect(o.attributes[3]!.raw).toHaveLength(10);
  });

  it("reads a direct colour when byte 0 is 0xFF", () => {
    const { o } = single([sub(0x110b, [0xff, 0xaa, 0xbb, 0xcc]), sub(0x1061, countedPoints(1, pts(0, 0)))]);
    expect(o.attributes[0]).toMatchObject({ kind: "fill", fillColor: 0xff, rgb: [0xaa, 0xbb, 0xcc] });
    expect(objectColors(o)).toEqual({ fill: 0xff, outline: null, fillRgb: [0xaa, 0xbb, 0xcc], outlineRgb: null });
  });

  it("warns on a short 0x1100 and keeps it raw", () => {
    const { o, warnings } = single([sub(0x1100, [5]), sub(0x1021, pts(0, 0, 1, 1))]);
    expect(o.attributes[0]).toMatchObject({ kind: "raw", subTag: 0x1100 });
    expect(warnings.join("\n")).toMatch(/0x1100: only 1 byte/);
  });

  it("records the state each shape is drawn with", () => {
    const rect = sub(0x1071, concat(u16(1), u16(0), box(0, 0, 1, 1)));
    const { o } = single([sub(0x1100, [14, 0, 0, 0]), sub(0x110b, [21, 0, 0, 0]), rect, sub(0x110b, [22, 0, 0, 0]), rect]);
    expect(o.shapes).toHaveLength(2);
    expect(o.shape).toBe(o.shapes[0]!.shape);
    expect(shapeColors(o.shapes[0]!.shape, o.shapes[0]!.state)).toMatchObject({ fill: 21, outline: 14 });
    expect(shapeColors(o.shapes[1]!.shape, o.shapes[1]!.state)).toMatchObject({ fill: 22, outline: 14 });
    expect(o.subRecords).toHaveLength(5);
  });
});

describe("objectColors (interim rule, SPEC §5.6)", () => {
  const rect = sub(0x1071, concat(u16(1), u16(0), box(0, 0, 1, 1)));
  const line = sub(0x1100, [18, 1, 0, 0]);
  const fill = sub(0x110b, [24, 0, 0, 0]);
  const polyline = sub(0x1050, countedPoints(2, pts(0, 0, 1, 1)));

  it("closed shape: fill from 0x110B, outline from 0x1100", () => {
    expect(objectColors(single([line, fill, rect]).o)).toMatchObject({ fill: 24, outline: 18 });
  });

  it("closed shape without 0x110B: fill from 0x1100", () => {
    expect(objectColors(single([line, rect]).o)).toMatchObject({ fill: 18, outline: 18 });
  });

  it("closed shape with only 0x110B: no outline", () => {
    expect(objectColors(single([fill, rect]).o)).toMatchObject({ fill: 24, outline: null });
  });

  it("open shape: never filled", () => {
    expect(objectColors(single([line, fill, polyline]).o)).toMatchObject({ fill: null, outline: 18 });
  });

  it("no attributes: nothing", () => {
    expect(objectColors(single([rect]).o)).toEqual({ fill: null, outline: null, fillRgb: null, outlineRgb: null });
  });
});
