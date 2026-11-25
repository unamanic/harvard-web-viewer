import { describe, expect, it } from "vitest";
import { LANDSCAPE_VIEW_BOX, PORTRAIT_VIEW_BOX } from "../formats/types";
import { BAYER_8X8, ditherRows, ditherTile, normalizeDither, screenGeometry } from "./dither";
import {
  HERCULES_HEIGHT,
  HERCULES_LINE_MAX_WIDTH,
  HERCULES_PIXEL_ASPECT,
  HERCULES_WIDTH,
  herculesDither,
  herculesGradientDither,
  herculesLevel,
  herculesLine,
  herculesScreen,
} from "./hercules";

/** The 4 x 4 tile ("1" = white) a colour shows as on fills and text. */
const tile = (rgb: [number, number, number]) => ditherRows(normalizeDither(herculesDither(rgb)), 1);

describe("herculesLevel", () => {
  it("picks one of 9 levels from Rec. 601 luma, as the reference renders do", () => {
    // Pairs observed in the 238 Hercules renders (stored colour -> pattern level).
    const observed: [[number, number, number], number][] = [
      [[0, 0, 0], 0],
      [[15, 15, 15], 0],
      [[0, 0, 64], 0],
      [[22, 22, 22], 1],
      [[49, 49, 49], 1],
      [[37, 36, 68], 1],
      [[53, 53, 53], 2],
      [[64, 64, 64], 2],
      [[0, 64, 128], 2],
      [[0, 128, 128], 3],
      [[0, 128, 255], 3],
      [[255, 0, 255], 3],
      [[152, 76, 0], 3],
      [[128, 128, 128], 4],
      [[202, 101, 0], 4],
      [[0, 255, 255], 5],
      [[255, 128, 0], 5],
      [[161, 161, 161], 5],
      [[191, 191, 191], 6],
      [[255, 184, 84], 6],
      [[255, 255, 128], 7],
      [[255, 247, 188], 7],
      [[255, 255, 255], 8],
    ];
    for (const [rgb, level] of observed) expect(herculesLevel(rgb), rgb.join(",")).toBe(level);
  });
});

describe("herculesDither", () => {
  it("lights 2 x level cells of the 4 x 4 Bayer matrix", () => {
    expect(tile([0, 0, 0])).toEqual(["0000", "0000", "0000", "0000"]);
    expect(tile([22, 22, 22])).toEqual(["1000", "0000", "0010", "0000"]);
    expect(tile([64, 64, 64])).toEqual(["1010", "0000", "1010", "0000"]);
    expect(tile([0, 128, 128])).toEqual(["1010", "0100", "1010", "0001"]);
    expect(tile([128, 128, 128])).toEqual(["1010", "0101", "1010", "0101"]);
    expect(tile([0, 255, 255])).toEqual(["1110", "0101", "1011", "0101"]);
    expect(tile([191, 191, 191])).toEqual(["1111", "0101", "1111", "0101"]);
    expect(tile([255, 255, 128])).toEqual(["1111", "1101", "1111", "0111"]);
    expect(tile([255, 255, 255])).toEqual(["1111", "1111", "1111", "1111"]);
  });

  it("does not depend on hue beyond luma: cyan and orange share a pattern", () => {
    expect(tile([0, 255, 255])).toEqual(tile([255, 128, 0]));
    expect(tile([0, 128, 255])).toEqual(tile([255, 0, 255]));
  });
});

describe("herculesLine", () => {
  it("is solid white for any colour above level 0, else black", () => {
    expect(herculesLine([0, 0, 255])).toEqual([{ color: 1, cells: 16 }]);
    expect(herculesLine([85, 85, 85])).toEqual([{ color: 1, cells: 16 }]);
    expect(herculesLine([0, 0, 128])).toEqual([{ color: 0, cells: 16 }]);
    expect(herculesLine([0, 0, 0])).toEqual([{ color: 0, cells: 16 }]);
  });
});

describe("herculesGradientDither", () => {
  it("uses 64 levels on the 8 x 8 matrix", () => {
    const cells = (rgb: [number, number, number]) => normalizeDither(herculesGradientDither(rgb)).find((s) => s.color === 1)?.cells ?? 0;
    expect(cells([0, 0, 0])).toBe(0);
    expect(cells([4, 4, 4])).toBe(1);
    expect(cells([64, 64, 64])).toBe(16);
    expect(cells([160, 160, 160])).toBe(40);
    expect(cells([255, 255, 255])).toBe(64);
    const t = ditherTile(normalizeDither(herculesGradientDither([4, 4, 4])), BAYER_8X8);
    expect(t.flat().filter((c) => c === 1)).toHaveLength(1);
    expect(t[0][0]).toBe(1);
  });
});

describe("herculesScreen", () => {
  it("is 720 x 348, two colours, pixels 1.55 times taller than wide", () => {
    const s = herculesScreen();
    expect([s.width, s.height]).toEqual([HERCULES_WIDTH, HERCULES_HEIGHT]);
    expect([HERCULES_WIDTH, HERCULES_HEIGHT]).toEqual([720, 348]);
    expect(s.colors).toEqual(["#000000", "#ffffff"]);
    expect(1 / HERCULES_PIXEL_ASPECT).toBeCloseTo(1.552, 3);
    expect(s.line?.maxWidth).toBe(HERCULES_LINE_MAX_WIDTH);
    expect(s.backgroundLikeShapes).toBe(true);
  });

  it("maps a 4:3 page onto the whole framebuffer, and letterboxes a portrait one in 4:3 space", () => {
    const s = herculesScreen();
    const land = screenGeometry(LANDSCAPE_VIEW_BOX, s);
    expect(land.pixelWidth * 720).toBeCloseTo(LANDSCAPE_VIEW_BOX.width);
    expect(land.pixelHeight * 348).toBeCloseTo(LANDSCAPE_VIEW_BOX.height);
    expect(land.originX).toBeCloseTo(LANDSCAPE_VIEW_BOX.minX);
    // PORTRAIT.CH3's page; the reference shows it 420 of 720 pixels wide (VGA: 372 of 640).
    const page = { minX: -12660, minY: -16384, width: 25320, height: 32768 };
    const port = screenGeometry(page, s);
    expect(Math.abs(page.width / port.pixelWidth - 420)).toBeLessThan(3);
    expect(screenGeometry(PORTRAIT_VIEW_BOX, s).pixelHeight * 348).toBeCloseTo(PORTRAIT_VIEW_BOX.height);
  });
});
