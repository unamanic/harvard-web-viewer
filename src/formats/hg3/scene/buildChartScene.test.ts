import { afterEach, describe, expect, it } from "vitest";
import { LANDSCAPE_VIEW_BOX, PORTRAIT_VIEW_BOX, type ParseContext, type ResolvedFile } from "../../types";
import { FRAME_STROKE_WIDTH } from "../assumptions";
import { parseChart } from "../chart";
import { DocumentType, readContainer } from "../container";
import { DEFAULT_PALETTE, ROLE, colorForRole, rgbToCss } from "../palette";
import { type RecordSpec, block, buildDocument, concat, cstr, f32, i16, leaf, padded, u16, u8 } from "../testing/bytes";
import { SCENE_DEBUG, buildChartScene, notYetDrawn } from "./buildChartScene";

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

const area = (tag: number, x1: number, y1: number, x2: number, y2: number) =>
  leaf(tag, concat(i16(x1), i16(y1), i16(x2), i16(y2), u16(0)));
const ref = (kind: number, name: string) => leaf(404, concat(u16(kind), u16(0), cstr(name)));
const pageSetup = (orientation: number) => leaf(816, concat(u8(orientation), u8(1), f32(10), f32(7.5)));

/** Entry i gets RGB (i, 2i, 3i) and the role i + 1. */
function paletteFile(count: number): Uint8Array {
  const body: RecordSpec[] = [leaf(1551, u16(count))];
  for (let i = 0; i < count; i++) {
    body.push(leaf(1553, concat(u16(i), padded(`C${i}`, 16))), leaf(1552, concat(u16(i), [i + 1, i, 2 * i, 3 * i])));
  }
  return buildDocument("HGA2", DocumentType.Palette, [block(500, [leaf(400, cstr(""))]), block(524, body)]);
}

function fakeContext(files: Record<string, Uint8Array>): ParseContext {
  return {
    path: "A.CH3",
    resolve(name: string): ResolvedFile | null {
      const key = Object.keys(files).find((k) => k.toUpperCase() === name.toUpperCase());
      return key ? { path: key, name: key, bytes: files[key] } : null;
    },
  };
}

function chartOf(type: number, inner508: RecordSpec[], objects: RecordSpec[] = []) {
  const bytes = buildDocument("HGB3", type, [
    block(500, [leaf(400, cstr("demo"))]),
    block(504, [block(516, objects, new Uint8Array(16)), block(508, inner508)]),
  ]);
  return parseChart(readContainer(bytes)).chart;
}

const pieWithAreas = (extra: RecordSpec[] = []) =>
  chartOf(DocumentType.Pie, [
    area(802, -16000, -12000, 16000, 12000),
    area(804, -16000, 6000, 16000, 12000),
    area(806, -15000, -9000, 15000, 6000),
    area(808, -16000, -12000, 0, -9000),
    pageSetup(1),
    ...extra,
  ]);

afterEach(() => {
  SCENE_DEBUG.showPageAreas = false;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildChartScene: page", () => {
  it("uses the landscape viewBox for 816 orientation 1 and the portrait one for 2", () => {
    const land = buildChartScene(chartOf(DocumentType.Drawing, [pageSetup(1)]), undefined);
    expect(land.scene.viewBox).toEqual(LANDSCAPE_VIEW_BOX);
    const port = buildChartScene(chartOf(DocumentType.Drawing, [pageSetup(2)]), undefined);
    expect(port.scene.viewBox).toEqual(PORTRAIT_VIEW_BOX);
  });

  it("defaults to landscape when there is no 816", () => {
    expect(buildChartScene(chartOf(DocumentType.Drawing, []), undefined).scene.viewBox).toEqual(LANDSCAPE_VIEW_BOX);
  });
});

describe("buildChartScene: colours", () => {
  it("fills the background with role 15 of the palette the chart names", () => {
    const chart = pieWithAreas([ref(2, "MINE.PL3")]);
    const { scene, warnings } = buildChartScene(chart, fakeContext({ "MINE.PL3": paletteFile(64) }));
    // Role 15 = entry 14 = (14, 28, 42).
    expect(scene.background).toBe("#0e1c2a");
    expect(warnings).toEqual([]);
  });

  it("uses HG3.PL3 from the file set when the chart names no palette", () => {
    const { scene } = buildChartScene(pieWithAreas(), fakeContext({ "HG3.PL3": paletteFile(64) }));
    expect(scene.background).toBe("#0e1c2a");
  });

  it("falls back to the built-in palette, with a warning, when the palette file is missing", () => {
    const { scene, warnings } = buildChartScene(pieWithAreas([ref(2, "12.PL3")]), fakeContext({}));
    expect(scene.background).toBe(rgbToCss(colorForRole(DEFAULT_PALETTE, ROLE.FrameBkg)!));
    expect(warnings).toContain("palette file 12.PL3 not found");
    expect(warnings).toContain("using the built-in copy of HG3.PL3 instead of 12.PL3");
  });

  it("warns once for a role the palette lacks and uses the default palette's colour", () => {
    const chart = pieWithAreas([ref(2, "SHORT.PL3")]);
    // "never": no data layout (its title separator would ask for role 18 too).
    const { scene, warnings } = buildChartScene(chart, fakeContext({ "SHORT.PL3": paletteFile(10) }), { dataLayout: "never" });
    expect(scene.background).toBe(rgbToCss(colorForRole(DEFAULT_PALETTE, ROLE.FrameBkg)!));
    const roleWarnings = warnings.filter((w) => w.startsWith("colour role"));
    expect(roleWarnings).toEqual([
      "colour role 15 is not in the palette (10 colours); default palette used",
      "colour role 14 is not in the palette (10 colours); default palette used",
    ]);
  });
});

describe("buildChartScene: frame", () => {
  it("draws the 802 area as a role 14 outline, y flipped", () => {
    const chart = chartOf(DocumentType.Pie, [area(802, -1000, -2000, 3000, 4000), ref(2, "MINE.PL3")]);
    const { scene } = buildChartScene(chart, fakeContext({ "MINE.PL3": paletteFile(64) }));
    expect(scene.elements).toEqual([
      {
        kind: "rect",
        x: -1000,
        y: -4000,
        width: 4000,
        height: 6000,
        fill: null,
        stroke: "#0d1a27", // role 14 = entry 13 = (13, 26, 39)
        strokeWidth: FRAME_STROKE_WIDTH,
      },
    ]);
  });

  it("draws no frame for a drawing", () => {
    const { scene } = buildChartScene(chartOf(DocumentType.Drawing, [pageSetup(1)]), undefined);
    expect(scene.elements).toEqual([]);
  });

  it("draws no frame for a data chart without 802", () => {
    const { scene } = buildChartScene(chartOf(DocumentType.Pie, []), undefined);
    expect(scene.elements).toEqual([]);
  });

  it("outlines every page area on top when SCENE_DEBUG.showPageAreas is set", () => {
    SCENE_DEBUG.showPageAreas = true;
    const { scene } = buildChartScene(pieWithAreas(), undefined, { dataLayout: "never" });
    // Frame + 4 debug outlines (802, 804, 806, 808; no 810).
    expect(scene.elements).toHaveLength(5);
    expect(scene.elements.slice(1).map((e) => e.kind === "rect" && e.y)).toEqual([-12000, -12000, -6000, 9000]);
  });
});

describe("notYetDrawn", () => {
  it("lists only the parts the chart has", () => {
    expect(notYetDrawn(chartOf(DocumentType.Drawing, []))).toEqual([]);
    expect(notYetDrawn(chartOf(DocumentType.Drawing, [], [leaf(616, new Uint8Array(4))]))).toEqual([]);
    expect(notYetDrawn(chartOf(DocumentType.Pie, [ref(1, "BUTTONS.CH3")]))).toEqual(["pie data"]);
  });
});
