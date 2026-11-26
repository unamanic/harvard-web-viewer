/**
 * Drawing one line of 1.x/2.x text: attribute runs (bold, italic,
 * underline, colour per character; SPEC §2.2, §4.1).
 *
 * The programs' own fonts are not decoded, so text is drawn with our HWV
 * Sans clone faces (fonts/outline), measured from their advances, once the
 * parser's prepare() has loaded them. Until then (or if they cannot load)
 * it falls back to CSS text in FONT_FAMILY with an approximate width.
 */
import type { FontKey } from "../../fonts/fontKey";
import { EM_UNITS, type GlyphSource, glyphLineElement, measureGlyphLine } from "../../fonts/glyphRun";
import { codeForChar, loadedOutlineClone, outlineCloneFor } from "../../fonts/outline";
import { outlineGlyphSource } from "../../fonts/sources";
import type { SceneElement, TextAnchor } from "../../model/scene";
import { CHAR_WIDTH, FONT_FAMILY, classicColor } from "./assumptions";
import { ATTR, type ClassicText, attrColor } from "./model";

/** HWV Sans regular, italic, bold and bold italic (the Swiss 721 font keys of fonts/outline/table.ts). */
const FACE_KEYS: Readonly<Record<"regular" | "italic" | "bold" | "boldItalic", FontKey>> = {
  regular: { source: 3, number: 3, style: 0x4268 },
  italic: { source: 3, number: 4, style: 0x4269 },
  bold: { source: 3, number: 5, style: 0x42a8 },
  boldItalic: { source: 3, number: 6, style: 0x42a9 },
};

/** Load the faces text is drawn with (for the parser's prepare()). Never rejects. */
export async function loadTextFaces(): Promise<void> {
  await Promise.all(Object.values(FACE_KEYS).map((key) => outlineCloneFor(key).catch(() => null)));
}

function faceFor(bold: boolean, italic: boolean): GlyphSource | null {
  const key = bold ? (italic ? FACE_KEYS.boldItalic : FACE_KEYS.bold) : italic ? FACE_KEYS.italic : FACE_KEYS.regular;
  const font = loadedOutlineClone(key);
  return font ? outlineGlyphSource(font) : null;
}

/** Byte codes of the clone faces for a string ("?" for characters they lack). */
function codesOf(text: string): number[] {
  return Array.from(text, (ch) => codeForChar(ch) ?? 0x3f);
}

/** Width of a line of text, scene units. */
export function textWidth(text: string, size: number, bold = false, italic = false): number {
  const face = faceFor(bold, italic);
  if (!face) return text.length * CHAR_WIDTH * size;
  return (measureGlyphLine(face, codesOf(text)) * size) / EM_UNITS;
}

/** One line in one style, its anchor at (x, baseline y). */
export function plainText(
  text: string,
  x: number,
  y: number,
  size: number,
  fill: string,
  anchor: TextAnchor = "start",
  fontWeight = 400,
  italic = false,
): SceneElement {
  const face = faceFor(fontWeight >= 600, italic);
  if (face) return glyphLineElement(face, text, codesOf(text), fill, anchor, x, y, size);
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
  const runs = runsOf(trimmed, opts.defaultAttr ?? 0);
  const runWidth = (run: Run, size: number) => textWidth(run.text, size, (run.attr & ATTR.bold) !== 0, (run.attr & ATTR.italic) !== 0);
  let size = opts.size;
  let width = runs.reduce((w, run) => w + runWidth(run, size), 0);
  if (opts.maxWidth && width > opts.maxWidth && width > 0) {
    size *= opts.maxWidth / width;
    width = opts.maxWidth;
  }
  let x = opts.anchor === "start" ? opts.x : opts.anchor === "middle" ? opts.x - width / 2 : opts.x - width;
  const out: SceneElement[] = [];
  for (const run of runs) {
    const colorNumber = attrColor(run.attr);
    const fill = classicColor(colorNumber === 1 && opts.baseColor ? opts.baseColor : colorNumber);
    const w = runWidth(run, size);
    out.push(
      plainText(run.text, x, opts.y, size, fill, "start", run.attr & ATTR.bold ? 700 : 400, (run.attr & ATTR.italic) !== 0),
    );
    if (run.attr & ATTR.underline && run.text.trim() !== "") {
      const uy = opts.y + size * 0.12;
      out.push({ kind: "rect", x, y: uy, width: w, height: size * 0.06, fill, stroke: null });
    }
    x += w;
  }
  return out;
}

/** True when the line has visible characters. */
export function hasText(line: ClassicText | null | undefined): line is ClassicText {
  return !!line && line.text.trim() !== "";
}
