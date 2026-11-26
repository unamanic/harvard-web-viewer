import { describe, expect, it } from "vitest";
import { FileSet } from "../files/FileSet";
import { DocumentType } from "../formats/hg3/container";
import { block, buildDocument, concat, cstr, leaf, u16 } from "../formats/hg3/testing/bytes";
import { LANDSCAPE_VIEW_BOX, centredViewBox } from "../model/scene";
import { addedSummary, placeAddedFiles, providedNames } from "./addFiles";
import { heightFor } from "../render/svgFile";
import { exportChoices, exportFileName } from "./exportImage";
import { chartFacts, formatBytes, paletteText, summariseFonts } from "./fileFacts";
import { missingSentence, noticeItems, noticeTitle } from "./notice";
import { transitionLabel, transitionPlanLabel } from "./transitionLabel";

const bytes = (n = 1) => new Uint8Array(n);

describe("export choices and names", () => {
  it("keeps the page shape", () => {
    expect(heightFor(LANDSCAPE_VIEW_BOX, 640)).toBe(480);
    expect(exportChoices(centredViewBox(24576, 32768)).map((c) => c.label)).toEqual([
      "SVG (vector, any size)",
      "PNG, 1280 × 1707",
      "PNG, 640 × 853 (original screen size)",
    ]);
  });

  it("names the file after the document and slide", () => {
    expect(exportFileName("SALES93.CH3", 1, "png")).toBe("SALES93-slide1.png");
    expect(exportFileName("PETE&WLF.SH3", 12, "svg")).toBe("PETE&WLF-slide12.svg");
    expect(exportFileName("my chart.ch3", null, "svg")).toBe("my_chart.svg");
  });
});

describe("add missing files", () => {
  it("places added files beside the file shown, later duplicates winning", () => {
    const a = bytes(1);
    const b = bytes(2);
    expect(placeAddedFiles("DATA/SHOW.SH3", [{ path: "LOGO.PCX", bytes: a }, { path: "x/y/BX000003.SPD", bytes: a }, { path: "logo.pcx", bytes: b }])).toEqual([
      { path: "DATA/logo.pcx", bytes: b },
      { path: "DATA/BX000003.SPD", bytes: a },
    ]);
    expect(placeAddedFiles("TOP.CH3", [{ path: "LOGO.PCX", bytes: a }])).toEqual([{ path: "LOGO.PCX", bytes: a }]);
  });

  it("merges into a new set of the same lineage, the old one unchanged, so lookups find the files", () => {
    const set = new FileSet([{ path: "DATA/SHOW.SH3", bytes: bytes() }, { path: "OTHER/LOGO.PCX", bytes: bytes(5) }]);
    set.resolve("FONT.SPD", "DATA/SHOW.SH3", "font");
    const merged = set.withFiles(placeAddedFiles("DATA/SHOW.SH3", [{ path: "LOGO.PCX", bytes: bytes(9) }, { path: "FONT.SPD", bytes: bytes(3) }]));
    expect(merged.lineage).toBe(set.lineage);
    expect(set.size).toBe(2);
    expect(merged.size).toBe(4);
    expect(merged.find("LOGO.PCX", "DATA/SHOW.SH3")?.bytes.length).toBe(9);
    expect(merged.find("FONT.SPD", "DATA/SHOW.SH3")?.path).toBe("DATA/FONT.SPD");
    expect(merged.missing()).toEqual([]);
    expect(new FileSet().lineage).not.toBe(set.lineage);
  });

  it("reports which missing files were provided", () => {
    const provided = providedNames([{ name: "LOGO.PCX" }, { name: "FONT.SPD" }], [{ path: "dir/logo.pcx" }, { path: "README" }]);
    expect(provided).toEqual(["LOGO.PCX"]);
    expect(addedSummary(provided, 2)).toBe("Added LOGO.PCX.");
    expect(addedSummary([], 1)).toBe("Added 1 file; none of them was a missing one.");
  });
});

describe("file facts", () => {
  const chart = (type: number, palette?: string) =>
    buildDocument("HGB3", type, [
      block(500, [leaf(400, cstr("Quarterly Sales")), ...(palette ? [leaf(404, concat(u16(2), u16(0), cstr(palette)))] : [])]),
    ]);

  it("reads the chart type, title and palette name", () => {
    expect(chartFacts(chart(DocumentType.Pie, "STANDARD.PL3"))).toEqual({
      typeName: "Pie chart",
      description: "Quarterly Sales",
      paletteName: "STANDARD.PL3",
    });
    expect(chartFacts(chart(DocumentType.XY))?.paletteName).toBeNull();
    expect(chartFacts(bytes(8))).toBeNull();
  });

  it("follows the palette fallback chain", () => {
    const set = new FileSet([{ path: "D/HG3.PL3", bytes: bytes() }]);
    const find = (name: string) => set.find(name, "D/A.CH3");
    expect(paletteText(null, find)).toBe("HG3.PL3, found");
    expect(paletteText("MISSING.PL3", find)).toBe("MISSING.PL3 missing, HG3.PL3 used");
    expect(paletteText("monochrw.pl3", () => null)).toBe("MONOCHRW.PL3, built-in copy");
    expect(paletteText(null, () => null)).toBe("HG3.PL3, built-in copy");
  });

  it("summarises the font report", () => {
    expect(
      summariseFonts([
        "odd",
        "Fonts: Swiss 721 Roman — original BX000003.SPD; Dutch 801 Bold — clone HWV Serif Bold",
        "GALB1.CH3: Fonts: Swiss 721 Roman — original BX000003.SPD; Sans — look-alike Helvetica (CSS, clone not loaded)",
      ]),
    ).toEqual(["Swiss 721 Roman — original", "Dutch 801 Bold — clone", "Sans — look-alike"]);
  });

  it("formats sizes", () => {
    expect(formatBytes(4812)).toBe("4,812 bytes");
    expect(formatBytes(1)).toBe("1 byte");
  });
});

describe("notice", () => {
  it("pluralises the title", () => {
    expect(noticeTitle(1)).toBe("1 thing to know");
    expect(noticeTitle(3)).toBe("3 things to know");
  });

  it("puts missing files first in plain words, drops repeats and the font report, counts the technical notes", () => {
    const items = noticeItems({
      missing: [
        { name: "BX000003.SPD", requestedBy: "A.CH3", purpose: "font" },
        { name: "X.DAT", requestedBy: null },
      ],
      documentWarnings: [
        "font file BX000003.SPD (Swiss 721 Roman) not found; using a substitute",
        "HG3.FGF not found; using built-in font table",
        "bitmap LOGO.PCX could not be read: bad header",
        "object layer: object (612) at offset 1621: run 0 declares length 16 but the text has 15",
        "Fonts: Swiss 721 Roman — look-alike Helvetica (CSS)",
      ],
      slideWarnings: ["GALB1.CH3: odd record", "GALB1.CH3: HG3.FGF not found; using built-in font table"],
    });
    expect(items).toEqual([
      "Font file BX000003.SPD was not provided, so a look-alike font is used.",
      "X.DAT was not provided.",
      "Bitmap LOGO.PCX could not be read: bad header.",
      "3 small problems in the file were worked around.",
    ]);
    expect(missingSentence({ name: "TUNE.WAV", requestedBy: null, purpose: "sound" })).toBe("Sound TUNE.WAV was not provided, so it is not played.");
  });
});

describe("transitionLabel", () => {
  it("names effects with their direction, nothing for a plain cut", () => {
    expect(transitionLabel({ effect: "wipe", direction: "right" })).toBe("wipe right");
    expect(transitionLabel({ effect: "fade" })).toBe("fade");
    expect(transitionLabel({ effect: "replace" })).toBeNull();
    expect(transitionLabel(null)).toBeNull();
  });

  it("names a slide change: the old slide's erase, then the new slide's draw", () => {
    const iris = { effect: "iris", direction: "out" };
    expect(transitionPlanLabel({ erase: { effect: "fade" }, draw: iris })).toBe("erase fade, then iris out");
    expect(transitionPlanLabel({ erase: null, draw: iris })).toBe("iris out");
    expect(transitionPlanLabel({ erase: { effect: "replace" }, draw: iris })).toBe("iris out");
    expect(transitionPlanLabel({ erase: { effect: "wipe", direction: "down" }, draw: { effect: "replace" } })).toBe("erase wipe down");
    expect(transitionPlanLabel({ erase: null, draw: { effect: "replace" } })).toBeNull();
    expect(transitionPlanLabel(null)).toBeNull();
  });
});
