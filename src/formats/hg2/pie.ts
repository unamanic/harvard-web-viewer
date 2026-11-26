/**
 * Pie charts (SPEC §2.4, §4.4): one or two pies (or columns) side by side.
 */
import type { Point, SceneElement, TextAnchor } from "../../model/scene";
import { DEFAULT_SIZES, classicColor, shade, sizeToUnits } from "./assumptions";
import type { Box } from "./graph";
import type { ClassicPie } from "./model";
import { drawLine, hasText, plainText, textWidth } from "./text";

interface Slice {
  /** Index of the point (picks colour, label and cut). */
  index: number;
  value: number;
}

function slicesOf(pie: ClassicPie): Slice[] {
  const slices: Slice[] = [];
  pie.values.forEach((v, index) => {
    if (v !== null && v > 0 && index < 12) slices.push({ index, value: v });
  });
  if (pie.sort) slices.sort((a, b) => b.value - a.value);
  return slices;
}

function total(slices: Slice[]): number {
  return slices.reduce((s, x) => s + x.value, 0);
}

function money(v: number): string {
  return `$${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function valueText(pie: ClassicPie, v: number, sum: number): { value: string; percent: string } {
  const value = pie.showValue ? (pie.currency ? money(v) : v.toLocaleString("en-US", { maximumFractionDigits: 2 })) : "";
  const percent = pie.showPercent && sum > 0 ? `${((100 * v) / sum).toFixed(1)}%` : "";
  return { value, percent };
}

/** True when the pie has something to draw. */
export function pieHasData(pie: ClassicPie): boolean {
  return pie.style !== "none" && slicesOf(pie).length > 0;
}

const DEG = Math.PI / 180;

function wedge(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number): Point[] {
  const pts: Point[] = [{ x: cx, y: cy }];
  const steps = Math.max(2, Math.ceil((a1 - a0) / 3));
  for (let k = 0; k <= steps; k++) {
    const a = (a0 + ((a1 - a0) * k) / steps) * DEG;
    pts.push({ x: cx + rx * Math.cos(a), y: cy - ry * Math.sin(a) });
  }
  return pts;
}

function drawOnePie(pie: ClassicPie, region: Box, radius: number, warnings: string[]): SceneElement[] {
  const out: SceneElement[] = [];
  const slices = slicesOf(pie);
  const sum = total(slices);
  const labelSize = sizeToUnits(pie.labelSize > 0 && pie.labelSize < 50 ? pie.labelSize : DEFAULT_SIZES.axisLabel);
  const cx = (region.left + region.right) / 2;
  const cy = (region.top + region.bottom) / 2;

  if (pie.style === "column") {
    const w = radius * 0.6;
    const h = radius * 2;
    let y = cy + h / 2;
    for (const s of slices) {
      const sh = (s.value / sum) * h;
      const color = classicColor(pie.colors[s.index]);
      out.push({ kind: "rect", x: cx - w / 2, y: y - sh, width: w, height: sh, fill: color, stroke: "#000000", strokeWidth: 20 });
      const label = pie.showLabel ? (pie.labels[s.index] ?? "") : "";
      const { value, percent } = valueText(pie, s.value, sum);
      const text = [label, value, percent].filter((t) => t).join("  ");
      if (text) out.push(plainText(text, cx + w / 2 + labelSize * 0.6, y - sh / 2 + labelSize * 0.35, labelSize, classicColor(1), "start"));
      y -= sh;
    }
    return out;
  }

  const rx = radius;
  const ry = pie.threeD ? radius * 0.55 : radius;
  const depth = pie.threeD ? radius * 0.18 : 0;
  let angle = pie.startAngle;
  const placed = slices.map((s) => {
    const a0 = angle;
    const a1 = angle + (s.value / sum) * 360;
    angle = a1;
    const mid = ((a0 + a1) / 2) * DEG;
    const cut = pie.cut[s.index] ? radius * 0.12 : 0;
    return { s, a0, a1, mid, ox: cut * Math.cos(mid), oy: -cut * (ry / rx) * Math.sin(mid) };
  });
  if (depth > 0) {
    for (const p of placed) {
      const color = shade(classicColor(pie.colors[p.s.index]), 0.6);
      out.push({ kind: "band", cx: cx + p.ox, cy: cy + p.oy, rx, ry, startAngle: p.a0, endAngle: p.a1, depth, fill: color, stroke: "#000000", strokeWidth: 20 });
    }
  }
  for (const p of placed) {
    const color = classicColor(pie.colors[p.s.index]);
    out.push({ kind: "path", points: wedge(cx + p.ox, cy + p.oy, rx, ry, p.a0, p.a1), closed: true, fill: color, stroke: "#000000", strokeWidth: 20 });
  }

  // Labels: outside each slice; value and percent below it, beside it or inside the slice.
  for (const p of placed) {
    const label = pie.showLabel ? (pie.labels[p.s.index] ?? "").trim() : "";
    const { value, percent } = valueText(pie, p.s.value, sum);
    const cos = Math.cos(p.mid);
    const sin = Math.sin(p.mid);
    const anchor: TextAnchor = cos > 0.15 ? "start" : cos < -0.15 ? "end" : "middle";
    const lx = cx + p.ox + (rx + labelSize * 0.6) * cos;
    let ly = cy + p.oy - (ry + labelSize * 0.6) * sin + (sin < 0 ? depth + labelSize : 0) + labelSize * 0.35;
    if (Math.abs(cos) <= 0.15 && sin > 0) ly -= labelSize * 0.5;
    const lines: string[] = [];
    const inside: string[] = [];
    const extra = [value, percent].filter((t) => t);
    const placeOf = (t: string) => (t === value ? pie.valuePlace : pie.percentPlace);
    let first = label;
    for (const t of extra) {
      const where = placeOf(t);
      if (where === "inside") inside.push(t);
      else if (where === "adjacent") first = first ? `${first}  ${t}` : t;
      else lines.push(t);
    }
    if (first) lines.unshift(first);
    lines.forEach((t, k) => out.push(plainText(t, lx, ly + k * labelSize * 1.2, labelSize, classicColor(1), anchor)));
    if (inside.length > 0) {
      const ix = cx + p.ox + rx * 0.6 * cos;
      const iy = cy + p.oy - ry * 0.6 * sin + labelSize * 0.35;
      inside.forEach((t, k) => out.push(plainText(t, ix, iy + k * labelSize * 1.2, labelSize, "#000000", "middle", 700)));
    }
  }
  if (slices.length < pie.values.filter((v) => v !== null).length) {
    warnings.push(`Pie ${pie.index}: zero, negative or more than 12 values are left out.`);
  }
  return out;
}

export function drawPies(pies: ClassicPie[], area: Box, warnings: string[]): SceneElement[] {
  const shown = pies.filter(pieHasData);
  if (shown.length === 0) {
    return [plainText("(no data)", (area.left + area.right) / 2, (area.top + area.bottom) / 2, sizeToUnits(4), classicColor(8), "middle")];
  }
  const out: SceneElement[] = [];
  const width = (area.right - area.left) / shown.length;
  const regions: Box[] = shown.map((_, k) => ({ left: area.left + k * width, right: area.left + (k + 1) * width, top: area.top, bottom: area.bottom }));
  const sums = shown.map((p) => total(slicesOf(p)));
  shown.forEach((pie, k) => {
    const region = { ...regions[k] };
    // Pie titles above the pie.
    const titleLines = pie.title.filter(hasText);
    for (const t of titleLines) {
      const size = sizeToUnits(t.size > 0 ? t.size : DEFAULT_SIZES.pieTitle);
      region.top += size * 1.2;
      out.push(...drawLine(t, { x: (region.left + region.right) / 2, y: region.top, size, anchor: "middle", maxWidth: width * 0.95 }));
      region.top += size * 0.3;
    }
    const labelRoom = sizeToUnits(DEFAULT_SIZES.axisLabel) * 2.5;
    const longest = Math.max(0, ...pie.labels.map((l) => textWidth(l, sizeToUnits(DEFAULT_SIZES.axisLabel))));
    const maxR = Math.max(500, Math.min((region.right - region.left) / 2 - Math.min(longest, width * 0.25) - labelRoom * 0.3, (region.bottom - region.top) / 2 - labelRoom));
    let radius = maxR * Math.max(0.2, Math.min(pie.size > 0 ? pie.size / 50 : 1, 1.3));
    radius = Math.min(radius, maxR);
    if (k === 1 && pie.proportional && sums[0] > 0) radius = Math.min(maxR, radius * Math.sqrt(sums[1] / sums[0]));
    out.push(...drawOnePie(pie, region, radius, warnings));
  });
  if (shown.some((p) => p.fill !== 1)) {
    warnings.push("Pie slices with fill patterns are drawn in solid colour; patterns are not drawn yet.");
  }
  return out;
}
