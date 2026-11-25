/**
 * Pure geometry of every transition (SPEC §4.5 "suggested drawing"): which
 * layers are drawn at a given progress, how each is clipped and shifted.
 * The stage turns a frame into CSS (clip-path, transform); tests and the
 * static frame renderer use the same numbers.
 *
 * All lengths are fractions of the stage (0..1), y downwards.
 */
import type { Transition } from "./types";

/** A rectangle in stage fractions. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Layer {
  which: "previous" | "current";
  /** Visible part: the union of these boxes; null = not clipped, [] = nothing visible. */
  clip: Box[] | null;
  /** Shift in stage fractions (Scroll). */
  dx: number;
  dy: number;
  /** Draw the scene without its background, so the layer below shows through (Overlay, Keep). */
  transparent: boolean;
}

/** Layers bottom to top. */
export type Frame = Layer[];

const layer = (which: Layer["which"], extra: Partial<Layer> = {}): Layer => ({
  which,
  clip: null,
  dx: 0,
  dy: 0,
  transparent: false,
  ...extra,
});

/** Number of stripes in Blinds. */
export const BLINDS_STRIPES = 10;
/** Grid of small pieces in Fade (columns × rows; 4:3 cells on a 4:3 page). */
export const FADE_COLUMNS = 40;
export const FADE_ROWS = 30;

/** Deterministic shuffle of 0..n-1 (xorshift32), so every Fade dissolves the same way. */
function shuffledOrder(n: number, seed: number): number[] {
  const order = Array.from({ length: n }, (_, i) => i);
  let s = seed >>> 0 || 1;
  for (let i = n - 1; i > 0; i--) {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    const j = s % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

let fadeOrderCache: number[] | null = null;
/** Rank of each cell (row-major index) in the dissolve: cell i appears when rank < revealed count. */
function fadeRanks(): number[] {
  if (!fadeOrderCache) {
    const order = shuffledOrder(FADE_COLUMNS * FADE_ROWS, 0x48473321);
    fadeOrderCache = new Array<number>(order.length);
    order.forEach((cell, rank) => (fadeOrderCache![cell] = rank));
  }
  return fadeOrderCache;
}

/**
 * The cells shown after `revealed` of them have appeared, merged into
 * horizontal runs per row to keep the clip path short.
 */
export function fadeBoxes(revealed: number): Box[] {
  const ranks = fadeRanks();
  const boxes: Box[] = [];
  const w = 1 / FADE_COLUMNS;
  const h = 1 / FADE_ROWS;
  for (let row = 0; row < FADE_ROWS; row++) {
    let start = -1;
    for (let col = 0; col <= FADE_COLUMNS; col++) {
      const on = col < FADE_COLUMNS && ranks[row * FADE_COLUMNS + col] < revealed;
      if (on && start < 0) start = col;
      else if (!on && start >= 0) {
        boxes.push({ x: start * w, y: row * h, w: (col - start) * w, h });
        start = -1;
      }
    }
  }
  return boxes;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const vertical = (t: Transition) => t.direction === "left" || t.direction === "right";

/**
 * The layers to draw `progress` (0..1) of the way through `t`. `hasPrevious`
 * is false at the start of a show: the new slide is then drawn alone. At
 * progress 1 every animated effect ends as the new slide alone; Overlay and
 * Keep keep the old slide under the new one.
 */
export function frameAt(t: Transition, progress: number, hasPrevious = true): Frame {
  const p = clamp01(progress);
  if (!hasPrevious) return [layer("current")];
  switch (t.effect) {
    case "overlay":
    case "keep":
      return [layer("previous"), layer("current", { transparent: true })];
    case "replace":
      return [layer("current")];
  }
  if (p >= 1 || t.durationMs <= 0) return [layer("current")];
  const q = 1 - p;
  switch (t.effect) {
    case "wipe": {
      if (t.direction === "out") {
        // From the vertical centre line out to both sides.
        return [layer("previous"), layer("current", { clip: [{ x: q / 2, y: 0, w: p, h: 1 }] })];
      }
      if (t.direction === "in") {
        // From both sides in to the vertical centre line.
        const side = p / 2;
        return [layer("previous"), layer("current", { clip: [{ x: 0, y: 0, w: side, h: 1 }, { x: 1 - side, y: 0, w: side, h: 1 }] })];
      }
      // The edge moves in `direction`, revealing the new slide behind it.
      const clip: Box =
        t.direction === "right"
          ? { x: 0, y: 0, w: p, h: 1 }
          : t.direction === "up"
            ? { x: 0, y: q, w: 1, h: p }
            : t.direction === "down"
              ? { x: 0, y: 0, w: 1, h: p }
              : { x: q, y: 0, w: p, h: 1 };
      return [layer("previous"), layer("current", { clip: [clip] })];
    }
    case "scroll": {
      // Both pictures move in `direction`; the new one comes from the opposite side (in/out: left).
      const [ux, uy] =
        t.direction === "right" ? [1, 0] : t.direction === "up" ? [0, -1] : t.direction === "down" ? [0, 1] : [-1, 0];
      return [
        layer("previous", { dx: ux * p, dy: uy * p }),
        layer("current", { dx: -ux * q, dy: -uy * q }),
      ];
    }
    case "fade":
      return [layer("previous"), layer("current", { clip: fadeBoxes(Math.round(p * FADE_COLUMNS * FADE_ROWS)) })];
    case "open": {
      // From the centre line outwards (horizontal line unless left/right).
      const clip: Box = vertical(t) ? { x: q / 2, y: 0, w: p, h: 1 } : { x: 0, y: q / 2, w: 1, h: p };
      return [layer("previous"), layer("current", { clip: [clip] })];
    }
    case "close": {
      // From the edges inwards: the old slide shrinks to the centre line on top.
      const clip: Box = vertical(t) ? { x: p / 2, y: 0, w: q, h: 1 } : { x: 0, y: p / 2, w: 1, h: q };
      return [layer("current"), layer("previous", { clip: [clip] })];
    }
    case "blinds": {
      // Every stripe grows at once in `direction` (down unless up/left/right).
      const n = BLINDS_STRIPES;
      const back = t.direction === "up" || t.direction === "left";
      const start = (k: number) => (back ? (k + q) / n : k / n);
      const clip = Array.from({ length: n }, (_, k): Box =>
        vertical(t) ? { x: start(k), y: 0, w: p / n, h: 1 } : { x: 0, y: start(k), w: 1, h: p / n },
      );
      return [layer("previous"), layer("current", { clip })];
    }
    case "iris":
      // Growing rectangle unless "in".
      if (t.direction === "in") {
        // Shrinking rectangle: the old slide inside it, the new one around it.
        return [layer("current"), layer("previous", { clip: [{ x: p / 2, y: p / 2, w: q, h: q }] })];
      }
      return [layer("previous"), layer("current", { clip: [{ x: q / 2, y: q / 2, w: p, h: p }] })];
  }
}

// ---------------------------------------------------------------------------
// CSS
// ---------------------------------------------------------------------------

const pct = (v: number) => `${+(v * 100).toFixed(3)}%`;

/** A CSS clip-path for the union of `boxes`: inset() for one box, else a polygon(). */
export function clipPathCss(boxes: Box[]): string {
  if (boxes.length === 0) return "polygon(0 0, 0 0, 0 0)";
  if (boxes.length === 1) {
    const { x, y, w, h } = boxes[0];
    return `inset(${pct(y)} ${pct(1 - x - w)} ${pct(1 - y - h)} ${pct(x)})`;
  }
  // One polygon: each box traced clockwise from the corner (0, 0) and back;
  // the connecting lines have no area.
  const pts: string[] = [];
  for (const { x, y, w, h } of boxes) {
    pts.push("0 0", `${pct(x)} ${pct(y)}`, `${pct(x + w)} ${pct(y)}`, `${pct(x + w)} ${pct(y + h)}`, `${pct(x)} ${pct(y + h)}`, `${pct(x)} ${pct(y)}`);
  }
  pts.push("0 0");
  return `polygon(${pts.join(", ")})`;
}

/** Inline CSS for a layer (absolute positioning comes from the stylesheet). */
export function layerCss(l: Layer): { clipPath?: string; transform?: string } {
  const css: { clipPath?: string; transform?: string } = {};
  if (l.clip) css.clipPath = clipPathCss(l.clip);
  if (l.dx !== 0 || l.dy !== 0) css.transform = `translate(${pct(l.dx)}, ${pct(l.dy)})`;
  return css;
}
