/**
 * Harvard Graphics 1.0 (Harvard Presentation Graphics A.00) and 2.10 / 2.12
 * / 2.30 chart parser (docs/SPEC-HG1-HG2.md).
 *
 * Detection is by signature ("PCOK" for 1.0, "Falc" for 2.x); the .CHT
 * extension is weak evidence only. Each chart becomes one scene, laid out
 * by the viewer from the chart's data and options (the files hold no
 * drawing). 1.0 and 2.x slide shows (.SHW, signatures "show" and "SHOW")
 * become presentations that find their charts beside them (show.ts,
 * presentation.ts).
 */
import type { Confidence, Document, FormatParser, ParseContext } from "../types";
import { UnsupportedFormatError } from "../types";
import { kindLabel } from "./model";
import { NotClassicChartError, isClassicChart, readClassicChart } from "./read";
import { classicShowToPresentation } from "./presentation";
import { chartToScene } from "./scene";
import { isClassicShow, readClassicShow } from "./show";

const EXTENSION_ONLY_CONFIDENCE = 0.2;

export const hg2Parser: FormatParser = {
  id: "hg2",
  name: "Harvard Graphics 1.x/2.x",

  detect(bytes: Uint8Array, filename: string): Confidence {
    if (isClassicChart(bytes) || isClassicShow(bytes)) return 1;
    return filename.toLowerCase().endsWith(".cht") ? EXTENSION_ONLY_CONFIDENCE : 0;
  },

  parse(bytes: Uint8Array, filename: string, context?: ParseContext): Document {
    const warnings: string[] = [];
    if (isClassicShow(bytes)) {
      const show = readClassicShow(bytes, warnings);
      // Opened on its own: no other files can be found, so every slide is missing.
      const ctx: ParseContext = context ?? { path: filename, resolve: () => null };
      const presentation = classicShowToPresentation(show, ctx, warnings);
      const count = show.slides.length;
      const description = show.description ? `: ${show.description}` : "";
      return {
        formatName: `Harvard Graphics ${show.version} slide show (${count} slide${count === 1 ? "" : "s"})${description}`,
        scenes: [],
        warnings: [...new Set(warnings)],
        presentation,
      };
    }
    let chart;
    try {
      chart = readClassicChart(bytes, warnings);
    } catch (e) {
      if (e instanceof NotClassicChartError) throw new UnsupportedFormatError(`This file is ${e.message}`);
      throw e;
    }
    const open = new Set([filename.replace(/^.*[\\/]/, "").toUpperCase()]);
    const scene = chartToScene(chart, warnings, { context, open });
    const description = chart.description.trim() ? `: ${chart.description.trim()}` : "";
    return {
      formatName: `Harvard Graphics ${chart.version} ${kindLabel(chart.kind)}${description}`,
      scenes: [scene],
      warnings: [...new Set(warnings)],
    };
  },
};
