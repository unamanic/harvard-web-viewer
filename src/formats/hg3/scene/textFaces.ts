/**
 * Which glyphs draw each font (task 7f; SPEC §2, §6.4). Priority per font
 * key, first available wins:
 *
 *   1. the original .SPD from the user's files (ResolvedFont.file, Speedo
 *      kind), glyph ids from the HG3.FGF character map;
 *   2. the original .FN3: not decodable yet (task 7c), skipped;
 *   3. our clone: the outline clone for Speedo keys (only if its face has
 *      already been loaded, see prepareFonts.ts), the stroke clone for HG
 *      stroke keys (built in, always available);
 *   4. the CSS look-alike (ResolvedFont.cssFamily) as a plain text element.
 *
 * Parsed Speedo fonts are cached per file (by its bytes), converted glyphs
 * per font and code (src/fonts/sources.ts), so redrawing a chart or the
 * slides of a show reuses them.
 */
import { loadedOutlineClone, outlineCloneInfo } from "../../../fonts/outline";
import { outlineGlyphSource, speedoGlyphSource, strokeGlyphSource } from "../../../fonts/sources";
import type { GlyphSource } from "../../../fonts/glyphRun";
import { strokeCloneFor } from "../../../fonts/stroke";
import { type SpeedoFont, parseSpeedo } from "../../speedo/speedo";
import type { ResolvedFile } from "../../parser";
import { fontKeyString } from "../../../fonts/fontKey";
import type { FontResolver, ResolvedFont } from "../fonts";

export type TextFaceOrigin = "original" | "clone" | "css";

export interface TextFace {
  font: ResolvedFont;
  origin: TextFaceOrigin;
  /** Null for "css": draw a text element with font.cssFamily. */
  glyphs: GlyphSource | null;
  /** Where the glyphs come from, e.g. "original BX000003.SPD", "clone HWV Serif Bold". */
  source: string;
}

const speedoCache = new WeakMap<Uint8Array, SpeedoFont | Error>();

/** Parse a Speedo file once per file (by its bytes); an Error when it cannot be read. */
export function speedoFontOf(file: ResolvedFile): SpeedoFont | Error {
  let font = speedoCache.get(file.bytes);
  if (!font) {
    try {
      font = parseSpeedo(file.bytes);
    } catch (e) {
      font = e instanceof Error ? e : new Error(String(e));
    }
    speedoCache.set(file.bytes, font);
  }
  return font;
}

/** True when the original font file can draw this font (step 1). */
export function hasUsableOriginal(font: ResolvedFont): boolean {
  if (!font.file || !font.charMap || !/\.spd$/i.test(font.file.name)) return false;
  return !(speedoFontOf(font.file) instanceof Error);
}

/** First word of a CSS stack without quotes, e.g. "Helvetica". */
function firstFamily(css: string): string {
  return (css.split(",")[0] ?? css).trim().replace(/^['"]|['"]$/g, "");
}

/** The face for one resolved font (steps 1 to 4). `warn` gets problems with original files. */
export function chooseTextFace(font: ResolvedFont, warn: (w: string) => void): TextFace {
  // 1. Original Speedo font.
  if (font.file && /\.spd$/i.test(font.file.name)) {
    const spd = speedoFontOf(font.file);
    if (spd instanceof Error) {
      warn(`font file ${font.file.name} could not be read (${spd.message}); using a substitute`);
    } else if (!font.charMap) {
      warn(`font file ${font.file.name} found but HG3.FGF (its character map) is missing; using a substitute`);
    } else {
      return { font, origin: "original", glyphs: speedoGlyphSource(spd, font.charMap), source: `original ${font.file.name}` };
    }
  }
  // 2. Original .FN3: not decodable yet (task 7c).
  // 3. Our clones.
  const outline = loadedOutlineClone(font.key);
  if (outline) {
    return { font, origin: "clone", glyphs: outlineGlyphSource(outline), source: `clone ${outline.family} ${outline.style}` };
  }
  const stroke = strokeCloneFor(font.key);
  if (stroke) {
    const style = stroke.weight === "bold" ? "Bold" : "Light";
    return { font, origin: "clone", glyphs: strokeGlyphSource(stroke), source: `clone ${stroke.family} ${style}` };
  }
  // 4. CSS look-alike.
  const pending = outlineCloneInfo(font.key) ? ", clone not loaded" : "";
  return { font, origin: "css", glyphs: null, source: `look-alike ${firstFamily(font.cssFamily)} (CSS${pending})` };
}

/** Faces of one document (or scene), cached per font key, with a report of what drew each font. */
export interface TextFaces {
  /** Resolve the font key and choose its face (cached). */
  faceFor(key: ResolvedFont["key"]): TextFace;
  /**
   * One line naming each face actually used, in first-use order, e.g.
   * "Fonts: Swiss 721 Roman — original BX000003.SPD; Dutch 801 Bold — clone
   * HWV Serif Bold". Null when no text was drawn.
   */
  report(): string | null;
}

export function createTextFaces(fonts: FontResolver, warn: (w: string) => void): TextFaces {
  const faces = new Map<string, TextFace>();
  return {
    faceFor(key) {
      const k = fontKeyString(key);
      let face = faces.get(k);
      if (!face) {
        face = chooseTextFace(fonts.resolve(key), warn);
        faces.set(k, face);
      }
      return face;
    },
    report() {
      if (faces.size === 0) return null;
      const parts = [...faces].map(([k, face]) => {
        const name = face.font.family ? `${face.font.family} ${face.font.style}`.trim() : `font ${k}`;
        return `${name} — ${face.source}`;
      });
      return `Fonts: ${parts.join("; ")}`;
    },
  };
}
