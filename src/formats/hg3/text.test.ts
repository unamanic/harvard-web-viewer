import { describe, expect, it } from "vitest";
import { ByteReader } from "./ByteReader";
import type { LeafRecord } from "./container";
import { fontKeyString, isEmptyFontKey, readFontKey } from "./fontKey";
import { concat, cstr, f32, f64, u16, u8 } from "./testing/bytes";
import { Justification, TEXT_TAIL_LENGTH, readStyleTable, readTextLine, readTextTail } from "./text";

function tail(o: { len: number; color?: number; color2?: number; size?: number; just?: number; key?: number[] }) {
  const [s, n, st] = o.key ?? [3, 3, 0x4268];
  return concat(
    u16(o.len),
    u16(o.color ?? 1),
    u16(0),
    u16(o.color2 ?? o.color ?? 1),
    u16(0),
    f32(o.size ?? 9),
    u16(o.just ?? 2),
    u16(s),
    u16(n),
    u16(st),
  );
}

const rec = (tag: number, data: Uint8Array): LeafRecord => ({ type: "record", tag, offset: 100, data });

describe("font key", () => {
  it("reads and formats", () => {
    const k = readFontKey(new ByteReader(concat(u16(3), u16(13), u16(0x42a8))));
    expect(k).toEqual({ source: 3, number: 13, style: 0x42a8 });
    expect(fontKeyString(k)).toBe("3:13:0x42a8");
    expect(isEmptyFontKey(k)).toBe(false);
    expect(isEmptyFontKey({ source: 0, number: 0, style: 0 })).toBe(true);
  });
});

describe("readTextTail", () => {
  it("reads 22 bytes and splits justification flags", () => {
    const bytes = tail({ len: 5, color: 4, color2: 5, size: 3.5, just: 0x2003 });
    expect(bytes.length).toBe(TEXT_TAIL_LENGTH);
    const r = new ByteReader(bytes);
    const t = readTextTail(r);
    expect(r.remaining).toBe(0);
    expect(t).toMatchObject({
      declaredLength: 5,
      color: 4,
      raw4: 0,
      color2: 5,
      raw8: 0,
      size: 3.5,
      justification: Justification.Right,
      justificationFlags: 0x2000,
      fontKey: { source: 3, number: 3, style: 0x4268 },
    });
  });

  it("throws when short", () => {
    expect(() => readTextTail(new ByteReader(new Uint8Array(21)))).toThrow();
  });
});

describe("readTextLine", () => {
  it("reads head, CP437 text and tail", () => {
    const w: string[] = [];
    const data = concat(u16(6), u16(2), u16(1), u8(3), u8(0x10), [0x43, 0x61, 0x66, 0x82, 0], tail({ len: 4 }));
    const line = readTextLine(rec(800, data), w);
    expect(w).toEqual([]);
    expect(line).toMatchObject({ slot: 6, row: 2, column: 1, raw6: 3, raw7: 0x10, text: "Café", declaredLength: 4 });
  });

  it("warns on a length mismatch but keeps the line", () => {
    const w: string[] = [];
    const line = readTextLine(rec(800, concat(u16(1), u16(0), u16(0), u8(0), u8(0x10), cstr("Hi"), tail({ len: 7 }))), w);
    expect(line?.text).toBe("Hi");
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/declares text length 7 but the text has 2/);
  });

  it("skips short records and missing terminators", () => {
    const w: string[] = [];
    expect(readTextLine(rec(800, new Uint8Array(10)), w)).toBeNull();
    const noNul = concat(u16(1), u16(0), u16(0), u8(0), u8(0), new Uint8Array(30).fill(0x41));
    expect(readTextLine(rec(800, noNul), w)).toBeNull();
    const shortTail = concat(u16(1), u16(0), u16(0), u8(0), u8(0), cstr("Hello world, longer"), tail({ len: 19 }).subarray(0, 10));
    expect(readTextLine(rec(800, shortTail), w)).toBeNull();
    expect(w).toHaveLength(3);
    expect(w[0]).toMatch(/too short/);
    expect(w[1]).toMatch(/no string terminator/);
    expect(w[2]).toMatch(/tail truncated/);
  });
});

describe("readStyleTable", () => {
  const entry = (size: number, role: number, just: number) => concat(f64(size), u8(role), u8(just), u16(3), u16(3), u16(0x4268));

  it("reads 16-byte entries", () => {
    const w: string[] = [];
    const t = readStyleTable(rec(1002, concat(entry(8, 1, 2), entry(0, 2, 1))), w);
    expect(w).toEqual([]);
    expect(t).toEqual([
      { size: 8, colorRole: 1, justification: 2, fontKey: { source: 3, number: 3, style: 0x4268 } },
      { size: 0, colorRole: 2, justification: 1, fontKey: { source: 3, number: 3, style: 0x4268 } },
    ]);
  });

  it("ignores a partial trailing entry with a warning", () => {
    const w: string[] = [];
    expect(readStyleTable(rec(1002, concat(entry(8, 1, 2), [1, 2, 3])), w)).toHaveLength(1);
    expect(w[0]).toMatch(/not a multiple of 16/);
  });
});
