import { describe, expect, it } from "vitest";
import { detectFormat } from "./registry";
import { hexdump } from "./hexdump";
import { DocumentType } from "./hg3/container";
import { ascii, buildDocument } from "./hg3/testing/bytes";

describe("detectFormat", () => {
  it.each([
    ["HGB3", DocumentType.Pie],
    ["HGB1", DocumentType.Show],
    ["HGA2", DocumentType.Palette],
  ])("claims %s files with confidence 1 whatever their name", (signature, type) => {
    const detection = detectFormat(buildDocument(signature, type, []), "anything.bin");
    expect(detection?.parser.id).toBe("hg3");
    expect(detection?.confidence).toBe(1);
  });
  it.each(["SALES.CH3", "demo.sh3", "Colors.Pl3", "SETUP.PC3"])(
    "gives weak confidence to %s without a signature",
    (name) => {
      const detection = detectFormat(ascii("HG2 not really"), name);
      expect(detection?.parser.id).toBe("hg3");
      expect(detection?.confidence).toBe(0.2);
    },
  );
  it("no longer claims .SY3 symbol libraries", () => {
    expect(detectFormat(new Uint8Array(), "SYMBOLS.SY3")).toBeNull();
  });
  it("returns null for unrelated files", () => {
    expect(detectFormat(new Uint8Array(), "photo.jpg")).toBeNull();
  });
});

describe("hexdump", () => {
  it("renders offset, hex and ascii columns", () => {
    const [line] = hexdump(new Uint8Array([0x48, 0x47, 0x00]));
    expect(line.startsWith("00000000  48 47 00")).toBe(true);
    expect(line.endsWith("|HG.|")).toBe(true);
  });
});
