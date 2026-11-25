/**
 * The "About this file" rows (pure, no React): what was detected, the chart
 * type, the palette, the fonts and the size. Chart facts are read from the
 * bytes with the HG3 container and chart readers (read-only use); fonts come
 * from the font report line the chart scene builder adds to its warnings.
 */
import { readContainer } from "../formats/hg3/container";
import { parseChart } from "../formats/hg3/chart";
import type { FileEntry } from "../files/FileSet";
import type { PresentationSlide } from "../formats/types";
import type { LoadedFile } from "../loadFile";

/** The default palette a chart uses when it names none (SPEC §3). */
const DEFAULT_PALETTE = "HG3.PL3";
/** Palettes the viewer has a built-in copy of. */
const BUILT_IN_PALETTES = new Set([DEFAULT_PALETTE, "MONOCHRB.PL3", "MONOCHRW.PL3"]);

/** Friendly names of the HG3 document types (container.ts DocumentType keys). */
const CHART_TYPE_NAMES: Record<string, string> = {
  XY: "XY chart (bar, line or area)",
  Pie: "Pie chart",
  Organization: "Organization chart",
  Title: "Title chart",
  Bullet: "Bullet list",
  Table: "Table",
  Drawing: "Drawing",
  Show: "Slide show",
  Palette: "Palette",
  CustomPalette: "Custom palette",
};

export interface ChartFacts {
  /** Friendly chart type, or null when the type code is unknown. */
  typeName: string | null;
  /** Description record (400), "" when absent: the chart's own title. */
  description: string;
  /** Palette the chart names (404 kind 2), or null: it uses HG3.PL3. */
  paletteName: string | null;
}

/** Chart facts from an HG3 chart's bytes, or null when they are not an HG3 chart. */
export function chartFacts(bytes: Uint8Array): ChartFacts | null {
  try {
    const container = readContainer(bytes);
    if (container.kind !== "chart") return null;
    const { chart } = parseChart(container);
    return {
      typeName: chart.name ? (CHART_TYPE_NAMES[chart.name] ?? chart.name) : null,
      description: chart.description.replace(/\s+/g, " ").trim(),
      paletteName: chart.fileRefs.paletteName?.trim() || null,
    };
  } catch {
    return null;
  }
}

/**
 * Where a chart's palette comes from, in words, following the palette
 * fallback chain (formats/hg3/palette.ts resolveChartPalette): the named
 * file, else HG3.PL3 from the opened files, else the built-in HG3.PL3.
 */
export function paletteText(
  paletteName: string | null,
  find: (name: string) => FileEntry | null,
  override?: string,
): string {
  if (override) return `${override}, chosen in Display`;
  const name = paletteName ?? DEFAULT_PALETTE;
  const found = find(name);
  if (found) return `${found.name}, found`;
  if (BUILT_IN_PALETTES.has(name.toUpperCase())) return `${name.toUpperCase()}, built-in copy`;
  return find(DEFAULT_PALETTE) ? `${name} missing, ${DEFAULT_PALETTE} used` : `${name} missing, built-in ${DEFAULT_PALETTE} used`;
}

const FONT_REPORT = /(?:^|: )Fonts: (.*)$/;

/** True for the font report line ("Fonts: …", possibly prefixed "CHART.CH3: "). */
export function isFontReport(warning: string): boolean {
  return FONT_REPORT.test(warning);
}

/**
 * Short font list from the font report lines among `warnings`, e.g.
 * "Swiss 721 Roman — original BX000003.SPD" → "Swiss 721 Roman — original".
 * One entry per face, in first-use order.
 */
export function summariseFonts(warnings: readonly string[]): string[] {
  const out: string[] = [];
  for (const w of warnings) {
    const m = FONT_REPORT.exec(w);
    if (!m) continue;
    for (const part of m[1].split("; ")) {
      const dash = part.indexOf(" — ");
      const name = dash >= 0 ? part.slice(0, dash) : part;
      const source = dash >= 0 ? part.slice(dash + 3) : "";
      const kind = /^(original|clone|look-alike|stroke|built-in)\b/.exec(source)?.[1] ?? source;
      const text = kind ? `${name} — ${kind}` : name;
      if (!out.includes(text)) out.push(text);
    }
  }
  return out;
}

/** "12,541 bytes". */
export function formatBytes(n: number): string {
  return `${n.toLocaleString("en-US")} byte${n === 1 ? "" : "s"}`;
}

/** One-line description of what was detected. */
export function detectedText(file: Pick<LoadedFile, "document" | "formatName" | "error">): string {
  if (file.document) return file.document.formatName;
  if (file.formatName && !file.error) return file.formatName;
  if (file.formatName) return `Could not open as ${file.formatName}`;
  return "Format not recognised";
}

export interface AboutRow {
  label: string;
  /** One or more lines. */
  value: string[];
}

/** Number of playable slides of a show (from its first slide). */
export function slideCount(file: LoadedFile): number {
  const p = file.document?.presentation;
  return p ? Math.max(0, p.slides.length - Math.max(p.firstSlide, 0)) : 0;
}

/**
 * The rows of the "About this file" list. For a show, the chart rows
 * describe the slide shown (`slide`), whose chart is looked up in the
 * opened files.
 */
export function aboutRows(file: LoadedFile, slide: PresentationSlide | null, paletteOverride?: string): AboutRow[] {
  const rows: AboutRow[] = [{ label: "Detected as", value: [detectedText(file)] }];
  const presentation = file.document?.presentation;
  let chartBytes: Uint8Array | null = file.bytes;
  let chartPath = file.path;
  let fontWarnings: readonly string[] = file.warnings;

  if (presentation) {
    const n = slideCount(file);
    rows.push({ label: "Show", value: [`${n} slide${n === 1 ? "" : "s"}`] });
    chartBytes = null;
    if (slide) {
      fontWarnings = slide.warnings();
      if (slide.kind === "picture" && slide.fileName) {
        const entry = file.fileSet.find(slide.fileName, file.path);
        rows.push({ label: "Slide file", value: [entry ? entry.name : `${slide.fileName} (not opened)`] });
        if (entry) {
          chartBytes = entry.bytes;
          chartPath = entry.path;
        }
      } else if (slide.kind !== "picture") {
        const kind = slide.kind === "nested" ? "Nested show" : slide.kind === "sound" ? "Sound" : "Empty";
        rows.push({ label: "Slide", value: [slide.fileName ? `${kind}: ${slide.fileName}` : kind] });
      }
    }
  }

  const facts = chartBytes && file.document ? chartFacts(chartBytes) : null;
  if (facts) {
    if (facts.typeName) rows.push({ label: "Chart type", value: [facts.typeName] });
    rows.push({
      label: "Palette",
      value: [paletteText(facts.paletteName, (name) => file.fileSet.find(name, chartPath), paletteOverride)],
    });
  }
  const fonts = summariseFonts(fontWarnings);
  if (fonts.length > 0) rows.push({ label: "Fonts", value: fonts });
  rows.push({ label: "Size", value: [formatBytes(file.bytes.length)] });
  return rows;
}
