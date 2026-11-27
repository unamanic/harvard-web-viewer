import { describe, expect, it } from "vitest";
import { LANDSCAPE_VIEW_BOX, centredViewBox, type Scene, type SceneElement } from "../model/scene";
import { type RGB, formatCssColor as rgbToCss, luma } from "./color";
import { vgaScreenShow } from "./vgaScreenShow";
import {
  BAYER_4X4,
  BAYER_8X8,
  type Dither,
  type Screen,
  applyScreen,
  blendPatterns,
  patternAverage,
  colorAtThreshold,
  ditherAverage,
  ditherRows,
  ditherTile,
  matrixSize,
  normalizeDither,
  screenGeometry,
  tilePattern,
} from "./dither";

/** A 2-colour test screen: white share by luma in 8 levels (2 thresholds each), white first. */
const mono: Screen = {
  id: "m",
  width: 640,
  height: 480,
  pixelAspect: 1,
  colors: ["#000000", "#ffffff"],
  matrix: BAYER_4X4,
  dither(rgb: RGB): Dither {
    const white = Math.round((luma(rgb) / 255) * 8) * 2;
    return [
      { color: 1, cells: white },
      { color: 0, cells: 16 - white },
    ];
  },
};

const rect = (fill: string | null, stroke: string | null = null): SceneElement => ({
  kind: "rect", x: 0, y: 0, width: 10, height: 10, fill, stroke,
});
const scene = (elements: SceneElement[], background = "#000000"): Scene => ({
  viewBox: LANDSCAPE_VIEW_BOX, background, elements,
});

describe("threshold matrix and tiles", () => {
  it("BAYER_4X4 holds every threshold 0..15 once", () => {
    expect(matrixSize(BAYER_4X4)).toBe(16);
    expect(BAYER_4X4.flat().sort((a, b) => a - b)).toEqual([...Array(16).keys()]);
  });

  it("gives the first stop the lowest thresholds", () => {
    const d: Dither = [{ color: 7, cells: 2 }, { color: 3, cells: 14 }];
    expect(colorAtThreshold(d, 0)).toBe(7);
    expect(colorAtThreshold(d, 1)).toBe(7);
    expect(colorAtThreshold(d, 2)).toBe(3);
    expect(colorAtThreshold(d, 15)).toBe(3);
    // Thresholds 0 and 1 sit at (0, 0) and (2, 2) of the Bayer matrix.
    expect(ditherTile(d)).toEqual([[7, 3, 3, 3], [3, 3, 3, 3], [3, 3, 7, 3], [3, 3, 3, 3]]);
  });

  it("makes a checkerboard of a half / half dither", () => {
    expect(ditherRows([{ color: 1, cells: 8 }, { color: 0, cells: 8 }], 1)).toEqual(["1010", "0101", "1010", "0101"]);
  });

  it("makes three-colour tiles", () => {
    const d: Dither = [{ color: 1, cells: 12 }, { color: 4, cells: 2 }, { color: 3, cells: 2 }];
    expect(ditherTile(d)).toEqual([[1, 1, 1, 1], [4, 1, 3, 1], [1, 1, 1, 1], [3, 1, 4, 1]]);
  });

  it("normalises: drops empty stops, merges repeats", () => {
    expect(normalizeDither([{ color: 1, cells: 0 }, { color: 2, cells: 4 }, { color: 3, cells: 8 }, { color: 2, cells: 4 }])).toEqual([
      { color: 2, cells: 8 },
      { color: 3, cells: 8 },
    ]);
  });

  it("averages a dither", () => {
    expect(ditherAverage([{ color: 0, cells: 8 }, { color: 1, cells: 8 }], [[0, 0, 0], [255, 255, 255]])).toEqual([127.5, 127.5, 127.5]);
  });
});

describe("screenGeometry", () => {
  it("puts one pixel at 1/480 of a 4:3 page's height, from its top left", () => {
    expect(screenGeometry(LANDSCAPE_VIEW_BOX, mono)).toEqual({ originX: -16384, originY: -12288, pixelWidth: 51.2, pixelHeight: 51.2 });
  });

  it("letterboxes other page shapes", () => {
    // A portrait 3:4 page fills the screen's height: 480 pixels for 32768 units, centred across 640.
    const g = screenGeometry(centredViewBox(24576, 32768), mono);
    expect(g.pixelHeight).toBeCloseTo(32768 / 480);
    expect(g.originY).toBeCloseTo(-16384);
    expect(g.originX).toBeCloseTo(-320 * (32768 / 480));
  });

  it("uses the pixel aspect", () => {
    const g = screenGeometry(LANDSCAPE_VIEW_BOX, { width: 640, height: 350, pixelAspect: 35 / 48 });
    expect(g.pixelHeight).toBeCloseTo(24576 / 350);
    expect(g.pixelWidth).toBeCloseTo((24576 / 350) * (35 / 48));
    expect(g.originX).toBeCloseTo(-16384);
  });
});

describe("tilePattern", () => {
  it("writes two colours as ink and paper", () => {
    expect(tilePattern([[0, 1], [1, 0]], ["#000", "#fff"], 2, 3)).toEqual({ rows: ["01", "10"], ink: "#fff", paper: "#000", pixelWidth: 2, pixelHeight: 3 });
  });

  it("writes three or more colours as hexadecimal digits into `colors`", () => {
    const p = tilePattern([[5, 9], [12, 5]], [...Array(16).keys()].map((i) => `c${i}`), 1, 1, [1, 0, 0, 1, 4, 5]);
    expect(p.rows).toEqual(["01", "20"]);
    expect(p.colors).toEqual(["c5", "c9", "c12"]);
    expect(p.transform).toEqual([1, 0, 0, 1, 4, 5]);
  });
});

describe("applyScreen with a 2-colour screen", () => {
  it("draws solid levels as screen colours and mixed ones as screen-aligned patterns", () => {
    const out = applyScreen(scene([rect("#ffffff", "#000000"), rect("#808080")], "#000000"), mono);
    expect(out.background).toBe("#000000");
    expect(out.elements[0]).toMatchObject({ fill: "#ffffff", stroke: "#000000" });
    expect(out.elements[1]).toMatchObject({ fill: "pattern:m-0" });
    expect(out.patterns?.["m-0"]).toEqual({
      // White on the lower thresholds: (0, 0) is white, the tile's paper.
      rows: ["0101", "1010", "0101", "1010"],
      ink: "#000000",
      paper: "#ffffff",
      pixelWidth: 51.2,
      pixelHeight: 51.2,
      // Pattern origin moved to the screen's top left (-320, -240 pixels).
      transform: [1, 0, 0, 1, -16384, -12288],
    });
  });

  it("dithers outlines and text too, and shares one pattern per tile and alignment", () => {
    const text: SceneElement = {
      kind: "text", x: 0, y: 0, text: "Hi", size: 10, fill: "#808080",
      fontFamily: "sans-serif", fontWeight: 400, italic: false, anchor: "start",
    };
    const glyphs: SceneElement = { kind: "glyphs", d: "M0 0", text: "B", advance: 1, em: 1000, fill: "#808080", stroke: null };
    const out = applyScreen(scene([rect(null, "#808080"), text, glyphs]), mono);
    expect(out.elements[0]).toMatchObject({ fill: null, stroke: "pattern:m-0" });
    expect(out.elements[1]).toMatchObject({ fill: "pattern:m-0" });
    expect(out.elements[2]).toMatchObject({ fill: "pattern:m-0", stroke: null });
    expect(Object.keys(out.patterns ?? {})).toEqual(["m-0"]);
  });

  it("keeps patterns on the screen grid inside transformed groups and glyph lines", () => {
    const out = applyScreen(
      scene([
        {
          kind: "group",
          transform: [2, 0, 0, 2, 100, 0],
          children: [
            rect("#808080"),
            { kind: "glyphs", d: "M0 0", text: "B", advance: 1, em: 1000, fill: "#808080", stroke: null, transform: [0.5, 0, 0, 0.5, 0, 0] },
          ],
        },
      ]),
      mono,
    );
    const g = out.elements[0];
    if (g.kind !== "group") throw new Error("group expected");
    const groupPattern = out.patterns?.[(g.children[0] as { fill: string }).fill.slice("pattern:".length)];
    // local = (scene − (100, 0)) / 2; pattern origin at scene (−16384, −12288).
    expect(groupPattern?.transform).toEqual([0.5, 0, 0, 0.5, (-16384 - 100) / 2, -12288 / 2]);
    const glyphPattern = out.patterns?.[(g.children[1] as { fill: string }).fill.slice("pattern:".length)];
    expect(glyphPattern?.transform).toEqual([1, 0, 0, 1, -16384 - 100, -12288]);
    expect(groupPattern?.pixelWidth).toBe(51.2);
  });

  it("leaves images, halos and colours it cannot parse alone, and does not touch the input", () => {
    const image: SceneElement = { kind: "image", href: "data:,", x: 0, y: 0, width: 1, height: 1 };
    const s = scene([rect("transparent", "red"), image], "navy");
    const before = JSON.stringify(s);
    const out = applyScreen(s, mono);
    expect(out.background).toBe("navy");
    expect(out.elements[0]).toMatchObject({ fill: "transparent", stroke: "red" });
    expect(out.elements[1]).toBe(image);
    expect(out.patterns).toBeUndefined();
    expect(JSON.stringify(s)).toBe(before);
  });

  it("uses Screen.background for the page when given", () => {
    const out = applyScreen(scene([], "#ffffff"), { ...mono, background: () => 0 });
    expect(out.background).toBe("#000000");
  });

  it("dithers the background like shapes with Screen.backgroundLikeShapes", () => {
    const fine = { matrix: BAYER_8X8, dither: mono.dither };
    const asGradient = applyScreen(scene([], "#808080"), { ...mono, gradient: fine });
    const asShape = applyScreen(scene([], "#808080"), { ...mono, gradient: fine, backgroundLikeShapes: true });
    expect(asGradient.patterns![asGradient.background.slice("pattern:".length)].rows).toHaveLength(8);
    expect(asShape.patterns![asShape.background.slice("pattern:".length)].rows).toHaveLength(4);
  });

  it("uses Screen.line for strokes up to line.maxWidth screen pixels wide, `dither` for wider ones", () => {
    const screen: Screen = { ...mono, line: { maxWidth: 1.5, dither: () => [{ color: 1, cells: 16 }] } };
    const px = LANDSCAPE_VIEW_BOX.height / 480;
    const stroke = (w: number): SceneElement => ({ kind: "rect", x: 0, y: 0, width: 10, height: 10, fill: null, stroke: "#808080", strokeWidth: w * px });
    const out = applyScreen(scene([stroke(1), stroke(1.5), stroke(2), glyph()]), screen);
    const strokes = out.elements.map((el) => (el as { stroke: string | null }).stroke);
    expect(strokes.slice(0, 2)).toEqual(["#ffffff", "#ffffff"]);
    expect(strokes[2]).toMatch(/^pattern:/);
    expect(strokes[3]).toMatch(/^pattern:/); // glyph outlines count as text
    // Scaled groups scale the width.
    const inGroup = applyScreen(scene([{ kind: "group", transform: [2, 0, 0, 2, 0, 0], children: [stroke(1)] }]), screen);
    expect((inGroup.elements[0] as { children: { stroke: string }[] }).children[0].stroke).toMatch(/^pattern:/);
  });
});

function glyph(): SceneElement {
  return { kind: "glyphs", d: "M0 0", text: "A", advance: 1, em: 1000, fill: null, stroke: "#808080" };
}

describe("applyScreen with gradients", () => {
  it("samples a gradient once per screen pixel along it and merges equal paints into bands", () => {
    // Black to white over a 640-pixel-wide rect, left to right.
    const s: Scene = {
      ...scene([{ kind: "rect", x: -16384, y: -12288, width: 32768, height: 24576, fill: "gradient:g", stroke: null }]),
      gradients: { g: { from: "#000000", to: "#ffffff", angle: 0 } },
    };
    const out = applyScreen(s, mono);
    const fill = (out.elements[0] as { fill: string }).fill;
    expect(fill).toBe("gradient:m-g0");
    const bands = out.gradients?.["m-g0"]?.bands ?? [];
    // 9 dither levels of the test screen: black, 7 patterns, white.
    expect(bands).toHaveLength(9);
    expect(bands[0]).toEqual({ offset: 0, paint: "#000000" });
    expect(bands[8]?.paint).toBe("#ffffff");
    expect(bands.slice(1, 8).every((b) => b.paint.startsWith("pattern:"))).toBe(true);
    expect(bands.map((b) => b.offset)).toEqual([...bands.map((b) => b.offset)].sort((a, b) => a - b));
    // The input keeps its smooth gradient.
    expect(s.gradients?.g.bands).toBeUndefined();
  });

  it("uses Screen.gradient (matrix and rule) for gradients and the background", () => {
    const fine: Screen = {
      ...mono,
      gradient: { matrix: BAYER_8X8, dither: () => [{ color: 1, cells: 32 }, { color: 0, cells: 32 }] },
    };
    const out = applyScreen(scene([], "#123456"), fine);
    expect(out.background).toBe("pattern:m-0");
    expect(out.patterns?.["m-0"]?.rows).toHaveLength(8);
  });

  it("dithers a gradient background over the viewBox", () => {
    const s: Scene = { ...scene([], "gradient:g"), gradients: { g: { from: "#000000", to: "#ffffff", angle: 270 } } };
    const out = applyScreen(s, mono);
    expect(out.background).toBe("gradient:m-g0");
    expect(out.gradients?.["m-g0"]?.bands?.[0]?.paint).toBe("#000000");
  });
});

describe("blendPatterns", () => {
  const tile = { pixelWidth: 1, pixelHeight: 1 };

  it("averages a tile's pixels", () => {
    expect(patternAverage({ ...tile, rows: ["10", "00"], ink: "#ffffff", paper: "#000000" })).toBe(rgbToCss([64, 64, 64]));
    expect(patternAverage({ ...tile, rows: ["01", "22"], ink: "", paper: "", colors: ["#ff0000", "#0000ff", "#000000"] })).toBe(
      rgbToCss([64, 0, 64]),
    );
    expect(patternAverage({ ...tile, rows: ["1"], ink: "red", paper: "#000" })).toBeNull();
  });

  it("replaces every pattern paint of a dithered scene with its average", () => {
    const text = { kind: "text", x: 0, y: 0, text: "Hi", size: 10, fill: "#0000aa", fontFamily: "serif", fontWeight: 400, italic: false, anchor: "start" } as SceneElement;
    const scene: Scene = {
      viewBox: LANDSCAPE_VIEW_BOX,
      background: "#0000aa",
      elements: [
        { kind: "rect", x: 0, y: 0, width: 100, height: 100, fill: "#0000aa", stroke: null },
        { kind: "group", children: [text] },
      ],
    };
    const shown = applyScreen(scene, vgaScreenShow());
    expect(shown.background.startsWith("pattern:")).toBe(true);
    const blended = blendPatterns(shown);
    expect(JSON.stringify({ ...blended, patterns: undefined })).not.toContain("pattern:");
    // Navy on the VGA ScreenShow: 43/64 blue on black (8 × 8 dither) for the background.
    expect(blended.background).toBe(rgbToCss([0, 0, Math.round((43 * 255) / 64)]));
    expect(blendPatterns(scene)).toBe(scene);
  });
});
