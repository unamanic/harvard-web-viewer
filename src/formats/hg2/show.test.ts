/**
 * 1.0 / 2.x slide shows (.SHW): the one-setting 2.30 test shows in
 * samples/hg1-hg2/shows (see its README) and hand-built 1.0 and nested
 * shows, read and played as presentations.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { choosePrimary } from "../../files/choosePrimary";
import { navigate, pressKey, startPlayer, currentSlide } from "../../player/player";
import { fileKind } from "../../files/fileKind";
import { detectFormat } from "../registry";
import type { Presentation } from "../../model/presentation";
import type { TextElement } from "../../model/scene";
import type { ParseContext, ResolvedFile } from "../parser";
import { hg2Parser } from "./index";
import { classicShowToPresentation } from "./presentation";
import { readClassicShow, slideFileKind } from "./show";

const ROOT = new URL("../../../samples/hg1-hg2/", import.meta.url);
const present = existsSync(new URL("shows/S1.SHW", ROOT));

function show(name: string): Uint8Array {
  return new Uint8Array(readFileSync(new URL(`shows/${name}.SHW`, ROOT)));
}
function chart(name: string): Uint8Array {
  return new Uint8Array(readFileSync(new URL(`v230/${name}.CHT`, ROOT)));
}

function read(bytes: Uint8Array) {
  const warnings: string[] = [];
  const s = readClassicShow(bytes, warnings);
  return { show: s, warnings };
}

/** A file set that resolves base names case-insensitively and records misses. */
function fakeContext(path: string, files: Record<string, Uint8Array>, missing: string[] = []): ParseContext {
  return {
    path,
    resolve(name, purpose) {
      const base = name.replace(/^.*[\\/:]/, "").toLowerCase();
      const key = Object.keys(files).find((k) => k.toLowerCase() === base);
      if (!key) {
        missing.push(`${name} (${purpose})`);
        return null;
      }
      const file: ResolvedFile = { path: key, name: key, bytes: files[key] };
      return file;
    },
  };
}

describe.skipIf(!present)("2.30 test shows", () => {
  it("S1: description, slots and play order", () => {
    const { show: s, warnings } = read(show("S1"));
    expect(warnings).toEqual([]);
    expect(s.version).toBe("2.x");
    expect(s.description).toBe("Base show");
    expect(s.slides.map((x) => [x.position, x.slot, x.fileName])).toEqual([
      [1, 1, "HWV01.CHT"],
      [2, 2, "HWV02.CHT"],
      [3, 3, "HWV03.CHT"],
    ]);
    expect(s.slides.every((x) => x.displaySeconds === null && x.draw === null && x.erase === null)).toBe(true);
    expect(s.defaultSeconds).toBeNull();
  });

  it("S2: moving a slide changes only the play order", () => {
    const { show: s } = read(show("S2MOVE"));
    expect(s.slides.map((x) => [x.slot, x.fileName])).toEqual([
      [3, "HWV03.CHT"],
      [1, "HWV01.CHT"],
      [2, "HWV02.CHT"],
    ]);
  });

  it("S3: a new slide reuses the freed slot", () => {
    const { show: s } = read(show("S3DELADD"));
    expect(s.slides.map((x) => [x.slot, x.fileName])).toEqual([
      [3, "HWV03.CHT"],
      [1, "HWV01.CHT"],
      [2, "HWV04.CHT"],
    ]);
  });

  it("S4: times are minutes and seconds", () => {
    expect(read(show("S4TIME")).show.slides.map((x) => x.displaySeconds)).toEqual([5, 90, 45]);
  });

  it("S5: the Default row", () => {
    const { show: s } = read(show("S5DEF"));
    expect(s.defaultSeconds).toBe(7);
    expect(s.defaultDraw).toEqual({ effect: "fade", direction: "up" });
    expect(s.defaultErase).toEqual({ effect: "blinds", direction: "down" });
  });

  it("S6: effect and direction codes", () => {
    const { show: s } = read(show("S6FX"));
    expect(s.slides.map((x) => [x.draw, x.erase])).toEqual([
      [{ effect: "blinds", direction: null }, { effect: "blinds", direction: null }],
      [{ effect: "rain", direction: null }, { effect: "rain", direction: null }],
      [{ effect: "weave", direction: "out" }, { effect: "overlay", direction: null }],
    ]);
  });

  it("S7: HyperShow keys keep their case and go to play positions", () => {
    const { show: s } = read(show("S7HYPER"));
    expect(s.slides[0].keys).toEqual([
      { key: "A", goTo: 3 },
      { key: "z", goTo: 1 },
    ]);
    expect(s.slides[1].keys).toEqual([]);
  });

  it("S8: moving slides renumbers Go To", () => {
    const { show: s } = read(show("S8MOVEHYP"));
    expect(s.slides.map((x) => x.fileName)).toEqual(["HWV04.CHT", "HWV03.CHT", "HWV01.CHT"]);
    expect(s.slides[1].keys).toEqual([
      { key: "A", goTo: 1 },
      { key: "z", goTo: 2 },
    ]);
  });

  describe("as a presentation", () => {
    // Any 2.30 charts stand in for the show's charts.
    const files = {
      "S8MOVEHYP.SHW": show("S8MOVEHYP"),
      "hwv04.cht": chart("BBASE"),
      "HWV03.CHT": chart("PBASE"),
    };

    function open(): { p: Presentation; warnings: string[]; missing: string[] } {
      const missing: string[] = [];
      const doc = hg2Parser.parse(files["S8MOVEHYP.SHW"], "S8MOVEHYP.SHW", fakeContext("S8MOVEHYP.SHW", files, missing));
      expect(doc.formatName).toBe("Harvard Graphics 2.x slide show (3 slides): Base show");
      expect(doc.scenes).toEqual([]);
      return { p: doc.presentation as Presentation, warnings: doc.warnings, missing };
    }

    it("lists the slides in play order with a placeholder slide 0", () => {
      const { p } = open();
      expect(p.title).toBe("Base show");
      expect(p.firstSlide).toBe(1);
      expect(p.slides.map((s) => [s.kind, s.fileName])).toEqual([
        ["empty", null],
        ["picture", "HWV04.CHT"],
        ["picture", "HWV03.CHT"],
        ["picture", "HWV01.CHT"],
      ]);
    });

    it("finds charts case-insensitively and draws them", () => {
      const { p } = open();
      const scene = p.slides[1].scene();
      expect(scene?.elements.length).toBeGreaterThan(0);
      expect(p.slides[2].scene()?.elements.length).toBeGreaterThan(0);
    });

    it("shows a note for a missing chart", () => {
      const { p, warnings, missing } = open();
      expect(missing).toEqual(["HWV01.CHT (slide)"]);
      expect(warnings).toContain("Slide 3: file HWV01.CHT was not opened; shown as a note naming it");
      const texts = (p.slides[3].scene()?.elements ?? []).filter((e): e is TextElement => e.kind === "text").map((e) => e.text);
      expect(texts).toEqual(["HWV01.CHT", "This file was not opened."]);
    });

    it("times, effects (Weave and Rain drawn with the nearest effect) and defaults", () => {
      const { p } = open();
      expect(p.slides.slice(1).map((s) => [s.waitForKey, s.displaySeconds])).toEqual([
        [false, 45],
        [false, 5],
        [false, 90],
      ]);
      expect(p.slides.slice(1).map((s) => s.effects)).toEqual([
        { draw: { effect: "blinds", direction: "out" }, erase: { effect: "overlay" } },
        { draw: { effect: "blinds" }, erase: { effect: "blinds" } },
        { draw: { effect: "fade" }, erase: { effect: "fade" } },
      ]);
    });

    it("HyperShow keys jump to play positions", () => {
      const { p } = open();
      expect(p.slides[2].keys).toEqual([
        { key: "A", destination: { kind: "slide", index: 1 } },
        { key: "z", destination: { kind: "slide", index: 2 } },
      ]);
      let state = startPlayer(p);
      expect(currentSlide(state)?.fileName).toBe("HWV04.CHT");
      state = navigate(state, { kind: "next" });
      expect(currentSlide(state)?.fileName).toBe("HWV03.CHT");
      state = pressKey(state, "a");
      expect(currentSlide(state)?.fileName).toBe("HWV04.CHT");
    });
  });

  it("the Default row fills blank slide fields", () => {
    const warnings: string[] = [];
    const s = readClassicShow(show("S5DEF"), warnings);
    const p = classicShowToPresentation(s, fakeContext("S5DEF.SHW", {}), warnings);
    // S5's slides have their own times; their effects are blank.
    expect(p.slides[1].displaySeconds).toBe(5);
    expect(p.slides[1].effects).toEqual({ draw: { effect: "fade", direction: "up" }, erase: { effect: "blinds", direction: "down" } });
    s.slides[0].displaySeconds = null;
    const q = classicShowToPresentation(s, fakeContext("S5DEF.SHW", {}), []);
    expect(q.slides[1].displaySeconds).toBe(7);
  });
});

/** A 1.0 show: "show", count, u16 order list at 6, 60-byte slots from 104. */
function show10(order: number[], slots: [string, number, number, string][]): Uint8Array {
  const out = new Uint8Array(5120);
  const dv = new DataView(out.buffer);
  out.set([0x73, 0x68, 0x6f, 0x77]);
  dv.setUint16(4, order.length, true);
  order.forEach((s, k) => dv.setUint16(6 + 2 * k, s, true));
  slots.forEach(([name, cls, sub, title], k) => {
    const o = 104 + 60 * k;
    out[o] = 12;
    out.set(new TextEncoder().encode(name.padEnd(12)), o + 1);
    out[o + 14] = cls;
    out[o + 15] = sub;
    out[o + 16] = title.length;
    out.set(new TextEncoder().encode(title), o + 17);
  });
  return out;
}

/** A 2.x show with the given slots (name, class, subtype) in slot order and play order. */
function show2x(description: string, order: number[], slots: [string, number, number][]): Uint8Array {
  const out = new Uint8Array(8192);
  const dv = new DataView(out.buffer);
  out.set([0x53, 0x48, 0x4f, 0x57]);
  dv.setUint16(4, order.length, true);
  dv.setUint16(6, 16, true);
  out[8] = description.length;
  out.set(new TextEncoder().encode(description), 9);
  out.set([0xff, 0xff, 1, 0, 0, 0], 50);
  order.forEach((s, k) => dv.setUint16(56 + 2 * k, s, true));
  slots.forEach(([name, cls, sub], k) => {
    const o = 236 + 88 * k;
    const [base, ext] = name.split(".");
    out[o] = 12;
    out.set(new TextEncoder().encode(`${base.padEnd(8)}.${ext}`), o + 1);
    out[o + 14] = cls;
    out[o + 15] = sub;
    out.set([0xff, 0xff], o + 60);
  });
  return out;
}

describe("1.0 shows", () => {
  const bytes = show10(
    [2, 1],
    [
      ["OPENING .CHT", 1, 0, "Opening"],
      ["REGIONS .CHT", 2, 1, "Regions"],
    ],
  );

  it("reads slots through the play order; no times or effects", () => {
    const { show: s, warnings } = read(bytes);
    expect(warnings).toEqual([]);
    expect(s.version).toBe("1.0");
    expect(s.slides.map((x) => [x.position, x.slot, x.fileName, x.description, x.classCode, x.subtype])).toEqual([
      [1, 2, "REGIONS.CHT", "Regions", 2, 1],
      [2, 1, "OPENING.CHT", "Opening", 1, 0],
    ]);
    const p = classicShowToPresentation(s, fakeContext("S.SHW", {}), []);
    expect(p.slides.slice(1).map((x) => [x.label, x.waitForKey, x.effects])).toEqual([
      ["Regions", true, undefined],
      ["Opening", true, undefined],
    ]);
  });

  it("is detected by signature and listed as a show", () => {
    expect(detectFormat(bytes, "anything.dat")?.parser.id).toBe("hg2");
    expect(fileKind("anything.dat", bytes)).toBe("show");
    expect(hg2Parser.parse(bytes, "S.SHW").formatName).toBe("Harvard Graphics 1.0 slide show (2 slides)");
  });

  it("skips play-order entries that name no slot", () => {
    const { show: s, warnings } = read(show10([1, 7], [["A       .CHT", 1, 0, ""]]));
    expect(s.slides.map((x) => x.fileName)).toEqual(["A.CHT"]);
    expect(warnings).toEqual(["Slide 2: slot 7 names no file; skipped"]);
  });
});

describe("nested shows and bitmaps", () => {
  it("knows file kinds by extension, then by class byte", () => {
    expect(slideFileKind({ fileName: "WPIE.SHW", classCode: 0, subtype: 1 })).toBe("show");
    expect(slideFileKind({ fileName: "CITY.PCX", classCode: 0, subtype: 3 })).toBe("bitmap");
    expect(slideFileKind({ fileName: "WGRID.TPL", classCode: 0, subtype: 0 })).toBe("template");
    expect(slideFileKind({ fileName: "X", classCode: 0, subtype: 1 })).toBe("show");
    expect(slideFileKind({ fileName: "X.CHT", classCode: 2, subtype: 1 })).toBe("chart");
  });

  it("plays a nested show and stops a show that includes itself", () => {
    const outer = show2x("Outer", [1, 2], [
      ["INNER.SHW", 0, 1],
      ["OUTER.SHW", 0, 1],
    ]);
    const inner = show2x("Inner", [1], [["A.CHT", 0, 2]]);
    const files = { "OUTER.SHW": outer, "INNER.SHW": inner, "A.CHT": present ? chart("BBASE") : new Uint8Array() };
    const p = hg2Parser.parse(outer, "OUTER.SHW", fakeContext("OUTER.SHW", files)).presentation as Presentation;
    expect(p.slides.map((s) => s.kind)).toEqual(["empty", "nested", "nested"]);
    const nested = p.slides[1].nested?.();
    expect(nested?.title).toBe("Inner");
    expect(nested?.slides[1].fileName).toBe("A.CHT");
    expect(p.slides[2].nested?.()).toBeNull();
    expect(p.slides[2].warnings()).toEqual(["Slide 2: nested show OUTER.SHW includes itself; skipped"]);
  });

  it("draws a PCX slide as a whole-page picture", () => {
    // 2x1, 8 bits, one plane, run-length data, VGA palette.
    const pcx = new Uint8Array(128 + 2 + 769);
    pcx.set([0x0a, 5, 1, 8, 0, 0, 0, 0, 1, 0, 0, 0]);
    pcx[65] = 1;
    pcx[66] = 2;
    pcx[68] = 1;
    pcx.set([0xc2, 3], 128);
    pcx[130] = 0x0c;
    const s = show2x("", [1], [["CITY.PCX", 0, 3]]);
    const p = hg2Parser.parse(s, "S.SHW", fakeContext("S.SHW", { "S.SHW": s, "CITY.PCX": pcx })).presentation as Presentation;
    const scene = p.slides[1].scene();
    expect(scene?.elements.map((e) => e.kind)).toEqual(["image"]);
  });
});

describe("file lists", () => {
  it("open a .SHW before charts", () => {
    const entries = [{ name: "A.CHT" }, { name: "B.SHW" }];
    expect(choosePrimary(entries, () => true)?.name).toBe("B.SHW");
    expect(choosePrimary([{ name: "C.SH3" }, ...entries], () => true)?.name).toBe("C.SH3");
    expect(fileKind("story.shw")).toBe("show");
  });
});
