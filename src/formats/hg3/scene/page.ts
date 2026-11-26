/**
 * Page geometry and the page → scene coordinate change (SPEC §6.1).
 *
 * Page coordinates have (0, 0) at the centre and y going UP; scene
 * coordinates (types.ts) have y going DOWN. This file is the only place the
 * y flip happens: every scene builder converts page points with `toScene`
 * and page areas with `areaToRect`.
 */
import { type Matrix, type Point, type ViewBox, centredViewBox } from "../../../model/scene";
import { PAGE_LONG_SIDE, PAPER_SIZES_IN, SCREEN_HEIGHT_PX, SCREEN_WIDTH_PX, pageShortSide } from "../assumptions";
import type { Chart, PageArea } from "../chart";
import type { Box } from "../objects";

export type PageOrientation = "landscape" | "portrait";

export interface PageGeometry {
  orientation: PageOrientation;
  /**
   * The page, centred on (0, 0): PAGE_LONG_SIDE along the long side and the
   * short side rounded to an even number of units (LANDSCAPE_VIEW_BOX or
   * PORTRAIT_VIEW_BOX for a 10 × 7.5 in page, 32768 × 25320 for Letter).
   */
  viewBox: ViewBox;
  /**
   * Shorter side in page units, unrounded (assumptions.ts pageShortSide):
   * the base of every text size (textSizeToUnits).
   */
  shortSide: number;
  /**
   * What the screen shows (assumptions.ts PAPER_SIZES_IN): the page area of
   * the 816 paper size, centred on (0, 0) with the same square units. Equal
   * to `viewBox` except when the paper's shape differs from the stated page
   * size (the tutorial charts: Letter paper, 10 × 7.5 in page). The scene's
   * viewBox; layout and embedding use `viewBox`.
   */
  screenViewBox: ViewBox;
  /**
   * One pixel of the 640 × 480 screen the original draws on, in page units:
   * the screen area letterboxed (51.2 on a 4:3 page, 52.75 on Letter).
   * Used where the original rounds to pixels (glyph advances).
   */
  screenPixel: number;
}

/**
 * Page geometry from record 816 (SPEC §5.2, §6.1; assumptions.ts
 * pageShortSide): orientation 2 is portrait, anything else (1, an unknown
 * code, or no 816) landscape; the short side follows the 816 width and
 * height (4:3 when missing or odd), the screen area from its paper size.
 * parseChart already warns about an
 * unknown orientation code.
 */
export function pageGeometry(chart: Pick<Chart, "pageSetup">): PageGeometry {
  const setup = chart.pageSetup;
  const portrait = setup?.orientation === "portrait";
  const shortSide = pageShortSide(setup?.widthIn, setup?.heightIn);
  const box = (short: number) => {
    const extent = 2 * Math.round(short / 2);
    return portrait ? centredViewBox(extent, PAGE_LONG_SIDE) : centredViewBox(PAGE_LONG_SIDE, extent);
  };
  const viewBox = box(shortSide);
  const paper = setup ? PAPER_SIZES_IN.get(setup.paperSize) : undefined;
  const paperShort = paper ? pageShortSide(paper[0], paper[1]) : shortSide;
  const screenViewBox = Math.abs(paperShort - shortSide) < 1 ? viewBox : box(paperShort);
  return {
    orientation: portrait ? "portrait" : "landscape",
    viewBox,
    shortSide,
    screenViewBox,
    screenPixel: Math.max(screenViewBox.width / SCREEN_WIDTH_PX, screenViewBox.height / SCREEN_HEIGHT_PX),
  };
}

/** Page point (y up) → scene point (y down). */
export function toScene(x: number, y: number): Point {
  return { x, y: -y };
}

/** Axis-aligned box in scene units with non-negative width and height. */
export interface SceneRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Page area (any two opposite corners, y up) → scene rect: `x`/`y` is the
 * top-left corner on screen, i.e. the area's smallest x and largest page y.
 */
export function areaToRect(area: Pick<PageArea, "x1" | "y1" | "x2" | "y2">): SceneRect {
  const left = Math.min(area.x1, area.x2);
  const top = Math.max(area.y1, area.y2);
  const topLeft = toScene(left, top);
  return {
    x: topLeft.x,
    y: topLeft.y,
    width: Math.abs(area.x2 - area.x1),
    height: Math.abs(area.y2 - area.y1),
  };
}

/**
 * Scene matrix that draws a chart laid out on page `from` into a scene of
 * page `to` so that both fill the same 640 × 480 screen (assumptions.ts
 * BUTTON_CHART_ON_SCREEN): a uniform scale about the centre by the ratio of
 * their screen pixels. Null when the pixels are the same size.
 */
export function screenMapping(from: Pick<PageGeometry, "screenPixel">, to: Pick<PageGeometry, "screenPixel">): Matrix | null {
  const k = to.screenPixel / from.screenPixel;
  return Number.isFinite(k) && k > 0 && Math.abs(k - 1) > 1e-9 ? [k, 0, 0, k, 0, 0] : null;
}

/** A page box scaled by `k` about the page centre (0, 0). */
export function scaleBox(box: Box, k: number): Box {
  return { x1: box.x1 * k, y1: box.y1 * k, x2: box.x2 * k, y2: box.y2 * k };
}
