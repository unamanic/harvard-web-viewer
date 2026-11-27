/**
 * Organization charts (SPEC §2.5, §4.6): a box per person, upper levels
 * side by side, the last level stacked under its manager when the chart
 * asks for it.
 *
 * Measured on the A.00 and 2.3 screens of the story show's two org charts:
 * - The chart hangs from the top of the area under the title, not spread over the page.
 * - Every box on one level has the same size: as wide as the widest text on that level
 *   (and never narrower than the level below), as tall as its lines need.
 * - Boxes sit 1.25 box widths apart; the gap above and below the connecting bus is a
 *   little over a third of the box height.
 * - All text is one size, the name size (titles too); when the boxes do not fit across
 *   the page, all of it shrinks.
 * - 2.x, with three lines a box, puts a name with a space on two lines, split at the
 *   first space ("Harvard / Web Viewer"); A.00 keeps a name on one line [I].
 * Box fills are the page background, so connecting lines never show through.
 */
import type { SceneElement } from "../../model/scene";
import { BACKGROUND, classicColor, sizeToUnits } from "./assumptions";
import type { Box } from "./graph";
import type { ClassicVersion, OrgData, OrgNode } from "./model";
import { plainText, textWidth } from "./text";

interface Laid {
  node: OrgNode;
  depth: number;
  children: Laid[];
  /** Children drawn as a vertical stack under this box. */
  stacked: boolean;
  columns: number;
}

function lay(node: OrgNode, depth: number, levels: number, vertical: boolean, seen: Set<number>): Laid {
  seen.add(node.id);
  const visible = levels === 0 || depth + 1 < levels ? node.children.filter((c) => !seen.has(c.id)) : [];
  const children = visible.map((c) => lay(c, depth + 1, levels, vertical, seen));
  const stacked = vertical && children.length > 0 && children.every((c) => c.children.length === 0);
  const columns = stacked || children.length === 0 ? 1 : children.reduce((s, c) => s + c.columns, 0);
  return { node, depth, children, stacked, columns };
}

const LINE = 40;

export interface BoxLine {
  text: string;
  /** Size in percent of the page, before shrinking. */
  size: number;
  style: number;
  color: number;
}

export interface OrgDrawOptions {
  version?: ClassicVersion;
  /** Box fill: the page background. */
  background?: string;
}

/** The text lines of one box, at most the chart's lines-per-box setting. */
export function orgBoxLines(org: OrgData, node: OrgNode, last: boolean, version: ClassicVersion = "2.30"): BoxLine[] {
  const o = org.options;
  const limit = Math.max(1, last ? o.linesLast : o.linesUpper);
  const lines: BoxLine[] = [];
  const name = last && o.abbreviations && node.abbreviation.trim() ? node.abbreviation.trim() : node.name.trim();
  const space = name.indexOf(" ");
  const nameLines = version !== "1.0" && limit >= 3 && space > 0 ? [name.slice(0, space), name.slice(space + 1).trim()] : [name];
  for (const text of nameLines) lines.push({ text, size: o.nameSize, style: o.nameStyle, color: o.nameColor });
  if ((last ? o.titlesLast : o.titlesUpper) && node.title.trim()) lines.push({ text: node.title.trim(), size: o.titleSize, style: o.titleStyle, color: o.titleColor });
  if ((last ? o.commentsLast : o.commentsUpper) && node.comment.trim()) lines.push({ text: node.comment.trim(), size: o.commentSize, style: o.commentStyle, color: o.commentColor });
  return lines.slice(0, limit);
}

export function drawOrg(org: OrgData, area: Box, options: OrgDrawOptions = {}): SceneElement[] {
  const out: SceneElement[] = [];
  if (!org.root) return out;
  const version = options.version ?? "2.30";
  const fill = options.background ?? BACKGROUND;
  const o = org.options;
  const tree = lay(org.root, 0, o.levels, o.lastLevelVertical, new Set());
  const color = classicColor(1);

  // Every laid box with its lines.
  const all: { t: Laid; lines: BoxLine[] }[] = [];
  const walk = (t: Laid) => {
    all.push({ t, lines: orgBoxLines(org, t.node, t.children.length === 0, version) });
    t.children.forEach(walk);
  };
  walk(tree);
  const lineOf = new Map(all.map((b) => [b.t, b.lines]));
  const maxDepth = Math.max(...all.map((b) => b.t.depth));
  const nameUnits = sizeToUnits(o.nameSize > 0 ? o.nameSize : 6);
  const bottomPad = version === "1.0" ? 0.15 : 0.7;
  // Both screens draw a box's title and comment at the name's size, whatever size is stored for them [I].
  const lineSize = (_l: BoxLine) => nameUnits;

  const measure = (k: number) => {
    const width: number[] = new Array(maxDepth + 1).fill(0);
    const height: number[] = new Array(maxDepth + 1).fill(0);
    for (const b of all) {
      const w = Math.max(0, ...b.lines.map((l) => textWidth(l.text, lineSize(l) * k))) + nameUnits * k * 0.9;
      const h = nameUnits * k * 0.6 + b.lines.reduce((s, l, i) => s + lineSize(l) * k * (i === 0 ? 1 : 1.15), 0) + nameUnits * k * bottomPad;
      width[b.t.depth] = Math.max(width[b.t.depth], w);
      height[b.t.depth] = Math.max(height[b.t.depth], h);
    }
    for (let d = maxDepth - 1; d >= 0; d--) width[d] = Math.max(width[d], width[d + 1]);
    return { width, height };
  };
  const gapOf = (h: number) => h * 0.37 + sizeToUnits(1);
  const layout = (k: number) => {
    const m = measure(k);
    const colW = 1.25 * Math.max(...m.width.slice(maxDepth > 0 ? 1 : 0));
    // Height: each level plus its bus gaps; a stacked list adds a row per child.
    const below = (t: Laid): number =>
      t.children.length === 0
        ? 0
        : t.stacked
          ? t.children.length * (m.height[t.depth + 1] + gapOf(m.height[t.depth + 1]))
          : 2 * gapOf(m.height[t.depth]) + Math.max(...t.children.map((c) => m.height[c.depth] + below(c)));
    return { ...m, colW, totalW: Math.max(tree.columns * colW, m.width[0]), totalH: m.height[0] + below(tree) };
  };
  const areaW = area.right - area.left;
  const areaH = area.bottom - area.top - sizeToUnits(1.5);
  let k = 1;
  let g = layout(k);
  const fit = Math.min(1, areaW / g.totalW, areaH / g.totalH);
  if (fit < 1) {
    k = fit;
    g = layout(k);
  }
  const left = area.left + (areaW - tree.columns * g.colW) / 2;

  const box = (t: Laid, cx: number, top: number) => {
    const w = g.width[t.depth];
    const h = g.height[t.depth];
    if (o.shadow) {
      const d = h * 0.08;
      out.push({ kind: "rect", x: cx - w / 2 + d, y: top + d, width: w, height: h, fill: classicColor(15), stroke: null });
    }
    out.push({ kind: "rect", x: cx - w / 2, y: top, width: w, height: h, fill, stroke: color, strokeWidth: LINE });
    const lines = lineOf.get(t) ?? [];
    let y = top + nameUnits * k * 0.6;
    lines.forEach((l, i) => {
      const size = lineSize(l) * k;
      y += size * (i === 0 ? 1 : 1.15);
      out.push(plainText(l.text, cx, y - size * 0.15, size, classicColor(l.color), "middle", l.style & 2 ? 700 : 400, (l.style & 4) !== 0));
    });
  };

  const seg = (x0: number, y0: number, x1: number, y1: number) =>
    out.push({ kind: "path", points: [{ x: x0, y: y0 }, { x: x1, y: y1 }], closed: false, fill: null, stroke: color, strokeWidth: LINE });

  const draw = (t: Laid, colStart: number, top: number) => {
    const cx = left + (colStart + t.columns / 2) * g.colW;
    box(t, cx, top);
    if (t.children.length === 0) return;
    const bottom = top + g.height[t.depth];
    if (t.stacked) {
      const ch = g.height[t.depth + 1];
      const cw = g.width[t.depth + 1];
      const spine = cx - g.width[t.depth] * 0.42;
      let ctop = bottom + gapOf(ch);
      t.children.forEach((c, i) => {
        const ccx = spine + cw * 0.08 + cw / 2;
        seg(spine, ctop + ch / 2, ccx - cw / 2, ctop + ch / 2);
        box(c, ccx, ctop);
        if (i === t.children.length - 1) seg(spine, bottom, spine, ctop + ch / 2);
        ctop += ch + gapOf(ch);
      });
      return;
    }
    const gap = gapOf(g.height[t.depth]);
    const busY = bottom + gap;
    seg(cx, bottom, cx, busY);
    let start = colStart;
    const centres: number[] = [];
    for (const c of t.children) {
      centres.push(left + (start + c.columns / 2) * g.colW);
      draw(c, start, busY + gap);
      start += c.columns;
    }
    seg(Math.min(...centres), busY, Math.max(...centres), busY);
    for (const x of centres) seg(x, busY, x, busY + gap);
  };
  draw(tree, 0, area.top + sizeToUnits(1.5));
  return out;
}
