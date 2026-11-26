import { describe, expect, it } from "vitest";
import { ByteReader, TruncatedError, isNotSet } from "./ByteReader";
import { decodeFileName } from "./charset";

const r = (...b: number[]) => new ByteReader(new Uint8Array(b));

function f32Bytes(v: number): number[] {
  const dv = new DataView(new ArrayBuffer(4));
  dv.setFloat32(0, v, true);
  return [...new Uint8Array(dv.buffer)];
}
function f64Bytes(v: number): number[] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, v, true);
  return [...new Uint8Array(dv.buffer)];
}
const NOT_SET = [0, 0, 0, 0, 0, 0, 0xf0, 0xff];

describe("ByteReader numbers", () => {
  it("reads u8, u16, i16, u32 little-endian", () => {
    const br = r(0xfe, 0x34, 0x12, 0xff, 0xff, 0x00, 0x80, 0x78, 0x56, 0x34, 0x12, 0xff, 0xff, 0xff, 0xff);
    expect(br.u8()).toBe(0xfe);
    expect(br.u16()).toBe(0x1234);
    expect(br.i16()).toBe(-1);
    expect(br.i16()).toBe(-32768);
    expect(br.u32()).toBe(0x12345678);
    expect(br.u32()).toBe(0xffffffff);
    expect(br.remaining).toBe(0);
  });
  it("reads positive i16 and u16 above 0x7FFF", () => {
    const br = r(0xff, 0x7f, 0x00, 0x80);
    expect(br.i16()).toBe(32767);
    expect(br.u16()).toBe(0x8000);
  });
  it("reads f32 and f64", () => {
    const br = r(...f32Bytes(1.5), ...f32Bytes(-0.25), ...f64Bytes(Math.PI), ...f64Bytes(-1234.5678));
    expect(br.f32()).toBe(1.5);
    expect(br.f32()).toBe(-0.25);
    expect(br.f64()).toBe(Math.PI);
    expect(br.f64()).toBe(-1234.5678);
  });
  it("respects subarray byteOffset", () => {
    const buf = new Uint8Array([0xaa, 0xbb, 0x01, 0x02, 0x03, 0x04, 0xcc]);
    const br = new ByteReader(buf.subarray(2, 6));
    expect(br.length).toBe(4);
    expect(br.u32()).toBe(0x04030201);
    expect(() => br.u8()).toThrow(TruncatedError);
  });
  it("respects byteOffset for floats", () => {
    const buf = new Uint8Array([0x99, ...f64Bytes(2.75)]);
    expect(new ByteReader(buf.subarray(1)).f64()).toBe(2.75);
  });
});

describe("not-set sentinel", () => {
  it("isNotSet is true only for -Infinity", () => {
    expect(isNotSet(Number.NEGATIVE_INFINITY)).toBe(true);
    expect(isNotSet(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isNotSet(0)).toBe(false);
    expect(isNotSet(NaN)).toBe(false);
  });
  it("f64 of the pattern is -Infinity", () => {
    expect(isNotSet(r(...NOT_SET).f64())).toBe(true);
  });
  it("f64OrNotSet returns null for the pattern and the value otherwise", () => {
    const br = r(...NOT_SET, ...f64Bytes(-3), ...f64Bytes(0));
    expect(br.f64OrNotSet()).toBeNull();
    expect(br.f64OrNotSet()).toBe(-3);
    expect(br.f64OrNotSet()).toBe(0);
    expect(br.pos).toBe(24);
  });
});

describe("strings", () => {
  it("cstring reads to NUL, consumes it, decodes the HG3 character set", () => {
    const br = r(0x43, 0x61, 0x66, 0x82, 0x00, 0xb0, 0x00, 0x00, 0x41);
    expect(br.cstring()).toBe("Café");
    expect(br.pos).toBe(5);
    expect(br.cstring()).toBe("░");
    expect(br.cstring()).toBe("");
    expect(br.pos).toBe(8);
  });
  it("cstring without NUL throws and does not move", () => {
    const br = r(0x00, 0x41, 0x42);
    br.cstring();
    expect(() => br.cstring()).toThrow(TruncatedError);
    expect(br.pos).toBe(1);
  });
  it("paddedString with NUL padding", () => {
    const br = r(0x48, 0x69, 0x00, 0x58, 0x58, 0x7a);
    expect(br.paddedString(5)).toBe("Hi");
    expect(br.pos).toBe(5);
  });
  it("paddedString with space padding and no NUL", () => {
    const br = r(0x82, 0x20, 0xb0, 0x20, 0x20);
    expect(br.paddedString(5)).toBe("é ░");
    expect(br.remaining).toBe(0);
  });
  it("decodes the upper half as the HG3 set, not CP437", () => {
    expect(r(0xb5, 0xca, 0xcb, 0xfa, 0x00).cstring()).toBe("Á“”•");
    expect(r(0xf2, 0xfd, 0x20, 0x20).paddedString(4)).toBe("≥−");
  });
  it("takes another decoder, e.g. for file names", () => {
    expect(r(0x41, 0x2e, 0x50, 0x43, 0x58, 0x00).cstring(decodeFileName)).toBe("A.PCX");
    expect(r(0x41, 0xe9, 0x00, 0x00).paddedString(4, decodeFileName)).toBe("A\u00e9");
  });
  it("paddedString trims spaces before a NUL", () => {
    expect(r(0x41, 0x20, 0x20, 0x00, 0x20).paddedString(5)).toBe("A");
  });
});

describe("positioning", () => {
  it("skip, seek, pos, remaining", () => {
    const br = r(1, 2, 3, 4, 5);
    br.skip(2);
    expect(br.pos).toBe(2);
    expect(br.remaining).toBe(3);
    expect(br.u8()).toBe(3);
    br.seek(0);
    expect(br.u8()).toBe(1);
    br.seek(5);
    expect(br.remaining).toBe(0);
    expect(() => br.seek(6)).toThrow(TruncatedError);
    expect(() => br.seek(-1)).toThrow(TruncatedError);
    expect(br.pos).toBe(5);
  });
  it("bytes returns a view over the same buffer", () => {
    const buf = new Uint8Array([9, 8, 7, 6]);
    const v = new ByteReader(buf).bytes(3);
    expect([...v]).toEqual([9, 8, 7]);
    buf[1] = 0x55;
    expect(v[1]).toBe(0x55);
  });
  it("sub reads a bounded region and advances the parent", () => {
    const br = r(0xaa, 0x01, 0x02, 0x03, 0xbb);
    br.skip(1);
    const s = br.sub(3);
    expect(br.pos).toBe(4);
    expect(s.length).toBe(3);
    expect(s.pos).toBe(0);
    expect(s.u16()).toBe(0x0201);
    expect(() => s.u16()).toThrow(TruncatedError);
    expect(s.u8()).toBe(3);
    expect(br.u8()).toBe(0xbb);
  });
});

describe("TruncatedError", () => {
  const cases: [string, (b: ByteReader) => unknown, number][] = [
    ["u8", (b) => b.u8(), 1],
    ["u16", (b) => b.u16(), 2],
    ["i16", (b) => b.i16(), 2],
    ["u32", (b) => b.u32(), 4],
    ["f32", (b) => b.f32(), 4],
    ["f64", (b) => b.f64(), 8],
    ["f64OrNotSet", (b) => b.f64OrNotSet(), 8],
    ["paddedString", (b) => b.paddedString(4), 4],
    ["bytes", (b) => b.bytes(4), 4],
    ["skip", (b) => b.skip(4), 4],
    ["sub", (b) => b.sub(4), 4],
  ];
  for (const [name, read, need] of cases) {
    it(`${name} throws without advancing`, () => {
      // One byte consumed, then fewer than `need` remain.
      const br = new ByteReader(new Uint8Array(need));
      br.skip(1);
      let err: unknown;
      try {
        read(br);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(TruncatedError);
      expect(err).toBeInstanceOf(Error);
      const te = err as TruncatedError;
      expect(te.offset).toBe(1);
      expect(te.requested).toBe(need);
      expect(te.available).toBe(need - 1);
      expect(br.pos).toBe(1);
    });
  }
  it("cstring on empty input throws", () => {
    const br = r();
    expect(() => br.cstring()).toThrow(TruncatedError);
    expect(br.pos).toBe(0);
  });
});
