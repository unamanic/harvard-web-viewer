/**
 * Drawing one video frame from its layers (timeline.ts → frameAt): pure
 * geometry in pixels (`drawOps`), then canvas calls (`drawFrame`) on any
 * 2D context, so tests can pass a recording fake. Every picture is a
 * pre-rendered canvas of the whole frame; a layer is that canvas clipped to
 * its boxes and shifted (Scroll). No DOM animation is involved.
 */
import type { Box } from "../player/transitions/frames";
import type { FrameLayer, Source } from "./timeline";

/** A rectangle in whole pixels. */
export interface PixelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DrawOp {
  source: Source;
  /** Transparent version of the picture (scene without its background). */
  transparent: boolean;
  /** Draw only inside these rectangles; null = everywhere. Empty = nothing (the op is dropped). */
  clip: PixelRect[] | null;
  /** Where the picture's top-left corner goes (Scroll shifts it). */
  dx: number;
  dy: number;
}

/**
 * A box in stage fractions as whole pixels. Edges are rounded on their own
 * (not the width), so neighbouring boxes (Fade cells, Blinds stripes) meet
 * with neither gaps nor overlaps, and progress 1 covers the frame exactly.
 */
export function pixelRect(box: Box, width: number, height: number): PixelRect {
  const x0 = Math.round(box.x * width);
  const y0 = Math.round(box.y * height);
  const x1 = Math.round((box.x + box.w) * width);
  const y1 = Math.round((box.y + box.h) * height);
  const x = Math.max(0, Math.min(width, x0));
  const y = Math.max(0, Math.min(height, y0));
  return { x, y, w: Math.max(0, Math.min(width, x1) - x), h: Math.max(0, Math.min(height, y1) - y) };
}

/** The canvas operations for a frame's layers, bottom to top; invisible layers are left out. */
export function drawOps(layers: readonly FrameLayer[], width: number, height: number): DrawOp[] {
  const ops: DrawOp[] = [];
  for (const l of layers) {
    let clip: PixelRect[] | null = null;
    if (l.clip) {
      clip = l.clip.map((b) => pixelRect(b, width, height)).filter((r) => r.w > 0 && r.h > 0);
      if (clip.length === 0) continue;
    }
    // `|| 0`: no negative zero.
    const dx = Math.round(l.dx * width) || 0;
    const dy = Math.round(l.dy * height) || 0;
    if (Math.abs(dx) >= width || Math.abs(dy) >= height) continue;
    ops.push({ source: l.source, transparent: l.transparent, clip, dx, dy });
  }
  return ops;
}

/** The part of CanvasRenderingContext2D a frame needs. */
export interface FrameContext {
  fillStyle: string | CanvasGradient | CanvasPattern;
  fillRect(x: number, y: number, w: number, h: number): void;
  save(): void;
  restore(): void;
  beginPath(): void;
  rect(x: number, y: number, w: number, h: number): void;
  clip(): void;
  drawImage(image: CanvasImageSource, dx: number, dy: number): void;
}

/** A picture as a canvas of the frame's size (opaque, or transparent where the scene had its background). */
export type PictureLookup = (picture: number, transparent: boolean) => CanvasImageSource;

export const BLACK = "#000000";

/** Draw the ops on `ctx` (the frame is first cleared to black, like the screen between slides). */
export function drawFrame(ctx: FrameContext, ops: readonly DrawOp[], width: number, height: number, pictures: PictureLookup): void {
  ctx.fillStyle = BLACK;
  ctx.fillRect(0, 0, width, height);
  for (const op of ops) {
    ctx.save();
    if (op.clip) {
      ctx.beginPath();
      for (const r of op.clip) ctx.rect(r.x, r.y, r.w, r.h);
      ctx.clip();
    }
    if (op.source === "blank") {
      ctx.fillStyle = BLACK;
      ctx.fillRect(op.dx, op.dy, width, height);
    } else {
      ctx.drawImage(pictures(op.source.picture, op.transparent), op.dx, op.dy);
    }
    ctx.restore();
  }
}

/** Where a page of `pageW × pageH` goes in the frame: as large as fits, centred (letterboxed on black). */
export function fitRect(pageW: number, pageH: number, width: number, height: number): PixelRect {
  const scale = Math.min(width / pageW, height / pageH);
  const w = Math.round(pageW * scale);
  const h = Math.round(pageH * scale);
  return { x: Math.round((width - w) / 2), y: Math.round((height - h) / 2), w, h };
}
