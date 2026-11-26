/**
 * Stroke font clones (docs/RENDERER_TASKS.md task 7d-1): the viewer's own
 * single-line fonts, built only from the public-domain Hershey font data in
 * hersheyData.ts, used for the HG stroke fonts (SPEC §2, §6.4) when the
 * original .FN3 files are not loaded.
 *
 * Glyph coordinates are in font units (unitsPerEm = 32, the Hershey body
 * height), x from the glyph origin, y downwards with the baseline at y = 0.
 * Glyphs are meant to be stroked (round caps and joins), not filled.
 */
import type { Point } from "../../model/scene";
import { hg3CodeOf } from "../../formats/charset";
import { HERSHEY_SETS, type HersheySetId } from "./hersheyData";

export interface StrokeGlyph {
  /** Horizontal advance in font units. */
  advance: number;
  /** Polylines in font units (y down, baseline at y = 0). */
  strokes: Point[][];
}

export type StrokeWeight = "light" | "bold";

export interface StrokeFont {
  /** Our own family name, e.g. "HWV Stroke Roman". */
  family: string;
  weight: StrokeWeight;
  /** Hershey set the glyphs come from. */
  hersheySet: HersheySetId;
  /** Recommended stroke width as a fraction of the em (multiply by the size). */
  strokeWidthEm: number;
  /** Font units per em. */
  unitsPerEm: number;
  /** Nominal height above the baseline, font units (positive). */
  ascent: number;
  /** Nominal depth below the baseline, font units (positive). */
  descent: number;
  /** Cap height, font units (positive). */
  capHeight: number;
  /** x-height, font units (positive). */
  xHeight: number;
  /** Glyph for a byte code of the HG3 character set, or null when the clone has none. */
  glyph(code: number): StrokeGlyph | null;
}

/** Hershey body: 32 units, the baseline 9 units below the centre line. */
export const HERSHEY_UNITS_PER_EM = 32;
const HERSHEY_BASELINE = 9;
const HERSHEY_ASCENT = 25;
const HERSHEY_DESCENT = 7;
const PEN_UP = " R";
const R = 82;

// ---------------------------------------------------------------------------
// Geometry helpers

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function inkBox(strokes: readonly Point[][]): Box | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of strokes) {
    for (const p of s) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
  }
  return minX === Infinity ? null : { minX, minY, maxX, maxY };
}

function mapStrokes(strokes: readonly Point[][], f: (p: Point) => Point): Point[][] {
  return strokes.map((s) => s.map(f));
}

function translate(strokes: readonly Point[][], dx: number, dy: number): Point[][] {
  return mapStrokes(strokes, (p) => ({ x: p.x + dx, y: p.y + dy }));
}

/** Scale uniformly about the origin. */
function scale(strokes: readonly Point[][], k: number): Point[][] {
  return mapStrokes(strokes, (p) => ({ x: p.x * k, y: p.y * k }));
}

/**
 * Fit strokes into a box `width` × `height` whose bottom centre is the
 * origin (y from -height to 0). A null width keeps the horizontal scale
 * equal to the vertical one.
 */
function fit(strokes: readonly Point[][], width: number | null, height: number): Point[][] {
  const b = inkBox(strokes);
  if (!b) return [];
  const bh = b.maxY - b.minY;
  const bw = b.maxX - b.minX;
  const sy = bh > 0 ? height / bh : 1;
  const sx = width === null ? sy : bw > 0 ? width / bw : 1;
  const cx = (b.minX + b.maxX) / 2;
  return mapStrokes(strokes, (p) => ({ x: (p.x - cx) * sx, y: (p.y - b.maxY) * sy }));
}

/** Rotate 180° about the ink centre. */
function rotate180(strokes: readonly Point[][]): Point[][] {
  const b = inkBox(strokes);
  if (!b) return [];
  const cx = b.minX + b.maxX;
  const cy = b.minY + b.maxY;
  return mapStrokes(strokes, (p) => ({ x: cx - p.x, y: cy - p.y }));
}

/**
 * Horizontal centre of the top part of the ink (the top 40%), where an accent
 * sits: the apex of A, the bowl of e, the slanted top of a script letter.
 */
function topCentre(strokes: readonly Point[][]): number {
  const b = inkBox(strokes);
  if (!b) return 0;
  const limit = b.minY + 0.4 * (b.maxY - b.minY);
  let minX = Infinity;
  let maxX = -Infinity;
  for (const s of strokes) {
    for (const p of s) {
      if (p.y <= limit) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
      }
    }
  }
  return minX === Infinity ? (b.minX + b.maxX) / 2 : (minX + maxX) / 2;
}

// ---------------------------------------------------------------------------
// Decoding

/** Decode one .jhf pair string (left/right pair first) into a glyph. */
export function decodeHersheyGlyph(data: string): StrokeGlyph {
  const left = data.charCodeAt(0) - R;
  const right = data.charCodeAt(1) - R;
  const strokes: Point[][] = [];
  let current: Point[] = [];
  for (let i = 2; i + 1 < data.length; i += 2) {
    if (data.slice(i, i + 2) === PEN_UP) {
      if (current.length > 0) strokes.push(current);
      current = [];
      continue;
    }
    current.push({ x: data.charCodeAt(i) - R - left, y: data.charCodeAt(i + 1) - R - HERSHEY_BASELINE });
  }
  if (current.length > 0) strokes.push(current);
  return { advance: right - left, strokes };
}

// ---------------------------------------------------------------------------
// Composition of HG3 characters beyond ASCII

type Accent = "acute" | "grave" | "circumflex" | "diaeresis" | "tilde" | "ring";

type Recipe =
  | { kind: "accent"; base: string; accent: Accent }
  | { kind: "cedilla"; base: string }
  | { kind: "ligature"; first: string; second: string }
  | { kind: "inverted"; base: string }
  | { kind: "guillemet"; base: string }
  | { kind: "superscript"; base: string; underline?: boolean }
  | { kind: "copy"; base: string }
  | { kind: "slashed"; base: string }
  | { kind: "cent" }
  | { kind: "yen" }
  | { kind: "middleDot" };

const acc = (base: string, accent: Accent): Recipe => ({ kind: "accent", base, accent });

/**
 * HG3 code (src/formats/charset.ts) → how to build it from the set's
 * ASCII glyphs. The original stroke fonts follow the same character set:
 * HG3.FGF gives them glyphs for the letters at 0xB5–0xEB and none for the
 * box drawing between them.
 */
const RECIPES: ReadonlyMap<number, Recipe> = new Map<number, Recipe>([
  [128, { kind: "cedilla", base: "C" }],
  [129, acc("u", "diaeresis")],
  [130, acc("e", "acute")],
  [131, acc("a", "circumflex")],
  [132, acc("a", "diaeresis")],
  [133, acc("a", "grave")],
  [134, acc("a", "ring")],
  [135, { kind: "cedilla", base: "c" }],
  [136, acc("e", "circumflex")],
  [137, acc("e", "diaeresis")],
  [138, acc("e", "grave")],
  [139, acc("ı", "diaeresis")],
  [140, acc("ı", "circumflex")],
  [141, acc("ı", "grave")],
  [142, acc("A", "diaeresis")],
  [143, acc("A", "ring")],
  [144, acc("E", "acute")],
  [145, { kind: "ligature", first: "a", second: "e" }],
  [146, { kind: "ligature", first: "A", second: "E" }],
  [147, acc("o", "circumflex")],
  [148, acc("o", "diaeresis")],
  [149, acc("o", "grave")],
  [150, acc("u", "circumflex")],
  [151, acc("u", "grave")],
  [152, acc("y", "diaeresis")],
  [153, acc("O", "diaeresis")],
  [154, acc("U", "diaeresis")],
  [155, { kind: "slashed", base: "o" }],
  [157, { kind: "slashed", base: "O" }],
  [160, acc("a", "acute")],
  [161, acc("ı", "acute")],
  [162, acc("o", "acute")],
  [163, acc("u", "acute")],
  [164, acc("n", "tilde")],
  [165, acc("N", "tilde")],
  [166, { kind: "superscript", base: "a", underline: true }],
  [167, { kind: "superscript", base: "o", underline: true }],
  [168, { kind: "inverted", base: "?" }],
  [173, { kind: "inverted", base: "!" }],
  [174, { kind: "guillemet", base: "<" }],
  [175, { kind: "guillemet", base: ">" }],
  [0xb5, acc("A", "acute")],
  [0xb6, acc("A", "circumflex")],
  [0xb7, acc("A", "grave")],
  [0xbd, { kind: "cent" }],
  [0xbe, { kind: "yen" }],
  [0xc6, acc("a", "tilde")],
  [0xc7, acc("A", "tilde")],
  [0xd2, acc("E", "circumflex")],
  [0xd4, acc("E", "grave")],
  [0xd6, acc("I", "acute")],
  [0xde, acc("I", "grave")],
  [0xe0, acc("O", "acute")],
  [0xe2, acc("O", "circumflex")],
  [0xe3, acc("O", "grave")],
  [0xe4, acc("o", "tilde")],
  [0xe5, acc("O", "tilde")],
  [0xe9, acc("U", "acute")],
  [0xeb, acc("U", "grave")],
  [248, { kind: "superscript", base: "o" }],
  [250, { kind: "middleDot" }],
  [0xfc, { kind: "copy", base: "*" }],
  [0xfd, { kind: "copy", base: "-" }],
]);

/** HG3 codes the clones can draw beyond ASCII 32–126. */
export const COMPOSED_CODES: readonly number[] = [...RECIPES.keys()];

class HersheyStrokeFont implements StrokeFont {
  readonly unitsPerEm = HERSHEY_UNITS_PER_EM;
  readonly ascent = HERSHEY_ASCENT;
  readonly descent = HERSHEY_DESCENT;
  readonly capHeight: number;
  readonly xHeight: number;
  private readonly data: readonly string[];
  private readonly cache = new Map<number, StrokeGlyph | null>();

  constructor(
    readonly family: string,
    readonly weight: StrokeWeight,
    readonly hersheySet: HersheySetId,
    readonly strokeWidthEm: number,
  ) {
    this.data = HERSHEY_SETS[hersheySet];
    this.capHeight = -(inkBox(this.ascii("H").strokes)?.minY ?? -21);
    this.xHeight = -(inkBox(this.ascii("x").strokes)?.minY ?? -14);
  }

  glyph(code: number): StrokeGlyph | null {
    if (!Number.isInteger(code) || code < 0 || code > 255) return null;
    let g = this.cache.get(code);
    if (g === undefined) {
      g = this.build(code);
      this.cache.set(code, g);
    }
    return g;
  }

  private build(code: number): StrokeGlyph | null {
    if (code >= 32 && code <= 126) return decodeHersheyGlyph(this.data[code - 32]);
    const recipe = RECIPES.get(code);
    return recipe ? this.compose(recipe) : null;
  }

  /** ASCII glyph by character; "ı" is a dotless i made from "i". */
  private ascii(ch: string): StrokeGlyph {
    if (ch === "ı") return this.dotless();
    return decodeHersheyGlyph(this.data[ch.charCodeAt(0) - 32]);
  }

  /** "i" without the strokes that lie wholly above the x-height. */
  private dotless(): StrokeGlyph {
    const i = this.ascii("i");
    const top = inkBox(this.ascii("x").strokes)?.minY ?? -14;
    const strokes = i.strokes.filter((s) => s.some((p) => p.y > top - 0.5));
    return { advance: i.advance, strokes: strokes.length > 0 ? strokes : i.strokes };
  }

  private accentStrokes(accent: Accent, capital: boolean): Point[][] {
    const k = capital ? 0.85 : 1;
    switch (accent) {
      case "acute":
        return fit(this.ascii("/").strokes, 3 * k, 4 * k);
      case "grave":
        return fit(this.ascii("\\").strokes, 3 * k, 4 * k);
      case "circumflex":
        // The ASCII "^" is an up arrow in most Hershey sets; its first stroke is the caret.
        return fit(this.ascii("^").strokes.slice(0, 1), 6 * k, 3.5 * k);
      case "tilde":
        return fit(this.ascii("~").strokes, 7 * k, 2.5 * k);
      case "ring":
        return fit(this.ascii("o").strokes, null, 4.5 * k);
      case "diaeresis": {
        const dot = fit(this.ascii(".").strokes, null, Math.min(2, inkHeight(this.ascii(".").strokes)));
        const dx = capital ? 3.5 : 3;
        return [...translate(dot, -dx, 0), ...translate(dot, dx, 0)];
      }
    }
  }

  private compose(r: Recipe): StrokeGlyph | null {
    switch (r.kind) {
      case "accent": {
        const base = this.ascii(r.base);
        const b = inkBox(base.strokes);
        if (!b) return null;
        const capital = r.base >= "A" && r.base <= "Z";
        const mark = this.accentStrokes(r.accent, capital);
        const gap = capital ? 2 : 3;
        return {
          advance: base.advance,
          strokes: [...base.strokes, ...translate(mark, topCentre(base.strokes), b.minY - gap)],
        };
      }
      case "cedilla": {
        const base = this.ascii(r.base);
        const b = inkBox(base.strokes);
        const comma = this.ascii(",").strokes;
        const cb = inkBox(comma);
        if (!b || !cb) return null;
        const cx = (b.minX + b.maxX) / 2;
        const placed = translate(comma, cx - (cb.minX + cb.maxX) / 2, b.maxY - cb.minY - 0.5);
        return { advance: base.advance, strokes: [...base.strokes, ...placed] };
      }
      case "ligature": {
        const a = this.ascii(r.first);
        const e = this.ascii(r.second);
        const ab = inkBox(a.strokes);
        const eb = inkBox(e.strokes);
        if (!ab || !eb) return null;
        // Overlap so the second letter's left edge meets the first's right edge.
        const offset = ab.maxX - eb.minX - 0.15 * (ab.maxX - ab.minX);
        return { advance: offset + e.advance, strokes: [...a.strokes, ...translate(e.strokes, offset, 0)] };
      }
      case "inverted": {
        const base = this.ascii(r.base);
        const b = inkBox(base.strokes);
        if (!b) return null;
        const turned = rotate180(base.strokes);
        // Hang the turned mark from the x-height down into the descender.
        const tb = inkBox(turned)!;
        return { advance: base.advance, strokes: translate(turned, 0, -this.xHeight - tb.minY) };
      }
      case "guillemet": {
        const base = this.ascii(r.base);
        const small = fit(base.strokes, null, this.xHeight * 0.6);
        const sb = inkBox(small);
        if (!sb) return null;
        const w = sb.maxX - sb.minX;
        const step = w * 0.75;
        const y = -this.xHeight * 0.2;
        const left = (base.advance - (w + step)) / 2 - sb.minX;
        return {
          advance: base.advance,
          strokes: [...translate(small, left, y), ...translate(small, left + step, y)],
        };
      }
      case "superscript": {
        const base = this.ascii(r.base);
        const k = 0.6;
        const small = scale(base.strokes, k);
        const sb = inkBox(small);
        if (!sb) return null;
        const dy = -this.capHeight - sb.minY;
        const pad = 1.5;
        const strokes = translate(small, pad - sb.minX, dy);
        if (r.underline) {
          const bar = fit(this.ascii("-").strokes, sb.maxX - sb.minX, 0);
          strokes.push(...translate(bar, pad + (sb.maxX - sb.minX) / 2, sb.maxY + dy + 2.5));
        }
        return { advance: sb.maxX - sb.minX + 2 * pad, strokes };
      }
      case "copy":
        return this.ascii(r.base);
      case "slashed": {
        const base = this.ascii(r.base);
        const b = inkBox(base.strokes);
        if (!b) return null;
        const over = 1;
        const slash = [{ x: b.minX - over, y: b.maxY + over }, { x: b.maxX + over, y: b.minY - over }];
        return { advance: base.advance, strokes: [...base.strokes, slash] };
      }
      case "cent": {
        const c = this.ascii("c");
        const b = inkBox(c.strokes);
        if (!b) return null;
        const bar = fit(this.ascii("|").strokes, 0, b.maxY - b.minY + 6);
        return { advance: c.advance, strokes: [...c.strokes, ...translate(bar, (b.minX + b.maxX) / 2, b.maxY + 3)] };
      }
      case "yen": {
        const y = this.ascii("Y");
        const b = inkBox(y.strokes);
        if (!b) return null;
        const bar = fit(this.ascii("-").strokes, (b.maxX - b.minX) * 0.6, 0);
        const cx = (b.minX + b.maxX) / 2;
        const h = b.maxY - b.minY;
        return {
          advance: y.advance,
          strokes: [...y.strokes, ...translate(bar, cx, b.maxY - h * 0.38), ...translate(bar, cx, b.maxY - h * 0.22)],
        };
      }
      case "middleDot": {
        const dot = this.ascii(".");
        const b = inkBox(dot.strokes);
        if (!b) return null;
        return { advance: dot.advance, strokes: translate(dot.strokes, 0, -this.xHeight / 2 - (b.minY + b.maxY) / 2) };
      }
    }
  }
}

function inkHeight(strokes: readonly Point[][]): number {
  const b = inkBox(strokes);
  return b ? b.maxY - b.minY : 0;
}

/** Create a clone face from a Hershey set. */
export function createStrokeFont(
  family: string,
  weight: StrokeWeight,
  hersheySet: HersheySetId,
  strokeWidthEm: number,
): StrokeFont {
  return new HersheyStrokeFont(family, weight, hersheySet, strokeWidthEm);
}

// ---------------------------------------------------------------------------
// Text to SVG path data

export interface StrokeText {
  /** SVG path data, y down, baseline at y = 0, starting at x = 0. Stroke it, don't fill it. */
  d: string;
  /** Total advance in the same units as sizeUnits. */
  advance: number;
  /** Recommended stroke width in the same units (strokeWidthEm × sizeUnits). */
  strokeWidth: number;
}

function num(v: number): string {
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? "0" : String(r);
}

/**
 * Lay out one line of text as stroke paths. `text` is Unicode (already
 * decoded from the HG3 character set) or an array of HG3 byte codes; `sizeUnits` is the em size
 * in output units. Characters without a glyph advance by the space width.
 */
export function textToStrokePaths(font: StrokeFont, text: string | readonly number[], sizeUnits: number): StrokeText {
  const codes = typeof text === "string" ? Array.from(text, (ch) => hg3CodeOf(ch) ?? -1) : text;
  const k = sizeUnits / font.unitsPerEm;
  const spaceAdvance = font.glyph(32)?.advance ?? font.unitsPerEm / 2;
  const parts: string[] = [];
  let x = 0;
  for (const code of codes) {
    const g = font.glyph(code);
    if (!g) {
      x += spaceAdvance;
      continue;
    }
    for (const s of g.strokes) {
      if (s.length === 0) continue;
      let seg = `M${num((x + s[0].x) * k)} ${num(s[0].y * k)}`;
      if (s.length === 1) seg += "h0";
      for (let i = 1; i < s.length; i++) seg += `L${num((x + s[i].x) * k)} ${num(s[i].y * k)}`;
      parts.push(seg);
    }
    x += g.advance;
  }
  return { d: parts.join(""), advance: x * k, strokeWidth: font.strokeWidthEm * sizeUnits };
}
