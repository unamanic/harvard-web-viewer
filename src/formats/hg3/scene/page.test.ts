import { describe, expect, it } from "vitest";
import { LANDSCAPE_VIEW_BOX, PORTRAIT_VIEW_BOX } from "../../types";
import type { PageSetup } from "../chart";
import { areaToRect, pageGeometry, scaleBox, screenMapping, toScene } from "./page";

const setup = (orientation: PageSetup["orientation"], orientationCode: number): PageSetup => ({
  orientation,
  orientationCode,
  paperSize: 1,
  widthIn: 10,
  heightIn: 7.5,
});

describe("pageGeometry", () => {
  it("is landscape by default, with or without 816", () => {
    expect(pageGeometry({ pageSetup: null }).viewBox).toEqual(LANDSCAPE_VIEW_BOX);
    expect(pageGeometry({ pageSetup: setup("landscape", 1) }).orientation).toBe("landscape");
    expect(pageGeometry({ pageSetup: setup("unknown", 7) }).orientation).toBe("landscape");
  });

  it("is portrait for 816 orientation 2", () => {
    const g = pageGeometry({ pageSetup: setup("portrait", 2) });
    expect(g.orientation).toBe("portrait");
    expect(g.viewBox).toEqual(PORTRAIT_VIEW_BOX);
    expect(g.shortSide).toBe(24576);
  });
});

describe("pageGeometry: page size from 816 (task 12b)", () => {
  const sized = (orientation: PageSetup["orientation"], widthIn: number, heightIn: number): PageSetup => ({
    orientation,
    orientationCode: orientation === "portrait" ? 2 : 1,
    paperSize: 1,
    widthIn,
    heightIn,
  });
  const LETTER_SHORT = (32768 * 8.5) / 11;

  it("keeps the 4:3 page for 10 × 7.5 in", () => {
    const g = pageGeometry({ pageSetup: sized("landscape", 10, 7.5) });
    expect(g.viewBox).toEqual(LANDSCAPE_VIEW_BOX);
    expect(g.shortSide).toBe(24576);
  });

  it("makes a landscape Letter page 32768 × 25320 with square units", () => {
    const g = pageGeometry({ pageSetup: sized("landscape", 11, 8.5) });
    expect(g.orientation).toBe("landscape");
    expect(g.viewBox).toEqual({ minX: -16384, minY: -12660, width: 32768, height: 25320 });
    expect(g.shortSide).toBeCloseTo(LETTER_SHORT, 9);
    expect(Math.round(g.shortSide)).toBe(25321);
  });

  it("swaps the sides for a portrait Letter page", () => {
    const g = pageGeometry({ pageSetup: sized("portrait", 8.5, 11) });
    expect(g.orientation).toBe("portrait");
    expect(g.viewBox).toEqual({ minX: -12660, minY: -16384, width: 25320, height: 32768 });
    expect(g.shortSide).toBeCloseTo(LETTER_SHORT, 9);
  });

  it("takes the orientation from the 816 code, the sides from the sizes in either order", () => {
    expect(pageGeometry({ pageSetup: sized("portrait", 11, 8.5) }).viewBox.height).toBe(32768);
    expect(pageGeometry({ pageSetup: sized("landscape", 8.5, 11) }).viewBox.width).toBe(32768);
  });

  it("falls back to 4:3 when 816 is missing or its size is odd", () => {
    expect(pageGeometry({ pageSetup: null })).toEqual({
      orientation: "landscape",
      viewBox: LANDSCAPE_VIEW_BOX,
      shortSide: 24576,
      screenViewBox: LANDSCAPE_VIEW_BOX,
      screenPixel: 51.2,
    });
    for (const [w, h] of [[0, 7.5], [10, -1], [Number.NaN, 8], [Number.POSITIVE_INFINITY, 8], [100, 1]]) {
      const g = pageGeometry({ pageSetup: sized("landscape", w!, h!) });
      expect(g.viewBox).toEqual(LANDSCAPE_VIEW_BOX);
      expect(g.shortSide).toBe(24576);
    }
    expect(pageGeometry({ pageSetup: sized("portrait", 0, 0) }).viewBox).toEqual(PORTRAIT_VIEW_BOX);
  });
});

describe("pageGeometry: screen area from the paper size (PAPER_SIZES_IN)", () => {
  const paper = (paperSize: number, orientation: PageSetup["orientation"], widthIn: number, heightIn: number): PageSetup => ({
    orientation,
    orientationCode: orientation === "portrait" ? 2 : 1,
    paperSize,
    widthIn,
    heightIn,
  });

  it("letterboxes a 10 × 7.5 in page on Letter paper: Letter-shaped screen area, 10 × 7.5 in units and text base", () => {
    const g = pageGeometry({ pageSetup: paper(1, "landscape", 10, 7.5) });
    expect(g.viewBox).toEqual(LANDSCAPE_VIEW_BOX);
    expect(g.shortSide).toBe(24576);
    expect(g.screenViewBox).toEqual({ minX: -16384, minY: -12660, width: 32768, height: 25320 });
    // On a 640 × 480 screen the page is drawn at 480 / (25320 / 51.2) = 0.971 of the 4:3 size.
    expect(480 / g.screenViewBox.height / (640 / 32768)).toBeCloseTo(0.971, 3);
  });

  it("is the page itself when the paper matches it or is unknown", () => {
    expect(pageGeometry({ pageSetup: paper(14, "landscape", 10, 7.5) }).screenViewBox).toEqual(LANDSCAPE_VIEW_BOX);
    expect(pageGeometry({ pageSetup: paper(99, "landscape", 10, 7.5) }).screenViewBox).toEqual(LANDSCAPE_VIEW_BOX);
    const letter = pageGeometry({ pageSetup: paper(1, "portrait", 8.5, 11) });
    expect(letter.screenViewBox).toBe(letter.viewBox);
    expect(pageGeometry({ pageSetup: paper(1, "portrait", 7.5, 10) }).screenViewBox).toEqual({
      minX: -12660,
      minY: -16384,
      width: 25320,
      height: 32768,
    });
  });
});

describe("screenPixel / screenMapping / scaleBox", () => {
  const letter: PageSetup = { orientation: "landscape", orientationCode: 1, paperSize: 1, widthIn: 11, heightIn: 8.5 };
  const screen: PageSetup = { orientation: "landscape", orientationCode: 1, paperSize: 14, widthIn: 10, heightIn: 7.5 };

  it("gives one 640 × 480 screen pixel in page units: 51.2 on 4:3, 52.75 on Letter (letterboxed by height)", () => {
    expect(pageGeometry({ pageSetup: screen }).screenPixel).toBe(51.2);
    expect(pageGeometry({ pageSetup: letter }).screenPixel).toBeCloseTo(25320 / 480, 9);
  });

  it("maps one page's screen onto another's by the pixel ratio, or not at all when equal", () => {
    const g4 = pageGeometry({ pageSetup: screen });
    const gl = pageGeometry({ pageSetup: letter });
    const m = screenMapping(g4, gl)!;
    expect(m[0]).toBeCloseTo(25320 / 480 / 51.2, 12);
    expect(m.slice(1)).toEqual([0, 0, m[0], 0, 0]);
    expect(screenMapping(g4, g4)).toBeNull();
    expect(scaleBox({ x1: -10, y1: 5, x2: 20, y2: -40 }, 2)).toEqual({ x1: -20, y1: 10, x2: 40, y2: -80 });
  });
});

describe("toScene / areaToRect", () => {
  it("flips y", () => {
    expect(toScene(100, 2000)).toEqual({ x: 100, y: -2000 });
    expect(toScene(-5, -7)).toEqual({ x: -5, y: 7 });
  });

  it("puts the top-left corner (largest page y) at x/y, whatever the corner order", () => {
    const expected = { x: -1000, y: -5600, width: 11000, height: 4600 };
    expect(areaToRect({ x1: -1000, y1: 1000, x2: 10000, y2: 5600 })).toEqual(expected);
    expect(areaToRect({ x1: 10000, y1: 5600, x2: -1000, y2: 1000 })).toEqual(expected);
  });

  it("maps the full landscape page onto the landscape viewBox", () => {
    const r = areaToRect({ x1: -16384, y1: -12288, x2: 16384, y2: 12288 });
    expect(r).toEqual({ x: LANDSCAPE_VIEW_BOX.minX, y: LANDSCAPE_VIEW_BOX.minY, width: 32768, height: 24576 });
  });
});
