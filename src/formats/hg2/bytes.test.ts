import { describe, expect, it } from "vitest";
import { Bytes, cp437, hasSignature } from "./bytes";

const f32 = (v: number) => new Uint8Array(new Float32Array([v]).buffer);

describe("Bytes", () => {
  it("reads little-endian fields", () => {
    const b = new Bytes(new Uint8Array([0x34, 0x12, ...f32(2.5)]));
    expect(b.u8(0)).toBe(0x34);
    expect(b.u16(0)).toBe(0x1234);
    expect(b.f32(2)).toBe(2.5);
    expect(b.value(2)).toBe(2.5);
  });

  it("reads past the end as 0, null or empty, never throwing", () => {
    const b = new Bytes(new Uint8Array([1, 2, 3]));
    expect(b.u8(3)).toBe(0);
    expect(b.u8(-1)).toBe(0);
    expect(b.u16(2)).toBe(0);
    expect(b.f32(0)).toBe(0);
    expect(b.value(0)).toBeNull();
    expect(b.pstring(5)).toBe("");
    expect(Array.from(b.slice(2, 10))).toEqual([3]);
  });

  it("reads 1e30 (missing or auto) and non-finite values as null", () => {
    expect(new Bytes(new Uint8Array([0xca, 0xf2, 0x49, 0x71])).value(0)).toBeNull();
    expect(new Bytes(f32(Number.NaN)).value(0)).toBeNull();
    expect(new Bytes(f32(-1e30)).value(0)).toBeNull();
    expect(new Bytes(f32(1e20)).value(0)).toBe(new Float32Array([1e20])[0]);
  });

  it("reads a length-prefixed string inside its field, ignoring leftovers", () => {
    const data = new Uint8Array([3, 0x41, 0x42, 0x43, 0x44, 0x45]);
    expect(new Bytes(data).pstring(0)).toBe("ABC");
    // The length byte claims more than the field holds: cut at the field.
    expect(new Bytes(new Uint8Array([9, 0x41, 0x42, 0x43])).pstring(0, 3)).toBe("AB");
  });
});

describe("cp437", () => {
  it("turns control codes into spaces, stops at a NUL and maps the upper half", () => {
    expect(cp437(new Uint8Array([0x41, 0x09, 0x82, 0x00, 0x42]))).toBe("A é");
  });
});

describe("hasSignature", () => {
  it("compares the first bytes", () => {
    expect(hasSignature(new Uint8Array([0x50, 0x43, 0x4f, 0x4b, 0]), "PCOK")).toBe(true);
    expect(hasSignature(new Uint8Array([0x50, 0x43]), "PCOK")).toBe(false);
    expect(hasSignature(new Uint8Array([0x46, 0x61, 0x6c, 0x64]), "Falc")).toBe(false);
  });
});
