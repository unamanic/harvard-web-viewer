import { describe, expect, it } from "vitest";
import { HG3_CHARSET, decodeFileName, decodeHg3Text, hg3CodeOf } from "./charset";

const bytes = (...b: number[]) => Uint8Array.from(b);

describe("HG3 character set", () => {
  it("has 256 entries of one UTF-16 unit each", () => {
    expect(HG3_CHARSET).toHaveLength(256);
    for (const ch of HG3_CHARSET) expect(ch).toHaveLength(1);
  });

  it("is ASCII from 0x20 to 0x7E", () => {
    for (let c = 0x20; c < 0x7f; c++) expect(HG3_CHARSET[c]).toBe(String.fromCharCode(c));
  });

  it("decodes the upper half as Harvard's set, not CP437", () => {
    const spots: [number, string][] = [
      [0x82, "é"],
      [0x8e, "Ä"],
      [0x9b, "ø"],
      [0x9e, "×"],
      [0xa9, "®"],
      [0xb5, "Á"],
      [0xb8, "©"],
      [0xb9, "Œ"],
      [0xc6, "ã"],
      [0xca, "“"],
      [0xcb, "”"],
      [0xd0, "ð"],
      [0xe0, "Ó"],
      [0xee, "‘"],
      [0xef, "’"],
      [0xf0, "‰"],
      [0xf2, "≥"],
      [0xf3, "≤"],
      [0xf9, "►"],
      [0xfa, "•"],
      [0xfd, "−"],
    ];
    for (const [code, ch] of spots) expect(HG3_CHARSET[code], code.toString(16)).toBe(ch);
  });

  it("decodes control codes: 0x07 big bullet, 0x0A/0x0D line ends", () => {
    expect(decodeHg3Text(bytes(0x07, 0x41, 0x0d, 0x0a, 0x42))).toBe("●A\r\nB");
    expect(HG3_CHARSET[0x07]).not.toBe(HG3_CHARSET[0xfa]);
    expect(HG3_CHARSET[0xff]).toBe("�");
  });

  it("decodes one character per byte", () => {
    expect(decodeHg3Text(bytes(0x43, 0x61, 0x66, 0x82))).toBe("Café");
    expect(decodeHg3Text(bytes())).toBe("");
  });

  it("round-trips every printable code", () => {
    for (let code = 0x20; code < 0xff; code++) {
      const ch = HG3_CHARSET[code]!;
      const back = hg3CodeOf(ch);
      if (code === 0xfc) expect(back).toBe(0x2a); // 0xFC is also "*"; ASCII wins
      else expect(back, code.toString(16)).toBe(code);
      expect(decodeHg3Text(bytes(back!))).toBe(ch);
    }
  });

  it("prefers printable codes over control pictographs", () => {
    expect(hg3CodeOf("►")).toBe(0xf9);
    expect(hg3CodeOf("§")).toBe(0xf5);
    expect(hg3CodeOf("●")).toBe(0x07);
    expect(hg3CodeOf("\n")).toBe(0x0a);
    expect(hg3CodeOf("α")).toBeUndefined();
  });

  it("decodes file names as stored bytes", () => {
    expect(decodeFileName(bytes(0x4c, 0x4f, 0x47, 0x4f, 0x2e, 0x50, 0x43, 0x58))).toBe("LOGO.PCX");
    expect(decodeFileName(bytes(0x82))).toBe("\u0082");
  });
});
