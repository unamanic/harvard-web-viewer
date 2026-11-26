import { describe, expect, it } from "vitest";
import type { ImageElement, IndexedPixels, Scene, SceneElement } from "../model/scene";
import type { RGB } from "./color";
import { type Dither, type Screen, applyScreen } from "./dither";
import { herculesScreen } from "./hercules";

/** An 8 × 4 two-colour screen, one scene unit per pixel: light colours white, dark black, mid greys a checkerboard. */
const tiny: Screen = {
  id: "t",
  width: 8,
  height: 4,
  pixelAspect: 1,
  colors: ["#000000", "#ffffff"],
  matrix: [
    [0, 2],
    [3, 1],
  ],
  dither(rgb: RGB): Dither {
    const v = rgb[0];
    if (v > 200) return [{ color: 1, cells: 4 }];
    if (v < 50) return [{ color: 0, cells: 4 }];
    return [
      { color: 1, cells: 2 }, // thresholds 0 and 1: (0,0) and (1,1)
      { color: 0, cells: 2 },
    ];
  },
};

const sceneOf = (elements: SceneElement[], w = 8, h = 4): Scene => ({
  viewBox: { minX: 0, minY: 0, width: w, height: h },
  background: "#000000",
  elements,
});

const pixels = (width: number, height: number, data: number[], palette: (string | null)[]): IndexedPixels => ({
  width,
  height,
  data: new Uint8Array(data),
  palette,
});

/** The screened image as rows of "W" (white), "B" (black), "." (transparent). */
function grid(el: SceneElement | undefined): string[] {
  if (el?.kind !== "image" || !el.pixels) throw new Error("screened image expected");
  const p = el.pixels;
  const ch = (c: string | null) => (c === null ? "." : c === "#ffffff" ? "W" : c === "#000000" ? "B" : "?");
  return Array.from({ length: p.height }, (_, y) =>
    Array.from({ length: p.width }, (_, x) => ch(p.palette[p.data[y * p.width + x]]!)).join(""),
  );
}

const WBG = ["#ffffff", "#000000", "#808080"];

describe("applyScreen: images with indexed pixels (screenImage)", () => {
  it("draws a screen-pixel tile one image pixel per screen pixel from floor(anchor − hot), repeated and clipped to the box", () => {
    const img: ImageElement = {
      kind: "image",
      href: "data:,",
      x: 0.2,
      y: 0,
      width: 6.4, // pixel centres 0.5 … 6.5: columns 0–6
      height: 2,
      pixels: pixels(3, 1, [0, 1, 2], WBG),
      tile: { pixelWidth: 5, pixelHeight: 5, imageWidth: 3, imageHeight: 1, anchorX: 3.4, anchorY: 1, hotX: 1, hotY: 0.5, screenPixels: true },
    };
    const out = applyScreen(sceneOf([img]), tiny).elements[0]!;
    // Origin column floor(3.4 − 1) = 2: columns 2, 5 white, 0, 3, 6 black, 1, 4 grey (the dither at that pixel).
    expect(grid(out)).toEqual(["BBWBWWB", "BWWBBWB"]);
    expect(out).toMatchObject({ kind: "image", x: 0, y: 0, width: 7, height: 2 });
    expect(out.kind === "image" && out.tile).toBeUndefined();
    expect(out.kind === "image" && out.href).toMatch(/^data:image\//);
  });

  it("uses the tile's pixel size in element units without screenPixels", () => {
    const img: ImageElement = {
      kind: "image",
      href: "data:,",
      x: 0,
      y: 0,
      width: 8,
      height: 1,
      pixels: pixels(2, 1, [0, 1], WBG),
      tile: { pixelWidth: 2, pixelHeight: 1, imageWidth: 2, imageHeight: 1, anchorX: 1, anchorY: 0, hotX: 0, hotY: 0 },
    };
    expect(grid(applyScreen(sceneOf([img]), tiny).elements[0])).toEqual(["BWWBBWWB"]);
  });

  it("stretches an untiled image over its box and keeps transparent pixels transparent", () => {
    const img: ImageElement = { kind: "image", href: "data:,", x: 0, y: 0, width: 4, height: 1, pixels: pixels(2, 1, [0, 1], ["#ffffff", null]) };
    expect(grid(applyScreen(sceneOf([img]), tiny).elements[0])).toEqual(["WW.."]);
  });

  it("stretches nearest-neighbour: box pixel i shows image pixel round(i × n / D), halves down", () => {
    // 3 image pixels over 7 screen pixels (box 0.2 … 6.6: pixel centres 0.5 … 6.5): round(i × 3 / 7) = 0 0 1 1 2 2 2 (3 clamped).
    const img: ImageElement = { kind: "image", href: "data:,", x: 0.2, y: 0, width: 6.4, height: 1, pixels: pixels(3, 1, [0, 1, 0], ["#ffffff", "#000000"]) };
    expect(grid(applyScreen(sceneOf([img]), tiny).elements[0])).toEqual(["WWBBWWW"]);
    // 2 over 4 rows: a tie (i = 1: 0.5) rounds down, so rows 0, 1 show row 0 and rows 2, 3 row 1.
    const tall: ImageElement = { kind: "image", href: "data:,", x: 0, y: 0, width: 1, height: 4, pixels: pixels(1, 2, [0, 1], ["#ffffff", "#000000"]) };
    expect(grid(applyScreen(sceneOf([tall]), tiny).elements[0])).toEqual(["W", "W", "B", "B"]);
  });

  it("drops an image whose box covers no screen pixel centre, and leaves rotated ones unchanged", () => {
    const px = pixels(1, 1, [0], WBG);
    const tinyImg: ImageElement = { kind: "image", href: "data:,", x: 1.6, y: 1.6, width: 0.3, height: 0.3, pixels: px };
    expect(applyScreen(sceneOf([tinyImg]), tiny).elements).toEqual([]);
    const rotated: SceneElement = { kind: "group", transform: [0, 1, -1, 0, 4, 0], children: [{ ...tinyImg, width: 2, height: 2 }] };
    const out = applyScreen(sceneOf([rotated]), tiny).elements[0]!;
    expect(out.kind === "group" && out.children[0]).toEqual({ ...tinyImg, width: 2, height: 2 });
  });

  it("follows the element's group transform", () => {
    const img: ImageElement = { kind: "image", href: "data:,", x: 0, y: 0, width: 1, height: 1, pixels: pixels(1, 1, [0], WBG) };
    const out = applyScreen(sceneOf([{ kind: "group", transform: [2, 0, 0, 2, 4, 2], children: [img] }]), tiny).elements[0]!;
    if (out.kind !== "group") throw new Error("group expected");
    expect(grid(out.children[0])).toEqual(["WW", "WW"]);
    expect(out.children[0]).toMatchObject({ x: 0, y: 0, width: 1, height: 1 });
  });

  it("dithers bitmap pixels with the screen's fill patterns at their own screen pixels (Hercules, non-square pixels)", () => {
    // A 4:3 page (960 × 720 units) fills 720 × 348 pixels of 4/3 × 720/348 units. A 1 × 1 image of
    // (0,0,255) (level 1: white on Bayer thresholds 0 and 1) tiled over 4 × 4 pixels from pixel (360, 172).
    const pw = 4 / 3;
    const ph = 720 / 348;
    const s = sceneOf([], 960, 720);
    const img: ImageElement = {
      kind: "image",
      href: "data:,",
      x: 360 * pw,
      y: 172 * ph,
      width: 4 * pw,
      height: 4 * ph,
      pixels: pixels(1, 1, [0], ["#0000ff"]),
      tile: { pixelWidth: 1, pixelHeight: 1, imageWidth: 1, imageHeight: 1, anchorX: 361 * pw, anchorY: 173 * ph, hotX: 0.5, hotY: 0.5, screenPixels: true },
    };
    const out = applyScreen({ ...s, elements: [img] }, herculesScreen()).elements[0];
    expect(grid(out)).toEqual(["WBBB", "BBBB", "BBWB", "BBBB"]);
  });
});
