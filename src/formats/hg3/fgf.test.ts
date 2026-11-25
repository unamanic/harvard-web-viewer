import { describe, expect, it } from "vitest";
import { BUILT_IN_FONTS, FGF_ENTRY_LENGTH, NO_GLYPH, NotFgfError, parseFgf, splitFontName } from "./fgf";
import { ascii, concat, padded, u16 } from "./testing/bytes";

interface FgfEntrySpec {
  source: number;
  number: number;
  style: number;
  classification?: number[];
  name: string;
  fileName: string;
  /** code → id; codes not given are NO_GLYPH. */
  map?: Record<number, number>;
}

function fgfEntry(e: FgfEntrySpec): Uint8Array {
  const map: number[] = [];
  for (let c = 0; c < 256; c++) map.push(e.map?.[c] ?? NO_GLYPH);
  return concat(
    u16(e.source),
    u16(e.number),
    u16(e.style),
    e.classification ?? [0, 0, 0, 0],
    padded(e.name, 48),
    padded(e.fileName, 18),
    ...map.map(u16),
  );
}

function buildFgf(entries: FgfEntrySpec[], count = entries.length): Uint8Array {
  return concat(ascii("IDXF"), u16(count), ...entries.map(fgfEntry));
}

const swiss: FgfEntrySpec = {
  source: 3,
  number: 3,
  style: 0x4268,
  classification: [0, 4, 6, 8],
  name: "Swiss 721|Roman",
  fileName: "bx000003.spd",
  map: { 32: 0, 65: 33 },
};
const dutch: FgfEntrySpec = { source: 3, number: 13, style: 0x42a8, name: "Dutch 801|Bold", fileName: "BX000013.SPD" };

describe("parseFgf", () => {
  it("round-trips entries", () => {
    const bytes = buildFgf([swiss, dutch]);
    expect(fgfEntry(swiss).length).toBe(FGF_ENTRY_LENGTH);
    const { entries, warnings } = parseFgf(bytes);
    expect(warnings).toEqual([]);
    expect(entries).toHaveLength(2);
    const [a, b] = entries;
    expect(a.key).toEqual({ source: 3, number: 3, style: 0x4268 });
    expect(Array.from(a.classification)).toEqual([0, 4, 6, 8]);
    expect(a.name).toBe("Swiss 721|Roman");
    expect(a.family).toBe("Swiss 721");
    expect(a.style).toBe("Roman");
    expect(a.fileName).toBe("bx000003.spd");
    expect(a.charMap).toBeInstanceOf(Uint16Array);
    expect(a.charMap.length).toBe(256);
    expect(a.charMap[65]).toBe(33);
    expect(a.charMap[32]).toBe(0);
    expect(a.charMap[0]).toBe(NO_GLYPH);
    expect(b.key).toEqual({ source: 3, number: 13, style: 0x42a8 });
    expect(b.family).toBe("Dutch 801");
    expect(b.style).toBe("Bold");
  });

  it("rejects a wrong signature", () => {
    expect(() => parseFgf(ascii("IDXX\0\0"))).toThrow(NotFgfError);
    expect(() => parseFgf(ascii("ID"))).toThrow(NotFgfError);
  });

  it("warns on a missing count", () => {
    expect(parseFgf(ascii("IDXF"))).toEqual({ entries: [], warnings: [expect.stringMatching(/truncated/)] });
  });

  it("warns when the count exceeds the entries and on a truncated entry", () => {
    const full = buildFgf([swiss, dutch], 3);
    const r = parseFgf(full.subarray(0, full.length - 10));
    expect(r.entries).toHaveLength(1);
    expect(r.warnings).toEqual([expect.stringMatching(/says 3 entries but has room for 1 \(plus 578 byte/)]);
  });

  it("warns on trailing bytes and reads only `count` entries", () => {
    const r = parseFgf(buildFgf([swiss, dutch], 1));
    expect(r.entries).toHaveLength(1);
    expect(r.warnings).toEqual([expect.stringMatching(/588 byte\(s\) after its 1 entries/)]);
  });
});

describe("splitFontName", () => {
  it("splits and trims", () => {
    expect(splitFontName("Geo Slab 712|Medium Italic ")).toEqual({ family: "Geo Slab 712", style: "Medium Italic" });
    expect(splitFontName("Plain")).toEqual({ family: "Plain", style: "" });
  });
});

describe("BUILT_IN_FONTS", () => {
  it("holds the 22-entry catalogue, including both sample keys", () => {
    expect(BUILT_IN_FONTS).toHaveLength(22);
    const names = BUILT_IN_FONTS.map((f) => `${f.key.source}:${f.key.number}:${f.key.style.toString(16)} ${f.family}|${f.style}`);
    expect(names).toContain("3:3:4268 Swiss 721|Roman");
    expect(names).toContain("3:13:42a8 Dutch 801|Bold");
    expect(names).toContain("2:25:5878 HG Gothic|Bold");
    expect(new Set(BUILT_IN_FONTS.map((f) => `${f.key.source}:${f.key.number}:${f.key.style}`)).size).toBe(22);
  });
});
