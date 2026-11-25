/**
 * Page geometry and the page → scene coordinate change (SPEC §6.1).
 *
 * Page coordinates have (0, 0) at the centre and y going UP; scene
 * coordinates (types.ts) have y going DOWN. This file is the only place the
 * y flip happens: every scene builder converts page points with `toScene`
 * and page areas with `areaToRect`.
 */
import { type Point, type ViewBox, centredViewBox } from "../../types";
import { PAGE_LONG_SIDE, pageShortSide } from "../assumptions";
import type { Chart, PageArea } from "../chart";

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
}

/**
 * Page geometry from record 816 (SPEC §5.2, §6.1; assumptions.ts
 * pageShortSide): orientation 2 is portrait, anything else (1, an unknown
 * code, or no 816) landscape; the short side follows the 816 width and
 * height (4:3 when missing or odd). parseChart already warns about an
 * unknown orientation code.
 */
export function pageGeometry(chart: Pick<Chart, "pageSetup">): PageGeometry {
  const setup = chart.pageSetup;
  const portrait = setup?.orientation === "portrait";
  const shortSide = pageShortSide(setup?.widthIn, setup?.heightIn);
  const shortExtent = 2 * Math.round(shortSide / 2);
  return {
    orientation: portrait ? "portrait" : "landscape",
    viewBox: portrait ? centredViewBox(shortExtent, PAGE_LONG_SIDE) : centredViewBox(PAGE_LONG_SIDE, shortExtent),
    shortSide,
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
