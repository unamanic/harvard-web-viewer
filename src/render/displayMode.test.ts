import { describe, expect, it } from "vitest";
import { LANDSCAPE_VIEW_BOX, type Scene, type SceneElement } from "../formats/types";
import {
  EGA_COLORS,
  applyDisplayMode,
  formatCssColor,
  isDisplayMode,
  parseCssColor,
  toScreenColor,
  vgaChannel,
  type RGB,
} from "./displayMode";

function rect(fill: string | null, stroke: string | null = null): SceneElement {
  return { kind: "rect", x: 0, y: 0, width: 10, height: 10, fill, stroke };
}

function scene(elements: SceneElement[], background = "#000000"): Scene {
  return { viewBox: LANDSCAPE_VIEW_BOX, background, elements };
}

/** Every colour string in the scene, background first. */
function colors(s: Scene): string[] {
  const out = [s.background];
  const walk = (els: SceneElement[]) => {
    for (const el of els) {
      if (el.kind === "group") walk(el.children);
      else if (el.kind === "text") out.push(el.fill);
      else if (el.kind !== "image") {
        if (el.fill) out.push(el.fill);
        if (el.stroke) out.push(el.stroke);
      }
    }
  };
  walk(s.elements);
  return out;
}

describe("parseCssColor", () => {
  it("reads #rrggbb, #rgb and rgb()", () => {
    expect(parseCssColor("#FFa500")).toEqual([255, 165, 0]);
    expect(parseCssColor("#f80")).toEqual([255, 136, 0]);
    expect(parseCssColor("rgb(1, 2,3)")).toEqual([1, 2, 3]);
    expect(parseCssColor(" rgb( 300 , 0 , 12.6 ) ")).toEqual([255, 0, 13]);
  });

  it("returns null for other forms", () => {
    expect(parseCssColor("red")).toBeNull();
    expect(parseCssColor("#12345")).toBeNull();
    expect(parseCssColor("hsl(0, 100%, 50%)")).toBeNull();
    expect(parseCssColor("rgba(1, 2, 3, 0.5)")).toBeNull();
  });

  it("formats as lower-case #rrggbb", () => {
    expect(formatCssColor([255, 10, 0])).toBe("#ff0a00");
  });
});

describe("toScreenColor", () => {
  it("VGA rounds each channel to 6 bits", () => {
    // 128 -> round(128*63/255) = 32 -> round(32*255/63) = 130
    expect(vgaChannel(128)).toBe(130);
    // 100 -> 25 -> 101
    expect(vgaChannel(100)).toBe(101);
    expect(vgaChannel(0)).toBe(0);
    expect(vgaChannel(255)).toBe(255);
    // 2 -> round(0.49) = 0 -> 0; 3 -> round(0.74) = 1 -> 4
    expect(vgaChannel(2)).toBe(0);
    expect(vgaChannel(3)).toBe(4);
    expect(toScreenColor([128, 100, 255], "vga")).toEqual([130, 101, 255]);
  });

  it("EGA picks the nearest of the 64 colours", () => {
    expect(EGA_COLORS).toHaveLength(64);
    // Orange: R and B are exact levels; G 165 is 5 from 0xAA, 80 from 0x55.
    expect(toScreenColor([255, 165, 0], "ega")).toEqual([0xff, 0xaa, 0x00]);
    // Mid grey 128 is 42 from 0xAA and 43 from 0x55.
    expect(toScreenColor([128, 128, 128], "ega")).toEqual([0xaa, 0xaa, 0xaa]);
    // Navy: 0x80 blue is nearer 0xAA than 0x55.
    expect(toScreenColor([0, 0, 0x80], "ega")).toEqual([0, 0, 0xaa]);
    // Exact EGA colours map to themselves.
    expect(toScreenColor([0xaa, 0x55, 0x00], "ega")).toEqual([0xaa, 0x55, 0x00]);
  });

  it("CGA thresholds Rec. 601 luma at 50%", () => {
    const white: RGB = [255, 255, 255];
    const black: RGB = [0, 0, 0];
    expect(toScreenColor([255, 255, 0], "cga")).toEqual(white); // luma 226
    expect(toScreenColor([0, 255, 0], "cga")).toEqual(white); // 150
    expect(toScreenColor([255, 0, 0], "cga")).toEqual(black); // 76
    expect(toScreenColor([0, 0, 255], "cga")).toEqual(black); // 29
    expect(toScreenColor([128, 128, 128], "cga")).toEqual(white); // 128
    expect(toScreenColor([127, 127, 127], "cga")).toEqual(black); // 127
  });

  it("modern keeps the stored RGB", () => {
    expect(toScreenColor([1, 2, 3], "modern")).toEqual([1, 2, 3]);
  });
});

describe("applyDisplayMode", () => {
  it("modern is the identity", () => {
    const s = scene([rect("#123456")]);
    expect(applyDisplayMode(s, "modern")).toBe(s);
  });

  it("maps background, fills, strokes and text, recursing into groups", () => {
    const s = scene(
      [
        rect("#808080", null),
        {
          kind: "group",
          buttonName: "b",
          children: [
            rect(null, "#ffff00"),
            {
              kind: "text", x: 0, y: 0, text: "Hi", size: 10, fill: "rgb(255,0,0)",
              fontFamily: "sans-serif", fontWeight: 400, italic: false, anchor: "start",
            },
            { kind: "image", href: "data:,", x: 0, y: 0, width: 1, height: 1 },
          ],
        },
      ],
      "#00f",
    );
    const out = applyDisplayMode(s, "cga");
    expect(out.background).toBe("#000000");
    const [r0, g] = out.elements as [SceneElement, SceneElement];
    expect(r0).toMatchObject({ fill: "#ffffff", stroke: null });
    if (g.kind !== "group") throw new Error("group expected");
    expect(g.buttonName).toBe("b");
    expect(g.children[0]).toMatchObject({ fill: null, stroke: "#ffffff" });
    expect(g.children[1]).toMatchObject({ fill: "#000000" });
    expect(g.children[2]).toBe((s.elements[1] as { children: SceneElement[] }).children[2]);
    // Input is untouched.
    expect(s.background).toBe("#00f");
    expect(s.elements[0]).toMatchObject({ fill: "#808080" });
  });

  it("maps the fill and stroke of glyph lines", () => {
    const s = scene([
      { kind: "glyphs", d: "M0 0", text: "A", advance: 1, em: 1000, fill: "#808080", stroke: null },
      { kind: "glyphs", d: "M0 0", text: "B", advance: 1, em: 1000, fill: null, stroke: "#202020", strokeWidth: 4, transform: [1, 0, 0, 1, 0, 0] },
    ]);
    const [a, b] = applyDisplayMode(s, "cga").elements;
    expect(a).toMatchObject({ kind: "glyphs", fill: "#ffffff", stroke: null, d: "M0 0", text: "A" });
    expect(b).toMatchObject({ kind: "glyphs", fill: null, stroke: "#000000", strokeWidth: 4, transform: [1, 0, 0, 1, 0, 0] });
    expect(colors(applyDisplayMode(s, "vga"))).toEqual(["#000000", "#828282", "#202020"]);
  });

  it("leaves colours it cannot parse unchanged", () => {
    const out = applyDisplayMode(scene([rect("red", "hsl(0,0%,0%)")], "navy"), "vga");
    expect(colors(out)).toEqual(["navy", "red", "hsl(0,0%,0%)"]);
  });

  it("EGA keeps all colours when 16 or fewer are used", () => {
    const sixteen = EGA_COLORS.slice(0, 16).map((c) => rect(formatCssColor(c)));
    const out = applyDisplayMode(scene(sixteen.slice(1)), "ega"); // background is #000000 = colour 0
    expect(new Set(colors(out)).size).toBe(16);
  });

  it("EGA keeps the 16 most used colours of 20 and maps the rest to the nearest kept", () => {
    // Colours 0..15 (red 0) are used twice each; 16..19 (red 0x55, green 0) once.
    const common = EGA_COLORS.slice(0, 16).map(formatCssColor);
    const rare = EGA_COLORS.slice(16, 20);
    expect(rare.every((c) => c[0] === 0x55 && c[1] === 0)).toBe(true);
    const els = [
      ...common.map((c) => rect(c, c)),
      ...rare.map((c) => rect(formatCssColor(c))),
    ];
    const out = applyDisplayMode(scene(els, common[0]), "ega");
    const used = new Set(colors(out));
    expect(used.size).toBe(16);
    expect([...used].sort()).toEqual([...common].sort());
    // (0x55, 0, b) is nearest to (0, 0, b) among the kept colours.
    const rareOut = out.elements.slice(16).map((e) => (e as { fill: string }).fill);
    expect(rareOut).toEqual(rare.map((c) => formatCssColor([0, 0, c[2]])));
  });

  it("EGA counts colours after mapping to the 64", () => {
    // Two near-identical colours both become #ffaa00: one EGA colour.
    const out = applyDisplayMode(scene([rect("#ffa500"), rect("#ffb000")]), "ega");
    expect(colors(out)).toEqual(["#000000", "#ffaa00", "#ffaa00"]);
  });
});

describe("isDisplayMode", () => {
  it("accepts only known modes", () => {
    expect(isDisplayMode("ega")).toBe(true);
    expect(isDisplayMode("hercules")).toBe(false);
    expect(isDisplayMode(null)).toBe(false);
  });
});
