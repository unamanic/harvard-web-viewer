/**
 * Text as glyph paths (task 7f): one interface over the three ways of
 * drawing a font's glyphs (an original Speedo font, an outline clone, a
 * stroke clone) and the layout of one line of byte codes as a single SVG
 * path.
 *
 * Units: everything here is in "em units", 1000 per em, x from the line's
 * start, y DOWN with the baseline at y = 0. A caller scales by size / 1000
 * (e.g. with a transform) to place the line.
 *
 * Glyphs are stored as contours whose first point is absolute and whose
 * other commands are relative, so a glyph moves along the line by changing
 * the first point of each contour only. Converted glyphs are cached per
 * source and byte code.
 */

/** Units per em of everything a GlyphSource returns. */
export const EM_UNITS = 1000;

/** One contour (outline) or polyline (stroke) of a glyph. */
export interface GlyphContour {
  /** Start point, em units, y down. */
  x: number;
  y: number;
  /** The rest of the contour as relative SVG commands (starts after the "M x y"). */
  rest: string;
}

export interface PlacedGlyph {
  /** Advance width, em units. */
  advance: number;
  contours: readonly GlyphContour[];
}

export interface GlyphSource {
  /** Outlines are filled; stroke-font polylines are stroked. */
  paint: "fill" | "stroke";
  /** For "stroke": pen width, em units. */
  strokeWidth?: number;
  /** Glyph of an HG3 byte code, or null (draws nothing, advances nothing). */
  glyph(code: number): PlacedGlyph | null;
}

/** A line of text laid out with a GlyphSource. */
export interface GlyphLine {
  /** SVG path data, em units, y down, baseline at 0, starting at x = 0. "" if nothing is inked. */
  d: string;
  /** Sum of the advances, em units. */
  advance: number;
}

const fmt = (n: number): string => {
  const r = Math.round(n * 10) / 10;
  return Object.is(r, -0) ? "0" : String(r);
};

/** Lay out byte codes left to right as one path. */
export function layoutGlyphLine(source: GlyphSource, codes: ArrayLike<number>): GlyphLine {
  let pen = 0;
  let d = "";
  for (let i = 0; i < codes.length; i++) {
    const g = source.glyph(codes[i]!);
    if (!g) continue;
    for (const c of g.contours) d += `M${fmt(c.x + pen)} ${fmt(c.y)}${c.rest}`;
    pen += g.advance;
  }
  return { d, advance: pen };
}

/** Sum of the advances of byte codes, em units (no paths built). */
export function measureGlyphLine(source: GlyphSource, codes: ArrayLike<number>): number {
  let pen = 0;
  for (let i = 0; i < codes.length; i++) pen += source.glyph(codes[i]!)?.advance ?? 0;
  return pen;
}

// ---------------------------------------------------------------------------
// Path conversion
// ---------------------------------------------------------------------------

const TOKEN = /[MmLlHhVvCcQqSsTtZz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;
const ARG_COUNT: Readonly<Record<string, number>> = { m: 2, l: 2, h: 1, v: 1, c: 6, q: 4, s: 4, t: 2, z: 0 };

/**
 * Convert SVG path data (y UP, `unitsPerEm` per em, absolute or relative
 * M L H V C Q S T Z, no arcs) into contours in em units with y down. Points
 * are rounded to 0.1 em unit first and the relative steps are taken between
 * rounded points, so placed glyphs do not drift.
 */
export function contoursFromPath(path: string, unitsPerEm: number): GlyphContour[] {
  const k = EM_UNITS / unitsPerEm;
  const tokens = path.match(TOKEN) ?? [];
  const out: GlyphContour[] = [];
  const round = (v: number) => Math.round(v * 10) / 10 + 0; // + 0 turns -0 into 0
  // Current point and contour start in source units (y up); `rx, ry` the
  // rounded output position of the current point (em units, y down).
  let cx = 0, cy = 0, sx = 0, sy = 0;
  let rx = 0, ry = 0, srx = 0, sry = 0;
  let current: GlyphContour | null = null;
  let cmd = "";
  let i = 0;
  const num = () => Number(tokens[i++]);
  /** Output point for a source point, relative to the rounded current point. */
  const rel = (x: number, y: number): [number, number] => [round(x * k) - rx, round(-y * k) - ry];
  while (i < tokens.length) {
    const t = tokens[i]!;
    if (/^[A-Za-z]$/.test(t)) {
      cmd = t;
      i++;
      if (cmd === "z" || cmd === "Z") {
        if (current) current.rest += "z";
        cx = sx;
        cy = sy;
        rx = srx;
        ry = sry;
        continue;
      }
    } else if (cmd === "" || cmd === "z" || cmd === "Z") {
      throw new Error(`path data without a command at ${JSON.stringify(t)}`);
    }
    const lower = cmd.toLowerCase();
    const isRel = cmd === lower;
    const n = ARG_COUNT[lower];
    if (n === undefined) throw new Error(`unsupported path command ${JSON.stringify(cmd)}`);
    if (i + n > tokens.length) break;
    const a: number[] = [];
    for (let j = 0; j < n; j++) a.push(num());
    // Absolute coordinates of the argument pairs (source units).
    const abs = (px: number, py: number): [number, number] => (isRel ? [cx + px, cy + py] : [px, py]);
    switch (lower) {
      case "m": {
        [cx, cy] = abs(a[0]!, a[1]!);
        sx = cx;
        sy = cy;
        rx = round(cx * k);
        ry = round(-cy * k);
        srx = rx;
        sry = ry;
        current = { x: rx, y: ry, rest: "" };
        out.push(current);
        // Further pairs after M are line-tos.
        cmd = isRel ? "l" : "L";
        break;
      }
      case "l":
      case "t":
      case "h":
      case "v": {
        let x: number, y: number;
        if (lower === "h") [x, y] = [isRel ? cx + a[0]! : a[0]!, cy];
        else if (lower === "v") [x, y] = [cx, isRel ? cy + a[0]! : a[0]!];
        else [x, y] = abs(a[0]!, a[1]!);
        const [dx, dy] = rel(x, y);
        if (current) current.rest += lower === "t" ? `t${fmt(dx)} ${fmt(dy)}` : `l${fmt(dx)} ${fmt(dy)}`;
        cx = x;
        cy = y;
        rx += dx;
        ry += dy;
        break;
      }
      case "c":
      case "q":
      case "s": {
        const pts: [number, number][] = [];
        for (let j = 0; j < n; j += 2) pts.push(abs(a[j]!, a[j + 1]!));
        const parts = pts.map(([x, y]) => rel(x, y));
        if (current) current.rest += lower + parts.map(([dx, dy]) => `${fmt(dx)} ${fmt(dy)}`).join(" ");
        const [ex, ey] = pts[pts.length - 1]!;
        const [edx, edy] = parts[parts.length - 1]!;
        cx = ex;
        cy = ey;
        rx += edx;
        ry += edy;
        break;
      }
    }
  }
  return out;
}

/** Polylines (y down, `unitsPerEm` per em) → stroke contours in em units. */
export function contoursFromPolylines(
  polylines: readonly (readonly { x: number; y: number }[])[],
  unitsPerEm: number,
): GlyphContour[] {
  const k = EM_UNITS / unitsPerEm;
  const round = (v: number) => Math.round(v * k * 10) / 10 + 0;
  const out: GlyphContour[] = [];
  for (const line of polylines) {
    if (line.length === 0) continue;
    let px = round(line[0]!.x);
    let py = round(line[0]!.y);
    const c: GlyphContour = { x: px, y: py, rest: line.length === 1 ? "h0" : "" };
    for (let j = 1; j < line.length; j++) {
      const x = round(line[j]!.x);
      const y = round(line[j]!.y);
      c.rest += `l${fmt(x - px)} ${fmt(y - py)}`;
      px = x;
      py = y;
    }
    out.push(c);
  }
  return out;
}

/**
 * A GlyphSource from a per-code glyph function, with the converted glyph
 * cached per code (null results too).
 */
export function cachedGlyphSource(
  paint: "fill" | "stroke",
  build: (code: number) => PlacedGlyph | null,
  strokeWidth?: number,
): GlyphSource {
  const cache = new Map<number, PlacedGlyph | null>();
  const source: GlyphSource = {
    paint,
    glyph(code) {
      let g = cache.get(code);
      if (g === undefined) {
        g = build(code);
        cache.set(code, g);
      }
      return g;
    },
  };
  if (strokeWidth !== undefined) source.strokeWidth = strokeWidth;
  return source;
}
