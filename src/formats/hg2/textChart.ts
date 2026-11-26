/**
 * Text charts: title, simple list, bullet list, two- and three-column
 * charts and free form (SPEC §2.2, §4.1). Lines are numbered as stored.
 */
import type { SceneElement, TextAnchor } from "../../model/scene";
import { DEFAULT_SIZES, MARGIN_X, MARGIN_Y, PAGE, classicColor, sizeToUnits } from "./assumptions";
import type { ClassicChart, ClassicText } from "./model";
import { drawLine, hasText, plainText, textWidth } from "./text";

const MAX_WIDTH = PAGE.width - 2 * MARGIN_X;

function sizeOf(line: ClassicText | undefined, fallback: number): number {
  return sizeToUnits(line && line.size > 0 ? line.size : fallback);
}

function anchorX(place: ClassicText["place"]): { x: number; anchor: TextAnchor } {
  if (place === "left") return { x: PAGE.left + MARGIN_X, anchor: "start" };
  if (place === "right") return { x: PAGE.right - MARGIN_X, anchor: "end" };
  return { x: 0, anchor: "middle" };
}

function placed(line: ClassicText, y: number, size: number): SceneElement[] {
  const { x, anchor } = anchorX(line.place);
  return drawLine(line, { x, y, size, anchor, maxWidth: MAX_WIDTH });
}

/** Lines first..last that have text, with their sizes. */
function present(lines: ClassicText[], first: number, last: number, fallback: number) {
  const out: { line: ClassicText; size: number; k: number }[] = [];
  for (let k = first; k <= last; k++) {
    const line = lines[k];
    if (hasText(line)) out.push({ line, size: sizeOf(line, fallback), k });
  }
  return out;
}

/** Title (line 0), subtitle (1) and footnote (2) of list, bullet, column and free-form charts; returns the body's top and bottom. */
function heading(lines: ClassicText[], out: SceneElement[]): { top: number; bottom: number } {
  let top = PAGE.top + MARGIN_Y;
  for (const [k, fallback] of [
    [0, DEFAULT_SIZES.title],
    [1, DEFAULT_SIZES.subtitle],
  ] as const) {
    const line = lines[k];
    if (!hasText(line)) continue;
    const size = sizeOf(line, fallback);
    top += size;
    out.push(...placed(line, top, size));
    top += size * 0.4;
  }
  let bottom = PAGE.bottom - MARGIN_Y;
  const foot = lines[2];
  if (hasText(foot)) {
    const size = sizeOf(foot, DEFAULT_SIZES.footnote);
    out.push(...drawLine(foot, { x: PAGE.left + MARGIN_X, y: bottom, size, anchor: "start", maxWidth: MAX_WIDTH }));
    bottom -= size * 1.6;
  }
  return { top: top + sizeToUnits(2), bottom };
}

/** Lays out stacked rows between top and bottom, shrinking them all if they do not fit. */
function stack(rows: { size: number }[], top: number, bottom: number, gap = 1.5): { ys: number[]; scale: number } {
  const needed = rows.reduce((h, r) => h + r.size * gap, 0);
  const scale = needed > bottom - top && needed > 0 ? (bottom - top) / needed : 1;
  const ys: number[] = [];
  let y = top;
  for (const r of rows) {
    y += r.size * scale;
    ys.push(y);
    y += r.size * scale * (gap - 1);
  }
  return { ys, scale };
}

function titleChart(lines: ClassicText[]): SceneElement[] {
  const out: SceneElement[] = [];
  const blocks: [number, number][] = [
    [0, 2],
    [3, 5],
    [6, 8],
  ];
  const third = PAGE.height / 3;
  blocks.forEach(([first, last], b) => {
    const rows = present(lines, first, last, first === 0 ? DEFAULT_SIZES.title : DEFAULT_SIZES.subtitle);
    if (rows.length === 0) return;
    const height = rows.reduce((h, r) => h + r.size * 1.4, 0);
    const blockTop = PAGE.top + b * third;
    const top = b === 0 ? blockTop + MARGIN_Y : b === 1 ? blockTop + (third - height) / 2 : blockTop + third - MARGIN_Y - height;
    const { ys, scale } = stack(rows, top, blockTop + third, 1.4);
    rows.forEach((r, k) => out.push(...placed(r.line, ys[k], r.size * scale)));
  });
  return out;
}

function listChart(lines: ClassicText[], bullets: boolean): SceneElement[] {
  const out: SceneElement[] = [];
  const { top, bottom } = heading(lines, out);
  const rows = present(lines, 3, lines.length - 1, DEFAULT_SIZES.body);
  const { ys, scale } = stack(rows, top, bottom);
  // The body is one block, centred on the page by its widest line (as the program centres a list) [I].
  const widest = Math.max(0, ...rows.map((r) => textWidth(r.line.text.trimEnd(), r.size * scale) + (bullets ? r.size * scale * 1.2 : 0)));
  const left = Math.max(PAGE.left + MARGIN_X, -widest / 2);
  rows.forEach((r, k) => {
    const size = r.size * scale;
    let x = left;
    if (bullets) {
      out.push(plainText("•", x, ys[k], size, classicColor(r.line.attrs[0] !== undefined ? (r.line.attrs[0] >> 4) + 1 : 1), "start"));
      x += size * 1.2;
    }
    if (r.line.place === "left" || bullets) {
      out.push(...drawLine(r.line, { x, y: ys[k], size, anchor: "start", maxWidth: PAGE.right - MARGIN_X - x }));
    } else out.push(...placed(r.line, ys[k], size));
  });
  return out;
}

function columnChart(lines: ClassicText[], columns: number): SceneElement[] {
  const out: SceneElement[] = [];
  const { top, bottom } = heading(lines, out);
  // [I] Column headers are lines 3..3+n-1; then rows of n cells.
  let lastRow = 0;
  for (let k = 3 + columns; k < lines.length; k++) if (hasText(lines[k])) lastRow = Math.floor((k - 3) / columns);
  const rowCount = lastRow + 1;
  const rows: { size: number; cells: (ClassicText | undefined)[] }[] = [];
  for (let r = 0; r < rowCount; r++) {
    const cells = Array.from({ length: columns }, (_, c) => lines[3 + r * columns + c]);
    const size = Math.max(...cells.map((c) => (hasText(c) ? sizeOf(c, DEFAULT_SIZES.body) : 0)), r === 0 ? 0 : sizeToUnits(DEFAULT_SIZES.body * 0.5));
    rows.push({ size: size || sizeToUnits(DEFAULT_SIZES.body), cells });
  }
  const { ys, scale } = stack(rows, top, bottom);
  const colWidth = MAX_WIDTH / columns;
  rows.forEach((row, r) => {
    row.cells.forEach((cell, c) => {
      if (!hasText(cell)) return;
      const left = PAGE.left + MARGIN_X + c * colWidth;
      const size = row.size * scale;
      const anchor: TextAnchor = cell.place === "left" ? "start" : cell.place === "right" ? "end" : "middle";
      const x = anchor === "start" ? left + size * 0.3 : anchor === "end" ? left + colWidth - size * 0.3 : left + colWidth / 2;
      // Headers (row 0) are underlined (SPEC §4.1).
      const line = r === 0 ? { ...cell, attrs: Array.from(cell.text, (_, i) => (cell.attrs[i] ?? 0) | 0x08) } : cell;
      out.push(...drawLine(line, { x, y: ys[r], size, anchor, maxWidth: colWidth * 0.95 }));
    });
  });
  return out;
}

function freeForm(lines: ClassicText[]): SceneElement[] {
  const out: SceneElement[] = [];
  let last = -1;
  lines.forEach((l, k) => {
    if (hasText(l)) last = k;
  });
  if (last < 0) return out;
  const rows = lines.slice(0, last + 1).map((line, k) => ({ line, size: sizeOf(line, k === 0 ? DEFAULT_SIZES.title : DEFAULT_SIZES.body) }));
  const { ys, scale } = stack(
    rows.map((r) => ({ size: hasText(r.line) ? r.size : r.size * 0.6 })),
    PAGE.top + MARGIN_Y,
    PAGE.bottom - MARGIN_Y,
    1.3,
  );
  rows.forEach((r, k) => out.push(...placed(r.line, ys[k], r.size * scale)));
  return out;
}

export function drawTextChart(chart: ClassicChart): SceneElement[] {
  const lines = chart.textLines;
  switch (chart.kind) {
    case "title":
      return titleChart(lines);
    case "list":
      return listChart(lines, false);
    case "bullet":
      return listChart(lines, true);
    case "columns":
      return columnChart(lines, chart.subtype === 4 ? 3 : 2);
    default:
      return freeForm(lines);
  }
}
