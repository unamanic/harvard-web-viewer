/**
 * The viewer's palette option (task 6c): ParseContext.paletteOverride draws
 * every chart, and every show slide, with another palette role for role.
 */
import { describe, expect, it } from "vitest";
import { FileSet } from "../../files/FileSet";
import { openEntry } from "../../loadFile";
import type { ParseContext, ResolvedFile } from "../types";
import { parseChart } from "./chart";
import { DocumentType, readContainer } from "./container";
import { GREYSCALE_PALETTES } from "./greyscalePalettes";
import { hg3Parser } from "./index";
import {
  GREYSCALE_PALETTE_NAMES,
  PaletteTag,
  ROLE,
  builtInPalette,
  colorForRole,
  resolvePaletteOverride,
  rgbToCss,
} from "./palette";
import { createChartSceneContext } from "./scene/context";
import { type RecordSpec, block, buildDocument, concat, cstr, leaf, padded, u16 } from "./testing/bytes";

type Rgb = [number, number, number];

/** A 64-entry .PL3 whose entry i has the colour rgbOf(i); role = index + 1. */
function paletteFile(rgbOf: (i: number) => Rgb): Uint8Array {
  const body: RecordSpec[] = [leaf(PaletteTag.Count, u16(64))];
  for (let i = 0; i < 64; i++) {
    body.push(leaf(PaletteTag.Name, concat(u16(i), padded(`C${i}`, 16))));
    body.push(leaf(PaletteTag.Color, concat(u16(i), [i + 1, ...rgbOf(i)])));
  }
  return buildDocument("HGA2", DocumentType.Palette, [block(500, [leaf(400, cstr(""))]), block(524, body)]);
}

/** The chart's own palette and the override: every role differs. */
const OWN = paletteFile((i) => [i, 0, 0]);
const OVERRIDE = paletteFile((i) => [0, i, 200]);

/** A drawing that names `palette` (404 kind 2), or none. */
function chartBytes(palette?: string): Uint8Array {
  const header = [leaf(400, cstr("c")), ...(palette ? [leaf(404, concat(u16(2), u16(0), cstr(palette)))] : [])];
  return buildDocument("HGB3", DocumentType.Drawing, [block(500, header), block(504, [block(508, [])])]);
}

function slideEntry(number: number, kind: number): RecordSpec {
  const fixed = new Uint8Array(102);
  const dv = new DataView(fixed.buffer);
  dv.setUint16(0, number, true);
  fixed[2] = kind;
  dv.setInt16(14, -1, true);
  return leaf(702, concat(fixed, cstr("")));
}

/** A show with charts A.CH3 and B.CH3 as slides 1 and 2. */
function showBytes(): Uint8Array {
  return buildDocument("HGB1", DocumentType.Show, [
    block(500, [leaf(400, cstr("show"))]),
    block(520, [
      leaf(708, [0, 1, 2]),
      leaf(710, new Uint8Array(1941)),
      leaf(712, new Uint8Array(52)),
      leaf(714, [2, 2]),
      slideEntry(0, 0x2e),
      slideEntry(1, DocumentType.Drawing),
      leaf(404, concat(u16(20), u16(1), cstr("A.CH3"))),
      slideEntry(2, DocumentType.Drawing),
      leaf(404, concat(u16(20), u16(2), cstr("B.CH3"))),
    ]),
  ]);
}

function context(files: Record<string, Uint8Array>, path: string, paletteOverride?: string): ParseContext {
  const ctx: ParseContext = {
    path,
    resolve(name): ResolvedFile | null {
      const key = Object.keys(files).find((k) => k.toUpperCase() === name.toUpperCase());
      return key ? { path: key, name: key, bytes: files[key] } : null;
    },
  };
  if (paletteOverride) ctx.paletteOverride = paletteOverride;
  return ctx;
}

const css = (rgb: Rgb) => rgbToCss(rgb);

describe("built-in greyscale palettes", () => {
  it("has both program palettes, 64 entries each, role = index + 1", () => {
    for (const name of GREYSCALE_PALETTE_NAMES) {
      const p = builtInPalette(name.toLowerCase());
      expect(p?.entries).toHaveLength(64);
      p!.entries.forEach((e, i) => {
        expect(e.index).toBe(i);
        expect(e.role).toBe(i + 1);
      });
    }
    expect(builtInPalette("HG3.PL3")).toBeNull();
  });

  it("MONOCHRB has a dark background and MONOCHRW a white one", () => {
    const bkg = (name: string) => colorForRole(builtInPalette(name)!, ROLE.FrameBkg)!;
    expect(Math.max(...bkg("MONOCHRB.PL3"))).toBeLessThan(64);
    expect(bkg("MONOCHRW.PL3")).toEqual([255, 255, 255]);
    // Greyscale: R = G = B everywhere.
    for (const name of GREYSCALE_PALETTE_NAMES) {
      for (const e of GREYSCALE_PALETTES[name].entries) expect(new Set(e.rgb).size).toBe(1);
    }
  });
});

describe("resolvePaletteOverride", () => {
  it("prefers the file from the set", () => {
    const r = resolvePaletteOverride("monochrw.pl3", context({ "MONOCHRW.PL3": OVERRIDE }, "A.CH3"));
    expect(r.palette?.source).toBe("file");
    expect(r.palette?.override).toBe("MONOCHRW.PL3");
    expect(r.warnings).toEqual([]);
    expect(colorForRole(r.palette!.palette, 5)).toEqual([0, 4, 200]);
  });

  it("uses the built-in copy when the file was not opened", () => {
    const r = resolvePaletteOverride("MONOCHRB.PL3", context({}, "A.CH3"));
    expect(r.palette?.source).toBe("built-in");
    expect(r.palette?.palette.entries).toHaveLength(64);
    expect(r.warnings).toEqual(["MONOCHRB.PL3 was not opened; using the viewer's built-in copy"]);
    expect(resolvePaletteOverride("MONOCHRW.PL3").palette?.source).toBe("built-in");
  });

  it("gives null (the chart's own palette) for a palette it cannot find", () => {
    const r = resolvePaletteOverride("GRAYS.PL3", context({}, "A.CH3"));
    expect(r.palette).toBeNull();
    expect(r.warnings).toEqual(["GRAYS.PL3 not found; using the chart's palette"]);
  });
});

describe("palette option on a chart", () => {
  const files = { "A.CH3": chartBytes("OWN.PL3"), "OWN.PL3": OWN, "MONOCHRW.PL3": OVERRIDE };

  it("replaces the chart's palette role for role", () => {
    const chart = parseChart(readContainer(files["A.CH3"])).chart;
    const { context: ctx, warnings } = createChartSceneContext(chart, context(files, "A.CH3", "MONOCHRW.PL3"));
    expect(warnings).toEqual([]);
    for (let role = 1; role <= 64; role++) expect(ctx.color(role)).toBe(css([0, role - 1, 200]));
    expect(ctx.color(0)).toBeNull();

    const own = createChartSceneContext(chart, context(files, "A.CH3")).context;
    for (let role = 1; role <= 64; role++) expect(own.color(role)).toBe(css([role - 1, 0, 0]));
  });

  it("draws the background from the override", () => {
    const doc = hg3Parser.parse(files["A.CH3"], "A.CH3", context(files, "A.CH3", "MONOCHRW.PL3"));
    expect(doc.scenes[0].background).toBe(css([0, ROLE.FrameBkg - 1, 200]));
  });

  it("uses the built-in copy when the file is absent", () => {
    const { "MONOCHRW.PL3": _omitted, ...withoutFile } = files;
    const doc = hg3Parser.parse(files["A.CH3"], "A.CH3", context(withoutFile, "A.CH3", "MONOCHRW.PL3"));
    expect(doc.scenes[0].background).toBe("#ffffff");
    expect(doc.warnings.filter((w) => w.includes("MONOCHRW"))).toHaveLength(1);
  });

  it("falls back to the chart's palette with one warning when the palette cannot be found", () => {
    const doc = hg3Parser.parse(files["A.CH3"], "A.CH3", context(files, "A.CH3", "NOSUCH.PL3"));
    expect(doc.scenes[0].background).toBe(css([ROLE.FrameBkg - 1, 0, 0]));
    expect(doc.warnings.filter((w) => w.includes("NOSUCH.PL3"))).toEqual(["NOSUCH.PL3 not found; using the chart's palette"]);
  });

  it("goes through loadFile's options", () => {
    const set = new FileSet(Object.entries(files).map(([path, bytes]) => ({ path, bytes })));
    const asSaved = openEntry(set, set.get("A.CH3")!);
    const grey = openEntry(set, set.get("A.CH3")!, { paletteOverride: "MONOCHRW.PL3" });
    expect(asSaved.document?.scenes[0].background).toBe(css([ROLE.FrameBkg - 1, 0, 0]));
    expect(grey.document?.scenes[0].background).toBe(css([0, ROLE.FrameBkg - 1, 200]));
  });
});

describe("palette option on a show", () => {
  const files = {
    "S.SH3": showBytes(),
    "A.CH3": chartBytes("OWN.PL3"),
    "B.CH3": chartBytes(),
    "OWN.PL3": OWN,
    "HG3.PL3": OWN,
    "MONOCHRB.PL3": OVERRIDE,
  };
  const open = (override?: string, set: Record<string, Uint8Array> = files) =>
    hg3Parser.parse(set["S.SH3"], "S.SH3", context(set, "S.SH3", override));
  const backgrounds = (doc: ReturnType<typeof open>) =>
    doc.presentation!.slides.slice(1).map((s) => s.scene()?.background);

  it("draws every slide with the override, and again as saved when re-parsed without it", () => {
    expect(backgrounds(open("MONOCHRB.PL3"))).toEqual([css([0, 14, 200]), css([0, 14, 200])]);
    expect(backgrounds(open())).toEqual([css([14, 0, 0]), css([14, 0, 0])]);
  });

  it("uses the built-in copy for every slide when the file is absent, saying so once", () => {
    const { "MONOCHRB.PL3": _omitted, ...withoutFile } = files;
    const doc = open("MONOCHRB.PL3", withoutFile);
    const dark = rgbToCss(colorForRole(builtInPalette("MONOCHRB.PL3")!, ROLE.FrameBkg)!);
    expect(backgrounds(doc)).toEqual([dark, dark]);
    expect(doc.warnings.filter((w) => w.includes("MONOCHRB"))).toHaveLength(1);
    for (const s of doc.presentation!.slides) expect(s.warnings().filter((w) => w.includes("MONOCHRB"))).toEqual([]);
  });

  it("falls back to each chart's palette with a single warning for the whole show", () => {
    const doc = open("NOSUCH.PL3");
    expect(backgrounds(doc)).toEqual([css([14, 0, 0]), css([14, 0, 0])]);
    expect(doc.warnings.filter((w) => w.includes("NOSUCH"))).toEqual(["NOSUCH.PL3 not found; using the chart's palette"]);
    for (const s of doc.presentation!.slides) expect(s.warnings().filter((w) => w.includes("NOSUCH"))).toEqual([]);
  });
});
