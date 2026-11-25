/**
 * Page geometry and the page → scene coordinate change (SPEC §6.1).
 *
 * Page coordinates have (0, 0) at the centre and y going UP; scene
 * coordinates (types.ts) have y going DOWN. This file is the only place the
 * y flip happens: every scene builder converts page points with `toScene`
 * and page areas with `areaToRect`.
 */
import { LANDSCAPE_VIEW_BOX, PORTRAIT_VIEW_BOX, type Point, type ViewBox } from "../../types";
import { PAGE_SHORT_SIDE } from "../assumptions";
import type { Chart, PageArea } from "../chart";

export type PageOrientation = "landscape" | "portrait";

export interface PageGeometry {
  orientation: PageOrientation;
  /** LANDSCAPE_VIEW_BOX or PORTRAIT_VIEW_BOX. */
  viewBox: ViewBox;
  /** Shorter side in page units (for text sizes, assumptions.ts). */
  shortSide: number;
}

/**
 * Orientation from record 816 (SPEC §5.2, §6.1): 2 is portrait, anything else
 * (1, an unknown code, or no 816) is landscape. parseChart already warns about
 * an unknown code.
 */
export function pageGeometry(chart: Pick<Chart, "pageSetup">): PageGeometry {
  const portrait = chart.pageSetup?.orientation === "portrait";
  return {
    orientation: portrait ? "portrait" : "landscape",
    viewBox: portrait ? PORTRAIT_VIEW_BOX : LANDSCAPE_VIEW_BOX,
    shortSide: PAGE_SHORT_SIDE,
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
