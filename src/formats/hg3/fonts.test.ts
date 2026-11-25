import { describe, expect, it } from "vitest";
import type { ParseContext, ResolvedFile } from "../types";
import { textSizeToUnits, PAGE_SHORT_SIDE } from "./assumptions";
import { ascii, concat, padded, u16 } from "./testing/bytes";
import {
  DEFAULT_CSS_FAMILY,
  LOOK_ALIKES,
  createFontResolver,
  cssFamilyFor,
  decodeStyleWord,
  fontKind,
} from "./fonts";

interface Spec {
  source: number;
  number: number;
  style: number;
  name: string;
  fileName: string;
  map?: Record<number, number>;
}

/** HG3.FGF bytes (SPEC §2); fgf.test.ts covers the layout itself. */
function buildFgf(entries: Spec[]): Uint8Array {
  return concat(
    ascii("IDXF"),
    u16(entries.length),
    ...entries.map((e) =>
      concat(
        u16(e.source), u16(e.number), u16(e.style), [0, 0, 0, 0], padded(e.name, 48), padded(e.fileName, 18),
        ...Array.from({ length: 256 }, (_, c) => u16(e.map?.[c] ?? 0xffff)),
      ),
    ),
  );
}

const SWISS = { source: 3, number: 3, style: 0x4268 };
const DUTCH_BOLD = { source: 3, number: 13, style: 0x42a8 };
const HG_ROMAN_LIGHT = { source: 2, number: 12, style: 0x5848 };

function fakeContext(files: Record<string, Uint8Array>): ParseContext & { asked: string[] } {
  const asked: string[] = [];
  return {
    path: "DATA/A.CH3",
    asked,
    resolve(name: string, purpose?: string): ResolvedFile | null {
      asked.push(`${name}:${purpose}`);
      const key = Object.keys(files).find((k) => k.toUpperCase() === name.toUpperCase());
      return key ? { path: `FONT/${key}`, name: key, bytes: files[key] } : null;
    },
  };
}

const fgf = buildFgf([
  { source: 3, number: 3, style: 0x4268, name: "Swiss 721|Roman", fileName: "bx000003.spd", map: { 65: 33 } },
  { source: 3, number: 13, style: 0x42a8, name: "Dutch 801|Bold", fileName: "bx000013.spd" },
  { source: 2, number: 12, style: 0x5848, name: "HG Roman|Light", fileName: "hg3lite.fn3" },
]);
const spd = new Uint8Array([1, 2, 3]);

describe("decodeStyleWord", () => {
  it.each([
    [0x4228, 100, false, "speedo"],
    [0x4229, 100, true, "speedo"],
    [0x4248, 300, false, "speedo"],
    [0x5858, 700, false, "stroke"],
    [0x4268, 400, false, "speedo"],
    [0x4279, 500, true, "speedo"],
    [0x42a8, 700, false, "speedo"],
    [0x42a9, 700, true, "speedo"],
    [0x1233, 400, true, "unknown"],
  ])("0x%s → %i italic=%s %s", (style, weight, italic, kind) => {
    expect(decodeStyleWord(style)).toEqual({ weight, italic, kind });
  });

  it("takes the kind from the source first", () => {
    expect(fontKind({ source: 2, number: 1, style: 0x4268 })).toBe("stroke");
    expect(fontKind({ source: 3, number: 1, style: 0x5848 })).toBe("speedo");
    expect(fontKind({ source: 9, number: 1, style: 0x5848 })).toBe("stroke");
    expect(fontKind({ source: 9, number: 1, style: 0 })).toBe("unknown");
  });
});

describe("cssFamilyFor", () => {
  it("matches family names case-insensitively by substring", () => {
    expect(cssFamilyFor("Swiss 721")).toBe("Helvetica, Arial, 'Liberation Sans', sans-serif");
    expect(cssFamilyFor("DUTCH 801")).toBe("'Times New Roman', Times, 'Liberation Serif', serif");
    expect(cssFamilyFor("Geo Slab 712")).toBe("Rockwell, 'Roboto Slab', serif");
    expect(cssFamilyFor("Monospace 821")).toMatch(/monospace$/);
    expect(cssFamilyFor("Monospace 821")).not.toMatch(/Courier/);
    expect(cssFamilyFor("HG Script")).toMatch(/cursive$/);
    expect(cssFamilyFor("HG Sans serif")).toMatch(/sans-serif$/);
    expect(cssFamilyFor("HG Gothic")).toMatch(/serif$/);
  });

  it("defaults to sans-serif", () => {
    expect(cssFamilyFor("")).toBe(DEFAULT_CSS_FAMILY);
    expect(cssFamilyFor("Zapf Chancery")).toBe(DEFAULT_CSS_FAMILY);
  });

  it("takes a replacement table", () => {
    expect(cssFamilyFor("Swiss 721", [{ match: "SWISS", css: "Clone Sans" }])).toBe("Clone Sans");
  });

  it("has a stack for every face named in SPEC §2", () => {
    for (const f of ["Swiss 721", "Dutch 801", "Geo Slab 712", "Monospace 821", "HG Roman", "HG Sans serif", "HG Script", "HG Gothic"]) {
      expect(LOOK_ALIKES.some((l) => f.toLowerCase().includes(l.match))).toBe(true);
    }
  });
});

describe("createFontResolver", () => {
  it("uses HG3.FGF and the font file when present", () => {
    const ctx = fakeContext({ "HG3.FGF": fgf, "BX000003.SPD": spd });
    const r = createFontResolver(ctx);
    expect(ctx.asked).toEqual([]);
    const f = r.resolve(SWISS);
    expect(f).toMatchObject({
      key: SWISS,
      family: "Swiss 721",
      style: "Roman",
      weight: 400,
      italic: false,
      kind: "speedo",
      fileName: "bx000003.spd",
      cssFamily: "Helvetica, Arial, 'Liberation Sans', sans-serif",
    });
    expect(f.file?.bytes).toBe(spd);
    expect(f.charMap?.[65]).toBe(33);
    expect(r.indexSource).toBe("file");
    expect(r.warnings()).toEqual([]);
    expect(ctx.asked).toEqual(["HG3.FGF:font index", "bx000003.spd:font"]);
  });

  it("asks for font files only when their key is used, and caches", () => {
    const ctx = fakeContext({ "HG3.FGF": fgf });
    const r = createFontResolver(ctx);
    const a = r.resolve(DUTCH_BOLD);
    expect(r.resolve({ ...DUTCH_BOLD })).toBe(a);
    expect(ctx.asked).toEqual(["HG3.FGF:font index", "bx000013.spd:font"]);
    expect(a.file).toBeNull();
    expect(a.weight).toBe(700);
    expect(a.cssFamily).toMatch(/Times/);
    expect(r.warnings()).toEqual(["font file bx000013.spd (Dutch 801 Bold) not found; using a substitute"]);

    const h = r.resolve(HG_ROMAN_LIGHT);
    expect(h.kind).toBe("stroke");
    expect(h.weight).toBe(300);
    expect(ctx.asked).toEqual(["HG3.FGF:font index", "bx000013.spd:font", "hg3lite.fn3:font"]);
    expect(r.used().map((u) => u.family)).toEqual(["Dutch 801", "HG Roman"]);
  });

  it("asks once per file even for different keys naming the same file", () => {
    const shared = buildFgf([
      { source: 3, number: 3, style: 0x4268, name: "Swiss 721|Roman", fileName: "bx000003.spd" },
      { source: 3, number: 3, style: 0x4269, name: "Swiss 721|Italic", fileName: "BX000003.SPD" },
    ]);
    const ctx = fakeContext({ "HG3.FGF": shared });
    const r = createFontResolver(ctx);
    r.resolve(SWISS);
    expect(r.resolve({ ...SWISS, style: 0x4269 }).italic).toBe(true);
    expect(ctx.asked).toEqual(["HG3.FGF:font index", "bx000003.spd:font"]);
    expect(r.warnings()).toHaveLength(2);
  });

  it("falls back to the built-in table without HG3.FGF", () => {
    const ctx = fakeContext({ "BX000003.SPD": spd });
    const r = createFontResolver(ctx);
    const f = r.resolve(SWISS);
    expect(f.family).toBe("Swiss 721");
    expect(f.file?.bytes).toBe(spd);
    expect(f.charMap).toBeUndefined();
    expect(r.indexSource).toBe("built-in");
    expect(r.resolve(DUTCH_BOLD).family).toBe("Dutch 801");
    expect(r.warnings()).toEqual([
      "HG3.FGF not found; using built-in font table",
      expect.stringMatching(/^font file BX000013.SPD \(Dutch 801 Bold\) not found/),
    ]);
  });

  it("falls back to the built-in table when HG3.FGF is unreadable", () => {
    const r = createFontResolver(fakeContext({ "HG3.FGF": new Uint8Array(8) }));
    expect(r.resolve(SWISS).family).toBe("Swiss 721");
    expect(r.indexSource).toBe("built-in");
    expect(r.warnings()[0]).toMatch(/^HG3.FGF could not be read/);
  });

  it("collects unique warnings for unknown keys", () => {
    const ctx = fakeContext({ "HG3.FGF": fgf });
    const r = createFontResolver(ctx);
    const key = { source: 3, number: 99, style: 0x42a9 };
    const f = r.resolve(key);
    r.resolve({ ...key });
    expect(f).toMatchObject({ family: "", fileName: "", file: null, weight: 700, italic: true, kind: "speedo", cssFamily: DEFAULT_CSS_FAMILY });
    expect(r.warnings()).toEqual(["font 3:99:0x42a9 is not in the font index; using a substitute"]);
    expect(ctx.asked).toEqual(["HG3.FGF:font index"]);
  });

  it("works without a context", () => {
    const r = createFontResolver();
    const f = r.resolve(DUTCH_BOLD);
    expect(f.file).toBeNull();
    expect(f.family).toBe("Dutch 801");
    expect(r.warnings()).toEqual([]);
  });

  it("takes a replacement look-alike table", () => {
    const r = createFontResolver(undefined, { lookAlikes: [{ match: "swiss", css: "Clone Sans" }] });
    expect(r.resolve(SWISS).cssFamily).toBe("Clone Sans");
    expect(r.resolve(DUTCH_BOLD).cssFamily).toBe(DEFAULT_CSS_FAMILY);
  });
});

describe("textSizeToUnits", () => {
  it("is percent of the page's shorter side", () => {
    expect(PAGE_SHORT_SIDE).toBe(24576);
    expect(textSizeToUnits(100)).toBe(24576);
    expect(textSizeToUnits(9)).toBeCloseTo(2211.84);
    expect(textSizeToUnits(5, 1000)).toBe(50);
    expect(textSizeToUnits(0)).toBe(0);
  });
});
