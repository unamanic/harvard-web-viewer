// A small aliased rasteriser for Scene objects, so our renders can be compared
// pixel for pixel with the 640x480 reference framebuffers. Point-samples pixel
// centres (like the original's aliased drawing), fills with the nonzero rule,
// strokes as unions of segment quads plus round joins/caps (min 1 px wide),
// honours Scene.patterns ("pattern:<id>"), glyph halos, groups/transforms and
// 32-bit BMP data-URL images (stretched nearest-neighbour as HG fits a bitmap to its box, or tiled per ImageElement.tile). Text elements without glyph paths (fallback
// fonts) are drawn as a filled box of 0.5 em height over an estimated width
// (counted in stats.textBoxes) since we have no font rasteriser.
import {
  DEFAULT_STROKE_WIDTH,
  PATTERN_FILL_PREFIX,
  type FillPattern,
  type Matrix,
  type Scene,
  type SceneElement,
} from "../../src/formats/types";
import {
  arcPath,
  bandPath,
  normalizeBox,
  polylinePath,
  roundedRectPath,
  smoothPath,
  shapeBounds,
  gradientSpan,
} from "../../src/render/geometry";

type Pt = [number, number];
type Poly = Pt[];

export interface RasterResult {
  width: number;
  height: number;
  rgb: Uint8Array;
  /** 1 where text (glyphs/text) was painted last. */
  textMask: Uint8Array;
  /** What painted each pixel last (255 = outside the page): 0 background, 1 fill, 2 stroke, 3 text, 4 image, 5 halo. */
  kind: Uint8Array;
  /** CSS colour (before patterns) that painted each pixel last, as an index into `colors`. */
  colorIndex: Uint16Array;
  colors: string[];
  stats: { textBoxes: number; images: number; unknownColors: Set<string> };
}

const mul = (a: Matrix, b: Matrix): Matrix => [
  a[0] * b[0] + a[2] * b[1],
  a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3],
  a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4],
  a[1] * b[4] + a[3] * b[5] + a[5],
];
const apply = (m: Matrix, x: number, y: number): Pt => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const invert = (m: Matrix): Matrix => {
  const det = m[0] * m[3] - m[1] * m[2];
  const a = m[3] / det, b = -m[1] / det, c = -m[2] / det, d = m[0] / det;
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
};
const linScale = (m: Matrix) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));

// ---------------------------------------------------------------------------
// SVG path data -> polylines (local units)
// ---------------------------------------------------------------------------

function flattenCubic(out: Poly, p0: Pt, p1: Pt, p2: Pt, p3: Pt, tol: number) {
  const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) + Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) + Math.hypot(p3[0] - p2[0], p3[1] - p2[1]);
  const n = Math.max(2, Math.min(64, Math.ceil(Math.sqrt(len / tol))));
  for (let i = 1; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push([
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ]);
  }
}

function flattenArc(out: Poly, p0: Pt, rx: number, ry: number, phiDeg: number, large: boolean, sweep: boolean, p1: Pt) {
  if (rx === 0 || ry === 0) { out.push(p1); return; }
  rx = Math.abs(rx); ry = Math.abs(ry);
  const phi = (phiDeg * Math.PI) / 180, cos = Math.cos(phi), sin = Math.sin(phi);
  const dx = (p0[0] - p1[0]) / 2, dy = (p0[1] - p1[1]) / 2;
  const x1 = cos * dx + sin * dy, y1 = -sin * dx + cos * dy;
  const lam = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  let co = Math.sqrt(Math.max(0, num / den));
  if (large === sweep) co = -co;
  const cx1 = (co * rx * y1) / ry, cy1 = (-co * ry * x1) / rx;
  const cx = cos * cx1 - sin * cy1 + (p0[0] + p1[0]) / 2, cy = sin * cx1 + cos * cy1 + (p0[1] + p1[1]) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const t1 = ang(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
  let dt = ang((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  if (sweep && dt < 0) dt += 2 * Math.PI;
  const n = Math.max(4, Math.ceil((Math.abs(dt) / (2 * Math.PI)) * 96));
  for (let i = 1; i <= n; i++) {
    const t = t1 + (dt * i) / n;
    const ex = rx * Math.cos(t), ey = ry * Math.sin(t);
    out.push([cos * ex - sin * ey + cx, sin * ex + cos * ey + cy]);
  }
  out[out.length - 1] = p1;
}

/** Subpaths (with closed flags) of SVG path data. `tol` = local units per device pixel. */
export function parsePathData(d: string, tol: number): { pts: Poly; closed: boolean }[] {
  const toks = d.match(/[a-zA-Z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? [];
  const subs: { pts: Poly; closed: boolean }[] = [];
  let cur: Poly | null = null;
  let x = 0, y = 0, sx = 0, sy = 0, cmd = "";
  let i = 0;
  const num = () => parseFloat(toks[i++]);
  const start = () => { cur = [[x, y]]; subs.push({ pts: cur, closed: false }); };
  while (i < toks.length) {
    if (/[a-zA-Z]/.test(toks[i])) cmd = toks[i++];
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const ox = rel ? x : 0, oy = rel ? y : 0;
    switch (C) {
      case "M": x = ox + num(); y = oy + num(); sx = x; sy = y; start(); cmd = rel ? "l" : "L"; break;
      case "L": x = ox + num(); y = oy + num(); if (!cur) start(); cur!.push([x, y]); break;
      case "H": x = ox + num(); if (!cur) start(); cur!.push([x, y]); break;
      case "V": y = oy + num(); if (!cur) start(); cur!.push([x, y]); break;
      case "C": {
        const p1: Pt = [ox + num(), oy + num()], p2: Pt = [ox + num(), oy + num()], p3: Pt = [ox + num(), oy + num()];
        if (!cur) start();
        flattenCubic(cur!, [x, y], p1, p2, p3, tol); x = p3[0]; y = p3[1]; break;
      }
      case "Q": {
        const q: Pt = [ox + num(), oy + num()], p3: Pt = [ox + num(), oy + num()];
        if (!cur) start();
        flattenCubic(cur!, [x, y], [x + (2 / 3) * (q[0] - x), y + (2 / 3) * (q[1] - y)], [p3[0] + (2 / 3) * (q[0] - p3[0]), p3[1] + (2 / 3) * (q[1] - p3[1])], p3, tol);
        x = p3[0]; y = p3[1]; break;
      }
      case "A": {
        const rx = num(), ry = num(), rot = num(), la = num(), sw = num();
        const p1: Pt = [ox + num(), oy + num()];
        if (!cur) start();
        flattenArc(cur!, [x, y], rx, ry, rot, la !== 0, sw !== 0, p1); x = p1[0]; y = p1[1]; break;
      }
      case "Z": if (subs.length) subs[subs.length - 1].closed = true; x = sx; y = sy; cur = null; break;
      default: i++; // unsupported, skip
    }
  }
  return subs;
}

// ---------------------------------------------------------------------------
// Filling
// ---------------------------------------------------------------------------

type Rgb = [number, number, number];
type Paint = (px: number, py: number) => readonly [number, number, number] | null;

class Canvas {
  rgb: Uint8Array;
  textMask: Uint8Array;
  kind: Uint8Array;
  colorIndex: Uint16Array;
  colors: string[] = [];
  private colorIds = new Map<string, number>();
  curKind = 0;
  curColor = 0;
  setSource(kind: number, css: string) {
    this.curKind = kind;
    let id = this.colorIds.get(css);
    if (id === undefined) { id = this.colors.length; this.colors.push(css); this.colorIds.set(css, id); }
    this.curColor = id;
  }
  constructor(public w: number, public h: number) {
    this.rgb = new Uint8Array(w * h * 3);
    this.textMask = new Uint8Array(w * h);
    this.kind = new Uint8Array(w * h).fill(255); // 255: outside the page
    this.colorIndex = new Uint16Array(w * h);
  }
  /** Nonzero fill of device-space polygons. */
  fill(polys: Poly[], paint: Paint, isText: boolean) {
    let minY = Infinity, maxY = -Infinity;
    const edges: [number, number, number, number, number][] = []; // x0,y0,x1,y1,dir
    for (const p of polys) {
      for (let k = 0; k < p.length; k++) {
        const a = p[k], b = p[(k + 1) % p.length];
        if (a[1] === b[1]) continue;
        if (!isFinite(a[0] + a[1] + b[0] + b[1])) continue;
        edges.push(a[1] < b[1] ? [a[0], a[1], b[0], b[1], 1] : [b[0], b[1], a[0], a[1], -1]);
        minY = Math.min(minY, a[1], b[1]); maxY = Math.max(maxY, a[1], b[1]);
      }
    }
    if (!edges.length) return;
    const y0 = Math.max(0, Math.ceil(minY - 0.5)), y1 = Math.min(this.h - 1, Math.floor(maxY - 0.5));
    edges.sort((a, b) => a[1] - b[1]);
    const xs: [number, number][] = [];
    for (let py = y0; py <= y1; py++) {
      const sy = py + 0.5;
      xs.length = 0;
      for (const e of edges) {
        if (e[1] > sy) break;
        if (e[3] <= sy) continue;
        xs.push([e[0] + ((sy - e[1]) * (e[2] - e[0])) / (e[3] - e[1]), e[4]]);
      }
      if (xs.length < 2) continue;
      xs.sort((a, b) => a[0] - b[0]);
      let wind = 0;
      for (let k = 0; k < xs.length - 1; k++) {
        wind += xs[k][1];
        if (wind === 0) continue;
        const xa = Math.max(0, Math.ceil(xs[k][0] - 0.5)), xb = Math.min(this.w - 1, Math.floor(xs[k + 1][0] - 0.5));
        for (let px = xa; px <= xb; px++) {
          const c = paint(px, py);
          if (!c) continue;
          const o = (py * this.w + px) * 3;
          this.rgb[o] = c[0]; this.rgb[o + 1] = c[1]; this.rgb[o + 2] = c[2];
          this.textMask[py * this.w + px] = isText ? 1 : 0;
          this.kind[py * this.w + px] = this.curKind;
          this.colorIndex[py * this.w + px] = this.curColor;
        }
      }
    }
  }
}

function area(p: Poly) {
  let a = 0;
  for (let k = 0; k < p.length; k++) { const q = p[(k + 1) % p.length]; a += p[k][0] * q[1] - q[0] * p[k][1]; }
  return a / 2;
}
const orient = (p: Poly) => (area(p) < 0 ? p.slice().reverse() : p);

function circle(c: Pt, r: number): Poly {
  const n = Math.max(8, Math.min(48, Math.ceil(r * 4)));
  const out: Poly = [];
  for (let i = 0; i < n; i++) out.push([c[0] + r * Math.cos((2 * Math.PI * i) / n), c[1] + r * Math.sin((2 * Math.PI * i) / n)]);
  return out;
}

/** Stroke outline polygons of device-space polylines, all oriented the same way. */
function strokePolys(subs: { pts: Poly; closed: boolean }[], width: number): Poly[] {
  const r = Math.max(0.5, width / 2);
  const out: Poly[] = [];
  for (const s of subs) {
    const pts = s.pts;
    const segs = s.closed ? pts.length : pts.length - 1;
    for (let k = 0; k < segs; k++) {
      const a = pts[k], b = pts[(k + 1) % pts.length];
      const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
      if (len < 1e-9) continue;
      const nx = (-dy / len) * r, ny = (dx / len) * r;
      out.push(orient([[a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny], [b[0] - nx, b[1] - ny], [a[0] - nx, a[1] - ny]]));
    }
    if (r >= 0.75) for (const p of pts) out.push(circle(p, r));
    else if (pts.length === 1) out.push(circle(pts[0], r));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Colours, patterns, images
// ---------------------------------------------------------------------------

const colorCache = new Map<string, [number, number, number] | null>();
function parseColor(css: string): [number, number, number] | null {
  let c = colorCache.get(css);
  if (c !== undefined) return c;
  const s = css.trim();
  let m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(s);
  if (m) c = [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
  else if ((m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(s))) c = [parseInt(m[1] + m[1], 16), parseInt(m[2] + m[2], 16), parseInt(m[3] + m[3], 16)];
  else if ((m = /^rgb\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)$/i.exec(s))) c = [+m[1], +m[2], +m[3]].map(Math.round) as [number, number, number];
  else if (s === "black") c = [0, 0, 0];
  else if (s === "white") c = [255, 255, 255];
  else c = null;
  colorCache.set(css, c);
  return c;
}

function decodeBmpDataUrl(href: string): { w: number; h: number; rgba: Uint8Array } | null {
  const m = /^data:image\/bmp;base64,(.*)$/.exec(href);
  if (!m) return null;
  const b = new Uint8Array(Buffer.from(m[1], "base64"));
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const off = v.getUint32(10, true), w = v.getInt32(18, true), hs = v.getInt32(22, true), bpp = v.getUint16(28, true);
  if (bpp !== 32) return null;
  const h = Math.abs(hs);
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy = hs > 0 ? h - 1 - y : y;
    for (let x = 0; x < w; x++) {
      const s = off + (sy * w + x) * 4, d = (y * w + x) * 4;
      rgba[d] = b[s + 2]; rgba[d + 1] = b[s + 1]; rgba[d + 2] = b[s]; rgba[d + 3] = b[s + 3];
    }
  }
  return { w, h, rgba };
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

/**
 * pixelAspect: width / height of one framebuffer pixel (non-square pixels, e.g. 4:3 / (720/348) for
 * Hercules, 4:3 / (640/350) for EGA): the page is letterboxed on the W*pixelAspect x H display, then
 * mapped to pixels (a 4:3 page fills the whole framebuffer). stretch: true = pixelAspect for a 4:3 screen.
 */
export function rasterizeScene(scene: Scene, W = 640, H = 480, opts: { stretch?: boolean; pixelAspect?: number } = {}): RasterResult {
  const cv = new Canvas(W, H);
  const stats = { textBoxes: 0, images: 0, unknownColors: new Set<string>() };
  const vb = scene.viewBox;
  const pa = opts.pixelAspect ?? (opts.stretch ? (4 / 3) / (W / H) : 1);
  const s = Math.min((W * pa) / vb.width, H / vb.height);
  const sx = s / pa, sy = s;
  const root: Matrix = [sx, 0, 0, sy, (W - vb.width * sx) / 2 - vb.minX * sx, (H - vb.height * sy) / 2 - vb.minY * sy];
  const patterns = scene.patterns ?? {};

  const solid = (css: string | null): Paint | null => {
    if (css === null) return null;
    const c = parseColor(css);
    if (!c) { stats.unknownColors.add(css); return null; }
    return () => c;
  };
  const paintFor = (css: string | null, m: Matrix, owner?: SceneElement): Paint | null => {
    if (css === null) return null;
    if (css.startsWith("gradient:")) {
      const g = scene.gradients?.[css.slice(9)];
      const box = owner ? shapeBounds(owner) : null;
      if (!g || !box) return null;
      const span = gradientSpan(box, g.angle);
      const inv = invert(m);
      const len = span.end - span.start || 1;
      const offsetAt = (px: number, py: number) => {
        const [lx, ly] = apply(inv, px + 0.5, py + 0.5);
        return Math.max(0, Math.min(1, (lx * span.dir.x + ly * span.dir.y - span.start) / len));
      };
      if (g.bands && g.bands.length) {
        const paints = g.bands.map((b) => paintFor(b.paint, m));
        const offs = g.bands.map((b) => b.offset);
        return (px, py) => {
          const t = offsetAt(px, py);
          let i = 0;
          while (i + 1 < offs.length && offs[i + 1] <= t) i++;
          const p = paints[i];
          return p ? p(px, py) : null;
        };
      }
      const a = parseColor(g.from) ?? [255, 0, 255], b = parseColor(g.to) ?? [255, 0, 255];
      const c: [number, number, number] = [0, 0, 0];
      return (px, py) => { const t = offsetAt(px, py); for (let k = 0; k < 3; k++) c[k] = a[k] + (b[k] - a[k]) * t; return c; };
    }
    if (!css.startsWith(PATTERN_FILL_PREFIX)) return solid(css);
    const p: FillPattern | undefined = patterns[css.slice(PATTERN_FILL_PREFIX.length)];
    if (!p) return null;
    const MAGENTA: Rgb = [255, 0, 255];
    const ink: Rgb = parseColor(p.ink) ?? MAGENTA, paper: Rgb = parseColor(p.paper) ?? MAGENTA;
    const multi = p.colors?.map((c): Rgb => parseColor(c) ?? MAGENTA);
    // device -> element units -> pattern units
    let inv = invert(m);
    if (p.transform) inv = mul(invert(p.transform), inv);
    const rows = p.rows.length, cols = Math.max(1, ...p.rows.map((r) => r.length));
    return (px, py) => {
      const [lx, ly] = apply(inv, px + 0.5, py + 0.5);
      const ty = ((Math.floor(ly / p.pixelHeight + 1e-6) % rows) + rows) % rows;
      const tx = ((Math.floor(lx / p.pixelWidth + 1e-6) % cols) + cols) % cols;
      const ch = p.rows[ty][tx];
      if (multi) return multi[parseInt(ch, 16)] ?? paper;
      return ch === "1" ? ink : paper;
    };
  };

  const fillStroke = (d: string, el: { fill: string | null; stroke: string | null; strokeWidth?: number; kind?: string }, m: Matrix, isText = false, halo?: { color: string; width: number }) => {
    if (!d) return;
    const sc = linScale(m);
    const subs = parsePathData(d, 0.3 / (sc || 1)).map((sp) => ({ pts: sp.pts.map(([x, y]) => apply(m, x, y)), closed: sp.closed }));
    if (halo) {
      const hp = solid(halo.color);
      const w = ((el.stroke ? (el.strokeWidth ?? DEFAULT_STROKE_WIDTH) : 0) + 2 * halo.width) * sc;
      if (hp) {
        cv.setSource(5, halo.color);
        if (el.fill !== null) cv.fill(subs.map((x) => x.pts), hp, false);
        cv.fill(strokePolys(subs, w), hp, false);
      }
    }
    const f = paintFor(el.fill, m, el as SceneElement);
    if (f) { cv.setSource(isText ? 3 : 1, el.fill!); cv.fill(subs.map((x) => x.pts), f, isText); }
    const st = paintFor(el.stroke, m);
    if (st) cv.setSource(isText ? 3 : 2, el.stroke!);
    if (st) cv.fill(strokePolys(subs, (el.strokeWidth ?? DEFAULT_STROKE_WIDTH) * sc), st, isText);
  };

  const draw = (el: SceneElement, m: Matrix) => {
    switch (el.kind) {
      case "group": {
        const cm = el.transform ? mul(m, el.transform) : m;
        for (const c of el.children) draw(c, cm);
        return;
      }
      case "path":
        return fillStroke(el.smooth ? smoothPath(el.points, el.closed) : polylinePath(el.points, el.closed), el, m);
      case "ellipse": {
        const e = { cx: el.cx, cy: el.cy, rx: el.rx, ry: el.ry };
        return fillStroke(arcPath(e, 0, 360) + " Z", el, m);
      }
      case "arc":
        return fillStroke(arcPath(el, el.startAngle, el.endAngle), el, m);
      case "band":
        return fillStroke(bandPath(el, el.startAngle, el.endAngle, el.depth), el, m);
      case "rect": {
        const box = normalizeBox(el);
        const r = el.corners?.kind === "rounded" ? el.corners.radius : 0;
        return fillStroke(roundedRectPath(box, r), el, m);
      }
      case "glyphs": {
        const cm = el.transform ? mul(m, el.transform) : m;
        return fillStroke(el.d, el, cm, true, el.halo);
      }
      case "text": {
        stats.textBoxes++;
        const w = el.text.length * el.size * 0.5;
        const x0 = el.anchor === "middle" ? el.x - w / 2 : el.anchor === "end" ? el.x - w : el.x;
        const d = `M ${x0} ${el.y - el.size * 0.6} H ${x0 + w} V ${el.y} H ${x0} Z`;
        return fillStroke(d, { fill: el.fill, stroke: null }, m, true);
      }
      case "image": {
        stats.images++;
        const img = decodeBmpDataUrl(el.href);
        if (!img) return;
        const box = normalizeBox(el);
        const inv = invert(m);
        const poly = [apply(m, box.x, box.y), apply(m, box.x + box.width, box.y), apply(m, box.x + box.width, box.y + box.height), apply(m, box.x, box.y + box.height)];
        const px: [number, number, number] = [0, 0, 0];
        cv.setSource(4, "image");
        const t = el.tile;
        const mod = (a: number, n: number) => ((a % n) + n) % n;
        // Stretched and axis-aligned: the box's D device pixels (centres inside it) show the image's n pixels,
        // box pixel i the image pixel round(i * n / D), halves down (src/render/screenImage.ts, as HG draws
        // a bitmap fitted to its box); 1:1 for an image already at device pixels.
        const axis = !t && Math.abs(m[1]) < 1e-9 && Math.abs(m[2]) < 1e-9;
        const xs = poly.map((q) => q[0]), ys = poly.map((q) => q[1]);
        const bx0 = Math.ceil(Math.min(...xs) - 0.5), bx1 = Math.ceil(Math.max(...xs) - 0.5);
        const by0 = Math.ceil(Math.min(...ys) - 0.5), by1 = Math.ceil(Math.max(...ys) - 0.5);
        const clamp = (v: number, n: number) => Math.max(0, Math.min(n - 1, v));
        const stretch = (i: number, n: number, d: number) => clamp(Math.floor((i * n + Math.floor((d - 1) / 2)) / Math.max(1, d)), n);
        const flipX = m[0] < 0, flipY = m[3] < 0;
        cv.fill([poly], (x, y) => {
          const [lx, ly] = apply(inv, x + 0.5, y + 0.5);
          // Tiled (ImageElement.tile, as drawn without a screen imitation): image pixel size in element units, hot spot on the anchor.
          const ix = t
            ? mod(Math.floor((lx - (t.anchorX - t.hotX * t.pixelWidth)) / t.pixelWidth), img.w)
            : axis
              ? stretch(flipX ? bx1 - 1 - x : x - bx0, img.w, bx1 - bx0)
              : Math.min(img.w - 1, Math.max(0, Math.floor(((lx - box.x) / box.width) * img.w)));
          const iy = t
            ? mod(Math.floor((ly - (t.anchorY - t.hotY * t.pixelHeight)) / t.pixelHeight), img.h)
            : axis
              ? stretch(flipY ? by1 - 1 - y : y - by0, img.h, by1 - by0)
              : Math.min(img.h - 1, Math.max(0, Math.floor(((ly - box.y) / box.height) * img.h)));
          const o = (iy * img.w + ix) * 4;
          if (img.rgba[o + 3] < 128) return null;
          px[0] = img.rgba[o]; px[1] = img.rgba[o + 1]; px[2] = img.rgba[o + 2];
          return px;
        }, false);
        return;
      }
    }
  };

  const bgRect = { kind: "rect", x: vb.minX, y: vb.minY, width: vb.width, height: vb.height, fill: scene.background, stroke: null } as SceneElement;
  const bg = paintFor(scene.background, root, bgRect);
  const page = [apply(root, vb.minX, vb.minY), apply(root, vb.minX + vb.width, vb.minY), apply(root, vb.minX + vb.width, vb.minY + vb.height), apply(root, vb.minX, vb.minY + vb.height)];
  cv.setSource(0, scene.background);
  if (bg) cv.fill([page], bg, false);
  for (const el of scene.elements) draw(el, root);
  return { width: W, height: H, rgb: cv.rgb, textMask: cv.textMask, kind: cv.kind, colorIndex: cv.colorIndex, colors: cv.colors, stats };
}
