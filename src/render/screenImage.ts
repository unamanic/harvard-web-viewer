/**
 * Bitmaps on an imitated screen (dither.ts `applyScreen`): an image with
 * indexed pixels (ImageElement.pixels) is redrawn at the screen's own
 * resolution, each screen pixel taking the colour of the image pixel under
 * it as the screen shows that colour in a fill at that position (for a
 * dithered colour, the dither tile's pixel there, aligned to the screen's
 * grid like every fill pattern). The result is a plain stretched image of
 * the box in screen pixels, still indexed.
 *
 * Where the image pixel lies: a tiled image with `screenPixels` is drawn
 * one image pixel per screen pixel from the screen pixel
 * floor(anchor − hot) (ImageTile); another tiled image at its pixel size in
 * element units; an untiled one stretched to its box. Every screen pixel
 * whose centre is inside the box is drawn (as for any filled shape).
 * Stretched, the box's D screen pixels in a row (or column) show the image's
 * n pixels nearest-neighbour, box pixel i (from the box's first screen
 * pixel) showing image pixel round(i × n / D), halves rounded down, i.e.
 * floor((i × n + floor((D − 1) / 2)) / D): the first and last box pixels
 * show the first and last image pixels [I, from the screenshots of
 * samples/claude-vs-codex, assumptions.ts BITMAP_FIT_TO_BOX: 530 × 290
 * bitmaps in 564 × 424-pixel boxes; this matches every column and row where
 * the screenshots repeat one (373 columns and 252 rows identified, 0
 * mismatches; sampling at pixel centres, floor((i + ½) × n / D), gets 181
 * columns and 124 rows wrong)].
 *
 * Images without `pixels`, and images in rotated, sheared or mirrored
 * groups, are left unchanged.
 */
import type { ImageElement, IndexedPixels, Matrix } from "../formats/types";
import { pcxToDataUrl } from "../formats/pcx/toDataUrl";
import { parseCssColor } from "./color";
import type { ScreenGeometry } from "./dither";

/** The screen colour (CSS) for stored colour `css` at screen pixel (sx, sy) (counted from the screen's top left). */
export type ScreenColorAt = (css: string, sx: number, sy: number) => string;

const mod = (a: number, n: number) => ((a % n) + n) % n;

/**
 * `el` as the screen shows it (module comment), in the units of the
 * element (mapped to the scene by `toScene`); null when no screen pixel of
 * its box is on the screen.
 */
export function screenImage(
  el: ImageElement,
  toScene: Matrix,
  geo: ScreenGeometry,
  screen: { width: number; height: number },
  colorAt: ScreenColorAt,
): ImageElement | null {
  const px = el.pixels;
  if (!px || px.width <= 0 || px.height <= 0 || px.data.length < px.width * px.height) return el;
  const [a, b, c, d, e, f] = toScene;
  if (Math.abs(b) > 1e-9 || Math.abs(c) > 1e-9 || !(a > 0) || !(d > 0)) return el;
  // Element units ↔ screen pixels (fractional, from the screen's top left).
  const toX = (x: number) => (a * x + e - geo.originX) / geo.pixelWidth;
  const toY = (y: number) => (d * y + f - geo.originY) / geo.pixelHeight;
  const fromX = (sx: number) => (sx * geo.pixelWidth + geo.originX - e) / a;
  const fromY = (sy: number) => (sy * geo.pixelHeight + geo.originY - f) / d;
  const xs = [toX(el.x), toX(el.x + el.width)];
  const ys = [toY(el.y), toY(el.y + el.height)];
  // The box's screen pixels (centres inside it), before clipping to the screen.
  const bx0 = Math.ceil(Math.min(...xs) - 0.5);
  const bx1 = Math.ceil(Math.max(...xs) - 0.5);
  const by0 = Math.ceil(Math.min(...ys) - 0.5);
  const by1 = Math.ceil(Math.max(...ys) - 0.5);
  const x0 = Math.max(0, bx0);
  const x1 = Math.min(screen.width, bx1);
  const y0 = Math.max(0, by0);
  const y1 = Math.min(screen.height, by1);
  if (x1 <= x0 || y1 <= y0) return null;

  const { width: w, height: h } = px;
  let column: (sx: number) => number;
  let row: (sy: number) => number;
  const t = el.tile;
  if (t?.screenPixels) {
    const ox = Math.floor(toX(t.anchorX) - t.hotX);
    const oy = Math.floor(toY(t.anchorY) - t.hotY);
    column = (sx) => mod(sx - ox, w);
    row = (sy) => mod(sy - oy, h);
  } else if (t && t.pixelWidth > 0 && t.pixelHeight > 0) {
    const ex0 = t.anchorX - t.hotX * t.pixelWidth;
    const ey0 = t.anchorY - t.hotY * t.pixelHeight;
    column = (sx) => mod(Math.floor((fromX(sx + 0.5) - ex0) / t.pixelWidth), w);
    row = (sy) => mod(Math.floor((fromY(sy + 0.5) - ey0) / t.pixelHeight), h);
  } else {
    // Stretched: D box pixels show n image pixels, box pixel i the image pixel round(i × n / D), halves down.
    const clamp = (v: number, n: number) => Math.max(0, Math.min(n - 1, v));
    const stretch = (i: number, n: number, d: number) => clamp(Math.floor((i * n + Math.floor((d - 1) / 2)) / d), n);
    column = (sx) => stretch(sx - bx0, w, bx1 - bx0);
    row = (sy) => stretch(sy - by0, h, by1 - by0);
  }

  const W = x1 - x0;
  const H = y1 - y0;
  const data = new Uint8Array(W * H);
  const rgba = new Uint8ClampedArray(W * H * 4);
  const palette: (string | null)[] = [];
  const indexOf = new Map<string | null, number>();
  const columns = Array.from({ length: W }, (_, i) => column(x0 + i));
  for (let j = 0; j < H; j++) {
    const sy = y0 + j;
    const base = row(sy) * w;
    for (let i = 0; i < W; i++) {
      const sx = x0 + i;
      const stored = px.palette[px.data[base + columns[i]]] ?? null;
      const shown = stored === null ? null : colorAt(stored, sx, sy);
      let k = indexOf.get(shown);
      if (k === undefined) {
        k = palette.length;
        indexOf.set(shown, k);
        palette.push(shown);
      }
      const o = j * W + i;
      data[o] = k;
      const rgb = shown === null ? null : parseCssColor(shown);
      if (rgb) rgba.set([rgb[0], rgb[1], rgb[2], 255], o * 4);
    }
  }
  const pixels: IndexedPixels = { width: W, height: H, data, palette };
  return {
    kind: "image",
    href: pcxToDataUrl({ width: W, height: H, rgba }),
    x: fromX(x0),
    y: fromY(y0),
    width: fromX(x1) - fromX(x0),
    height: fromY(y1) - fromY(y0),
    pixels,
  };
}
