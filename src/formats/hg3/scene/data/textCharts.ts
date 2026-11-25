/**
 * Title and footnote text of every data chart (task 14), title charts and
 * bullet charts (task 15), laid out from their data (SPEC §5.3, §5.4, §5.5).
 * Fitted to the drawn copies of the sample charts; the guesses are in
 * assumptions.ts ("Tasks 14, 15, 19").
 */
import type { SceneElement } from "../../../types";
import {
  BULLET_MARKER_GAP_EM,
  BULLET_MARKER_TEXT,
  TITLE_SEPARATOR_LINE_STYLE,
  lineWidthFor,
  textSizeToUnits,
} from "../../assumptions";
import { effectiveStyle, styleEntryFor } from "../../chart";
import { DocumentType } from "../../container";
import { type BulletLine, parseBulletData, parseTitleData } from "../../data/bullet";
import { ROLE } from "../../palette";
import { type TextLine, Justification, TextSlot } from "../../text";
import type { ChartSceneContext } from "../context";
import { toScene } from "../page";
import {
  type Box,
  type StackRow,
  type StyledText,
  anchorX,
  baselineBelow,
  boxOf,
  drawStack,
  fitScale,
  pageBox,
  rowsByNumber,
  stackRows,
  textElement,
  textWidth,
} from "./text";

/** A text line with its effective style (the style table fills in what the line lacks). */
export function styled(ctx: ChartSceneContext, line: TextLine): StyledText {
  const s = effectiveStyle(line, styleEntryFor(ctx.chart, line));
  return { text: line.text, size: s.size, color: s.color, justification: s.justification, fontKey: s.fontKey };
}

/** Size of a blank row of `slot` at `row`: its style entry's size, else `fallback`. */
function blankSize(ctx: ChartSceneContext, slot: number, row: number, fallback: number): number {
  const entry = styleEntryFor(ctx.chart, { slot, row });
  return entry && entry.size > 0 ? entry.size : fallback;
}

const isBlank = (l: TextLine) => !l.text.trim();

/** Lines of a slot as stack rows (first to last non-blank row; gaps are blank). */
function slotRows(ctx: ChartSceneContext, lines: readonly TextLine[]): StackRow[] {
  return rowsByNumber(lines, isBlank).map((l) => (l ? styled(ctx, l) : null));
}

function slotLines(ctx: ChartSceneContext, slot: number): TextLine[] {
  return ctx.chart.textLines.filter((l) => l.slot === slot && l.column === 0).sort((a, b) => a.row - b.row);
}

// ---------------------------------------------------------------------------
// Title and footnote (task 14, SPEC §5.5 steps 2 and 3)
// ---------------------------------------------------------------------------

/**
 * Slot 1 (title, subtitles) stacked from the top of the title area, slot 2
 * (footnote) from the top of the footnote area, each justified in its area
 * (the frame when the area is missing, else the page). Data charts other
 * than title charts also get a line in role Lines along the bottom of the
 * title area, across the frame (every sample copy has one).
 */
export function drawTitleAndFootnote(ctx: ChartSceneContext): SceneElement[] {
  const { chart } = ctx;
  const frame = chart.areas.frame ? boxOf(chart.areas.frame) : pageBox(ctx);
  const out: SceneElement[] = [];
  const title = chart.areas.title ? boxOf(chart.areas.title) : frame;
  const titleRows = slotRows(ctx, slotLines(ctx, TextSlot.Title));
  if (titleRows.length) out.push(...drawStack(ctx, titleRows, title, title.top, blankSize(ctx, TextSlot.Title, 1, 0)).elements);

  if (chart.chartType !== DocumentType.Title && chart.areas.title) {
    const stroke = ctx.color(ROLE.Lines);
    if (stroke) {
      out.push({
        kind: "path",
        points: [toScene(frame.left, title.bottom), toScene(frame.right, title.bottom)],
        closed: false,
        fill: null,
        stroke,
        strokeWidth: lineWidthFor(TITLE_SEPARATOR_LINE_STYLE),
      });
    }
  }

  const footRows = slotRows(ctx, slotLines(ctx, TextSlot.Footnote));
  if (footRows.length) {
    const foot = chart.areas.footnote ? boxOf(chart.areas.footnote) : frame;
    out.push(...drawStack(ctx, footRows, foot, foot.top, blankSize(ctx, TextSlot.Footnote, 0, 0)).elements);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Title chart (task 15)
// ---------------------------------------------------------------------------

/**
 * Slot 7 in three sections (rows 0-3, 4-11, 12+; SPEC §5.4) in the page
 * frame: the top section stacked down from the frame top, the bottom
 * section stacked so that its last line ends at the frame bottom, and the
 * middle section centred between the two (between the frame edges when a
 * section is empty) [I]. Blank rows inside a section keep their pitch;
 * blank rows before the first and after the last line of a section do not
 * count.
 */
export function drawTitleChart(ctx: ChartSceneContext): SceneElement[] {
  const area: Box = ctx.chart.areas.frame
    ? boxOf(ctx.chart.areas.frame)
    : ctx.chart.areas.plot
      ? boxOf(ctx.chart.areas.plot)
      : pageBox(ctx);
  const data = parseTitleData(ctx.chart, []);
  const sections = data.sections.map((s) => {
    const rows = slotRows(ctx, s.lines);
    const blank = blankSize(ctx, TextSlot.TitleChart, s.startRow, rows.find((r) => r)?.size ?? 0);
    return { rows, blank, height: stackRows(ctx, rows, 0, blank).height };
  });
  const [top, middle, bottom] = sections as [(typeof sections)[0], (typeof sections)[0], (typeof sections)[0]];
  const out: SceneElement[] = [];
  let upper = area.top;
  if (top.rows.length) {
    const r = drawStack(ctx, top.rows, area, area.top, top.blank);
    out.push(...r.elements);
    upper = r.bottom;
  }
  let lower = area.bottom;
  if (bottom.rows.length) {
    lower = area.bottom + bottom.height;
    out.push(...drawStack(ctx, bottom.rows, area, lower, bottom.blank).elements);
  }
  if (middle.rows.length) {
    const midTop = (upper + lower) / 2 + middle.height / 2;
    out.push(...drawStack(ctx, middle.rows, area, midTop, middle.blank).elements);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Bullet chart (task 15)
// ---------------------------------------------------------------------------

/** Roman numeral of n (1 to 3999), upper case. */
export function roman(n: number): string {
  const table: [number, string][] = [
    [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"],
    [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
  ];
  let out = "";
  for (const [v, s] of table) {
    while (n >= v) {
      out += s;
      n -= v;
    }
  }
  return out;
}

/** The marker drawn before a bullet line (1108 shape; SPEC §5.4), or "" for none. */
export function bulletMarker(line: BulletLine): string {
  const e = line.entry;
  if (!e) return "";
  switch (e.shapeName) {
    case "bullet":
      return BULLET_MARKER_TEXT.bullet;
    case "triangle":
      return BULLET_MARKER_TEXT.triangle;
    case "number":
      return `${e.paragraph}.`;
    case "roman":
      return `${roman(e.paragraph)}.`;
    default:
      return "";
  }
}

/**
 * Slot 8 lines from the top of the plot area, one row per 1108 entry
 * (blank rows keep the blank pitch of the bullet style's size) [I]. Left
 * justified lines form one block (marker column, gap, widest line) centred
 * in the plot area, as in every sample copy; each marker is right-aligned
 * just before its line, in its 1108 colour role (16 = Bullet), at the
 * line's size and font. Centred and right-justified lines are placed in
 * the area with their marker just before them.
 */
export function drawBulletChart(ctx: ChartSceneContext): SceneElement[] {
  const area = ctx.chart.areas.plot ? boxOf(ctx.chart.areas.plot) : pageBox(ctx);
  const data = parseBulletData(ctx.chart, []);
  const byRow = rowsByNumber(data.lines.map((l) => ({ ...l, row: l.line.row })), (l) => isBlank(l.line));
  if (byRow.length === 0) return [];
  const natural: StackRow[] = byRow.map((l) => (l ? styled(ctx, l.line) : null));
  const naturalBlank = blankSize(ctx, TextSlot.BulletList, 0, natural.find((r) => r)?.size ?? 0);
  // Shrink every size by one factor when the list would run past the bottom of the area [I].
  const scaled = (k: number) => natural.map((r) => (r ? { ...r, size: r.size * k } : null));
  const k = fitScale((k) => stackRows(ctx, scaled(k), area.top, naturalBlank * k).bottom >= area.bottom);
  const rows = scaled(k);
  const { tops } = stackRows(ctx, rows, area.top, naturalBlank * k);

  const items = byRow.map((l, i) => {
    if (!l) return null;
    const t = rows[i]!;
    const marker = bulletMarker(l);
    const gap = l.entry && l.entry.shapeName !== "continuation" ? gapFor(ctx, l, t.size) : 0;
    return { t, marker, gap, markerWidth: marker ? textWidth(ctx, marker, t.fontKey, t.size) : 0, role: l.entry?.colorRole ?? ROLE.Bullet, top: tops[i]! };
  });
  const left = items.filter((it): it is NonNullable<typeof it> => it !== null && it.t.justification !== Justification.Centre && it.t.justification !== Justification.Right);
  const markerColumn = Math.max(0, ...left.map((it) => it.markerWidth + it.gap));
  const widest = Math.max(0, ...left.map((it) => textWidth(ctx, it.t.text, it.t.fontKey, it.t.size)));
  const textLeft = (area.left + area.right) / 2 - (markerColumn + widest) / 2 + markerColumn;

  const out: SceneElement[] = [];
  for (const it of items) {
    if (!it) continue;
    const baseline = baselineBelow(ctx, it.top, it.t.size);
    let lineLeft: number;
    let el: SceneElement | null;
    if (left.includes(it)) {
      lineLeft = textLeft;
      el = textElement(ctx, it.t, "start", textLeft, baseline);
    } else {
      const x = anchorX(area, it.t.justification);
      const w = textWidth(ctx, it.t.text, it.t.fontKey, it.t.size);
      lineLeft = it.t.justification === Justification.Right ? x - w : x - w / 2;
      el = textElement(ctx, it.t, it.t.justification === Justification.Right ? "end" : "middle", x, baseline);
    }
    if (it.marker) {
      const m = textElement(ctx, { ...it.t, text: it.marker, color: it.role }, "end", lineLeft - it.gap, baseline);
      if (m) out.push(m);
    }
    if (el) out.push(el);
  }
  return out;
}

/** Space between a marker and its line [I]: BULLET_MARKER_GAP_EM of the line's em, per marker kind. */
function gapFor(ctx: ChartSceneContext, line: BulletLine, size: number): number {
  const kind = line.entry?.shapeName ?? "none";
  const em = textSizeToUnits(size, ctx.page.shortSide);
  return (BULLET_MARKER_GAP_EM[kind as keyof typeof BULLET_MARKER_GAP_EM] ?? BULLET_MARKER_GAP_EM.none) * em;
}
