/** Test helpers for the chart data parsers: build a chart around data records. */
import { type Chart, parseChart } from "../chart";
import { readContainer } from "../container";
import { type RecordSpec, block, buildDocument, concat, cstr, f32, leaf, u16, u8 } from "../testing/bytes";

/** A chart of `type` whose 508 block holds `records`. */
export function chartWith(type: number, records: RecordSpec[]): Chart {
  const file = buildDocument("HGB3", type, [
    block(500, [leaf(400, cstr(""))]),
    block(504, [block(516, [], new Uint8Array(16)), block(508, records)]),
  ]);
  return parseChart(readContainer(file)).chart;
}

/** A text line record (800) with a plain tail. */
export function textLine(slot: number, row: number, column: number, text: string, color = 1): RecordSpec {
  return leaf(
    800,
    concat(u16(slot), u16(row), u16(column), u8(1), u8(0x10), cstr(text), textTail(text.length, color)),
  );
}

/** A 22-byte text tail (SPEC §5.3): length, colours, size 4, centred, font 3:3:0x4268. */
export function textTail(length: number, color = 1, size = 4): Uint8Array {
  return concat(u16(length), u16(color), u16(0), u16(color), u16(0), f32(size), u16(2), u16(3), u16(3), u16(0x4268));
}
