/**
 * Text layout for charts drawn from their data (task 14; SPEC §5.3, §5.5
 * steps 2 and 3, §6.4).
 *
 * Lines are stacked from the top of an area; each line's box height comes
 * from its size, its x from its justification relative to the area, its
 * colour from its colour role and its glyphs from the same pipeline as
 * object-layer text (textFaces.ts: original font, clone or CSS look-alike).
 * The metrics are fitted to the drawn copies the sample charts store (see
 * assumptions.ts, "Tasks 14, 15, 19").
 *
 * All positions here are PAGE coordinates (y up); elements are converted
 * with `toScene` (page.ts) when they are made.
 */
import { EM_UNITS, layoutGlyphLine } from "../../../../fonts/glyphRun";
import type { SceneElement, TextAnchor, TextElement } from "../../../../model/scene";
import {
  DATA_BLANK_ROW_HEIGHT,
  DATA_FIT_MIN_SCALE,
  DATA_ROW_OVERLAP,
  DATA_TEXT_BOX_FACTOR,
  DATA_TEXT_BOX_STEP,
  DATA_TEXT_CHAR_EXTRA,
  DATA_TEXT_CSS_ADVANCE_EM,
  ascent305,
  layoutEm305,
  lineBox305,
  textSizeToUnits,
} from "../../assumptions";
import type { PageArea } from "../../chart";
import { hg3CodeOf } from "../../../charset";
import type { FontKey } from "../../../../fonts/fontKey";
import { Justification } from "../../text";
import type { ChartSceneContext } from "../context";
import { advanceRounder, glyphLineElement } from "../objectLayer";
import { toScene } from "../page";

/** A line to draw: text and the values it is drawn with (effectiveStyle). */
export interface StyledText {
  text: string;
  /** Stored size (SPEC §6.4). */
  size: number;
  /** Colour role (SPEC §6.2). */
  color: number;
  justification: number;
  fontKey: FontKey;
}

/** An area in page coordinates, normalised (left < right, bottom < top). */
export interface Box {
  left: number;
  right: number;
  bottom: number;
  top: number;
}

export function boxOf(area: Pick<PageArea, "x1" | "y1" | "x2" | "y2">): Box {
  return {
    left: Math.min(area.x1, area.x2),
    right: Math.max(area.x1, area.x2),
    bottom: Math.min(area.y1, area.y2),
    top: Math.max(area.y1, area.y2),
  };
}

/** The page as a box (from the scene viewBox, flipped back to page y). */
export function pageBox(ctx: ChartSceneContext): Box {
  const { minX, minY, width, height } = ctx.page.viewBox;
  return { left: minX, right: minX + width, top: -minY, bottom: -(minY + height) };
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

/**
 * Em of a size for the layout (page units): size % of the page's short
 * side from 816 (24576 on a 10 × 7.5 in page, 25321 on Letter), rounded
 * down as Harvard Graphics 3.05 stores it (assumptions.ts layoutEm305).
 */
export function layoutEm(ctx: ChartSceneContext, size: number): number {
  return layoutEm305(size, ctx.page.shortSide);
}

/**
 * Height of a text line's box (page units) as Harvard Graphics 3.05 lays
 * a chart out, on every page size: (1.25 × em + 50) rounded up to a
 * multiple of 100 (assumptions.ts lineBox305).
 */
export function lineBoxHeight(ctx: ChartSceneContext, size: number): number {
  return lineBox305(layoutEm(ctx, size));
}

/**
 * Line box height by the rule fitted to the sample copies, which an older
 * build laid out (floor(DATA_TEXT_BOX_FACTOR × em / 100) × 100). Only for
 * object-layer text blocks that store no line entries (objectLayer.ts).
 */
export function legacyLineBoxHeight(ctx: ChartSceneContext, size: number): number {
  const raw = DATA_TEXT_BOX_FACTOR * textSizeToUnits(size, ctx.page.shortSide);
  return DATA_TEXT_BOX_STEP > 0 ? Math.floor(raw / DATA_TEXT_BOX_STEP) * DATA_TEXT_BOX_STEP : raw;
}

/** Height a row takes in a stack: a text row's box height, or a blank row's (DATA_BLANK_ROW_HEIGHT ems of its style's size). */
export function rowHeight(ctx: ChartSceneContext, size: number, blank: boolean): number {
  return blank ? DATA_BLANK_ROW_HEIGHT * layoutEm(ctx, size) : lineBoxHeight(ctx, size);
}

/** Baseline of a line whose box top is `top` (page y): the 3.05 ascent below it (assumptions.ts ascent305). */
export function baselineBelow(ctx: ChartSceneContext, top: number, size: number): number {
  return top - ascent305(layoutEm(ctx, size));
}

/** Byte codes of a decoded string (characters outside the HG3 set become "?"). */
export function codesOf(text: string): number[] {
  return Array.from(text, (ch) => hg3CodeOf(ch) ?? 0x3f);
}

/** Advance of a line as drawn (glyph advances, or an estimate for CSS text), page units. */
export function drawnAdvance(ctx: ChartSceneContext, text: string, fontKey: FontKey, size: number): number {
  const em = layoutEm(ctx, size);
  const { glyphs } = ctx.faces.faceFor(fontKey);
  if (!glyphs) return text.length * DATA_TEXT_CSS_ADVANCE_EM * em;
  return (layoutGlyphLine(glyphs, codesOf(text), advanceRounder(em, ctx.page.screenPixel)).advance * em) / EM_UNITS;
}

/**
 * Width the original gives a line's box, page units: the drawn advance plus
 * DATA_TEXT_CHAR_EXTRA per character.
 */
export function textWidth(ctx: ChartSceneContext, text: string, fontKey: FontKey, size: number): number {
  return drawnAdvance(ctx, text, fontKey, size) + text.length * DATA_TEXT_CHAR_EXTRA;
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

export function anchorOf(justification: number): TextAnchor {
  if (justification === Justification.Centre) return "middle";
  if (justification === Justification.Right) return "end";
  return "start";
}

/**
 * One text line with its anchor point at page (x, baseline): glyphs from
 * the line's font (original, clone) or a CSS text element. Null when the
 * text is blank or its colour role is 0 ("none").
 */
export function textElement(
  ctx: ChartSceneContext,
  t: Pick<StyledText, "text" | "size" | "color" | "fontKey">,
  anchor: TextAnchor,
  x: number,
  baseline: number,
): SceneElement | null {
  if (!t.text.trim()) return null;
  const fill = ctx.color(t.color);
  if (!fill) return null;
  const size = layoutEm(ctx, t.size);
  const p = toScene(x, baseline);
  const face = ctx.faces.faceFor(t.fontKey);
  if (face.glyphs) return glyphLineElement(face.glyphs, t.text, codesOf(t.text), fill, anchor, p.x, p.y, size, ctx.page.screenPixel);
  const { font } = face;
  return {
    kind: "text",
    x: p.x,
    y: p.y,
    size,
    text: t.text,
    fill,
    fontFamily: font.cssFamily,
    fontWeight: font.weight,
    italic: font.italic,
    anchor,
  } satisfies TextElement;
}

/** x of a line's anchor in `box` for its justification. */
export function anchorX(box: Pick<Box, "left" | "right">, justification: number): number {
  const anchor = anchorOf(justification);
  return anchor === "middle" ? (box.left + box.right) / 2 : anchor === "end" ? box.right : box.left;
}

/** A row of a stack: a line, or null for a blank row of `blankSize`. */
export type StackRow = StyledText | null;

/** Rows from the first to the last non-blank one, by row number; gaps are blank rows. */
export function rowsByNumber<T extends { row: number }>(lines: readonly T[], blank: (line: T) => boolean): (T | null)[] {
  const used = lines.filter((l) => !blank(l));
  if (used.length === 0) return [];
  const first = Math.min(...used.map((l) => l.row));
  const last = Math.max(...used.map((l) => l.row));
  const out: (T | null)[] = [];
  for (let r = first; r <= last; r++) out.push(used.find((l) => l.row === r) ?? null);
  return out;
}

/** Top of each row (page y) when the first row's box top is `top`, and the bottom of the last text box. */
export function stackRows(
  ctx: ChartSceneContext,
  rows: readonly StackRow[],
  top: number,
  blankSize: number,
): { tops: number[]; bottom: number; height: number } {
  const heights = rows.map((row) => (row ? rowHeight(ctx, row.size, false) : rowHeight(ctx, blankSize, true)));
  const tops = stackTops(heights, top);
  let bottom = top;
  rows.forEach((row, i) => {
    if (row) bottom = tops[i]! - heights[i]!;
  });
  return { tops, bottom, height: top - bottom };
}

/**
 * Tops (page or object y, up) of boxes of the given heights stacked from
 * `top`: each box overlaps the previous one by DATA_ROW_OVERLAP of its own
 * height (task 14), i.e. top(next) = top(prev) − height(prev) + 0.15 ×
 * height(next). Also used for object-layer text blocks (task 13d).
 */
export function stackTops(heights: readonly number[], top: number): number[] {
  const tops: number[] = [];
  let y = top;
  heights.forEach((h, i) => {
    if (i > 0) y -= heights[i - 1]! - DATA_ROW_OVERLAP * h;
    tops.push(y);
  });
  return tops;
}

/**
 * Lay out `rows` in `box` from its top (task 14): each text row's box is
 * justified in the box's width; blank rows take the blank pitch of
 * `blankSize`. Returns the elements and the bottom of the last text box.
 */
export function drawStack(
  ctx: ChartSceneContext,
  rows: readonly StackRow[],
  box: Box,
  top: number = box.top,
  blankSize = rows.find((r) => r)?.size ?? 0,
): { elements: SceneElement[]; bottom: number } {
  const { tops, bottom } = stackRows(ctx, rows, top, blankSize);
  const elements: SceneElement[] = [];
  rows.forEach((row, i) => {
    if (!row) return;
    const el = textElement(ctx, row, anchorOf(row.justification), anchorX(box, row.justification), baselineBelow(ctx, tops[i]!, row.size));
    if (el) elements.push(el);
  });
  return { elements, bottom };
}

/**
 * Largest factor k in [DATA_FIT_MIN_SCALE, 1] for which `fits(k)` holds
 * (1 when it already fits, DATA_FIT_MIN_SCALE when nothing does), found by
 * bisection: used to shrink text that would overflow its area [I].
 */
export function fitScale(fits: (k: number) => boolean): number {
  if (fits(1)) return 1;
  let lo = DATA_FIT_MIN_SCALE;
  let hi = 1;
  if (!fits(lo)) return lo;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}
