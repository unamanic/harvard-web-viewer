import { afterEach, describe, expect, it, vi } from "vitest";
import { LANDSCAPE_VIEW_BOX, type Scene, type SceneElement } from "../formats/types";
import {
  MONO_FILL_LEVELS,
  EGA_COLORS,
  applyDisplayMode,
  monoFillLevel,
  monoLevelsForFills,
  monoPatternRows,
  formatCssColor,
  isDisplayMode,
  loadDisplayMode,
  parseCssColor,
  toScreenColor,
  vgaChannel,
  type RGB,
} from "./displayMode";

function rect(fill: string | null, stroke: string | null = null): SceneElement {
  return { kind: "rect", x: 0, y: 0, width: 10, height: 10, fill, stroke };
}

function scene(elements: SceneElement[], background = "#000000"): Scene {
  return { viewBox: LANDSCAPE_VIEW_BOX, background, elements };
}

/** Every colour string in the scene, background first. */
function colors(s: Scene): string[] {
  const out = [s.background];
  const walk = (els: SceneElement[]) => {
    for (const el of els) {
      if (el.kind === "group") walk(el.children);
      else if (el.kind === "text") out.push(el.fill);
      else if (el.kind !== "image") {
        if (el.fill) out.push(el.fill);
        if (el.stroke) out.push(el.stroke);
      }
    }
  };
  walk(s.elements);
  return out;
}

describe("parseCssColor", () => {
  it("reads #rrggbb, #rgb and rgb()", () => {
    expect(parseCssColor("#FFa500")).toEqual([255, 165, 0]);
    expect(parseCssColor("#f80")).toEqual([255, 136, 0]);
    expect(parseCssColor("rgb(1, 2,3)")).toEqual([1, 2, 3]);
    expect(parseCssColor(" rgb( 300 , 0 , 12.6 ) ")).toEqual([255, 0, 13]);
  });

  it("returns null for other forms", () => {
    expect(parseCssColor("red")).toBeNull();
    expect(parseCssColor("#12345")).toBeNull();
    expect(parseCssColor("hsl(0, 100%, 50%)")).toBeNull();
    expect(parseCssColor("rgba(1, 2, 3, 0.5)")).toBeNull();
  });

  it("formats as lower-case #rrggbb", () => {
    expect(formatCssColor([255, 10, 0])).toBe("#ff0a00");
  });
});

describe("toScreenColor", () => {
  it("VGA rounds each channel to 6 bits", () => {
    // 128 -> round(128*63/255) = 32 -> round(32*255/63) = 130
    expect(vgaChannel(128)).toBe(130);
    // 100 -> 25 -> 101
    expect(vgaChannel(100)).toBe(101);
    expect(vgaChannel(0)).toBe(0);
    expect(vgaChannel(255)).toBe(255);
    // 2 -> round(0.49) = 0 -> 0; 3 -> round(0.74) = 1 -> 4
    expect(vgaChannel(2)).toBe(0);
    expect(vgaChannel(3)).toBe(4);
    expect(toScreenColor([128, 100, 255], "vga")).toEqual([130, 101, 255]);
  });

  it("EGA picks the nearest of the 64 colours", () => {
    expect(EGA_COLORS).toHaveLength(64);
    // Orange: R and B are exact levels; G 165 is 5 from 0xAA, 80 from 0x55.
    expect(toScreenColor([255, 165, 0], "ega")).toEqual([0xff, 0xaa, 0x00]);
    // Mid grey 128 is 42 from 0xAA and 43 from 0x55.
    expect(toScreenColor([128, 128, 128], "ega")).toEqual([0xaa, 0xaa, 0xaa]);
    // Navy: 0x80 blue is nearer 0xAA than 0x55.
    expect(toScreenColor([0, 0, 0x80], "ega")).toEqual([0, 0, 0xaa]);
    // Exact EGA colours map to themselves.
    expect(toScreenColor([0xaa, 0x55, 0x00], "ega")).toEqual([0xaa, 0x55, 0x00]);
  });

  it("mono thresholds Rec. 601 luma at 50% (background rule)", () => {
    const white: RGB = [255, 255, 255];
    const black: RGB = [0, 0, 0];
    expect(toScreenColor([255, 255, 0], "mono")).toEqual(white); // luma 226
    expect(toScreenColor([0, 255, 0], "mono")).toEqual(white); // 150
    expect(toScreenColor([255, 0, 0], "mono")).toEqual(black); // 76
    expect(toScreenColor([0, 0, 255], "mono")).toEqual(black); // 29
    expect(toScreenColor([128, 128, 128], "mono")).toEqual(white); // 128
    expect(toScreenColor([127, 127, 127], "mono")).toEqual(black); // 127
  });

  it("modern keeps the stored RGB", () => {
    expect(toScreenColor([1, 2, 3], "modern")).toEqual([1, 2, 3]);
  });
});

describe("applyDisplayMode", () => {
  it("modern is the identity", () => {
    const s = scene([rect("#123456")]);
    expect(applyDisplayMode(s, "modern")).toBe(s);
  });

  it("maps background, fills and strokes, recursing into groups (VGA)", () => {
    const s = scene(
      [
        rect("#808080", "#ff0000"),
        {
          kind: "group",
          buttonName: "b",
          children: [
            rect(null, "#ffff00"),
            {
              kind: "text", x: 0, y: 0, text: "Hi", size: 10, fill: "rgb(100,0,0)",
              fontFamily: "sans-serif", fontWeight: 400, italic: false, anchor: "start",
            },
            { kind: "image", href: "data:,", x: 0, y: 0, width: 1, height: 1 },
            { kind: "glyphs", d: "M0 0", text: "B", advance: 1, em: 1000, fill: null, stroke: "#808080" },
          ],
        },
      ],
      "#00f",
    );
    const out = applyDisplayMode(s, "vga");
    expect(colors(out)).toEqual(["#0000ff", "#828282", "#ff0000", "#ffff00", "#650000", "#828282"]);
    const g = out.elements[1];
    if (g.kind !== "group") throw new Error("group expected");
    expect(g.buttonName).toBe("b");
    expect(g.children[2]).toBe((s.elements[1] as { children: SceneElement[] }).children[2]);
    expect(out.patterns).toBeUndefined();
    // Input is untouched.
    expect(s.background).toBe("#00f");
    expect(s.elements[0]).toMatchObject({ fill: "#808080" });
  });

  it("leaves colours it cannot parse unchanged", () => {
    const out = applyDisplayMode(scene([rect("red", "hsl(0,0%,0%)")], "navy"), "vga");
    expect(colors(out)).toEqual(["navy", "red", "hsl(0,0%,0%)"]);
  });

  it("EGA keeps all colours when 16 or fewer are used", () => {
    const sixteen = EGA_COLORS.slice(0, 16).map((c) => rect(formatCssColor(c)));
    const out = applyDisplayMode(scene(sixteen.slice(1)), "ega"); // background is #000000 = colour 0
    expect(new Set(colors(out)).size).toBe(16);
  });

  it("EGA keeps the 16 most used colours of 20 and maps the rest to the nearest kept", () => {
    // Colours 0..15 (red 0) are used twice each; 16..19 (red 0x55, green 0) once.
    const common = EGA_COLORS.slice(0, 16).map(formatCssColor);
    const rare = EGA_COLORS.slice(16, 20);
    expect(rare.every((c) => c[0] === 0x55 && c[1] === 0)).toBe(true);
    const els = [
      ...common.map((c) => rect(c, c)),
      ...rare.map((c) => rect(formatCssColor(c))),
    ];
    const out = applyDisplayMode(scene(els, common[0]), "ega");
    const used = new Set(colors(out));
    expect(used.size).toBe(16);
    expect([...used].sort()).toEqual([...common].sort());
    // (0x55, 0, b) is nearest to (0, 0, b) among the kept colours.
    const rareOut = out.elements.slice(16).map((e) => (e as { fill: string }).fill);
    expect(rareOut).toEqual(rare.map((c) => formatCssColor([0, 0, c[2]])));
  });

  it("EGA counts colours after mapping to the 64", () => {
    // Two near-identical colours both become #ffaa00: one EGA colour.
    const out = applyDisplayMode(scene([rect("#ffa500"), rect("#ffb000")]), "ega");
    expect(colors(out)).toEqual(["#000000", "#ffaa00", "#ffaa00"]);
  });
});

describe("mono", () => {
  const text = (fill: string): SceneElement => ({
    kind: "text", x: 0, y: 0, text: "Hi", size: 10, fill,
    fontFamily: "sans-serif", fontWeight: 400, italic: false, anchor: "start",
  });
  const glyphs = (fill: string | null, stroke: string | null): SceneElement => ({
    kind: "glyphs", d: "M0 0", text: "A", advance: 1, em: 1000, fill, stroke,
  });
  const fillOf = (el: SceneElement) => (el as { fill: string | null }).fill;

  it("chooses the background by luma", () => {
    expect(applyDisplayMode(scene([], "#00f"), "mono").background).toBe("#000000");
    expect(applyDisplayMode(scene([], "#c0c0c0"), "mono").background).toBe("#ffffff");
  });

  it("draws text, glyphs and outlines in the foreground whatever their colour", () => {
    // Dark blue on black would vanish under a plain threshold.
    const els = [text("#0000aa"), glyphs("#000080", null), glyphs(null, "#ffffff"), rect(null, "#000040")];
    const onBlack = applyDisplayMode(scene(els, "#000000"), "mono").elements;
    expect(onBlack[0]).toMatchObject({ fill: "#ffffff", halo: { color: "#000000" } });
    expect(onBlack[1]).toMatchObject({ fill: "#ffffff", stroke: null, halo: { color: "#000000" } });
    expect(onBlack[2]).toMatchObject({ fill: null, stroke: "#ffffff" });
    expect(onBlack[3]).toMatchObject({ fill: null, stroke: "#ffffff" });
    const onWhite = applyDisplayMode(scene(els, "#ffffff"), "mono").elements;
    expect(onWhite[0]).toMatchObject({ fill: "#000000", halo: { color: "#ffffff" } });
    expect(onWhite[2]).toMatchObject({ fill: null, stroke: "#000000" });
    expect(onWhite[3]).toMatchObject({ stroke: "#000000" });
  });

  it("scales the text halo into the element's own units", () => {
    const s = scene([
      { kind: "group", transform: [2, 0, 0, 2, 0, 0], children: [text("#fff")] },
      { ...(glyphs("#fff", null) as object), transform: [0.5, 0, 0, 0.5, 0, 0] } as SceneElement,
    ]);
    const out = applyDisplayMode(s, "mono").elements;
    const inGroup = (out[0] as { children: { halo: { width: number } }[] }).children[0].halo.width;
    const line = (out[1] as { halo: { width: number } }).halo.width;
    expect(line / inGroup).toBeCloseTo(4);
  });

  it("selects dither levels by luma", () => {
    expect(monoFillLevel([0, 0, 0])).toBe(0);
    expect(monoFillLevel([255, 255, 255])).toBe(MONO_FILL_LEVELS);
    expect(monoFillLevel([128, 128, 128])).toBe(4); // 50%
    expect(monoFillLevel([255, 0, 0])).toBe(2); // luma 76
    expect(monoFillLevel([255, 255, 0])).toBe(7); // luma 226
  });

  it("builds ordered-dither tiles with level × 2 of 16 pixels lit", () => {
    for (let l = 0; l <= MONO_FILL_LEVELS; l++) {
      const rows = monoPatternRows(l);
      expect(rows).toHaveLength(4);
      expect(rows.join("").split("1").length - 1).toBe(l * 2);
    }
    expect(monoPatternRows(4)).toEqual(["1010", "0101", "1010", "0101"]);
  });

  it("maps fills to patterns, solid black and solid white", () => {
    const out = applyDisplayMode(scene([rect("#808080"), rect("#ffffff"), rect("#ff0000")]), "mono");
    expect(out.elements.map(fillOf)).toEqual(["pattern:mono-4", "#ffffff", "pattern:mono-2"]);
    expect(Object.keys(out.patterns ?? {}).sort()).toEqual(["mono-2", "mono-4"]);
    const p = out.patterns!["mono-4"];
    expect(p).toMatchObject({ rows: monoPatternRows(4), ink: "#ffffff", paper: "#000000" });
    // One pattern pixel = one 640 × 350 screen pixel: 1/350 of the page height, 35/48 as wide.
    expect(p.pixelHeight).toBeCloseTo(24576 / 350);
    expect(p.pixelWidth).toBeCloseTo((24576 / 350) * (35 / 48));
  });

  it("gives distinct colours distinct patterns even when their luma levels collide", () => {
    // Teal (luma 90) and azure (luma 104) both round to level 3.
    expect(monoFillLevel([0, 128, 128])).toBe(monoFillLevel([0, 128, 255]));
    const out = applyDisplayMode(scene([rect("#008080"), rect("#0080ff"), rect("#004080")]), "mono");
    const fills = out.elements.map(fillOf);
    expect(new Set(fills).size).toBe(3);
    // Lightness order is kept: the darkest colour gets the sparsest dither.
    const level = (f: string | null) => Number(/mono-(\d)/.exec(f ?? "")?.[1] ?? 0);
    expect(level(fills[2])).toBeLessThan(level(fills[0]));
    expect(level(fills[0])).toBeLessThan(level(fills[1]));
  });

  it("keeps near-identical colours identical", () => {
    const levels = monoLevelsForFills([[0, 128, 128], [3, 130, 126], [255, 0, 0]], [0, 0, 0]);
    expect(levels.get("#008080")).toBe(levels.get("#03827e"));
    expect(levels.get("#ff0000")).not.toBe(levels.get("#008080"));
  });

  it("falls back to plain luma levels when there are more colours than levels", () => {
    const greys: RGB[] = [...Array(20).keys()].map((i) => [i * 13, i * 13, i * 13]);
    const levels = monoLevelsForFills(greys, [0, 0, 0]);
    for (const g of greys) expect(levels.get(formatCssColor(g))).toBe(monoFillLevel(g));
  });

  it("outlines fills at the background level that have no outline", () => {
    const out = applyDisplayMode(scene([rect("#000000"), rect("#000000", "#0000ff"), rect("#ffffff")]), "mono");
    expect(out.elements[0]).toMatchObject({ fill: "#000000", stroke: "#ffffff" });
    expect(out.elements[1]).toMatchObject({ fill: "#000000", stroke: "#ffffff" });
    expect(out.elements[2]).toMatchObject({ fill: "#ffffff", stroke: null });
    const onWhite = applyDisplayMode(scene([rect("#fefefe"), rect("#000000")], "#ffffff"), "mono");
    expect(onWhite.elements[0]).toMatchObject({ fill: "#ffffff", stroke: "#000000" });
    expect(onWhite.elements[1]).toMatchObject({ fill: "#000000", stroke: null });
  });

  it("uses scaled pattern copies inside scaled groups and leaves images alone", () => {
    const img: SceneElement = { kind: "image", href: "data:,", x: 0, y: 0, width: 1, height: 1 };
    const s = scene([rect("#808080"), { kind: "group", transform: [0.5, 0, 0, 0.25, 0, 0], children: [rect("#808080"), img] }]);
    const out = applyDisplayMode(s, "mono");
    const g = out.elements[1] as { children: SceneElement[] };
    expect(fillOf(g.children[0])).toBe("pattern:mono-4@0.5x0.25");
    expect(g.children[1]).toBe(img);
    const base = out.patterns!["mono-4"];
    const scaled = out.patterns!["mono-4@0.5x0.25"];
    expect(scaled.pixelWidth).toBeCloseTo(base.pixelWidth * 2);
    expect(scaled.pixelHeight).toBeCloseTo(base.pixelHeight * 4);
  });

  it("does not touch the input", () => {
    const s = scene([rect("#808080"), text("#0000ff")], "#00f");
    const copy = structuredClone(s);
    applyDisplayMode(s, "mono");
    expect(s).toEqual(copy);
  });
});

describe("loadDisplayMode", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  const stored = (value: string | null) =>
    vi.stubGlobal("localStorage", { getItem: () => value, setItem: () => {} });

  it("maps the stored legacy value \"cga\" to \"mono\"", () => {
    stored("cga");
    expect(loadDisplayMode()).toBe("mono");
  });

  it("returns a stored mode, or the default for unknown values", () => {
    stored("ega");
    expect(loadDisplayMode()).toBe("ega");
    stored("hercules");
    expect(loadDisplayMode()).toBe("vga");
  });
});

describe("isDisplayMode", () => {
  it("accepts only known modes", () => {
    expect(isDisplayMode("ega")).toBe(true);
    expect(isDisplayMode("mono")).toBe(true);
    expect(isDisplayMode("cga")).toBe(false);
    expect(isDisplayMode("hercules")).toBe(false);
    expect(isDisplayMode(null)).toBe(false);
  });
});
