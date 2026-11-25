import { describe, expect, it } from "vitest";
import { LANDSCAPE_VIEW_BOX, centredViewBox, type Scene, type SceneElement } from "../formats/types";
import { type RGB, luma } from "./color";
import {
  BAYER_4X4,
  type Dither,
  type Screen,
  applyScreen,
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
    const out = applyScreen(scene([rect("#ffffff", "#000000"), rect("#808080")], "#202020"), mono);
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
});
