/**
 * GlyphSource adapters (task 7f) for the three kinds of font the viewer
 * draws with: an original Bitstream Speedo font (src/formats/speedo), an
 * outline clone (./outline) and a stroke clone (./stroke). Each adapter is
 * created once per font (and character map) and caches its converted glyphs.
 */
import type { SpeedoFont } from "../formats/speedo/speedo";
import { type GlyphSource, cachedGlyphSource, contoursFromPath, contoursFromPolylines } from "./glyphRun";
import type { OutlineFont } from "./outline/types";
import type { StrokeFont } from "./stroke/strokeFont";

/** Character map value meaning "no glyph" (HG3.FGF, SPEC §2). */
const NO_GLYPH = 0xffff;

const speedoSources = new WeakMap<SpeedoFont, Map<string, GlyphSource>>();

/**
 * Glyphs of an original Speedo font, by byte code through an HG3.FGF
 * character map (code → Speedo directory index; SPEC §2). Codes without an
 * entry, or whose glyph cannot be decoded, draw nothing.
 */
export function speedoGlyphSource(font: SpeedoFont, charMap: Uint16Array): GlyphSource {
  let byMap = speedoSources.get(font);
  if (!byMap) {
    byMap = new Map();
    speedoSources.set(font, byMap);
  }
  const mapKey = charMap.join(",");
  let source = byMap.get(mapKey);
  if (!source) {
    const map = charMap.slice();
    const k = 1000 / font.orusPerEm;
    source = cachedGlyphSource("fill", (code) => {
      const id = map[code];
      if (id === undefined || id === NO_GLYPH) return null;
      const g = font.glyph(id);
      if (!g) return null;
      return { advance: g.advanceWidth * k, contours: g.path ? contoursFromPath(g.path, font.orusPerEm) : [] };
    });
    byMap.set(mapKey, source);
  }
  return source;
}

const outlineSources = new WeakMap<OutlineFont, GlyphSource>();

/** Glyphs of an outline clone face (1000 units per em, y up). */
export function outlineGlyphSource(font: OutlineFont): GlyphSource {
  let source = outlineSources.get(font);
  if (!source) {
    source = cachedGlyphSource("fill", (code) => {
      const g = font.glyph(code);
      if (!g) return null;
      return { advance: (g.advance * 1000) / font.unitsPerEm, contours: g.path ? contoursFromPath(g.path, font.unitsPerEm) : [] };
    });
    outlineSources.set(font, source);
  }
  return source;
}

const strokeSources = new WeakMap<StrokeFont, GlyphSource>();

/**
 * Glyphs of a stroke clone (polylines, y down). As in textToStrokePaths, a
 * code without a glyph advances by the space width.
 */
export function strokeGlyphSource(font: StrokeFont): GlyphSource {
  let source = strokeSources.get(font);
  if (!source) {
    const k = 1000 / font.unitsPerEm;
    const space = (font.glyph(32)?.advance ?? font.unitsPerEm / 2) * k;
    source = cachedGlyphSource(
      "stroke",
      (code) => {
        const g = font.glyph(code);
        if (!g) return { advance: space, contours: [] };
        return { advance: g.advance * k, contours: contoursFromPolylines(g.strokes, font.unitsPerEm) };
      },
      font.strokeWidthEm * 1000,
    );
    strokeSources.set(font, source);
  }
  return source;
}
