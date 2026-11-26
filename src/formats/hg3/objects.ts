/**
 * Object layer parsing (SPEC §5.6): the drawn objects between 516 and 517,
 * optionally grouped with 608 ... 610 (groups nest).
 *
 * Record grouping, as found in the 238 sample charts (task 10):
 *
 * - 616 (transform), 618 (button name), 614 and any other leaf record (such
 *   as a 404 kind 5 bitmap reference) accumulate until a 612 closes the
 *   object. Recomputing bounding boxes confirms the 616 belongs to the 612
 *   that follows it (2,715 matches).
 * - A 612 without a 616 is normal: every object of a data chart (XY, pie,
 *   organization, bullet, title, table) has none. The identity transform
 *   then matches the stored bounding box, so no warning is given.
 * - 616 and 618 can also precede a 608 group: they then belong to the group
 *   (button groups; scaled bitmap groups `616 404 [608 610]`).
 * - 614 is a continuation of the preceding 612: in all 3 samples (XY
 *   charts) the 612's sub-record list has no 0x1FFF, and the 614 directly
 *   after it holds further sub-records (headers included, starting at a
 *   sub-record boundary) ending with 0x1FFF. They are merged into the
 *   object's display list. A 614 before a 612, as SPEC §5.6 describes, is
 *   still accepted and kept separately.
 *
 * A 612's sub-records are a display list, not one shape plus attributes:
 * attribute sub-records set the current drawing state and every shape
 * sub-record after them is drawn with that state (for example
 * `0x112D 0x1100 0x110B 0x1071 0x110B 0x1071 0x10B0 ... 0x1FFF`). Each shape
 * therefore records the attributes in effect when it is drawn.
 *
 * Never throws on content: problems become warnings (SPEC §7.1).
 */
import { ByteReader } from "../ByteReader";
import type { BlockRecord, LeafRecord, RecordNode } from "./container";
import { decodeHg3Text } from "../charset";
import { TEXT_TAIL_LENGTH, type TextTail, readTextTail } from "./text";

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

export const TAG_OBJECT_LAYER = 516;
export const TAG_GROUP = 608;
export const TAG_OBJECT = 612;
export const TAG_OBJECT_614 = 614;
export const TAG_TRANSFORM = 616;
export const TAG_BUTTON_NAME = 618;

/** Sub-tag ending an object's sub-record list (SPEC §5.6). */
export const SUB_END = 0x1fff;

/** Shape sub-tags (SPEC §5.6 shape table). */
export const ShapeSubTag = {
  Ellipse: [0x1021, 0x1022, 0x1028],
  Arc: [0x1031],
  Band: [0x1041],
  Polyline: [0x1050],
  Polygon: [0x1061, 0x1068],
  /** 0x1070 to 0x1078. */
  Box: [0x1070, 0x1071, 0x1072, 0x1073, 0x1074, 0x1075, 0x1076, 0x1077, 0x1078],
  Curve: [0x1080],
  ClosedCurve: [0x1091, 0x1098],
  CurveA: [0x10a0, 0x10a1],
  Text: [0x10b0],
} as const;

/** Attribute sub-tags decoded here (SPEC §5.6 attribute table). */
export const AttributeSubTag = {
  Line: 0x1100,
  Fill: 0x110b,
  Bitmap: 0x1140,
} as const;

/** True for sub-tags in the shape range (0x1000 to 0x10FF). */
export function isShapeRange(subTag: number): boolean {
  return subTag >= 0x1000 && subTag <= 0x10ff;
}

/** True for sub-tags in the attribute range (0x1100 to 0x11FF). */
export function isAttributeRange(subTag: number): boolean {
  return subTag >= 0x1100 && subTag <= 0x11ff;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Box {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface Point {
  x: number;
  y: number;
}

/** 616: page x = a·x + c·y + e, page y = b·x + d·y + f (SPEC §5.6). */
export type Transform = [a: number, b: number, c: number, d: number, e: number, f: number];

export const IDENTITY_TRANSFORM: Readonly<Transform> = [1, 0, 0, 1, 0, 0];

/** An angle as stored (tenths of a degree, CCW from +x) and in degrees. */
export interface Angle {
  tenths: number;
  degrees: number;
}

/** A sub-record. `offset` is the position of its 4-byte header in the containing record's data. */
export interface SubRecord {
  subTag: number;
  offset: number;
  data: Uint8Array;
  /** True when the sub-record came from a 614 continuing the 612 (`offset` is then within the 614 data). */
  in614?: boolean;
}

interface ShapeBase {
  /** The exact sub-tag (its low digit varies; SPEC §5.6). */
  subTag: number;
  /** The sub-record data, undecoded. */
  raw: Uint8Array;
}

export interface EllipseShape extends ShapeBase {
  kind: "ellipse";
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

export interface ArcShape extends ShapeBase {
  kind: "arc";
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  /** The u16 between radii and angles (1 in every sample) [?]. */
  raw8: number;
  start: Angle;
  end: Angle;
}

export interface BandShape extends ShapeBase {
  kind: "band";
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  start: Angle;
  end: Angle;
  depth: number;
}

interface PointListBase extends ShapeBase {
  /** Point count as declared (first u16). */
  count: number;
  /** Points actually read (truncated if the data is short). */
  points: Point[];
}

/**
 * Layout `u16 n, u16 k, k × u16 part point counts, n points` (0x1050,
 * 0x1061/68, 0x1080, 0x1091/98). SPEC §5.6 gives `u16 n, u16 1, u16 n`,
 * which is the k = 1 case; 160 sample polylines have k from 5 to 19 parts,
 * each with exactly this length and part counts summing to n (task 10).
 */
export interface CountedPointList extends PointListBase {
  /** u16 at 2: number of parts k [I]. */
  partCount: number;
  /** Point count of each part; sums to `points.length` after validation. */
  partCounts: number[];
}

export interface PolylineShape extends CountedPointList {
  kind: "polyline";
}
export interface PolygonShape extends CountedPointList {
  kind: "polygon";
}
export interface CurveShape extends CountedPointList {
  kind: "curve";
}
export interface ClosedCurveShape extends CountedPointList {
  kind: "closedCurve";
}

/** 0x10A0/0x10A1: u16 n, n points, 6 bytes [?]. */
export interface CurveAShape extends PointListBase {
  kind: "curveA";
  trailer: Uint8Array;
}

export interface BoxShape extends ShapeBase {
  kind: "box";
  /** 1 = square corners; 2, 3, 5, 6 = other corner styles [I]. */
  style: number;
  /** Corner size [I]. */
  cornerSize: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** One run of a text block: the string and its 22-byte text tail (SPEC §5.3). */
export interface TextRun extends TextTail {
  /** Text decoded in the HG3 character set (charset.ts); 0x0A line ends become "\n". */
  text: string;
  /** The run's raw byte codes (without the NUL), one per character of `text`, for drawing glyphs by code. */
  codes: Uint8Array;
}

/** One 28-byte line-layout entry of a text block header [I]. */
export interface TextLayoutLine {
  raw: Uint8Array;
  /** u32 at +4: index of the line's first character in the text [I]. */
  start: number;
  /** u8 at +8: characters on the line [I]. */
  length: number;
}

/** Fixed part of the 0x10B0 header, before the line entries. */
export const TEXT_HEADER_FIXED = 82;
/** Bytes per line entry in the 0x10B0 header. */
export const TEXT_LAYOUT_LINE_LENGTH = 28;

/**
 * Text block 0x10B0. Layout found in the samples (280 blocks; task 10):
 *
 * | Offset | Type | Meaning |
 * | --- | --- | --- |
 * | 0 | u16 | Header length = offset of the first run = 82 + 28 × line count (110, 138, 166 seen) |
 * | 2 | u16 | Sub-record length − 22 (SPEC §5.6), i.e. where the last run's tail starts |
 * | 4 | 10 bytes | 01 00 01 00 00 00 00 00 01 03 in every sample [?] |
 * | 14 | u16 | Total text length in characters [I] |
 * | 16 | u16 | 1 in every sample; number of runs [I] |
 * | 18 | 12 bytes | 00 × 8, 01 00 01 00 in every sample [?] |
 * | 30 | 8 bytes | Varies per file, constant within one; looks like stale memory [?] |
 * | 38 | 4 × i16 | Text box x1, y1, x2, y2 in object coordinates (y1 > y2) [I] |
 * | 46 | 8 bytes | Usually zero [?] |
 * | 54, 62, 70 | 3 × 4 × i16 | Further boxes: 54 usually repeats 38; 62 and 70 are usually equal and inside it [?] |
 * | 78 | u16 | [?] |
 * | 80 | u16 | Number of wrapped lines [I] |
 * | 82 | 28 × lines | One layout entry per wrapped line: u32 at +4 is the line's first character, u8 at +8 its length [I] |
 * | header length | runs | Each: string, NUL, a pad byte when needed to reach an even length, 22-byte tail |
 *
 * The whole header is kept raw in `header`.
 */
export interface TextBlockShape extends ShapeBase {
  kind: "text";
  /** u16 at 0: header length / offset of the first run. */
  headerLength: number;
  /** u16 at 2: sub-record length − 22 (SPEC §5.6). */
  lengthMinus22: number;
  /** Header bytes 0 .. headerLength (or as many as exist). */
  header: Uint8Array;
  /** u16 at 14 [I]: total text length. Null if the header is short. */
  textLength: number | null;
  /** u16 at 16 [I]: number of runs. Null if the header is short. */
  runCount: number | null;
  /** Box at 38 [I]: the text box in object coordinates. */
  textBox: Box | null;
  /** Boxes at 54, 62, 70 [?]. */
  otherBoxes: Box[];
  /** Layout entries at 82 [I]; one per wrapped line. */
  lines: TextLayoutLine[];
  runs: TextRun[];
  /** Bytes after the last complete run. */
  extra: Uint8Array;
}

export type Shape =
  | EllipseShape
  | ArcShape
  | BandShape
  | PolylineShape
  | PolygonShape
  | BoxShape
  | CurveShape
  | ClosedCurveShape
  | CurveAShape
  | TextBlockShape;

export type ShapeKind = Shape["kind"];

/** A direct colour: R, G, B bytes. */
export type Rgb = [r: number, g: number, b: number];

/**
 * Attribute sub-records (SPEC §5.6). Every variant keeps its sub-tag and raw
 * data. In the samples, byte 0 = 0xFF marks a direct colour with R, G, B in
 * bytes 1 to 3 (as in palette record 1555): 45 of 4,472 0x1100, 167 of
 * 3,642 0x110B, 66 of 142 0x110C and both halves of every 0x1110 (task 10).
 */
export type Attribute =
  | {
      kind: "line";
      subTag: number;
      /** Byte 0: colour role, or 0xFF for a direct colour. */
      lineColor: number;
      /** Byte 1: 0 to 3 or 255 mostly [I: width or style]; the red byte when `rgb` is set. */
      lineStyle: number;
      /** Bytes 1..3 when byte 0 is 0xFF. */
      rgb: Rgb | null;
      raw: Uint8Array;
    }
  | {
      kind: "fill";
      subTag: number;
      /** Byte 0: colour role, or 0xFF for a direct colour. */
      fillColor: number;
      /** Bytes 1..3 when byte 0 is 0xFF. */
      rgb: Rgb | null;
      raw: Uint8Array;
    }
  | { kind: "bitmap"; subTag: number; raw: Uint8Array }
  | { kind: "raw"; subTag: number; raw: Uint8Array };

/** A shape and the drawing state it is drawn with. */
export interface ShapeEntry {
  shape: Shape;
  /** Position of the shape's sub-record header in the containing data. */
  offset: number;
  /** True when the shape came from a 614 continuation. */
  in614?: boolean;
  /**
   * Attributes in effect: the latest sub-record of each attribute sub-tag
   * seen before this shape, in order of first appearance.
   */
  state: Attribute[];
}

/** Sub-records interpreted as a display list. */
export interface DisplayList {
  /** Every sub-record in order (without the 0x1FFF end). */
  subRecords: SubRecord[];
  /** Shapes in drawing order with their state. */
  shapes: ShapeEntry[];
  /** Every attribute sub-record, in order. */
  attributes: Attribute[];
  /** Sub-records that are neither a decodable shape nor in the attribute range. */
  unknownSubRecords: SubRecord[];
}

export interface DrawnObject extends DisplayList {
  kind: "object";
  /** File offset of the 612 record. */
  offset: number;
  transform: Transform;
  /** True when no 616 preceded the 612 (identity used; normal in data charts). */
  transformMissing: boolean;
  /** 618, trimmed. */
  buttonName?: string;
  /** 614 data, undecoded (concatenated if several continue the 612). */
  raw614?: Uint8Array;
  /**
   * "continuation": the 614 followed this 612, whose list had no 0x1FFF, and
   * its sub-records are merged into this object's display list (every
   * sample). "before": the 614 preceded the 612 as SPEC §5.6 describes
   * (never seen); its sub-records are in `list614` only.
   */
  raw614Position?: "before" | "continuation";
  /** For a 614 before the 612: its sub-records as a separate display list. */
  list614?: DisplayList;
  /** Page bounding box after the transform. */
  bbox: Box;
  /** The 8 flag bytes at 612 offset 8. */
  flags: Uint8Array;
  /** The first shape, or null. All shapes are in `shapes`. */
  shape: Shape | null;
  /** Whether the sub-record list ended with 0x1FFF. */
  terminated: boolean;
  /** Bytes after 0x1FFF (none expected). */
  trailing: Uint8Array;
  /** Other leaf records between the previous item and this 612 (e.g. 404 kind 5). */
  extraRecords: LeafRecord[];
}

export interface ObjectGroup {
  kind: "group";
  /** File offset of the 608 record. */
  offset: number;
  /** The 16 bytes of 608 data. */
  raw608: Uint8Array;
  /**
   * First 8 bytes of 608 as an i16 box. In the samples this equals the
   * union of the members' bounding boxes (201 of 201 checked) [I].
   */
  box: Box | null;
  /** Bytes 8..16 of 608 read as an i16 box; zero in the samples [?]. */
  box2: Box | null;
  /** A 616 that preceded the 608. */
  transform?: Transform;
  /** A 618 that preceded the 608. */
  buttonName?: string;
  /** Other leaf records that preceded the 608 (e.g. 404 kind 5). */
  extraRecords: LeafRecord[];
  items: LayerItem[];
  /** Records in the group that are not part of an item. */
  otherRecords: RecordNode[];
}

export type LayerItem = DrawnObject | ObjectGroup;

export interface ObjectLayer {
  /** 516 box 1: extent of all objects [I]. */
  extent: Box | null;
  /** 516 box 2: the canvas [I]. */
  canvas: Box | null;
  items: LayerItem[];
  /** Records in the layer that are not part of an item. */
  otherRecords: RecordNode[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function view(data: Uint8Array): DataView {
  return new DataView(data.buffer, data.byteOffset, data.byteLength);
}

function readBox(data: Uint8Array, at: number): Box | null {
  if (data.length < at + 8) return null;
  const v = view(data);
  return {
    x1: v.getInt16(at, true),
    y1: v.getInt16(at + 2, true),
    x2: v.getInt16(at + 4, true),
    y2: v.getInt16(at + 6, true),
  };
}

function angle(tenths: number): Angle {
  return { tenths, degrees: tenths / 10 };
}

function hex(n: number): string {
  return "0x" + n.toString(16).toUpperCase().padStart(4, "0");
}

/** Apply a transform to a point. */
export function applyTransform(t: Readonly<Transform>, p: Point): Point {
  const [a, b, c, d, e, f] = t;
  return { x: a * p.x + c * p.y + e, y: b * p.x + d * p.y + f };
}

/** Walk every drawn object, depth first, in file order. */
export function* allObjects(items: readonly LayerItem[]): Generator<DrawnObject> {
  for (const item of items) {
    if (item.kind === "object") yield item;
    else yield* allObjects(item.items);
  }
}

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

const KIND_BY_NAME: Record<keyof typeof ShapeSubTag, ShapeKind> = {
  Ellipse: "ellipse",
  Arc: "arc",
  Band: "band",
  Polyline: "polyline",
  Polygon: "polygon",
  Box: "box",
  Curve: "curve",
  ClosedCurve: "closedCurve",
  CurveA: "curveA",
  Text: "text",
};

const KIND_BY_SUBTAG: ReadonlyMap<number, ShapeKind> = new Map(
  (Object.entries(ShapeSubTag) as [keyof typeof ShapeSubTag, readonly number[]][]).flatMap(([name, tags]) =>
    tags.map((t) => [t, KIND_BY_NAME[name]] as const),
  ),
);

/** Shape kind for a known shape sub-tag, else undefined. */
export function shapeKindFor(subTag: number): ShapeKind | undefined {
  return KIND_BY_SUBTAG.get(subTag);
}

function readPoints(r: ByteReader, declared: number, reserve: number, where: string, warnings: string[]): Point[] {
  const available = Math.max(0, Math.floor((r.remaining - reserve) / 4));
  let n = declared;
  if (declared > available) {
    warnings.push(`${where}: declares ${declared} points but only ${available} fit; truncated`);
    n = available;
  }
  const points: Point[] = [];
  for (let i = 0; i < n; i++) points.push({ x: r.i16(), y: r.i16() });
  return points;
}

/** Minimum data length per shape kind. */
const MIN_LENGTH: Record<ShapeKind, number> = {
  ellipse: 8,
  arc: 14,
  band: 14,
  box: 12,
  polyline: 4,
  polygon: 4,
  curve: 4,
  closedCurve: 4,
  curveA: 2,
  text: 4,
};

/**
 * Decode one shape sub-record. Returns null for unknown sub-tags, and (with
 * a warning) when the data is too short for the shape's fixed fields.
 */
export function decodeShape(subTag: number, data: Uint8Array, at: string, warnings: string[]): Shape | null {
  const kind = shapeKindFor(subTag);
  if (!kind) return null;
  const where = `${at} shape ${hex(subTag)} (${kind})`;
  const min = MIN_LENGTH[kind];
  if (data.length < min) {
    warnings.push(`${where}: ${data.length} bytes, need at least ${min}; kept raw`);
    return null;
  }
  const r = new ByteReader(data);
  const base = { subTag, raw: data };
  const checkUsed = (used: number): void => {
    if (data.length > used) warnings.push(`${where}: ${data.length - used} unexpected byte(s) after the shape data`);
  };
  switch (kind) {
    case "ellipse": {
      const s: EllipseShape = { kind, ...base, cx: r.i16(), cy: r.i16(), rx: r.i16(), ry: r.i16() };
      checkUsed(8);
      return s;
    }
    case "arc": {
      const s: ArcShape = {
        kind,
        ...base,
        cx: r.i16(),
        cy: r.i16(),
        rx: r.i16(),
        ry: r.i16(),
        raw8: r.u16(),
        start: angle(r.i16()),
        end: angle(r.i16()),
      };
      checkUsed(14);
      return s;
    }
    case "band": {
      const s: BandShape = {
        kind,
        ...base,
        cx: r.i16(),
        cy: r.i16(),
        rx: r.i16(),
        ry: r.i16(),
        start: angle(r.i16()),
        end: angle(r.i16()),
        depth: r.u16(),
      };
      checkUsed(14);
      return s;
    }
    case "box": {
      const s: BoxShape = {
        kind,
        ...base,
        style: r.u16(),
        cornerSize: r.u16(),
        x1: r.i16(),
        y1: r.i16(),
        x2: r.i16(),
        y2: r.i16(),
      };
      checkUsed(12);
      return s;
    }
    case "polyline":
    case "polygon":
    case "curve":
    case "closedCurve": {
      const count = r.u16();
      const partCount = r.u16();
      let partCounts: number[] = [];
      if (partCount * 2 > r.remaining) {
        warnings.push(`${where}: declares ${partCount} parts but only ${r.remaining} bytes remain; read as one part`);
      } else {
        for (let i = 0; i < partCount; i++) partCounts.push(r.u16());
      }
      const sum = partCounts.reduce((a, b) => a + b, 0);
      if (partCounts.length && sum !== count) {
        warnings.push(`${where}: part point counts sum to ${sum}, not ${count}; read as one part`);
      }
      const points = readPoints(r, count, 0, where, warnings);
      if (!partCounts.length || sum !== points.length) partCounts = [points.length];
      checkUsed(r.pos);
      return { kind, ...base, count, partCount, partCounts, points };
    }
    case "curveA": {
      const count = r.u16();
      const points = readPoints(r, count, 6, where, warnings);
      const trailer = r.bytes(Math.min(6, r.remaining));
      if (trailer.length < 6) warnings.push(`${where}: trailer has ${trailer.length} of 6 bytes`);
      checkUsed(2 + points.length * 4 + trailer.length);
      return { kind, ...base, count, points, trailer };
    }
    case "text":
      return decodeTextBlock(subTag, data, where, warnings);
  }
}

function decodeTextBlock(subTag: number, data: Uint8Array, where: string, warnings: string[]): TextBlockShape {
  const v = view(data);
  const headerLength = v.getUint16(0, true);
  const lengthMinus22 = v.getUint16(2, true);
  if (lengthMinus22 !== data.length - 22) {
    warnings.push(`${where}: length field ${lengthMinus22} is not data length − 22 (${data.length - 22})`);
  }
  let runsAt = headerLength;
  if (headerLength < 4 || headerLength > data.length) {
    runsAt = data.length >= 82 ? Math.min(data.length, TEXT_HEADER_FIXED + TEXT_LAYOUT_LINE_LENGTH * v.getUint16(80, true)) : data.length;
    warnings.push(`${where}: header length ${headerLength} out of range; runs read from ${runsAt}`);
  }
  const header = data.subarray(0, runsAt);
  const textLength = runsAt >= 16 ? v.getUint16(14, true) : null;
  const runCount = runsAt >= 18 ? v.getUint16(16, true) : null;
  const textBox = runsAt >= 46 ? readBox(data, 38) : null;
  const otherBoxes: Box[] = [];
  for (const at of [54, 62, 70]) {
    const b = runsAt >= at + 8 ? readBox(data, at) : null;
    if (b) otherBoxes.push(b);
  }
  const lines: TextLayoutLine[] = [];
  if (runsAt >= TEXT_HEADER_FIXED) {
    const declared = v.getUint16(80, true);
    const fit = Math.floor((runsAt - TEXT_HEADER_FIXED) / TEXT_LAYOUT_LINE_LENGTH);
    if (declared !== fit || TEXT_HEADER_FIXED + fit * TEXT_LAYOUT_LINE_LENGTH !== runsAt) {
      warnings.push(`${where}: header declares ${declared} layout line(s) but its length ${runsAt} holds ${fit}`);
    }
    for (let i = 0; i < Math.min(declared, fit); i++) {
      const at = TEXT_HEADER_FIXED + i * TEXT_LAYOUT_LINE_LENGTH;
      lines.push({
        raw: data.subarray(at, at + TEXT_LAYOUT_LINE_LENGTH),
        start: v.getUint32(at + 4, true),
        length: data[at + 8]!,
      });
    }
  }

  const runs: TextRun[] = [];
  const r = new ByteReader(data);
  r.seek(runsAt);
  while (r.remaining > 0) {
    const start = r.pos;
    const nul = data.indexOf(0, start);
    // String and NUL are padded to an even length.
    const tailAt = nul < 0 ? -1 : nul + 1 + ((nul + 1 - start) % 2);
    if (nul < 0 || data.length - tailAt < TEXT_TAIL_LENGTH) {
      warnings.push(`${where}: incomplete text run at byte ${start} (${r.remaining} bytes left); kept as extra`);
      break;
    }
    const codes = data.slice(start, nul);
    const text = r.cstring();
    r.seek(tailAt);
    const tail = readTextTail(r);
    if (tail.declaredLength !== nul - start) {
      warnings.push(`${where}: run ${runs.length} declares length ${tail.declaredLength} but the text has ${nul - start}`);
    }
    runs.push({ text, codes, ...tail });
  }
  if (runCount !== null && runCount !== runs.length) {
    warnings.push(`${where}: header says ${runCount} run(s) but ${runs.length} were read`);
  }
  return {
    kind: "text",
    subTag,
    raw: data,
    headerLength,
    lengthMinus22,
    header,
    textLength,
    runCount,
    textBox,
    otherBoxes,
    lines,
    runs,
    extra: data.subarray(r.pos),
  };
}

// ---------------------------------------------------------------------------
// Attributes and colours
// ---------------------------------------------------------------------------

/** Marker byte for a direct RGB colour. */
export const DIRECT_COLOR = 0xff;

/** R, G, B from bytes 1..3 when byte 0 is 0xFF, else null. */
export function directRgb(data: Uint8Array, at = 0): Rgb | null {
  if (data.length < at + 4 || data[at] !== DIRECT_COLOR) return null;
  return [data[at + 1]!, data[at + 2]!, data[at + 3]!];
}

/** Decode an attribute sub-record (0x1100, 0x110B, 0x1140; others raw). */
export function decodeAttribute(subTag: number, data: Uint8Array, at: string, warnings: string[]): Attribute {
  switch (subTag) {
    case AttributeSubTag.Line:
      if (data.length < 2) break;
      return { kind: "line", subTag, lineColor: data[0]!, lineStyle: data[1]!, rgb: directRgb(data), raw: data };
    case AttributeSubTag.Fill:
      if (data.length < 1) break;
      return { kind: "fill", subTag, fillColor: data[0]!, rgb: directRgb(data), raw: data };
    case AttributeSubTag.Bitmap:
      return { kind: "bitmap", subTag, raw: data };
    default:
      return { kind: "raw", subTag, raw: data };
  }
  warnings.push(`${at} attribute ${hex(subTag)}: only ${data.length} byte(s); kept raw`);
  return { kind: "raw", subTag, raw: data };
}

/** Shapes that enclose an area (filled under the interim colour rule). */
export function isClosedShape(shape: Shape | null): boolean {
  if (!shape) return false;
  switch (shape.kind) {
    case "ellipse":
    case "polygon":
    case "box":
    case "closedCurve":
    case "band":
      return true;
    default:
      return false;
  }
}

export interface ObjectColors {
  /** Fill colour role (first byte), or null; 0xFF means use `fillRgb`. */
  fill: number | null;
  /** Outline colour role (first byte), or null; 0xFF means use `outlineRgb`. */
  outline: number | null;
  /** Direct fill colour when the chosen attribute holds one. */
  fillRgb: Rgb | null;
  /** Direct outline colour when the 0x1100 holds one. */
  outlineRgb: Rgb | null;
}

/**
 * The interim colour rule of SPEC §5.6 for one shape and its attributes:
 * outline = first byte of 0x1100; fill = first byte of 0x110B, or of 0x1100
 * when there is no 0x110B, but only for closed shapes.
 */
export function shapeColors(shape: Shape | null, attributes: readonly Attribute[]): ObjectColors {
  let line: Extract<Attribute, { kind: "line" }> | undefined;
  let fill: Extract<Attribute, { kind: "fill" }> | undefined;
  for (const a of attributes) {
    if (a.kind === "line" && !line) line = a;
    if (a.kind === "fill" && !fill) fill = a;
  }
  const outline = line ? line.lineColor : null;
  const outlineRgb = line ? line.rgb : null;
  if (!isClosedShape(shape)) return { fill: null, outline, fillRgb: null, outlineRgb };
  if (fill) return { fill: fill.fillColor, outline, fillRgb: fill.rgb, outlineRgb };
  return { fill: outline, outline, fillRgb: outlineRgb, outlineRgb };
}

/**
 * The interim colour rule (SPEC §5.6) for an object's first shape, using the
 * state it is drawn with; for other shapes use `shapeColors(entry.shape,
 * entry.state)`.
 */
export function objectColors(obj: Pick<DrawnObject, "shape" | "shapes" | "attributes">): ObjectColors {
  const first = obj.shapes[0];
  return first ? shapeColors(first.shape, first.state) : shapeColors(obj.shape, obj.attributes);
}

// ---------------------------------------------------------------------------
// Sub-record lists
// ---------------------------------------------------------------------------

/**
 * Split data into sub-records from `start`. Stops at 0x1FFF (consumed) or
 * the end of the data.
 */
export function readSubRecords(
  data: Uint8Array,
  start: number,
  at: string,
  warnings: string[],
): { subRecords: SubRecord[]; terminated: boolean; trailing: Uint8Array } {
  const v = view(data);
  const subRecords: SubRecord[] = [];
  let p = start;
  while (p < data.length) {
    if (p + 4 > data.length) {
      warnings.push(`${at}: ${data.length - p} stray byte(s) where a sub-record header was expected`);
      return { subRecords, terminated: false, trailing: data.subarray(p) };
    }
    const subTag = v.getUint16(p, true);
    const len = v.getUint16(p + 2, true);
    if (subTag === SUB_END) {
      if (len) warnings.push(`${at}: end sub-record 0x1FFF has length ${len}`);
      const trailing = data.subarray(Math.min(data.length, p + 4 + len));
      if (trailing.length) warnings.push(`${at}: ${trailing.length} byte(s) after 0x1FFF`);
      return { subRecords, terminated: true, trailing };
    }
    if (p + 4 + len > data.length) {
      warnings.push(`${at}: sub-record ${hex(subTag)} declares ${len} bytes, ${data.length - p - 4} left; truncated`);
    }
    subRecords.push({ subTag, offset: p, data: data.subarray(p + 4, p + 4 + len) });
    p += 4 + len;
  }
  return { subRecords, terminated: false, trailing: new Uint8Array(0) };
}

/** Interpret sub-records as a display list: attributes set state, shapes draw with it. */
export function interpretDisplayList(subRecords: SubRecord[], at: string, warnings: string[]): DisplayList {
  const shapes: ShapeEntry[] = [];
  const attributes: Attribute[] = [];
  const unknownSubRecords: SubRecord[] = [];
  const state = new Map<number, Attribute>();
  for (const sub of subRecords) {
    if (isShapeRange(sub.subTag)) {
      if (!shapeKindFor(sub.subTag)) {
        warnings.push(`${at}: unknown shape sub-tag ${hex(sub.subTag)} (${sub.data.length} bytes); kept raw`);
        unknownSubRecords.push(sub);
        continue;
      }
      const shape = decodeShape(sub.subTag, sub.data, at, warnings);
      if (shape) {
        const entry: ShapeEntry = { shape, offset: sub.offset, state: [...state.values()] };
        if (sub.in614) entry.in614 = true;
        shapes.push(entry);
      }
      else unknownSubRecords.push(sub);
    } else if (isAttributeRange(sub.subTag)) {
      const attr = decodeAttribute(sub.subTag, sub.data, at, warnings);
      attributes.push(attr);
      // Map.set on an existing key keeps its first-appearance position.
      state.set(sub.subTag, attr);
    } else {
      warnings.push(`${at}: unknown sub-tag ${hex(sub.subTag)} (${sub.data.length} bytes); kept raw`);
      unknownSubRecords.push(sub);
    }
  }
  return { subRecords, shapes, attributes, unknownSubRecords };
}

// ---------------------------------------------------------------------------
// Objects
// ---------------------------------------------------------------------------

interface Pending {
  transform?: Transform;
  transformOffset?: number;
  buttonName?: string;
  raw614?: Uint8Array;
  extra: LeafRecord[];
}

function readTransform(rec: LeafRecord, warnings: string[]): Transform {
  if (rec.data.length < 24) {
    warnings.push(`transform (616) at offset ${rec.offset} has ${rec.data.length} of 24 bytes; identity used`);
    return [...IDENTITY_TRANSFORM];
  }
  if (rec.data.length > 24) warnings.push(`transform (616) at offset ${rec.offset} has ${rec.data.length} bytes, expected 24`);
  const v = view(rec.data);
  const t: number[] = [];
  for (let i = 0; i < 6; i++) t.push(v.getFloat32(i * 4, true));
  return t as Transform;
}

function readButtonName(data: Uint8Array): string {
  const nul = data.indexOf(0);
  return decodeHg3Text(nul < 0 ? data : data.subarray(0, nul)).trim();
}

function read614Before(obj: DrawnObject, data: Uint8Array, at: string, warnings: string[]): void {
  obj.raw614 = data;
  obj.raw614Position = "before";
  const { subRecords } = readSubRecords(data, 0, `614 before ${at}`, warnings);
  obj.list614 = interpretDisplayList(subRecords, `614 before ${at}`, warnings);
}

function objectWhere(obj: DrawnObject): string {
  return `object (612) at offset ${obj.offset}`;
}

/** Start an object from a 612 and the records before it; its sub-records are interpreted by finishObject. */
function startObject(rec: LeafRecord, pending: Pending, warnings: string[]): DrawnObject {
  const data = rec.data;
  const obj: DrawnObject = {
    kind: "object",
    offset: rec.offset,
    transform: pending.transform ?? [...IDENTITY_TRANSFORM],
    transformMissing: pending.transform === undefined,
    bbox: readBox(data, 0) ?? { x1: 0, y1: 0, x2: 0, y2: 0 },
    flags: data.subarray(Math.min(8, data.length), Math.min(16, data.length)),
    shape: null,
    subRecords: [],
    shapes: [],
    attributes: [],
    unknownSubRecords: [],
    terminated: false,
    trailing: new Uint8Array(0),
    extraRecords: pending.extra,
  };
  const at = objectWhere(obj);
  if (pending.buttonName !== undefined) obj.buttonName = pending.buttonName;
  if (pending.raw614 !== undefined) read614Before(obj, pending.raw614, at, warnings);
  if (data.length < 16) {
    warnings.push(`${at} is only ${data.length} bytes (need 16 for box and flags)`);
    obj.terminated = true; // nothing to continue
    return obj;
  }
  const { subRecords, terminated, trailing } = readSubRecords(data, 16, at, warnings);
  obj.subRecords = subRecords;
  obj.terminated = terminated;
  obj.trailing = trailing;
  return obj;
}

/** Append a 614 that continues an unterminated 612 (seen in XY charts). */
function continueObject(obj: DrawnObject, rec: LeafRecord, warnings: string[]): void {
  const { subRecords, terminated, trailing } = readSubRecords(
    rec.data,
    0,
    `614 at offset ${rec.offset} (continuing ${objectWhere(obj)})`,
    warnings,
  );
  obj.subRecords.push(...subRecords.map((s) => ({ ...s, in614: true })));
  obj.terminated = terminated;
  obj.trailing = trailing;
  obj.raw614 = obj.raw614 ? concatBytes(obj.raw614, rec.data) : rec.data;
  obj.raw614Position = "continuation";
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

/** Interpret the object's sub-records once no continuation can follow. */
function finishObject(obj: DrawnObject, warnings: string[]): void {
  const at = objectWhere(obj);
  Object.assign(obj, interpretDisplayList(obj.subRecords, at, warnings));
  obj.shape = obj.shapes[0]?.shape ?? null;
  if (!obj.terminated) warnings.push(`${at}: sub-record list has no 0x1FFF end; stopped at the end of the record`);
  if (!obj.shapes.length) warnings.push(`${at} has no decodable shape`);
}

function describePending(p: Pending): string {
  const parts: string[] = [];
  if (p.transform) parts.push(`616 at offset ${p.transformOffset}`);
  if (p.buttonName !== undefined) parts.push("618");
  if (p.raw614) parts.push("614");
  return parts.join(", ");
}

function parseItems(
  nodes: readonly RecordNode[],
  where: string,
  warnings: string[],
): { items: LayerItem[]; otherRecords: RecordNode[] } {
  const items: LayerItem[] = [];
  const otherRecords: RecordNode[] = [];
  let pending: Pending = { extra: [] };
  /** The last object, while a 614 may still continue it. */
  let open: DrawnObject | null = null;
  const finishOpen = (): void => {
    if (open) finishObject(open, warnings);
    open = null;
  };

  for (const node of nodes) {
    if (node.type === "record" && node.tag === TAG_OBJECT_614 && open && !open.terminated) {
      continueObject(open, node, warnings);
      continue;
    }
    finishOpen();
    if (node.type === "block") {
      if (node.openTag === TAG_GROUP) {
        if (pending.raw614) warnings.push(`${where}: 614 before the group at offset ${node.offset}; dropped`);
        items.push(parseGroup(node, pending, warnings));
      } else {
        warnings.push(`${where}: unexpected block ${node.openTag} at offset ${node.offset}; kept raw`);
        otherRecords.push(...pending.extra, node);
      }
      pending = { extra: [] };
      continue;
    }
    switch (node.tag) {
      case TAG_TRANSFORM:
        if (pending.transform) {
          warnings.push(`${where}: ${describePending(pending)} not followed by an object (612) before the next 616; dropped`);
          otherRecords.push(...pending.extra);
          pending = { extra: [] };
        }
        pending.transform = readTransform(node, warnings);
        pending.transformOffset = node.offset;
        break;
      case TAG_BUTTON_NAME:
        if (pending.buttonName !== undefined) warnings.push(`${where}: second 618 at offset ${node.offset} replaces the first`);
        pending.buttonName = readButtonName(node.data);
        break;
      case TAG_OBJECT_614:
        if (pending.raw614 !== undefined) warnings.push(`${where}: second 614 at offset ${node.offset} replaces the first`);
        pending.raw614 = node.data;
        break;
      case TAG_OBJECT: {
        const obj = startObject(node, pending, warnings);
        items.push(obj);
        open = obj;
        pending = { extra: [] };
        break;
      }
      default:
        pending.extra.push(node);
    }
  }
  finishOpen();
  if (pending.transform || pending.buttonName !== undefined || pending.raw614) {
    warnings.push(`${where}: ${describePending(pending)} not followed by an object (612) at the end of the block; dropped`);
  }
  otherRecords.push(...pending.extra);
  return { items, otherRecords };
}

function parseGroup(block: BlockRecord, pending: Pending, warnings: string[]): ObjectGroup {
  const where = `group (608) at offset ${block.offset}`;
  if (block.data.length !== 16) warnings.push(`${where} has ${block.data.length} bytes of data, expected 16`);
  const { items, otherRecords } = parseItems(block.children, where, warnings);
  const group: ObjectGroup = {
    kind: "group",
    offset: block.offset,
    raw608: block.data,
    box: readBox(block.data, 0),
    box2: readBox(block.data, 8),
    extraRecords: pending.extra,
    items,
    otherRecords,
  };
  if (pending.transform) group.transform = pending.transform;
  if (pending.buttonName !== undefined) group.buttonName = pending.buttonName;
  return group;
}

/**
 * Parse the object layer block (516). A null block gives an empty layer.
 * Never throws on content.
 */
export function parseObjectLayer(block: BlockRecord | null): { layer: ObjectLayer; warnings: string[] } {
  const warnings: string[] = [];
  if (!block) return { layer: { extent: null, canvas: null, items: [], otherRecords: [] }, warnings };
  if (block.openTag !== TAG_OBJECT_LAYER) warnings.push(`object layer block has open tag ${block.openTag}, expected 516`);
  if (block.data.length !== 16) {
    warnings.push(`object layer (516) at offset ${block.offset} has ${block.data.length} bytes of data, expected 16`);
  }
  const { items, otherRecords } = parseItems(block.children, `object layer (516) at offset ${block.offset}`, warnings);
  return {
    layer: { extent: readBox(block.data, 0), canvas: readBox(block.data, 8), items, otherRecords },
    warnings,
  };
}
