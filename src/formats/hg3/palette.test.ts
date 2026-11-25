import { describe, expect, it } from "vitest";
import { DocumentType, NotHg3Error } from "./container";
import { DEFAULT_PALETTE_ENTRIES } from "./defaultPalette";
import {
  CUSTOM_PALETTE_ROLE,
  DEFAULT_PALETTE,
  NotPaletteError,
  PaletteTag,
  ROLE,
  ROLE_NAMES,
  colorForRole,
  parsePalette,
  resolveChartPalette,
  rgbToCss,
  roleName,
  seriesRole,
  splitEntryName,
  uniqueWarningSink,
} from "./palette";
import { type RecordSpec, block, buildDocument, concat, cstr, leaf, padded, u16 } from "./testing/bytes";
import type { ParseContext, ResolvedFile } from "../types";

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

const nameRec = (index: number, name: string): RecordSpec => leaf(PaletteTag.Name, concat(u16(index), padded(name, 16)));
const colorRec = (index: number, role: number, r: number, g: number, b: number): RecordSpec =>
  leaf(PaletteTag.Color, concat(u16(index), [role, r, g, b]));

interface EntrySpec {
  index: number;
  role?: number;
  name: string;
  rgb: [number, number, number];
}

/** Name used for entry i in synthetic palettes. */
const synthName = (i: number): string => (i < 42 ? `C${i}|${ROLE_NAMES[i]}` : `Extra ${i}`);
/** Distinct RGB for entry i. */
const synthRgb = (i: number): [number, number, number] => [i, 255 - i, (i * 4) & 0xff];

const fullEntries = (n = 64): EntrySpec[] =>
  Array.from({ length: n }, (_, i) => ({ index: i, name: synthName(i), rgb: synthRgb(i) }));

function paletteFile(
  entries: EntrySpec[],
  opts: { count?: number | null; extra?: RecordSpec[]; type?: number; description?: string } = {},
): Uint8Array {
  const body: RecordSpec[] = [];
  const count = opts.count === undefined ? entries.length : opts.count;
  if (count !== null) body.push(leaf(PaletteTag.Count, u16(count)));
  for (const e of entries) {
    body.push(nameRec(e.index, e.name), colorRec(e.index, e.role ?? e.index + 1, ...e.rgb));
  }
  body.push(...(opts.extra ?? []));
  return buildDocument("HGA2", opts.type ?? DocumentType.Palette, [
    block(500, [leaf(400, cstr(opts.description ?? ""))]),
    block(524, body),
  ]);
}

const RAW_1554 = Uint8Array.from({ length: 14 }, (_, i) => i + 1);
const RAW_1555 = Uint8Array.from({ length: 64 }, (_, i) => i);

// ---------------------------------------------------------------------------
// parsePalette
// ---------------------------------------------------------------------------

describe("parsePalette", () => {
  it("round-trips a full 64-entry palette with 1554 and 1555 kept raw", () => {
    const bytes = paletteFile(fullEntries(), {
      description: "Bkg Black",
      extra: [leaf(PaletteTag.Options, RAW_1554), leaf(PaletteTag.SixteenColor, RAW_1555)],
    });
    const { palette, warnings } = parsePalette(bytes);
    expect(warnings).toEqual([]);
    expect(palette.documentType).toBe(DocumentType.Palette);
    expect(palette.description).toBe("Bkg Black");
    expect(palette.count).toBe(64);
    expect(palette.entries).toHaveLength(64);
    palette.entries.forEach((e, i) => {
      expect(e.index).toBe(i);
      expect(e.role).toBe(i + 1);
      expect(e.name).toBe(synthName(i));
      expect(e.rgb).toEqual(synthRgb(i));
    });
    expect(palette.entries[0]).toMatchObject({ description: "C0", roleName: "Title" });
    expect(palette.entries[63]).toMatchObject({ description: "Extra 63", roleName: "" });
    expect(palette.raw1554).toEqual(RAW_1554);
    expect(palette.raw1555).toEqual(RAW_1555);
    expect(palette.unknownRecords).toEqual([]);
  });

  it("accepts .PC3 (type 0x34), ignores junk after the name's NUL, keeps unknown records", () => {
    const junkName = leaf(PaletteTag.Name, concat(u16(0), cstr("Yel  L|Title"), [0x51, 0xa4, 0xc2]));
    const bytes = buildDocument("HGA2", DocumentType.CustomPalette, [
      block(500, [leaf(400, cstr("")), leaf(402, [9])]),
      block(524, [
        leaf(PaletteTag.Count, u16(2)),
        junkName,
        colorRec(0, 1, 1, 2, 3),
        nameRec(1, "Gray L"),
        colorRec(1, CUSTOM_PALETTE_ROLE, 4, 5, 6), // .PC3 role byte: no warning
        leaf(1599, [7, 7]),
      ]),
    ]);
    const { palette, warnings } = parsePalette(bytes);
    expect(warnings).toEqual([]);
    expect(palette.documentType).toBe(0x34);
    expect(palette.entries[1]).toMatchObject({ role: 0xff, description: "Gray L", roleName: "" });
    expect(colorForRole(palette, 2)).toEqual([4, 5, 6]);
    expect(palette.entries[0]).toMatchObject({ name: "Yel  L|Title", description: "Yel  L", roleName: "Title" });
    expect(palette.unknownRecords.map((r) => r.tag)).toEqual([402, 1599]);
    expect(palette.raw1554).toBeUndefined();
  });

  it("throws for a chart and for a non-HG3 file", () => {
    expect(() => parsePalette(buildDocument("HGB3", DocumentType.Title, []))).toThrow(NotPaletteError);
    expect(() => parsePalette(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]))).toThrow(NotHg3Error);
  });

  it("warns about inconsistent role, duplicates, count mismatch and half entries", () => {
    const bytes = buildDocument("HGA2", DocumentType.Palette, [
      block(524, [
        leaf(PaletteTag.Count, u16(64)),
        nameRec(0, "A|Title"),
        colorRec(0, 9, 1, 1, 1), // role should be 1
        colorRec(0, 1, 2, 2, 2), // duplicate colour
        nameRec(0, "B|Title"), // duplicate name
        nameRec(1, "No colour"),
        colorRec(2, 3, 3, 3, 3), // no name
        leaf(PaletteTag.Color, [5, 0]), // too short
      ]),
    ]);
    const { palette, warnings } = parsePalette(bytes);
    expect(palette.entries.map((e) => e.index)).toEqual([0, 2]);
    expect(palette.entries[0]).toMatchObject({ role: 9, name: "A|Title", rgb: [1, 1, 1] });
    expect(palette.entries[1].name).toBe("");
    const text = warnings.join("\n");
    expect(text).toMatch(/entry 0 has role 9, expected 1/);
    expect(text).toMatch(/duplicate colour for entry 0/);
    expect(text).toMatch(/duplicate name for entry 0/);
    expect(text).toMatch(/entry 1 has a name but no colour/);
    expect(text).toMatch(/entry 2 has a colour but no name/);
    expect(text).toMatch(/record 1552 .* is 2 byte\(s\), expected 6/);
    expect(text).toMatch(/colour count is 64 but 2 entries found/);
  });

  it("warns about a missing count, missing body, wrong document type and an empty palette", () => {
    const noBody = buildDocument("HGA2", 0x2e, [nameRec(0, "x"), colorRec(0, 1, 0, 0, 0)]);
    const r1 = parsePalette(noBody);
    expect(r1.palette.entries).toHaveLength(1);
    expect(r1.palette.count).toBeNull();
    expect(r1.warnings.join("\n")).toMatch(/document type 0x2e/);
    expect(r1.warnings.join("\n")).toMatch(/no palette body/);
    expect(r1.warnings.join("\n")).toMatch(/no colour count/);

    const empty = parsePalette(paletteFile([], { count: 0 }));
    expect(empty.palette.entries).toEqual([]);
    expect(empty.warnings).toContain("palette has no colours");
  });
});

// ---------------------------------------------------------------------------
// Names and roles
// ---------------------------------------------------------------------------

describe("names and roles", () => {
  it("splits 'description|role' names", () => {
    expect(splitEntryName("Yel  L|Title")).toEqual({ description: "Yel  L", roleName: "Title" });
    expect(splitEntryName("White |Text")).toEqual({ description: "White", roleName: "Text" });
    expect(splitEntryName("Gray L   ")).toEqual({ description: "Gray L", roleName: "" });
    expect(splitEntryName("")).toEqual({ description: "", roleName: "" });
  });

  it("has the SPEC §6.2 role numbers", () => {
    expect(ROLE.Title).toBe(1);
    expect(ROLE.FrameBkg).toBe(15);
    expect(ROLE.Series1).toBe(21);
    expect(ROLE.Series6).toBe(26);
    expect(ROLE.Outlines).toBe(32);
    expect(ROLE.Range1).toBe(33);
    expect(ROLE.Range10).toBe(42);
    expect(ROLE_NAMES).toHaveLength(42);
    expect(roleName(1)).toBe("Title");
    expect(roleName(42)).toBe("Range10");
    expect(roleName(0)).toBeUndefined();
    expect(roleName(43)).toBeUndefined();
  });

  it("wraps series roles every six", () => {
    expect([1, 2, 6, 7, 8, 12, 13].map(seriesRole)).toEqual([21, 22, 26, 21, 22, 26, 21]);
  });
});

// ---------------------------------------------------------------------------
// colorForRole
// ---------------------------------------------------------------------------

describe("colorForRole", () => {
  const { palette } = parsePalette(paletteFile(fullEntries()));

  it("maps role 0 to none and role r to entry r - 1", () => {
    const warns: string[] = [];
    const warn = (m: string) => warns.push(m);
    expect(colorForRole(palette, 0, warn)).toBeNull();
    expect(colorForRole(palette, 1, warn)).toEqual(synthRgb(0));
    expect(colorForRole(palette, ROLE.Series3, warn)).toEqual(synthRgb(22));
    expect(colorForRole(palette, 64, warn)).toEqual(synthRgb(63));
    expect(warns).toEqual([]);
  });

  it("falls back to the default palette for missing entries, with deduplicated warnings", () => {
    const { palette: small } = parsePalette(paletteFile(fullEntries(10)));
    const warnings: string[] = [];
    const warn = uniqueWarningSink(warnings);
    expect(colorForRole(small, 10, warn)).toEqual(synthRgb(9));
    expect(colorForRole(small, 20, warn)).toEqual(DEFAULT_PALETTE_ENTRIES[19].rgb);
    expect(colorForRole(small, 20, warn)).toEqual(DEFAULT_PALETTE_ENTRIES[19].rgb);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/role 20 .*default palette/);
  });

  it("uses the default Text colour for roles outside every palette", () => {
    const warnings: string[] = [];
    expect(colorForRole(palette, 65, (m) => warnings.push(m))).toEqual(DEFAULT_PALETTE_ENTRIES[ROLE.Text - 1].rgb);
    expect(colorForRole(palette, -1)).toEqual(DEFAULT_PALETTE_ENTRIES[ROLE.Text - 1].rgb);
    expect(warnings[0]).toMatch(/role 65 is out of range/);
  });

  it("formats CSS colours", () => {
    expect(rgbToCss([255, 128, 0])).toBe("#ff8000");
    expect(rgbToCss([0, 0, 0])).toBe("#000000");
    expect(rgbToCss([300, -5, 15.6])).toBe("#ff0010");
  });
});

// ---------------------------------------------------------------------------
// resolveChartPalette
// ---------------------------------------------------------------------------

function fakeContext(files: Record<string, Uint8Array>): ParseContext & { asked: string[] } {
  const asked: string[] = [];
  return {
    path: "charts/A.CH3",
    asked,
    resolve(name: string, purpose?: string): ResolvedFile | null {
      asked.push(`${name}:${purpose}`);
      const key = Object.keys(files).find((k) => k.toUpperCase() === name.toUpperCase());
      return key ? { path: `PALETTE/${key}`, name: key, bytes: files[key] } : null;
    },
  };
}

describe("resolveChartPalette", () => {
  const named = paletteFile(fullEntries().map((e) => ({ ...e, rgb: [1, 2, 3] as [number, number, number] })));
  const hg3 = paletteFile(fullEntries());

  it("uses the named palette file", () => {
    const ctx = fakeContext({ "MONOCHRW.PL3": named, "HG3.PL3": hg3 });
    const r = resolveChartPalette("monochrw.pl3", ctx);
    expect(r.source).toBe("file");
    expect(r.path).toBe("PALETTE/MONOCHRW.PL3");
    expect(r.warnings).toEqual([]);
    expect(colorForRole(r.palette, 1)).toEqual([1, 2, 3]);
    expect(ctx.asked).toEqual(["monochrw.pl3:palette"]);
  });

  it("falls back to HG3.PL3 when the named file is missing, with a warning", () => {
    const r = resolveChartPalette("GONE.PL3", fakeContext({ "HG3.PL3": hg3 }));
    expect(r.source).toBe("HG3.PL3");
    expect(r.path).toBe("PALETTE/HG3.PL3");
    expect(r.warnings.join("\n")).toMatch(/GONE\.PL3 not found/);
  });

  it("uses HG3.PL3 without warnings when the chart names no palette", () => {
    const r = resolveChartPalette(null, fakeContext({ "HG3.PL3": hg3 }));
    expect(r.source).toBe("HG3.PL3");
    expect(r.warnings).toEqual([]);
  });

  it("falls back to the built-in copy when nothing is available", () => {
    const none = resolveChartPalette(null, fakeContext({}));
    expect(none.source).toBe("built-in");
    expect(none.palette).toBe(DEFAULT_PALETTE);
    expect(none.warnings).toEqual([]);

    const noCtx = resolveChartPalette("X.PL3");
    expect(noCtx.source).toBe("built-in");
    expect(noCtx.warnings.join("\n")).toMatch(/X\.PL3 not found/);

    const named = resolveChartPalette("GONE.PL3", fakeContext({}));
    expect(named.source).toBe("built-in");
    expect(named.warnings.join("\n")).toMatch(/built-in copy of HG3\.PL3 instead of GONE\.PL3/);
  });

  it("treats empty or unreadable palettes as missing", () => {
    const empty = paletteFile([], { count: 0 });
    const r = resolveChartPalette("EMPTY.PL3", fakeContext({ "EMPTY.PL3": empty, "HG3.PL3": hg3 }));
    expect(r.source).toBe("HG3.PL3");
    expect(r.warnings.join("\n")).toMatch(/EMPTY\.PL3 is empty/);

    const bad = resolveChartPalette("BAD.PL3", fakeContext({ "BAD.PL3": new Uint8Array(3), "HG3.PL3": empty }));
    expect(bad.source).toBe("built-in");
    expect(bad.warnings.join("\n")).toMatch(/BAD\.PL3 could not be read/);
    expect(bad.warnings.join("\n")).toMatch(/HG3\.PL3 is empty/);
  });

  it("does not look up HG3.PL3 twice when the chart names it", () => {
    const ctx = fakeContext({});
    const r = resolveChartPalette("HG3.PL3", ctx);
    expect(r.source).toBe("built-in");
    expect(ctx.asked).toEqual(["HG3.PL3:palette"]);
  });
});

// ---------------------------------------------------------------------------
// Built-in default
// ---------------------------------------------------------------------------

describe("defaultPalette", () => {
  it("has 64 entries with role = index + 1 and role names on entries 0 to 41", () => {
    expect(DEFAULT_PALETTE_ENTRIES).toHaveLength(64);
    DEFAULT_PALETTE_ENTRIES.forEach((e, i) => {
      expect(e.index).toBe(i);
      expect(e.role).toBe(i + 1);
      expect(e.rgb).toHaveLength(3);
      for (const v of e.rgb) expect(v >= 0 && v <= 255 && Number.isInteger(v)).toBe(true);
    });
    DEFAULT_PALETTE.entries.slice(0, 42).forEach((e, i) => expect(e.roleName).toBe(ROLE_NAMES[i]));
    expect(DEFAULT_PALETTE.entries).toHaveLength(64);
  });
});
