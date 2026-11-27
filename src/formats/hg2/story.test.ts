/**
 * The Harvard Web Viewer story show's charts (samples/hg1-hg2/story), drawn
 * the way the real A.00 and 2.30 screens show them (harvard-graphics/story-v2
 * captures): axis ranges, list lines that carry on, org chart layout and the
 * programs' own screen colours.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Scene, SceneElement, TextElement } from "../../model/scene";
import { applyDisplayMode } from "../../render/displayMode";
import { readClassicChart } from "./read";
import { chartToScene } from "./scene";
import { NOMINAL_SLOTS, SCREEN_2X, cgaIndex } from "./screen";

const ROOT = new URL("../../../samples/hg1-hg2/story/", import.meta.url);

function scene(folder: "v100" | "v230", name: string): Scene {
  const chart = readClassicChart(new Uint8Array(readFileSync(new URL(`${folder}/${name}.CHT`, ROOT))), []);
  return chartToScene(chart, []);
}

function flat(elements: SceneElement[]): SceneElement[] {
  return elements.flatMap((e) => (e.kind === "group" ? flat(e.children) : [e]));
}

function texts(s: Scene): TextElement[] {
  return flat(s.elements).filter((e): e is TextElement => e.kind === "text");
}

function textOf(s: Scene, text: string): TextElement {
  const t = texts(s).find((e) => e.text.trim() === text);
  if (!t) throw new Error(`no text "${text}" in ${texts(s).map((e) => e.text).join(" | ")}`);
  return t;
}

describe("story show: value axes", () => {
  it("A.00 draws eight steps, 0 to 16, though the chart stores 0 to 8", () => {
    const shown = texts(scene("v100", "HGV06")).map((t) => t.text);
    expect(shown).toContain("16");
    expect(shown).toContain("14");
    expect(shown).not.toContain("18");
  });

  it("2.30 ends the axis at the first step above the data, 0 to 14", () => {
    const shown = texts(scene("v230", "HGV06")).map((t) => t.text);
    expect(shown).toContain("14");
    expect(shown).not.toContain("16");
  });

  it("sets the Y title flat above the axis", () => {
    const s = scene("v230", "HGV06");
    const title = textOf(s, "Megabytes");
    expect(title.anchor).toBe("start");
    const top = textOf(s, "14");
    expect(title.y).toBeLessThan(top.y);
  });
});

describe("story show: bullet lists", () => {
  it("A.00: a line after a line with text carries on the item, without a bullet, under its text", () => {
    const s = scene("v100", "HGV14");
    const bullets = flat(s.elements).filter((e) => e.kind === "rect");
    expect(bullets).toHaveLength(4);
    const first = textOf(s, "2.3 .SHW: timings, effects, HyperShow");
    const more = textOf(s, "keys");
    expect(more.x).toBeCloseTo(first.x, 3);
    // Carried-on lines sit closer than items, which have a blank line between them.
    const next = textOf(s, "3.05 .SH3: points to its .CH3 charts");
    expect(more.y - first.y).toBeLessThan(next.y - more.y);
  });

  it("2.30: one round bullet per item", () => {
    const s = scene("v230", "HGV14");
    expect(texts(s).filter((t) => t.text === "•")).toHaveLength(4);
  });
});

describe("story show: org charts", () => {
  it("reads the subtitle (A.00 at 202, 2.x at 62)", () => {
    expect(texts(scene("v100", "HGV08")).map((t) => t.text)).toContain("Chart file families");
    expect(texts(scene("v230", "HGV08")).map((t) => t.text)).toContain("Chart file families");
    expect(texts(scene("v230", "HGV19")).map((t) => t.text)).toContain("Parts of the viewer");
  });

  it("2.30 with three lines a box splits a name at its first space; A.00 keeps it whole", () => {
    const v230 = texts(scene("v230", "HGV19")).map((t) => t.text);
    expect(v230).toContain("Harvard");
    expect(v230).toContain("Web Viewer");
    expect(texts(scene("v100", "HGV19")).map((t) => t.text)).toContain("Harvard Web Viewer");
  });

  it("draws every box's text at one size and every box on a level the same size", () => {
    const s = scene("v230", "HGV19");
    const boxText = texts(s).filter((t) => ["Runs in a browser", "Reads PCOK", "Screen checks", "A.00", "reader"].includes(t.text));
    expect(new Set(boxText.map((t) => t.size.toFixed(3))).size).toBe(1);
    const rects = flat(s.elements).filter((e) => e.kind === "rect");
    expect(rects).toHaveLength(5);
    const children = rects.slice(1);
    expect(new Set(children.map((r) => (r.kind === "rect" ? r.width.toFixed(3) : "")).values()).size).toBe(1);
  });

  it("fills boxes with the page background", () => {
    const s = scene("v230", "HGV08");
    const box = flat(s.elements).find((e) => e.kind === "rect");
    expect(box && box.kind === "rect" ? box.fill : null).toBe(s.background);
  });
});

describe("story show: the programs' own screen colours", () => {
  it("2.30: colour numbers are screen slots, shown in the 2.3 screen's colours", () => {
    const s = scene("v230", "HGV06");
    expect(s.classicSlots).toBe("cga4");
    expect(s.screenColors).toEqual([...SCREEN_2X]);
    expect(s.screenColors?.slice(0, 7)).toEqual(["#000055", "#ffffff", "#00aaaa", "#0055aa", "#55aaff", "#aaffff", "#ffffaa"]);
    expect(s.background).toBe(NOMINAL_SLOTS[0]);
    const modern = applyDisplayMode(s, "modern");
    expect(modern.background).toBe("#000055");
    expect(texts(modern).find((t) => t.text === "Room on Disk")?.fill).toBe("#ffffff");
    // The bars are colour 2, teal.
    const fills = flat(modern.elements).flatMap((e) => (e.kind === "rect" && e.fill ? [e.fill] : []));
    expect(fills).toContain("#00aaaa");
  });

  it("A.00 graph and pie charts: CGA palette 0 on blue", () => {
    const s = scene("v100", "HGV10");
    expect(s.classicSlots).toBe("cga4");
    const modern = applyDisplayMode(s, "modern");
    expect(modern.background).toBe("#0000aa");
    expect(texts(modern).find((t) => t.text.startsWith("Test Charts"))?.fill).toBe("#00aa00");
    const slices = flat(modern.elements).flatMap((e) => (e.kind === "path" && e.closed && e.fill ? [e.fill] : []));
    expect(new Set(slices)).toEqual(new Set(["#aa0000", "#aa5500", "#00aa00"]));
  });

  it("A.00 text and org charts: white on black", () => {
    const s = scene("v100", "HGV14");
    expect(s.classicSlots).toBe("cga2");
    const modern = applyDisplayMode(s, "modern");
    expect(modern.background).toBe("#000000");
    expect(new Set(texts(modern).map((t) => t.fill))).toEqual(new Set(["#ffffff"]));
  });

  it("maps colour numbers to CGA colours as both programs do", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 16].map(cgaIndex)).toEqual([1, 2, 3, 0, 1, 2, 3, 0, 0]);
  });
});

describe("story show: CGA display mode", () => {
  it("2.30 pie: colours 2, 3 and 4 as red, brown and the blue background", () => {
    const cga = applyDisplayMode(scene("v230", "HGV10"), "cga4");
    expect(cga.background).toBe("#0000aa");
    const slices = flat(cga.elements).flatMap((e) => (e.kind === "path" && e.closed && e.fill ? [e.fill] : []));
    expect(new Set(slices)).toEqual(new Set(["#aa0000", "#aa5500", "#0000aa"]));
    expect(texts(cga).find((t) => t.text.startsWith("Test Charts"))?.fill).toBe("#00aa00");
  });

  it("A.00 text charts: white on black", () => {
    const cga = applyDisplayMode(scene("v100", "HGV14"), "cga4");
    expect(cga.background).toBe("#000000");
    expect(new Set(texts(cga).map((t) => t.fill))).toEqual(new Set(["#ffffff"]));
  });
});
