import { describe, expect, it } from "vitest";
import { LANDSCAPE_VIEW_BOX, type Scene } from "../model/scene";
import { type RGB } from "./color";
import { BAYER_8X8, applyScreen, ditherTile, normalizeDither } from "./dither";
import {
  SCREENSHOW_DAC,
  SCREENSHOW_NOMINAL,
  changedScreenColors,
  screenIntent,
  screenShowDither,
  screenShowGradientDither,
  vgaScreenShow,
} from "./vgaScreenShow";

/** The dither as "colour:cells" strings in threshold order. */
const stops = (rgb: RGB) => normalizeDither(screenShowDither(rgb)).map((s) => `${s.color}:${s.cells}`);

/** The tile as rows of hexadecimal colour indexes, as the screen shows it (x % 4, y % 4). */
const tile = (rgb: RGB) => ditherTile(normalizeDither(screenShowDither(rgb))).map((r) => r.map((c) => c.toString(16)).join("")).join("/");

describe("VGA ScreenShow colours", () => {
  it("shows each of the 16 driver colours solid", () => {
    SCREENSHOW_NOMINAL.forEach((c, i) => expect(stops(c)).toEqual([`${i}:16`]));
  });

  it("shows them through the 6-bit DAC", () => {
    expect(SCREENSHOW_DAC).toHaveLength(16);
    expect(SCREENSHOW_DAC[3]).toBe("#ff8200"); // orange 255,128,0 -> 255,130,0
    expect(SCREENSHOW_DAC[9]).toBe("#0082ff");
    expect(SCREENSHOW_DAC[14]).toBe("#555555");
    expect(SCREENSHOW_DAC[15]).toBe("#aaaaaa");
  });
});

describe("screenShowDither (HG3.PL3 palette entries)", () => {
  it("mixes dark ('D') colours with black, black on the lower thresholds", () => {
    expect(stops([0, 128, 128])).toEqual(["0:8", "8:8"]); // Cyn D: cyan + black checkerboard
    expect(tile([0, 128, 128])).toBe("0808/8080/0808/8080");
    expect(stops([0, 64, 128])).toEqual(["0:8", "9:8"]); // Blu D: blue-cyan + black
    expect(stops([128, 64, 0])).toEqual(["0:8", "3:8"]); // Orn D
  });

  it("mixes light ('L') colours with white, white on the lower thresholds", () => {
    expect(stops([255, 255, 128])).toEqual(["1:8", "4:8"]); // Yel L
    expect(tile([255, 255, 128])).toBe("1414/4141/1414/4141");
    expect(stops([255, 191, 128])).toEqual(["1:8", "3:8"]); // Orn LL
    expect(stops([255, 255, 191])).toEqual(["1:12", "4:4"]); // Yel LL
  });

  it("uses 8 levels of the 4 x 4 Bayer matrix (the orange Range shades)", () => {
    expect(tile([15, 8, 0])).toBe("0000/0030/0000/3000");
    expect(stops([52, 26, 0])).toEqual(["0:12", "3:4"]);
    expect(stops([102, 51, 0])).toEqual(["0:10", "3:6"]);
    expect(stops([152, 76, 0])).toEqual(["0:6", "3:10"]);
    expect(stops([202, 101, 0])).toEqual(["0:4", "3:12"]);
    expect(stops([253, 169, 46])).toEqual(["1:2", "3:14"]);
    expect(stops([255, 184, 84])).toEqual(["1:6", "3:10"]);
  });

  it("splits a hue between two neighbours half and half", () => {
    // Range10 (255,247,188): white 12, then yellow (the next hue) and orange.
    expect(stops([255, 247, 188])).toEqual(["1:12", "4:2", "3:2"]);
    expect(tile([255, 247, 188])).toBe("1111/4131/1111/3141");
  });

  it("dithers greys on the grey ramp, lighter grey first", () => {
    expect(stops([22, 22, 22])).toEqual(["14:4", "0:12"]); // Gry DD as a fill
    expect(stops([128, 128, 128])).toEqual(["15:8", "14:8"]);
    expect(stops([158, 158, 158])).toEqual(["15:14", "14:2"]);
    expect(stops([191, 191, 191])).toEqual(["1:4", "15:12"]);
  });

  it("shows the white share of a greyed colour as dark grey and keeps its black share", () => {
    // (138,138,43): white 1, black 4, yellow 3 eighths.
    expect(stops([138, 138, 43])).toEqual(["14:2", "0:8", "4:6"]);
    // LEAVES's (64,60,52): 4/16 dark grey on black, no hue.
    expect(stops([64, 60, 52])).toEqual(["14:4", "0:12"]);
  });
});

describe("screenShowGradientDither (gradients and backgrounds)", () => {
  const gstops = (rgb: RGB) => normalizeDither(screenShowGradientDither(rgb)).map((s) => `${s.color}:${s.cells}`);

  it("dithers greys on the grey ramp in 64 levels, lighter first", () => {
    expect(gstops([65, 65, 65])).toEqual(["14:49", "0:15"]); // 7.PL3's background (ROCKTOP)
    expect(gstops([0, 0, 0])).toEqual(["0:64"]);
    expect(gstops([171, 171, 171])).toEqual(["15:64"]);
  });

  it("gives the chroma its share and the rest one nearest grey, grey first", () => {
    expect(gstops([37, 36, 68])).toEqual(["0:56", "10:8"]); // 2.PL3 (PLAY_ALL): black + 8/64 blue
    expect(gstops([91, 156, 220])).toEqual(["15:31", "9:33"]); // 9SHD (BLUESKY): grey 170 + azure (32/64 at the top rows)
    expect(gstops([0, 0, 64])).toEqual(["0:48", "10:16"]); // 1SHD top (LOGOBKG2)
    expect(gstops([128, 0, 0])).toEqual(["0:31", "2:33"]); // REDLEFT's dark red end
  });

  it("splits the hue share between neighbours in proportion, the following hue first", () => {
    // Hue 45°, half way between orange (30°) and yellow (60°).
    expect(gstops([255, 191, 0])).toEqual(["4:32", "3:32"]);
  });

  it("counts a chroma of one 6-bit step as grey", () => {
    expect(gstops([54, 51, 54])).toEqual(gstops([53, 53, 53]));
  });

  it("uses the 64 cells of the 8 x 8 Bayer matrix", () => {
    expect(BAYER_8X8.flat().sort((a, b) => a - b)).toEqual([...Array(64).keys()]);
    expect(BAYER_8X8[0].slice(0, 4)).toEqual([0, 32, 8, 40]);
  });
});

describe("screenIntent", () => {
  const own = SCREENSHOW_NOMINAL.map((c, i) => (i === 12 ? ([0, 0, 85] as const) : c));

  it("moves a colour's share of a changed slot to the document's colour", () => {
    expect(screenIntent([255, 0, 255], own)).toEqual([0, 0, 85]); // 1HDW slot 12
    expect(screenIntent([128, 0, 128], own)).toEqual([0, 0, 40]); // 33/64 of slot 12, on black
    expect(screenIntent([255, 0, 0], own)).toEqual([255, 0, 0]);
  });

  it("reports only screen colour sets that differ from the nominal one", () => {
    expect(changedScreenColors(undefined)).toBeNull();
    expect(changedScreenColors(SCREENSHOW_NOMINAL.map((c) => `rgb(${c.join(",")})`))).toBeNull();
    expect(changedScreenColors(own.map((c) => `rgb(${c.join(",")})`))?.[12]).toEqual([0, 0, 85]);
  });
});

describe("vgaScreenShow", () => {
  const scene: Scene = {
    viewBox: LANDSCAPE_VIEW_BOX,
    background: "#000000",
    elements: [
      { kind: "rect", x: 0, y: 0, width: 10, height: 10, fill: "#ff00ff", stroke: "#008080" },
    ],
  };

  it("draws a scene with the standard DAC", () => {
    const out = applyScreen(scene, vgaScreenShow());
    expect(out.background).toBe("#000000");
    expect(out.elements[0]).toMatchObject({ fill: "#ff00ff", stroke: "pattern:vga-0" });
    expect(out.patterns?.["vga-0"]).toMatchObject({ ink: "#00ffff", paper: "#000000", pixelHeight: 51.2 });
  });

  it("shows the document's own 16 colours (Scene.screenColors) in their slots", () => {
    // 12HDW.PL3 puts a blue-grey in slot 12 (nominal magenta).
    const colors = [...SCREENSHOW_DAC];
    colors[12] = "#355592";
    const out = applyScreen(scene, vgaScreenShow(colors));
    expect(out.elements[0]).toMatchObject({ fill: "#355592" });
  });
});
