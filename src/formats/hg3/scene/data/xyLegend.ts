/**
 * The XY legend in area 810 (1418).
 */
import type { SceneElement } from "../../../../model/scene";
import {
  lineWidthFor,
  XY_LEGEND_GAP,
  XY_LEGEND_MARGIN,
  XY_LEGEND_PITCH,
  XY_LEGEND_SWATCH,
  XY_LEGEND_SWATCH_DROP,
  XY_LINE_STYLE,
} from "../../assumptions";
import type { XySeries } from "../../data/xy";
import type { ChartSceneContext } from "../context";
import { fillLook } from "./fillStyle";
import { type Box, boxOf } from "./text";
import { styled } from "./textCharts";
import { drawLabel, HL_IBAR, isHighLow, label, LEGEND_NO_FRAME, line, polygon, rect } from "./xyLayout";
import type { XyOptions } from "./xyOptions";
import { listedBottomUp } from "./xyTable";

/** A series' swatch in box `sb`: a box (bars, areas; a triangle for pyramids), else a line and its point. */
export function swatchFor(ctx: ChartSceneContext, opts: XyOptions, s: XySeries, sb: Box, outline: string | null, thin: number): SceneElement[] {
  const fill = ctx.color(s.type === "bar" || s.type === "area" ? s.colorRole : s.colorRole2 || s.colorRole);
  const cx = (sb.left + sb.right) / 2;
  const cy = (sb.top + sb.bottom) / 2;
  if (s.type === "close") return line([{ x: cx, y: cy }, { x: sb.right, y: cy }], fill, thin);
  if ((s.type === "high" || s.type === "low") && opts.highLowStyle === HL_IBAR) {
    const f = ctx.color(s.colorRole);
    const q = (sb.right - sb.left) / 4;
    return [
      ...line([{ x: cx - q, y: sb.bottom }, { x: cx + q, y: sb.bottom }], f, thin),
      ...line([{ x: cx, y: sb.bottom }, { x: cx, y: sb.top }], f, thin),
      ...line([{ x: cx - q, y: sb.top }, { x: cx + q, y: sb.top }], f, thin),
    ];
  }
  if (s.type === "bar" || s.type === "area" || isHighLow(s) || (opts.threeD && s.type === "line")) {
    // Bar and area swatches take the series' fill style like its shapes (fillStyle.ts) [I].
    const look = s.type === "bar" || s.type === "area" ? fillLook(s.fillStyle, s.fillPattern, fill, outline) : { fill, outline };
    if (s.type === "bar" && opts.barShape === "pyramid") {
      return polygon([{ x: sb.left, y: sb.bottom }, { x: sb.right, y: sb.bottom }, { x: (sb.left + sb.right) / 2, y: sb.top }], look.fill, look.outline, thin);
    }
    return rect(sb, look.fill, look.outline, thin);
  }
  const parts: SceneElement[] = [];
  if (s.type === "line") parts.push(...line([{ x: sb.left, y: cy }, { x: sb.right, y: cy }], fill, thin), ...line([{ x: cx, y: cy }], fill, thin));
  parts.push(...line([{ x: cx, y: cy }], fill, thin, true));
  return parts;
}

/**
 * The legend in its 810 area (which the original sizes and places by
 * 1418 bytes 1 and 2, so a viewer needs no rule for those). Frame style 2
 * (Plain): a box in the 1418 fill and outline roles, items XY_LEGEND_MARGIN
 * in; style 1: no box, items flush left (XDTNO, XLEGOC) [I]. Items are
 * listed down the box, centred; across it when the box is too low for the
 * list. Every series with data has a row; hidden series leave theirs empty
 * (XS6SH) [C].
 */
export function drawLegend(ctx: ChartSceneContext, opts: XyOptions, series: XySeries[]): SceneElement[] {
  const area = ctx.chart.areas.legend;
  if (!area) return [];
  const box = boxOf(area);
  const thin = lineWidthFor(XY_LINE_STYLE);
  const framed = opts.legendFrameStyle !== LEGEND_NO_FRAME;
  const out: SceneElement[] = framed ? [...rect(box, ctx.color(opts.legendFillRole), ctx.color(opts.legendOutlineRole), thin)] : [];
  const labels = series
    .filter((s) => s.name && s.name.text.trim())
    .map((s) => ({ s, l: label(ctx, s.name!.text, styled(ctx, s.name!)) }));
  if (!labels.length) return out;
  const h = Math.max(...labels.map((x) => x.l.height));
  const sw = XY_LEGEND_SWATCH * h;
  const gap = XY_LEGEND_GAP * h;
  const pitch = XY_LEGEND_PITCH * h;
  const height = labels.length * h + (labels.length - 1) * (pitch - h);
  // Across when the box is lower than the list (XDTNO, XS3D: a box exactly as high as two rows lists them down) [I].
  const across = labels.length > 1 && box.top - box.bottom < height - 1;
  const outline = ctx.color(opts.outlineRole);
  const swatch = (s: XySeries, left: number, top: number): SceneElement[] => {
    const sTop = top - XY_LEGEND_SWATCH_DROP * h;
    return swatchFor(ctx, opts, s, { left, right: left + sw, top: sTop, bottom: sTop - sw }, outline, thin);
  };
  if (across) {
    const shown = labels.filter((x) => x.s.show);
    const widths = shown.map((x) => sw + gap + x.l.width);
    const total = widths.reduce((a, b) => a + b, 0) + 2 * gap * (shown.length - 1);
    let x = (box.left + box.right) / 2 - total / 2;
    const top = (box.top + box.bottom) / 2 + h / 2;
    shown.forEach(({ s, l }, i) => {
      out.push(...swatch(s, x, top));
      out.push(...drawLabel(ctx, l, x + sw + gap, top));
      x += widths[i]! + 2 * gap;
    });
    return out;
  }
  const left = box.left + (framed ? XY_LEGEND_MARGIN * h : 0);
  let top = (box.top + box.bottom) / 2 + height / 2;
  const ordered = listedBottomUp(opts) ? [...labels].reverse() : labels;
  for (const { s, l } of ordered) {
    if (s.show) {
      out.push(...swatch(s, left, top));
      out.push(...drawLabel(ctx, l, left + sw + gap, top));
    }
    top -= pitch;
  }
  return out;
}
