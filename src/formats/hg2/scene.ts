/**
 * One ClassicChart → one Scene. Graph, pie and org charts get the title
 * block (title, subtitles) at the top and footnotes at the bottom; text
 * charts lay their own lines out; multiple charts draw the charts they name
 * (other .CHT files) into their slots.
 */
import { LANDSCAPE_VIEW_BOX, type Scene, type SceneElement } from "../../model/scene";
import { type ParseContext } from "../parser";
import { BACKGROUND, DEFAULT_SIZES, MARGIN_X, MARGIN_Y, PAGE, classicColor, sizeToUnits } from "./assumptions";
import { type Box, drawGraph } from "./graph";
import type { ClassicChart, MultipleSlot } from "./model";
import { drawOrg } from "./orgChart";
import { drawPies } from "./pie";
import { readClassicChart } from "./read";
import { drawLine, hasText, plainText } from "./text";
import { drawTextChart } from "./textChart";

export interface SceneOptions {
  context?: ParseContext;
  /** Charts already being drawn (upper-cased names), to stop a multiple chart naming itself. */
  open?: Set<string>;
}

const MAX_WIDTH = PAGE.width - 2 * MARGIN_X;

/** Title and subtitles at the top, footnotes at the bottom; returns the space left between. */
function titleBlock(chart: ClassicChart, out: SceneElement[]): Box {
  let top = PAGE.top + MARGIN_Y;
  chart.title.forEach((line, k) => {
    if (!hasText(line)) return;
    const size = sizeToUnits(line.size > 0 ? line.size : k === 0 ? DEFAULT_SIZES.title : DEFAULT_SIZES.subtitle);
    top += size;
    const x = line.place === "left" ? PAGE.left + MARGIN_X : line.place === "right" ? PAGE.right - MARGIN_X : 0;
    const anchor = line.place === "left" ? "start" : line.place === "right" ? "end" : "middle";
    out.push(...drawLine(line, { x, y: top, size, anchor, maxWidth: MAX_WIDTH }));
    top += size * 0.4;
  });
  let bottom = PAGE.bottom - MARGIN_Y;
  const feet = chart.footnote.filter(hasText);
  for (let k = feet.length - 1; k >= 0; k--) {
    const line = feet[k];
    const size = sizeToUnits(line.size > 0 ? line.size : DEFAULT_SIZES.footnote);
    const x = line.place === "right" ? PAGE.right - MARGIN_X : line.place === "center" ? 0 : PAGE.left + MARGIN_X;
    const anchor = line.place === "right" ? "end" : line.place === "center" ? "middle" : "start";
    out.push(...drawLine(line, { x, y: bottom, size, anchor, maxWidth: MAX_WIDTH }));
    bottom -= size * 1.3;
  }
  return { left: PAGE.left + MARGIN_X, right: PAGE.right - MARGIN_X, top: top + sizeToUnits(1.5), bottom: bottom - sizeToUnits(1) };
}

/**
 * [I] Slot boxes: (x, width, y, height) in page units with y up from the
 * bottom. The whole set is scaled to fit the page.
 */
function drawMultiple(chart: ClassicChart, warnings: string[], options: SceneOptions): SceneElement[] {
  const out: SceneElement[] = [];
  const slots = chart.slots.filter((s) => s.box[1] > 0 && s.box[3] > 0);
  if (slots.length === 0) {
    out.push(plainText("(multiple chart with no charts in it)", 0, 0, sizeToUnits(4), classicColor(8), "middle"));
    return out;
  }
  const minX = Math.min(...slots.map((s) => s.box[0]));
  const maxX = Math.max(...slots.map((s) => s.box[0] + s.box[1]));
  const minY = Math.min(...slots.map((s) => s.box[2]));
  const maxY = Math.max(...slots.map((s) => s.box[2] + s.box[3]));
  const avail = { w: PAGE.width - 2 * MARGIN_X, h: PAGE.height - 2 * MARGIN_Y };
  const k = Math.min(avail.w / (maxX - minX), avail.h / (maxY - minY));
  const offX = -((maxX - minX) * k) / 2;
  const offY = -((maxY - minY) * k) / 2;
  const missing: string[] = [];
  for (const slot of slots) {
    const left = offX + (slot.box[0] - minX) * k;
    const width = slot.box[1] * k;
    const height = slot.box[3] * k;
    const top = offY + (maxY - (slot.box[2] + slot.box[3])) * k;
    const inner = slotScene(slot, warnings, options, missing);
    out.push({ kind: "rect", x: left, y: top, width, height, fill: BACKGROUND, stroke: null });
    if (inner) {
      const vb = inner.viewBox;
      const s = Math.min(width / vb.width, height / vb.height);
      const tx = left + (width - vb.width * s) / 2 - vb.minX * s;
      const ty = top + (height - vb.height * s) / 2 - vb.minY * s;
      out.push({ kind: "group", transform: [s, 0, 0, s, tx, ty], children: inner.elements });
    } else {
      out.push({ kind: "rect", x: left, y: top, width, height, fill: null, stroke: classicColor(8), strokeWidth: 40 });
      out.push(plainText(slot.fileName, left + width / 2, top + height / 2, Math.min(sizeToUnits(4), width / 10), classicColor(8), "middle"));
    }
  }
  if (missing.length > 0) {
    warnings.push(`This multiple chart shows ${missing.join(", ")}; open ${missing.length === 1 ? "that file" : "those files"} with it to see ${missing.length === 1 ? "it" : "them"}.`);
  }
  return out;
}

function slotScene(slot: MultipleSlot, warnings: string[], options: SceneOptions, missing: string[]): Scene | null {
  const name = slot.fileName.toUpperCase();
  const open = options.open ?? new Set<string>();
  if (open.has(name)) {
    warnings.push(`The multiple chart names ${slot.fileName} inside itself; that slot is left empty.`);
    return null;
  }
  const file = options.context?.resolve(slot.fileName, "chart") ?? null;
  if (!file) {
    missing.push(slot.fileName);
    return null;
  }
  const innerWarnings: string[] = [];
  try {
    const chart = readClassicChart(file.bytes, innerWarnings);
    const scene = chartToScene(chart, innerWarnings, { context: options.context, open: new Set([...open, name]) });
    for (const w of innerWarnings) warnings.push(`${slot.fileName}: ${w}`);
    return scene;
  } catch (e) {
    warnings.push(`${slot.fileName} could not be drawn: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

export function chartToScene(chart: ClassicChart, warnings: string[], options: SceneOptions = {}): Scene {
  const elements: SceneElement[] = [];
  switch (chart.kind) {
    case "title":
    case "list":
    case "bullet":
    case "columns":
    case "freeform":
      elements.push(...drawTextChart(chart));
      break;
    case "bar":
    case "area":
    case "hlc": {
      const area = titleBlock(chart, elements);
      if (chart.graph) elements.push(...drawGraph(chart, chart.graph, area, warnings));
      if (chart.graph && chart.graph.options.fill !== 1) warnings.push("Fill patterns are drawn in solid colour; patterns are not drawn yet.");
      break;
    }
    case "pie": {
      const area = titleBlock(chart, elements);
      elements.push(...drawPies(chart.pies, area, warnings));
      break;
    }
    case "org": {
      const area = titleBlock(chart, elements);
      if (chart.org) elements.push(...drawOrg(chart.org, area));
      break;
    }
    case "multiple":
      elements.push(...drawMultiple(chart, warnings, options));
      break;
    default:
      elements.push(plainText(`Chart class ${chart.chartClass}, type ${chart.subtype} is not drawn.`, 0, 0, sizeToUnits(4), classicColor(8), "middle"));
  }
  if (chart.hasAnnotations) warnings.push("The chart has drawn annotations (added text and shapes), which are not shown yet.");
  return { viewBox: LANDSCAPE_VIEW_BOX, background: BACKGROUND, elements };
}
