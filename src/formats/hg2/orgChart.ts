/**
 * Organization charts (SPEC §2.5, §4.6): a box per person, upper levels
 * side by side, the last level stacked under its manager when the chart
 * asks for it. The layout is the viewer's own [I].
 */
import type { SceneElement } from "../types";
import { classicColor, sizeToUnits } from "./assumptions";
import type { Box } from "./graph";
import type { OrgData, OrgNode } from "./model";
import { plainText, textWidth } from "./text";

interface Laid {
  node: OrgNode;
  children: Laid[];
  /** Children drawn as a vertical stack under this box. */
  stacked: boolean;
  columns: number;
  /** Rows below this box (stacked children count one row each). */
  rows: number;
}

function lay(node: OrgNode, depth: number, levels: number, vertical: boolean, seen: Set<number>): Laid {
  seen.add(node.id);
  const visible = levels === 0 || depth + 1 < levels ? node.children.filter((c) => !seen.has(c.id)) : [];
  const children = visible.map((c) => lay(c, depth + 1, levels, vertical, seen));
  const stacked = vertical && children.length > 0 && children.every((c) => c.children.length === 0);
  const columns = stacked || children.length === 0 ? 1 : children.reduce((s, c) => s + c.columns, 0);
  const rows = children.length === 0 ? 0 : stacked ? children.length : 1 + Math.max(...children.map((c) => c.rows));
  return { node, children, stacked, columns, rows };
}

const LINE = 40;

export function drawOrg(org: OrgData, area: Box): SceneElement[] {
  const out: SceneElement[] = [];
  if (!org.root) return out;
  const o = org.options;
  const tree = lay(org.root, 0, o.levels, o.lastLevelVertical, new Set());
  const totalRows = tree.rows + 1;
  const width = area.right - area.left;
  const height = area.bottom - area.top;
  const colW = width / tree.columns;
  const rowH = height / totalRows;
  const boxW = Math.min(colW * 0.86, width * 0.3);
  const boxH = Math.min(rowH * 0.7, height * 0.25);
  const color = classicColor(1);

  const linesFor = (node: OrgNode, last: boolean) => {
    const lines: { text: string; size: number; style: number; color: number }[] = [];
    const name = last && o.abbreviations && node.abbreviation.trim() ? node.abbreviation : node.name;
    lines.push({ text: name, size: o.nameSize, style: o.nameStyle, color: o.nameColor });
    if ((last ? o.titlesLast : o.titlesUpper) && node.title.trim()) lines.push({ text: node.title, size: o.titleSize, style: o.titleStyle, color: o.titleColor });
    if ((last ? o.commentsLast : o.commentsUpper) && node.comment.trim()) lines.push({ text: node.comment, size: o.commentSize, style: o.commentStyle, color: o.commentColor });
    // Text lines per box (tail +22 upper levels, +23 last level; SPEC §4.6).
    return lines.slice(0, Math.max(1, last ? o.linesLast : o.linesUpper));
  };

  const box = (node: OrgNode, cx: number, top: number, last: boolean) => {
    if (o.shadow) {
      const d = boxH * 0.08;
      out.push({ kind: "rect", x: cx - boxW / 2 + d, y: top + d, width: boxW, height: boxH, fill: classicColor(15), stroke: null });
    }
    out.push({ kind: "rect", x: cx - boxW / 2, y: top, width: boxW, height: boxH, fill: "#000000", stroke: color, strokeWidth: LINE });
    const lines = linesFor(node, last);
    let sizes = lines.map((l) => Math.min(sizeToUnits(l.size), (boxW * 0.9) / Math.max(1, textWidth(l.text, 1))));
    const needed = sizes.reduce((s, x) => s + x * 1.25, 0);
    if (needed > boxH * 0.9) sizes = sizes.map((s) => (s * boxH * 0.9) / needed);
    let y = top + (boxH - sizes.reduce((s, x) => s + x * 1.25, 0)) / 2;
    lines.forEach((l, k) => {
      y += sizes[k];
      out.push(plainText(l.text, cx, y - sizes[k] * 0.1, sizes[k], classicColor(l.color), "middle", l.style & 2 ? 700 : 400, (l.style & 4) !== 0));
      y += sizes[k] * 0.25;
    });
  };

  const seg = (x0: number, y0: number, x1: number, y1: number) =>
    out.push({ kind: "path", points: [{ x: x0, y: y0 }, { x: x1, y: y1 }], closed: false, fill: null, stroke: color, strokeWidth: LINE });

  const draw = (t: Laid, colStart: number, row: number) => {
    const cx = area.left + (colStart + t.columns / 2) * colW;
    const top = area.top + row * rowH + (rowH - boxH) / 2;
    box(t.node, cx, top, t.children.length === 0);
    if (t.children.length === 0) return;
    const bottom = top + boxH;
    if (t.stacked) {
      const spine = cx - boxW * 0.42;
      const lastTop = area.top + (row + t.children.length) * rowH + (rowH - boxH) / 2;
      seg(spine, bottom, spine, lastTop + boxH / 2);
      t.children.forEach((c, k) => {
        const ctop = area.top + (row + 1 + k) * rowH + (rowH - boxH) / 2;
        const ccx = cx + boxW * 0.08;
        seg(spine, ctop + boxH / 2, ccx - boxW / 2, ctop + boxH / 2);
        box(c.node, ccx, ctop, true);
      });
      return;
    }
    const busY = bottom + (rowH - boxH) / 2;
    seg(cx, bottom, cx, busY);
    let start = colStart;
    const centres: number[] = [];
    for (const c of t.children) {
      centres.push(area.left + (start + c.columns / 2) * colW);
      draw(c, start, row + 1);
      start += c.columns;
    }
    seg(Math.min(...centres), busY, Math.max(...centres), busY);
    for (const x of centres) seg(x, busY, x, busY + (rowH - boxH) / 2);
  };
  draw(tree, 0, 0);
  return out;
}
