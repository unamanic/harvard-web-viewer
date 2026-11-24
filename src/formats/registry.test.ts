import { describe, expect, it } from "vitest";
import { detectFormat } from "./registry";
import { hexdump } from "./hexdump";

describe("detectFormat", () => {
  it("claims Harvard Graphics extensions", () => {
    expect(detectFormat(new Uint8Array(), "SALES.CH3")?.parser.id).toBe("hg-dos");
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
