import { describe, expect, it } from "vitest";
import { EGA_COLORS, EGA_PIXEL_ASPECT, egaScreen } from "./ega";
import { screenShowDither, vgaScreenShow } from "./vgaScreenShow";

describe("egaScreen", () => {
  it("is 640 x 350 with pixels 1.37 times taller than wide", () => {
    const s = egaScreen();
    expect([s.width, s.height]).toEqual([640, 350]);
    expect(1 / EGA_PIXEL_ASPECT).toBeCloseTo(1.371, 3);
    expect(s.pixelAspect).toBe(EGA_PIXEL_ASPECT);
  });

  it("shows the 16 ScreenShow slots as their nearest EGA colours", () => {
    const s = egaScreen();
    const egaHex = new Set(EGA_COLORS.map((c) => "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("")));
    expect(s.colors.every((c) => egaHex.has(c))).toBe(true);
    // As observed in the EGA renders: orange and (0,128,255) slots, the two greys.
    expect(s.colors[3]).toBe("#ffaa00");
    expect(s.colors[9]).toBe("#00aaff");
    expect(s.colors[14]).toBe("#555555");
    expect(s.colors[15]).toBe("#aaaaaa");
  });

  it("keeps the VGA ScreenShow dither rules", () => {
    const s = egaScreen();
    const v = vgaScreenShow();
    expect(s.dither).toBe(screenShowDither);
    expect(s.matrix).toBe(v.matrix);
    expect(s.gradient?.matrix).toBe(v.gradient?.matrix);
  });
});
