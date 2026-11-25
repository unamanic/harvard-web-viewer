/**
 * Harvard Graphics 1.0 (Harvard Presentation Graphics A.00) and 2.10 / 2.12
 * / 2.30 chart parser (docs/SPEC-HG1-HG2.md).
 *
 * Detection is by signature ("PCOK" for 1.0, "Falc" for 2.x); the .CHT
 * extension is weak evidence only. Each chart becomes one scene, laid out
 * by the viewer from the chart's data and options (the files hold no
 * drawing). 2.x slide shows (.SHW) and the other 2.x files are not read.
 */
import type { Confidence, Document, FormatParser, ParseContext } from "../types";
import { UnsupportedFormatError } from "../types";
import { kindLabel } from "./model";
import { NotClassicChartError, isClassicChart, readClassicChart } from "./read";
import { chartToScene } from "./scene";

const EXTENSION_ONLY_CONFIDENCE = 0.2;

export const hg2Parser: FormatParser = {
  id: "hg2",
  name: "Harvard Graphics 1.x/2.x",

  detect(bytes: Uint8Array, filename: string): Confidence {
    if (isClassicChart(bytes)) return 1;
    return filename.toLowerCase().endsWith(".cht") ? EXTENSION_ONLY_CONFIDENCE : 0;
  },

  parse(bytes: Uint8Array, filename: string, context?: ParseContext): Document {
    const warnings: string[] = [];
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
