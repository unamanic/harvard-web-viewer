/**
 * Chart-wide colours of an HG3 scene: the page background (palette record
 * 1554), the 16 screen colours (record 1555) and gradient fills (0x1110).
 * The rules and their evidence are in assumptions.ts ("Colour rules from
 * the reference renders").
 */
import type { Scene } from "../../types";
import {
  BACKGROUND_FROM_PALETTE_1554,
  BACKGROUND_SHADE_ANGLE_OFFSET,
  FALLBACK_BACKGROUND,
  GRADIENT_ANGLE_UNIT,
  GRADIENT_ANGLE_ZERO,
} from "../assumptions";
import { directRgb } from "../objects";
import { ROLE, paletteBackground, paletteScreenColors, rgbToCss } from "../palette";
import type { ChartSceneContext } from "./context";

/**
 * The scene background: the palette's 1554 setting (a colour, or a
 * "gradient:<id>" for a shaded one), else role 15 (FrameBkg).
 */
export function chartBackground(ctx: ChartSceneContext): string {
  const bg = BACKGROUND_FROM_PALETTE_1554 ? paletteBackground(ctx.palette.palette) : null;
  if (!bg) return ctx.color(ROLE.FrameBkg) ?? FALLBACK_BACKGROUND;
  const from = rgbToCss(bg.color1);
  if (bg.mode === "plain") return from;
  return ctx.gradient(from, rgbToCss(bg.color2), normalizeAngle(bg.angle + BACKGROUND_SHADE_ANGLE_OFFSET));
}

/**
 * Scene fields that depend on the whole chart: the palette's 16 screen
 * colours (Scene.screenColors, as stored in 1555) and the gradients the
 * drawing used. Call when every element is drawn.
 */
export function chartSceneColors(ctx: ChartSceneContext): Pick<Scene, "screenColors" | "gradients"> {
  const out: Pick<Scene, "screenColors" | "gradients"> = {};
  const screen = paletteScreenColors(ctx.palette.palette);
  if (screen) out.screenColors = screen.map(rgbToCss);
  if (Object.keys(ctx.gradients).length > 0) out.gradients = { ...ctx.gradients };
  return out;
}

/**
 * The fill of a 0x1110 gradient attribute (assumptions.ts GRADIENT_SUBTAG):
 * "gradient:<id>", or null when the data is too short. A colour whose byte
 * 0 is not 0xFF is read as a colour role.
 */
export function gradientAttributeFill(ctx: ChartSceneContext, raw: Uint8Array): string | null {
  if (raw.length < 10) return null;
  const color = (at: number) => {
    const rgb = directRgb(raw, at);
    return rgb ? rgbToCss(rgb) : ctx.color(raw[at]!);
  };
  const from = color(0);
  const to = color(4);
  if (!from || !to) return from ?? to;
  const value = raw[8]! | (raw[9]! << 8);
  return ctx.gradient(from, to, normalizeAngle(GRADIENT_ANGLE_ZERO + value * GRADIENT_ANGLE_UNIT));
}

function normalizeAngle(a: number): number {
  const r = ((a % 360) + 360) % 360;
  return Math.round(r * 1000) / 1000;
}
