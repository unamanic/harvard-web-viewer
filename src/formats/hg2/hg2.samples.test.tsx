/**
 * The committed 1.0 and 2.x test charts (samples/hg1-hg2, see its
 * README.md): every chart is detected, read and drawn; the base charts'
 * contents match what was typed into the real programs; 2.10 and 2.12
 * resaves of 2.30 charts read the same as the originals.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FileSet } from "../../files/FileSet";
import { SceneRenderer } from "../../render/SceneRenderer";
import { detectFormat } from "../registry";
import type { SceneElement, TextElement } from "../types";
import { hg2Parser } from "./index";
import type { ClassicChart } from "./model";
import { readClassicChart } from "./read";

const ROOT = new URL("../../../samples/hg1-hg2/", import.meta.url);
const FOLDERS = ["v100", "v210", "v212", "v230"] as const;

function files(folder: string): string[] {
  return readdirSync(new URL(`${folder}/`, ROOT), { recursive: true, encoding: "utf8" })
    .filter((f) => !f.includes("/") && !f.includes("\\"))
    .filter((f) => f.toUpperCase().endsWith(".CHT"))
    .sort();
}

function bytesOf(folder: string, name: string): Uint8Array {
  return new Uint8Array(readFileSync(new URL(`${folder}/${name}`, ROOT)));
}

function chart(folder: string, name: string): ClassicChart {
  const warnings: string[] = [];
  return readClassicChart(bytesOf(folder, `${name}.CHT`), warnings);
}

function folderSet(folder: string): FileSet {
  const set = new FileSet();
  for (const f of files(folder)) set.add(`${folder}/${f}`, bytesOf(folder, f));
  return set;
}

function texts(elements: SceneElement[]): string[] {
  const out: string[] = [];
  for (const e of elements) {
    if (e.kind === "text") out.push((e as TextElement).text);
    else if (e.kind === "group") out.push(...texts(e.children));
  }
  return out;
}

/** Warnings expected for some test charts (options the viewer does not draw yet). */
const KNOWN_WARNING = /fill patterns|patterns are not drawn/;

const present = existsSync(ROOT);

describe.skipIf(!present)("Harvard Graphics 1.0 / 2.x test charts", () => {
  for (const folder of FOLDERS) {
    describe(folder, () => {
      const set = present ? folderSet(folder) : new FileSet();
      for (const name of present ? files(folder) : []) {
        it(`${name} is detected, read and drawn`, () => {
          const entry = set.get(`${folder}/${name}`);
          expect(entry).not.toBeNull();
          if (!entry) return;
          const detection = detectFormat(entry.bytes, entry.name);
          expect(detection?.parser.id).toBe("hg2");
          expect(detection?.confidence).toBe(1);
          const doc = hg2Parser.parse(entry.bytes, entry.name, set.contextFor(entry.path));
          expect(doc.scenes).toHaveLength(1);
          expect(doc.formatName).toMatch(/^Harvard Graphics (1\.0|2\.10\/2\.12|2\.30) /);
          expect(doc.warnings.filter((w) => !KNOWN_WARNING.test(w))).toEqual([]);
          const markup = renderToStaticMarkup(<SceneRenderer scene={doc.scenes[0]} />);
          expect(markup).toContain("<svg");
        });
      }
    });
  }

  it("reads the version from the file", () => {
    expect(chart("v100", "BBASE").version).toBe("1.0");
    expect(chart("v230", "BBASE").version).toBe("2.30");
    expect(chart("v210", "ZBB2").version).toBe("2.10/2.12");
    expect(chart("v212", "WBB2").version).toBe("2.10/2.12");
  });

  it("1.0 bar chart: titles, series, labels", () => {
    const c = chart("v100", "BBASE");
    expect(c.kind).toBe("bar");
    expect(c.title.map((t) => t.text)).toEqual(["TTL", "SUB", ""]);
    expect(c.footnote[0].text).toBe("FOOT");
    const g = c.graph;
    expect(g?.xLabels).toEqual(["P1", "P2", "P3"]);
    expect(g?.series[0].name).toBe("Series A");
    expect(g?.series[0].values).toEqual([1, 2, 3]);
    expect(g?.series[1].values).toEqual([4, 5, 6]);
  });

  it("1.0 series type change (C1: series A as a line)", () => {
    expect(chart("v100", "C1").graph?.series[0].type).toBe("line");
    expect(chart("v100", "C4").graph?.series[1].type).toBe("trend");
  });

  it("1.0 pie, org and text charts", () => {
    const pie = chart("v100", "PBASE");
    expect(pie.kind).toBe("pie");
    expect(pie.pies[0].values).toEqual([10, 20, 30]);
    expect(pie.pies[0].labels).toEqual(["L1", "L2", "L3"]);
    const org = chart("v100", "OBASE");
    expect(org.org?.root?.name).toBe("BS");
    expect(org.org?.root?.children.map((n) => n.name)).toEqual(["S1", "S2"]);
    expect(chart("v100", "O1").org?.options.levels).toBe(1);
    const text = chart("v100", "T4L");
    expect(text.kind).toBe("title");
    expect(text.textLines.filter((l) => l.text.trim()).map((l) => l.text.trim())).toEqual(["AAAA", "BBBB", "CCCC", "DDDD"]);
  });

  it("2.30 bar, area, high/low/close and pie charts", () => {
    const bar = chart("v230", "BBASE");
    expect(bar.kind).toBe("bar");
    expect(bar.title[0].text).toBe("Test");
    expect(bar.graph?.xLabels).toEqual(["Q1", "Q2", "Q3"]);
    expect(bar.graph?.series[0].values).toEqual([10, 20, 30]);
    expect(bar.graph?.series[1].values).toEqual([15, 25, 35]);
    expect(chart("v230", "ABASE").kind).toBe("area");
    expect(chart("v230", "ABASE").graph?.series[0].type).toBe("area");
    expect(chart("v230", "HBASE").kind).toBe("hlc");
    const pie = chart("v230", "PBASE");
    expect(pie.pies[0].values).toEqual([40, 30, 20, 10]);
    expect(pie.pies[0].labels).toEqual(["Alpha", "Beta", "Gamma", "Delta"]);
    expect(chart("v230", "PCUT").pies[0].cut.some((c) => c)).toBe(true);
    expect(chart("v230", "P3D").pies[0].threeD).toBe(true);
    expect(chart("v230", "PCOL").pies[0].style).toBe("column");
  });

  it("2.30 graph options from the one-setting test files", () => {
    expect(chart("v230", "BHOR").graph?.options.horizontal).toBe(true);
    expect(chart("v230", "BENH1").graph?.options.enhancement).toBe("3d");
    expect(chart("v230", "BS1Y").graph?.series[0].axis).toBe(2);
    expect(chart("v230", "BS1C").graph?.series[0].cumulative).toBe(true);
    expect(chart("v230", "BDT1").graph?.options.dataTable).toBe("normal");
    expect(chart("v230", "BDT2").graph?.options.dataTable).toBe("framed");
    expect(chart("v230", "BY1SC").graph?.options.y1.log).toBe(true);
    // Tag 121: minimums at 4/8/12, maximums X/Y1 at 16/20, increments X/Y1 at 28/32.
    expect(chart("v230", "BXMIN").graph?.options.x.min).toBe(2);
    expect(chart("v230", "BXMIN").graph?.options.y1.min).toBeNull();
    expect(chart("v230", "BY1MIN").graph?.options.y1.min).toBe(5);
    expect(chart("v230", "BY1MAX").graph?.options.y1.max).toBe(100);
    expect(chart("v230", "BY1INC").graph?.options.y1.increment).toBe(10);
    expect(chart("v230", "BY2MIN").graph?.options.y2.min).toBe(7);
  });

  it("2.30 text charts by type", () => {
    const kinds = ["TTITLE", "TLIST", "TBULL", "TCOL2", "TCOL3", "TFREE"].map((n) => chart("v230", n).kind);
    expect(kinds).toEqual(["title", "list", "bullet", "columns", "columns", "freeform"]);
    const list = chart("v230", "TLIST");
    expect(list.textLines[0].text).toBe("Top1");
    expect(list.textLines[3].text).toBe("Mid1");
    expect(list.textLines[6].text).toBe("Bot1");
  });

  it("2.30 org chart", () => {
    const org = chart("v230", "OBASE").org;
    expect(org?.root?.name).toBe("Boss");
    expect(org?.root?.children.map((n) => n.name)).toEqual(["Ann", "Bob", "Cy"]);
    expect(chart("v230", "OB2").org?.options.linesUpper).toBe(3);
  });

  it("2.30 multiple chart draws the charts it names", () => {
    const c = chart("v230", "MBASE");
    expect(c.kind).toBe("multiple");
    expect(c.slots.map((s) => s.fileName)).toEqual(["BB2.CHT", "PB2.CHT"]);
    const set = folderSet("v230");
    const entry = set.get("v230/MBASE.CHT");
    if (!entry) throw new Error("missing MBASE.CHT");
    const doc = hg2Parser.parse(entry.bytes, entry.name, set.contextFor(entry.path));
    expect(doc.warnings).toEqual([]);
    const shown = texts(doc.scenes[0].elements);
    expect(shown).toContain("Alpha");
    expect(shown).toContain("Q1");
    // Opened alone, the slots are named and the missing files reported.
    const alone = hg2Parser.parse(entry.bytes, entry.name);
    expect(alone.warnings.join(" ")).toContain("BB2.CHT, PB2.CHT");
  });

  for (const [folder, prefix] of [
    ["v210", "Z"],
    ["v212", "W"],
  ] as const) {
    it(`${folder} resaves (${prefix}*) read the same as the 2.30 originals`, () => {
      const resaves = files(folder).filter((f) => f.startsWith(prefix));
      expect(resaves.length).toBeGreaterThan(5);
      for (const f of resaves) {
        const name = f.slice(1, -4);
        const resaved = { ...chart(folder, f.slice(0, -4)), version: "-" };
        const original = { ...chart("v230", name), version: "-" };
        expect(resaved, f).toEqual(original);
      }
    });
  }

  it("does not claim other files", () => {
    expect(hg2Parser.detect(new TextEncoder().encode("HGB3...."), "X.CH3")).toBe(0);
    expect(hg2Parser.detect(new Uint8Array(8), "OLD.CHT")).toBe(0.2);
    expect(() => hg2Parser.parse(new Uint8Array(8), "OLD.CHT")).toThrow(/not a Harvard Graphics 1.x or 2.x chart/);
  });
});
