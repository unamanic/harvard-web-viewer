/**
 * Organization charts drawn from their data (task 18; SPEC §5.4, §6.2).
 *
 * Fitted to the drawn copies of the 7 sample org charts (GALD711-761,
 * ORGTUT); the values are in assumptions.ts ("Tasks 16, 18"):
 *
 * - Each box sits at the centre stored in its 914 record; every box has the
 *   size stored in 912 (two f64 percentages of the page's short side). A
 *   box with only a name is half as tall [I].
 * - 910 byte 0 is the box style: 2 square, 4 rounded corners, 6 a drop
 *   shadow; the corner / shadow size is ORG_CORNER_OF_HEIGHT of the box
 *   height. A shadowed box is drawn that much narrower and lower, shifted
 *   up-left, with its shadow (role Shadow) filling the rest of its cell.
 *   910 bytes 1 to 3 are the fill, outline and connector line roles.
 * - Connector lines (role Lines) follow the stored tree links: from each
 *   child's top up to halfway between the levels, across to the parent and
 *   up to its bottom.
 * - When 904 u16 at 2 is not 3, the last level is a list under its parent:
 *   a line down from the parent's left edge with a tick per entry, and the
 *   entry's text after it, without a box.
 * - Three text fields per box (name, title, comment) with their tails'
 *   colours, justification and font, stacked and centred in the box; every
 *   size is scaled by one factor (in steps of ORG_TEXT_SCALE_STEP) so that
 *   all box texts fit their boxes.
 */
import type { Point, SceneElement } from "../../../types";
import {
  BOX_CORNER_RADIUS_FACTOR,
  ORG_BOX_STYLE_ROUNDED,
  ORG_BOX_STYLE_SHADOW,
  ORG_CORNER_OF_HEIGHT,
  ORG_DEFAULT_BOX_HEIGHT_OF_PITCH,
  ORG_DEFAULT_BOX_WIDTH_OF_PITCH,
  ORG_LAST_LEVEL_BOXES,
  ORG_LINE_STYLE,
  ORG_LIST_TEXT_OF_TICK,
  ORG_LIST_TICK_OF_WIDTH,
  ORG_ROUNDED_MARGIN_OF_CORNER,
  ORG_TEXT_MARGIN_OF_WIDTH,
  ORG_TEXT_SCALE_MIN,
  ORG_TEXT_SCALE_STEP,
  ORG_TEXT_VMARGIN_OF_HEIGHT,
  lineWidthFor,
} from "../../assumptions";
import { type OrgBox, type OrgData, type OrgField, parseOrgData } from "../../data/org";
import { ROLE } from "../../palette";
import { Justification } from "../../text";
import type { ChartSceneContext } from "../context";
import { areaToRect, toScene } from "../page";
import { type Box, type StackRow, type StyledText, anchorOf, baselineBelow, boxOf, pageBox, stackRows, textElement, textWidth } from "./text";

/** Box style and colours from 910 (bytes 0 to 3) [I]. */
export interface OrgStyle {
  /** 2 square, 4 rounded, 6 shadowed. */
  boxStyle: number;
  fillRole: number;
  outlineRole: number;
  lineRole: number;
}

export function orgStyle(data: Pick<OrgData, "raw910">): OrgStyle {
  const r = data.raw910;
  const at = (i: number, fallback: number) => (r && r.length > i && r[i]! > 0 ? r[i]! : fallback);
  return { boxStyle: at(0, 2), fillRole: at(1, ROLE.FrameBkg), outlineRole: at(2, ROLE.Frame), lineRole: at(3, ROLE.Lines) };
}

function f64At(d: Uint8Array, at: number): number | null {
  if (d.length < at + 8) return null;
  const v = new DataView(d.buffer, d.byteOffset + at, 8).getFloat64(0, true);
  return Number.isFinite(v) && v > 0 && v < 1000 ? v : null;
}

/** Box width and height from 912 (f64 at 1 and 9, percent of the page's short side) [I], or null. */
export function storedBoxSize(data: Pick<OrgData, "raw912">, base: number): { width: number; height: number } | null {
  const r = data.raw912;
  if (!r) return null;
  const w = f64At(r, 1);
  const h = f64At(r, 9);
  return w && h ? { width: Math.round((w / 100) * base), height: Math.round((h / 100) * base) } : null;
}

/** Whether the last level is drawn as a list (904 u16 at 2 ≠ ORG_LAST_LEVEL_BOXES) [I]. */
export function lastLevelIsList(data: Pick<OrgData, "raw904">): boolean {
  const r = data.raw904;
  if (!r || r.length < 4) return false;
  return (r[2]! | (r[3]! << 8)) !== ORG_LAST_LEVEL_BOXES;
}

const fieldsOf = (b: OrgBox): (OrgField | null)[] => [b.name, b.title, b.comment];
const filled = (f: OrgField | null): f is OrgField => !!f && f.text.trim().length > 0;

// ---------------------------------------------------------------------------
// Positions
// ---------------------------------------------------------------------------

/** Box centres: the stored ones, or (when any box lacks them) a simple tree layout in the plot area. */
function centres(ctx: ChartSceneContext, data: OrgData, plot: Box): { points: Point[]; pitchX: number; pitchY: number } {
  const stored = data.boxes.every((b) => b.links) && data.boxes.some((b) => b.links!.x !== 0 || b.links!.y !== 0);
  if (stored) {
    const points = data.boxes.map((b) => ({ x: b.links!.x, y: b.links!.y }));
    const xs = [...new Set(points.map((p) => p.x))].sort((a, b) => a - b);
    const ys = [...new Set(data.boxes.map((b) => b.level))].sort((a, b) => a - b).map((lv) => {
      const at = data.boxes.filter((b) => b.level === lv).map((b) => b.links!.y);
      return Math.max(...at);
    });
    const gaps = (v: number[]) => v.slice(1).map((x, i) => Math.abs(x - v[i]!)).filter((g) => g > 0);
    const pitchX = Math.min(...gaps(xs), plot.right - plot.left);
    const pitchY = Math.min(...gaps(ys), plot.top - plot.bottom);
    return { points, pitchX, pitchY };
  }
  if (data.boxes.length) ctx.warn("org boxes lack stored positions; laid out as a simple tree");
  // Leaves spread evenly, parents centred over their children, levels evenly down the plot area.
  const leaves: number[] = [];
  const visit = (i: number, depth = 0) => {
    const b = data.boxes[i]!;
    if (b.children.length === 0 || depth > data.boxes.length) leaves.push(i);
    else b.children.forEach((c) => visit(c, depth + 1));
  };
  data.roots.forEach((r) => visit(r));
  const levels = Math.max(1, ...data.boxes.map((b) => b.level));
  const pitchX = (plot.right - plot.left) / Math.max(1, leaves.length);
  const pitchY = (plot.top - plot.bottom) / levels;
  const xs = new Map<number, number>();
  leaves.forEach((i, k) => xs.set(i, plot.left + (k + 0.5) * pitchX));
  const xOf = (i: number, depth = 0): number => {
    const known = xs.get(i);
    if (known !== undefined) return known;
    const kids = data.boxes[i]!.children;
    const x = depth > data.boxes.length || !kids.length ? 0 : (xOf(kids[0]!, depth + 1) + xOf(kids[kids.length - 1]!, depth + 1)) / 2;
    xs.set(i, x);
    return x;
  };
  const points = data.boxes.map((b, i) => ({ x: xOf(i), y: plot.top - (Math.max(1, b.level) - 0.5) * pitchY }));
  return { points, pitchX, pitchY };
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

interface PlacedBox {
  box: OrgBox;
  /** Stored centre. */
  x: number;
  y: number;
  /** Cell height (the stored height, halved for a name-only box). */
  height: number;
  /** Drawn box in page units (without the shadow). */
  drawn: Box;
  list: boolean;
}

function rowsOf(box: OrgBox, k: number): StackRow[] {
  const fields = fieldsOf(box);
  const used = fields.map((f, i) => (filled(f) ? i : -1)).filter((i) => i >= 0);
  if (!used.length) return [];
  const rows: StackRow[] = [];
  for (let i = used[0]!; i <= used[used.length - 1]!; i++) {
    const f = fields[i];
    rows.push(filled(f) ? styledField(f, k) : null);
  }
  return rows;
}

function styledField(f: OrgField, k: number): StyledText {
  return { text: f.text.trim(), size: f.tail.size * k, color: f.tail.color, justification: f.tail.justification || Justification.Left, fontKey: f.tail.fontKey };
}

/** Horizontal text inset in a drawn box [I]. */
function textMargin(style: OrgStyle, drawnWidth: number, corner: number): number {
  return ORG_TEXT_MARGIN_OF_WIDTH * drawnWidth + (style.boxStyle === ORG_BOX_STYLE_ROUNDED ? ORG_ROUNDED_MARGIN_OF_CORNER * corner : 0);
}

/** Rows drawn as one block centred vertically on `centreY`, each line placed in [left, right] by its justification. */
function drawRows(ctx: ChartSceneContext, rows: StackRow[], left: number, right: number, centreY: number): SceneElement[] {
  const blank = rows.find((r) => r)?.size ?? 0;
  const { tops, height } = stackRows(ctx, rows, 0, blank);
  const top = centreY + height / 2;
  const out: SceneElement[] = [];
  rows.forEach((row, i) => {
    if (!row) return;
    const anchor = anchorOf(row.justification);
    const x = anchor === "middle" ? (left + right) / 2 : anchor === "end" ? right : left;
    const el = textElement(ctx, row, anchor, x, baselineBelow(ctx, top + tops[i]!, row.size));
    if (el) out.push(el);
  });
  return out;
}

function rect(b: Box, fill: string | null, stroke: string | null, strokeWidth: number, radius = 0): SceneElement {
  return {
    kind: "rect",
    ...areaToRect({ x1: b.left, y1: b.bottom, x2: b.right, y2: b.top }),
    ...(radius > 0 ? { corners: { kind: "rounded" as const, radius } } : {}),
    fill,
    stroke,
    strokeWidth,
  };
}

function line(points: Point[], stroke: string, strokeWidth: number): SceneElement {
  return { kind: "path", points: points.map((p) => toScene(p.x, p.y)), closed: false, fill: null, stroke, strokeWidth };
}

export function drawOrgChart(ctx: ChartSceneContext): SceneElement[] {
  const data = parseOrgData(ctx.chart, []);
  if (data.boxes.length === 0) return [];
  const plot = ctx.chart.areas.plot ? boxOf(ctx.chart.areas.plot) : pageBox(ctx);
  const style = orgStyle(data);
  const { points, pitchX, pitchY } = centres(ctx, data, plot);
  const size = storedBoxSize(data, ctx.page.shortSide) ?? {
    width: ORG_DEFAULT_BOX_WIDTH_OF_PITCH * pitchX,
    height: ORG_DEFAULT_BOX_HEIGHT_OF_PITCH * pitchY,
  };
  const corner = style.boxStyle === ORG_BOX_STYLE_ROUNDED || style.boxStyle === ORG_BOX_STYLE_SHADOW ? Math.trunc(ORG_CORNER_OF_HEIGHT * size.height) : 0;
  const shadow = style.boxStyle === ORG_BOX_STYLE_SHADOW ? corner : 0;
  const maxLevel = Math.max(...data.boxes.map((b) => b.level));
  const listLast = lastLevelIsList(data) && maxLevel > 1;

  const placed: PlacedBox[] = data.boxes.map((box, i) => {
    const { x, y } = points[i]!;
    const nameOnly = filled(box.name) && !filled(box.title) && !filled(box.comment);
    const height = nameOnly ? size.height / 2 : size.height;
    const drawn: Box = {
      left: x - size.width / 2,
      right: x + size.width / 2 - shadow,
      top: y + height / 2,
      bottom: y - height / 2 + shadow,
    };
    return { box, x, y, height, drawn, list: listLast && box.level === maxLevel && box.children.length === 0 };
  });

  // One text scale for the chart: the largest step at which every box's text fits [I].
  const fits = (k: number) =>
    placed.every((p) => {
      if (p.list) return true;
      const rows = rowsOf(p.box, k);
      if (!rows.length) return true;
      const w = p.drawn.right - p.drawn.left;
      const h = p.drawn.top - p.drawn.bottom;
      const room = w - 2 * textMargin(style, w, corner);
      const blank = rows.find((r) => r)?.size ?? 0;
      return (
        rows.every((r) => !r || textWidth(ctx, r.text, r.fontKey, r.size) <= room) &&
        stackRows(ctx, rows, 0, blank).height <= h * (1 - 2 * ORG_TEXT_VMARGIN_OF_HEIGHT)
      );
    });
  let k = 1;
  while (k > ORG_TEXT_SCALE_MIN && !fits(k)) k = Math.round((k - ORG_TEXT_SCALE_STEP) * 1000) / 1000;

  const strokeWidth = lineWidthFor(ORG_LINE_STYLE);
  const fill = ctx.color(style.fillRole);
  const outline = ctx.color(style.outlineRole);
  const lineColor = ctx.color(style.lineRole);
  const shadowColor = ctx.color(ROLE.Shadow);
  const boxes: SceneElement[] = [];
  const lines: SceneElement[] = [];
  const texts: SceneElement[] = [];
  const cellBottom = (p: PlacedBox) => p.y - p.height / 2;
  const attachBottom = (p: PlacedBox) => cellBottom(p) + shadow / 2;

  for (const p of placed) {
    const w = p.drawn.right - p.drawn.left;
    const margin = textMargin(style, w, corner);
    const rows = rowsOf(p.box, k);
    if (p.list) {
      const parent = p.box.parent !== null ? placed[p.box.parent] : undefined;
      const cellLeft = (parent?.x ?? p.x) - size.width / 2;
      const left = cellLeft + margin + ORG_LIST_TEXT_OF_TICK * ORG_LIST_TICK_OF_WIDTH * size.width;
      // List entries show only the name (ORGTUT's comment is not drawn), moved up with the shadow shift [I].
      const name = filled(p.box.name) ? [styledField(p.box.name, k)] : [];
      texts.push(...drawRows(ctx, name, left, left + w - 2 * margin, p.y + shadow / 2));
      continue;
    }
    if (shadow > 0 && shadowColor) {
      boxes.push(rect({ left: p.drawn.left + shadow, right: p.drawn.right + shadow, top: p.drawn.top - shadow, bottom: p.drawn.bottom - shadow }, shadowColor, null, 0));
    }
    boxes.push(rect(p.drawn, fill, outline, strokeWidth, style.boxStyle === ORG_BOX_STYLE_ROUNDED ? corner * BOX_CORNER_RADIUS_FACTOR : 0));
    texts.push(...drawRows(ctx, rows, p.drawn.left + margin, p.drawn.right - margin, (p.drawn.top + p.drawn.bottom) / 2));
  }

  if (lineColor) {
    for (const parent of placed) {
      const kids = parent.box.children.map((c) => placed[c]!).filter(Boolean);
      const boxed = kids.filter((c) => !c.list);
      boxed.forEach((c, i) => {
        const mid = Math.trunc((cellBottom(parent) + c.y + c.height / 2) / 2);
        const pts = [{ x: c.x, y: c.y + c.height / 2 }, { x: c.x, y: mid }, { x: parent.x, y: mid }];
        if (i === 0) pts.push({ x: parent.x, y: attachBottom(parent) });
        lines.push(line(pts, lineColor, strokeWidth));
      });
      const listed = kids.filter((c) => c.list);
      if (listed.length) {
        const x = parent.x - size.width / 2 + shadow / 2;
        const lowest = Math.min(...listed.map((c) => c.y));
        // The copies end this line half the shadow (shadowed) or the whole corner size (rounded) above the cell bottom [I].
        const listTop = cellBottom(parent) + (style.boxStyle === ORG_BOX_STYLE_ROUNDED ? corner : shadow / 2);
        lines.push(line([{ x, y: lowest }, { x, y: listTop }], lineColor, strokeWidth));
        const tick = ORG_LIST_TICK_OF_WIDTH * size.width;
        for (const c of listed) lines.push(line([{ x, y: c.y }, { x: x + tick, y: c.y }], lineColor, strokeWidth));
      }
    }
  }
  return [...boxes, ...lines, ...texts];
}
