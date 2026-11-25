/**
 * Drawing one line of 1.x/2.x text: attribute runs (bold, italic,
 * underline, colour per character; SPEC §2.2, §4.1) laid out with an
 * approximate character width.
 */
import type { SceneElement, TextAnchor, TextElement } from "../types";
import { CHAR_WIDTH, FONT_FAMILY, classicColor } from "./assumptions";
import { ATTR, type ClassicText, attrColor } from "./model";

export function textWidth(text: string, size: number): number {
  return text.length * CHAR_WIDTH * size;
}

export function plainText(
  text: string,
  x: number,
  y: number,
  size: number,
  fill: string,
  anchor: TextAnchor = "start",
  fontWeight = 400,
  italic = false,
): TextElement {
  return { kind: "text", x, y, text, size, fill, fontFamily: FONT_FAMILY, fontWeight, italic, anchor };
}

interface Run {
  text: string;
  attr: number;
}

/** Runs of characters sharing one attribute byte. Missing attributes count as 0 (plain, colour 1). */
function runsOf(line: ClassicText, defaultAttr: number): Run[] {
  const out: Run[] = [];
  for (let i = 0; i < line.text.length; i++) {
    const attr = line.attrs[i] ?? defaultAttr;
    const last = out[out.length - 1];
    if (last && last.attr === attr) last.text += line.text[i];
    else out.push({ text: line.text[i], attr });
  }
  return out;
}

export interface LineOptions {
  /** Anchor x: the left edge, centre or right edge, by `anchor`. */
  x: number;
  /** Baseline. */
  y: number;
  size: number;
  anchor: TextAnchor;
  /** Narrow the text to fit this width by shrinking it. */
  maxWidth?: number;
  /** Attribute for characters with none (0 = plain, colour 1). */
  defaultAttr?: number;
  /** Colour number used in place of colour 1 (white) when the attribute gives colour 1. */
  baseColor?: number;
}

/** Elements for one line of text, or none for an empty line. */
export function drawLine(line: ClassicText, opts: LineOptions): SceneElement[] {
  const text = line.text.replace(/\s+$/, "");
  if (text.trim() === "") return [];
  const trimmed: ClassicText = { ...line, text };
  let size = opts.size;
  let width = textWidth(text, size);
  if (opts.maxWidth && width > opts.maxWidth && width > 0) {
    size *= opts.maxWidth / width;
    width = opts.maxWidth;
  }
  let x = opts.anchor === "start" ? opts.x : opts.anchor === "middle" ? opts.x - width / 2 : opts.x - width;
  const out: SceneElement[] = [];
  for (const run of runsOf(trimmed, opts.defaultAttr ?? 0)) {
    const colorNumber = attrColor(run.attr);
    const fill = classicColor(colorNumber === 1 && opts.baseColor ? opts.baseColor : colorNumber);
    const runWidth = textWidth(run.text, size);
    out.push(
      plainText(run.text, x, opts.y, size, fill, "start", run.attr & ATTR.bold ? 700 : 400, (run.attr & ATTR.italic) !== 0),
    );
    if (run.attr & ATTR.underline && run.text.trim() !== "") {
      const uy = opts.y + size * 0.12;
      out.push({ kind: "rect", x, y: uy, width: runWidth, height: size * 0.06, fill, stroke: null });
    }
    x += runWidth;
  }
  return out;
}

/** True when the line has visible characters. */
export function hasText(line: ClassicText | null | undefined): line is ClassicText {
  return !!line && line.text.trim() !== "";
}
