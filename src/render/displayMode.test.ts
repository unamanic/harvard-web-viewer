import { afterEach, describe, expect, it, vi } from "vitest";
import { LANDSCAPE_VIEW_BOX, type FillPattern, type Scene, type SceneElement } from "../formats/types";
import {
  DEFAULT_DISPLAY_MODE,
  DISPLAY_MODES,
  EGA_COLORS,
  applyDisplayMode,
  formatCssColor,
  isDisplayMode,
  loadDisplayMode,
  parseCssColor,
  saveDisplayMode,
  toScreenColor,
  vgaChannel,
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
  it("VGA gives the colour its ScreenShow dither averages to", () => {
    // The DAC still rounds to 6 bits: 128 -> 32 -> 130.
    expect(vgaChannel(128)).toBe(130);
    expect(vgaChannel(3)).toBe(4);
    // Solid driver colours come back as the DAC shows them.
    expect(toScreenColor([255, 128, 0], "vga")).toEqual([255, 130, 0]);
    // Cyn D (0,128,128) is cyan + black half and half.
    expect(toScreenColor([0, 128, 128], "vga")).toEqual([0, 128, 128]);
    // Yel L (255,255,128): yellow + white.
    expect(toScreenColor([255, 255, 128], "vga")).toEqual([255, 255, 128]);
    // Gry DD (22,22,22): a quarter dark grey.
    expect(toScreenColor([22, 22, 22], "vga")).toEqual([21, 21, 21]);
  });

  it("EGA gives the colour its EGA dither averages to", () => {
    expect(EGA_COLORS).toHaveLength(64);
    expect(toScreenColor([255, 255, 255], "ega")).toEqual([255, 255, 255]);
    expect(toScreenColor([0, 255, 255], "ega")).toEqual([0, 255, 255]);
    // The orange slot shows as EGA (255,170,0); dark cyan is half cyan, half black.
    expect(toScreenColor([255, 128, 0], "ega")).toEqual([255, 170, 0]);
    expect(toScreenColor([0, 128, 128], "ega")).toEqual([0, 128, 128]);
  });

  it("mono gives the grey its Hercules fill pattern averages to", () => {
    expect(toScreenColor([0, 0, 0], "mono")).toEqual([0, 0, 0]);
    expect(toScreenColor([255, 255, 255], "mono")).toEqual([255, 255, 255]);
    expect(toScreenColor([128, 128, 128], "mono")).toEqual([128, 128, 128]); // level 4 of 8
    expect(toScreenColor([0, 0, 255], "mono")).toEqual([32, 32, 32]); // level 1
    expect(toScreenColor([255, 255, 0], "mono")).toEqual([223, 223, 223]); // level 7
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

  it("VGA dithers fills, outlines and text, recursing into groups", () => {
    const s = scene(
      [
        rect("#808080", "#ff0000"),
        {
          kind: "group",
          buttonName: "b",
          children: [
            rect(null, "#ffff00"),
            {
              kind: "text", x: 0, y: 0, text: "Hi", size: 10, fill: "rgb(0,128,128)",
              fontFamily: "sans-serif", fontWeight: 400, italic: false, anchor: "start",
            },
            { kind: "image", href: "data:,", x: 0, y: 0, width: 1, height: 1 },
            { kind: "glyphs", d: "M0 0", text: "B", advance: 1, em: 1000, fill: null, stroke: "#808080" },
          ],
        },
      ],
      "#000000",
    );
    const out = applyDisplayMode(s, "vga");
    expect(colors(out)).toEqual(["#000000", "pattern:vga-0", "#ff0000", "#ffff00", "pattern:vga-1", "pattern:vga-0"]);
    expect(out.patterns?.["vga-0"]).toMatchObject({ rows: ["0101", "1010", "0101", "1010"], ink: "#555555", paper: "#aaaaaa" });
    expect(out.patterns?.["vga-1"]).toMatchObject({ ink: "#00ffff", paper: "#000000" });
    const g = out.elements[1];
    if (g.kind !== "group") throw new Error("group expected");
    expect(g.buttonName).toBe("b");
    expect(g.children[2]).toBe((s.elements[1] as { children: SceneElement[] }).children[2]);
    // Input is untouched.
    expect(s.background).toBe("#000000");
    expect(s.elements[0]).toMatchObject({ fill: "#808080" });
  });

  it("VGA uses the scene's own screen colours, through the 6-bit DAC", () => {
    const out = applyDisplayMode({ ...scene([rect("#ff00ff")]), screenColors: Array(16).fill("#123456") }, "vga");
    expect(colors(out)).toEqual(["#103555", "#103555"]);
  });

  it("VGA dithers the background like a gradient band (64 levels, 8 x 8)", () => {
    const out = applyDisplayMode(scene([], "#414141"), "vga");
    expect(out.background).toBe("pattern:vga-0");
    const p = out.patterns?.["vga-0"];
    expect(p?.rows).toHaveLength(8);
    // (65,65,65): 49 of 64 cells dark grey (the paper: lower thresholds), 15 black.
    expect(p?.rows.join("").split("").filter((c) => c === "1").length).toBe(15);
    expect(p).toMatchObject({ ink: "#000000", paper: "#555555" });
  });

  it("Modern shows a document's own screen colours in their slots (screenIntent)", () => {
    const own = ["#000000", "#ffffff", "#ff0000", "#ff8000", "#ffff00", "#80ff00", "#00ff00", "#00ff80", "#00ffff", "#0080ff", "#0000ff", "#8000ff", "#000055", "#ff0080", "#555555", "#aaaaaa"];
    const out = applyDisplayMode({ ...scene([rect("#ff00ff", "#ff0000")], "#ff00ff"), screenColors: own }, "modern");
    expect(colors(out)).toEqual(["#000055", "#000055", "#ff0000"]);
    // The standard set changes nothing.
    const std = { ...scene([rect("#ff00ff")]), screenColors: own.map((c, i) => (i === 12 ? "#ff00ff" : c)) };
    expect(applyDisplayMode(std, "modern")).toBe(std);
  });

  it("Modern draws gradients unchanged; mono dithers them in bands on the 8 x 8 matrix", () => {
    const big: SceneElement = { kind: "rect", x: 0, y: 0, width: 10000, height: 10000, fill: "gradient:g", stroke: null };
    const s: Scene = { ...scene([big], "#000000"), gradients: { g: { from: "#000000", to: "#ffffff", angle: 90 } } };
    expect(applyDisplayMode(s, "modern")).toBe(s);
    const mono = applyDisplayMode(s, "mono");
    const id = (mono.elements[0] as { fill: string }).fill.replace("gradient:", "");
    const bands = mono.gradients![id].bands!;
    expect(bands.length).toBeGreaterThan(8);
    const p = mono.patterns![bands[Math.floor(bands.length / 2)].paint.replace("pattern:", "")];
    expect(p.rows).toHaveLength(8);
  });

  it("leaves colours it cannot parse unchanged", () => {
    const out = applyDisplayMode(scene([rect("red", "hsl(0,0%,0%)")], "navy"), "ega");
    expect(colors(out)).toEqual(["navy", "red", "hsl(0,0%,0%)"]);
  });

  it("EGA dithers like VGA on the 640 x 350 grid, in EGA colours", () => {
    const out = applyDisplayMode(scene([rect("#008080"), rect("#ff8000"), rect("#ffffff")]), "ega");
    const fills = out.elements.map((e) => (e as { fill: string }).fill);
    expect(fills[1]).toBe("#ffaa00");
    expect(fills[2]).toBe("#ffffff");
    const p = out.patterns![fills[0].slice("pattern:".length)];
    expect([p.ink, p.paper].sort()).toEqual(["#000000", "#00ffff"]);
    expect(p.pixelHeight).toBeCloseTo(LANDSCAPE_VIEW_BOX.height / 350);
    expect(p.pixelWidth * 640).toBeCloseTo(LANDSCAPE_VIEW_BOX.width);
    expect(DISPLAY_MODES.find((m) => m.mode === "ega")?.label).toBe("EGA (640×350, 16 of 64 colours, dithered)");
  });

  it("EGA shows a palette's own screen colours as their nearest EGA colours", () => {
    const own = ["#000000", "#ffffff", "#ff0000", "#ff8000", "#ffff00", "#80ff00", "#00ff00", "#00ff80", "#00ffff", "#0080ff", "#0000ff", "#8000ff", "#000060", "#ff0080", "#555555", "#aaaaaa"];
    const out = applyDisplayMode({ ...scene([rect("#ff00ff")]), screenColors: own }, "ega");
    expect((out.elements[0] as { fill: string }).fill).toBe("#000055");
  });
});

describe("mono (Hercules)", () => {
  const text = (fill: string): SceneElement => ({
    kind: "text", x: 0, y: 0, text: "Hi", size: 10, fill,
    fontFamily: "sans-serif", fontWeight: 400, italic: false, anchor: "start",
  });
  const glyphs = (fill: string | null, stroke: string | null): SceneElement => ({
    kind: "glyphs", d: "M0 0", text: "A", advance: 1, em: 1000, fill, stroke,
  });
  const fillOf = (el: SceneElement) => (el as { fill: string | null }).fill;
  const strokeOf = (el: SceneElement) => (el as { stroke: string | null }).stroke;
  /** Tile rows of a two-colour pattern with "1" = white. */
  const white = (p: FillPattern) => (p.ink === "#ffffff" ? p.rows : p.rows.map((r) => r.replace(/./g, (c) => (c === "1" ? "0" : "1"))));

  it("is labelled as the Hercules screen", () => {
    expect(DISPLAY_MODES.find((m) => m.mode === "mono")?.label).toBe("Hercules monochrome (720×348)");
  });

  it("dithers the background like a fill (4 x 4), solid when black or white", () => {
    expect(applyDisplayMode(scene([], "#000000"), "mono").background).toBe("#000000");
    expect(applyDisplayMode(scene([], "#ffffff"), "mono").background).toBe("#ffffff");
    const out = applyDisplayMode(scene([], "#ff00ff"), "mono"); // luma 105: level 3
    const p = out.patterns![out.background.replace("pattern:", "")];
    expect(white(p)).toEqual(["1010", "0100", "1010", "0001"]);
  });

  it("patterns fills and text by luma, with the same rule", () => {
    const out = applyDisplayMode(scene([rect("#808080"), text("#808080"), glyphs("#00ffff", null), rect("#ffffff")]), "mono");
    const rows = (el: SceneElement) => white(out.patterns![fillOf(el)!.replace("pattern:", "")]);
    expect(rows(out.elements[0])).toEqual(["1010", "0101", "1010", "0101"]);
    expect(fillOf(out.elements[1])).toBe(fillOf(out.elements[0]));
    expect(rows(out.elements[2])).toEqual(["1110", "0101", "1011", "0101"]); // cyan: level 5
    expect(fillOf(out.elements[3])).toBe("#ffffff");
    // One pattern pixel = one 720 x 348 screen pixel, 0.644 as wide as tall.
    const p = out.patterns![fillOf(out.elements[0])!.replace("pattern:", "")];
    expect(p.pixelHeight).toBeCloseTo(LANDSCAPE_VIEW_BOX.height / 348);
    expect(p.pixelWidth / p.pixelHeight).toBeCloseTo(4 / 3 / (720 / 348));
    expect(p.pixelWidth * 720).toBeCloseTo(LANDSCAPE_VIEW_BOX.width);
  });

  it("draws thin lines and outlines solid: white unless near black", () => {
    const out = applyDisplayMode(scene([rect(null, "#0000ff"), rect("#808080", "#555555"), rect(null, "#000080"), rect(null, "#000000")]), "mono");
    expect(out.elements.map(strokeOf)).toEqual(["#ffffff", "#ffffff", "#000000", "#000000"]);
  });

  it("patterns thick strokes like fills", () => {
    const thick: SceneElement = { kind: "path", points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], closed: false, fill: null, stroke: "#808080", strokeWidth: 300 };
    const out = applyDisplayMode(scene([thick]), "mono");
    expect(strokeOf(out.elements[0])).toMatch(/^pattern:/);
  });

  it("keeps patterns aligned to the screen inside transformed groups and leaves images alone", () => {
    const img: SceneElement = { kind: "image", href: "data:,", x: 0, y: 0, width: 1, height: 1 };
    const s = scene([rect("#808080"), { kind: "group", transform: [0.5, 0, 0, 0.25, 0, 0], children: [rect("#808080"), img] }]);
    const out = applyDisplayMode(s, "mono");
    const g = out.elements[1] as { children: SceneElement[] };
    const base = out.patterns![fillOf(out.elements[0])!.replace("pattern:", "")];
    const inner = out.patterns![fillOf(g.children[0])!.replace("pattern:", "")];
    expect(inner.rows).toEqual(base.rows);
    expect(inner.transform).toBeDefined();
    expect(g.children[1]).toBe(img);
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
    stored(null);
    expect(loadDisplayMode()).toBe("vga");
  });

  it("keeps a stored \"vga\" (now the dithered ScreenShow driver) as it is", () => {
    stored("vga");
    expect(loadDisplayMode()).toBe("vga");
    expect(DEFAULT_DISPLAY_MODE).toBe("vga");
    expect(DISPLAY_MODES.find((m) => m.mode === "vga")?.label).toBe("VGA ScreenShow (16 colours, dithered)");
  });

  it("falls back to the default when storage throws", () => {
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("blocked"); }, setItem: () => {} });
    expect(loadDisplayMode()).toBe("vga");
  });
});

describe("saveDisplayMode", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("stores the mode id under hwv.displayMode", () => {
    const setItem = vi.fn();
    vi.stubGlobal("localStorage", { getItem: () => null, setItem });
    saveDisplayMode("vga");
    expect(setItem).toHaveBeenCalledWith("hwv.displayMode", "vga");
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
