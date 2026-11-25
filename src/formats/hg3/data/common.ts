/**
 * Helpers shared by the chart data parsers (task 11, SPEC §5.4).
 */
import { ByteReader } from "../ByteReader";
import type { Chart } from "../chart";
import type { LeafRecord } from "../container";

/** A record kept undecoded: its tag, file offset and data (ground rule: keep what we don't understand). */
export type RawRecord = LeafRecord;

/** Every data record of `chart` with `tag`, in file order. */
export function recordsOf(chart: Chart, tag: number): LeafRecord[] {
  return chart.dataRecords.filter((r) => r.tag === tag);
}

/** Data records whose tag is not in `known`, in file order. */
export function otherRecords(chart: Chart, known: ReadonlySet<number>): LeafRecord[] {
  return chart.dataRecords.filter((r) => !known.has(r.tag));
}

/** Data of the first record with `tag`, or null; warns when there are several. */
export function singleRaw(chart: Chart, tag: number, warnings: string[]): Uint8Array | null {
  const all = recordsOf(chart, tag);
  if (all.length > 1) warnings.push(`${all.length} records with tag ${tag}; using the first`);
  return all[0]?.data ?? null;
}

/**
 * True when the record has at least `min` bytes. Warns (and returns false)
 * when it is shorter; warns (and returns true) when its length is not
 * `expected`.
 */
export function checkLength(rec: LeafRecord, expected: number, min: number, what: string, warnings: string[]): boolean {
  const at = `${what} (${rec.tag}) at offset ${rec.offset}`;
  if (rec.data.length < min) {
    warnings.push(`${at} too short (${rec.data.length} bytes, need ${min}); kept raw`);
    return false;
  }
  if (rec.data.length !== expected) warnings.push(`${at} has ${rec.data.length} bytes, expected ${expected}`);
  return true;
}

/** Reader positioned at `offset` in `data`. */
export function readerAt(data: Uint8Array, offset: number): ByteReader {
  const r = new ByteReader(data);
  r.seek(offset);
  return r;
}

/** f64 at `offset`, null for the "not set" pattern (SPEC §3). */
export function f64At(data: Uint8Array, offset: number): number | null {
  return readerAt(data, offset).f64OrNotSet();
}

/** f32 at `offset`. */
export function f32At(data: Uint8Array, offset: number): number {
  return readerAt(data, offset).f32();
}

/** u16 at `offset`. */
export function u16At(data: Uint8Array, offset: number): number {
  return readerAt(data, offset).u16();
}

/** i16 at `offset`. */
export function i16At(data: Uint8Array, offset: number): number {
  return readerAt(data, offset).i16();
}

/** "padded string[n]" at `offset`, decoded in the HG3 character set. */
export function paddedAt(data: Uint8Array, offset: number, n: number): string {
  return readerAt(data, offset).paddedString(n);
}

/** Sequential f64 values (not set → null) from `offset` to the end of `data`. */
export function f64Array(data: Uint8Array, offset = 0): (number | null)[] {
  const r = readerAt(data, offset);
  const out: (number | null)[] = [];
  while (r.remaining >= 8) out.push(r.f64OrNotSet());
  return out;
}
