/** Types of the outline clone fonts (task 7d-2). */

/** Shape of a generated face module (faces/*.ts, default export). */
export interface OutlineFaceData {
  id: string;
  family: string;
  style: string;
  /** 256 advance widths by byte code, 1000 units per em; -1 = no glyph. */
  advances: readonly number[];
  /**
   * 256 SVG path strings by byte code, 1000 units per em, y up, baseline at
   * 0; "" = blank glyph (space), null = no glyph. Commands: absolute M at the
   * start of each contour, then relative l/h/v/q, and z.
   */
  paths: readonly (string | null)[];
}

export interface OutlineGlyph {
  /** Advance width in font units (1000 per em). */
  advance: number;
  /** SVG path data in font units, y up, baseline at 0 ("" = blank). */
  path: string;
}

export interface OutlineFont {
  family: string;
  style: string;
  unitsPerEm: 1000;
  /** Top of 'd' in the original face (y up). */
  ascent: number;
  /** Bottom of 'p' in the original face (negative, y up). */
  descent: number;
  capHeight: number;
  xHeight: number;
  /** Glyph for a byte code (HG3 character set, see charset.ts), or null. */
  glyph(code: number): OutlineGlyph | null;
}

/** What is known about a clone without loading its outlines. */
export interface OutlineCloneInfo {
  /** Clone face id (generated module name). */
  id: string;
  family: string;
  style: string;
  /** File name of the original face it stands in for. */
  originalFile: string;
  unitsPerEm: 1000;
  ascent: number;
  descent: number;
  capHeight: number;
  xHeight: number;
  italicAngle: number;
  /** Advance width of a byte code in font units, or null if no glyph. */
  advance(code: number): number | null;
}
