import { describe, expect, it } from "vitest";
import { cp437Char, decodeCp437 } from "./cp437";

describe("code page 437", () => {
  it("keeps ASCII and maps the upper half", () => {
    const codes = (text: string) => [...text].map((c) => c.codePointAt(0));
    // A, Ç, ü, ß, ■ and a no-break space.
    expect(codes(decodeCp437(new Uint8Array([0x41, 0x80, 0x81, 0xe1, 0xfe, 0xff])))).toEqual([0x41, 0xc7, 0xfc, 0xdf, 0x25a0, 0xa0]);
    expect(cp437Char(0x9e)).toBe("₧");
    expect(cp437Char(0xc4)).toBe("─");
  });

  it("has 128 characters in the upper half", () => {
    const upper = decodeCp437(Uint8Array.from({ length: 128 }, (_, i) => 0x80 + i));
    expect([...upper]).toHaveLength(128);
  });
});
