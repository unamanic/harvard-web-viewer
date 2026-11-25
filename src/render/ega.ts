/**
 * The Harvard Graphics 3.05 EGA display (EGA.SC3: 640 × 350, 16 of the
 * EGA's 64 colours) as a dithering-engine Screen (dither.ts).
 *
 * Inferred from the 238 chart renders made in the real program with the
 * EGA driver (samples-private/renders/ega, private reference material),
 * compared with the same charts on VGA: the driver dithers exactly like
 * the VGA ScreenShow one (vgaScreenShow.ts: the same 16 colour slots, the
 * same 4 × 4 rule for fills, lines and text, the same 64-level 8 × 8 rule
 * for gradients and the page background), but each slot shows as the
 * nearest of the 64 EGA colours (2 bits per channel) to the colour the VGA
 * DAC would show: orange (255,128,0) as (255,170,0), (0,128,255) as
 * (0,170,255), and a palette's own screen colours too (1HDW's dark-blue
 * magenta slot as navy (0,0,85)). The page is 640 × 350 pixels on a 4:3
 * screen, so a pixel is (4 / 3) / (640 / 350) ≈ 0.729 as wide as tall
 * (1.37 times taller than wide).
 */
import { type RGB, formatCssColor, nearestColor, parseCssColor } from "./color";
import type { Screen } from "./dither";
import { vgaScreenShow } from "./vgaScreenShow";

/** Channel levels of the EGA's 64 colours (2 bits per channel). */
const EGA_LEVELS = [0x00, 0x55, 0xaa, 0xff] as const;

/** All 64 EGA colours. */
export const EGA_COLORS: readonly RGB[] = EGA_LEVELS.flatMap((r) =>
  EGA_LEVELS.flatMap((g) => EGA_LEVELS.map((b) => [r, g, b] as const)),
);

export const EGA_WIDTH = 640;
export const EGA_HEIGHT = 350;

/** Width / height of one pixel: 640 × 350 fills a 4:3 screen. */
export const EGA_PIXEL_ASPECT = 4 / 3 / (EGA_WIDTH / EGA_HEIGHT);

/**
 * The EGA screen: the VGA ScreenShow screen for the same screen colours
 * (Scene.screenColors) at 640 × 350, each of its 16 colours replaced by the
 * nearest EGA colour.
 */
export function egaScreen(screenColors?: readonly string[]): Screen {
  const vga = vgaScreenShow(screenColors);
  return {
    ...vga,
    id: "ega",
    width: EGA_WIDTH,
    height: EGA_HEIGHT,
    pixelAspect: EGA_PIXEL_ASPECT,
    colors: vga.colors.map((c) => formatCssColor(nearestColor(parseCssColor(c) ?? [0, 0, 0], EGA_COLORS))),
  };
}
