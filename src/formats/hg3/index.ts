/**
 * Harvard Graphics 3 parser (SPEC §2, §3, §7.1).
 *
 * Detection is by signature (HGB3 chart, HGB1 show, HGA2 palette); the file
 * extension is only weak evidence, so that an HG3-named file with the wrong
 * contents still reaches `parse` and gets a clear rejection message.
 *
 * STATUS: charts produce one scene (scene/buildChartScene.ts; parts not drawn
 * yet are listed in an info warning). Shows produce a presentation
 * (presentation.ts) whose slides are drawn lazily. Palettes are not drawn.
 */
import type { Document } from "../../model/document";
import type { Presentation } from "../../model/presentation";
import type { Scene } from "../../model/scene";
import type { Confidence, FormatParser, ParseContext } from "../parser";
import { UnsupportedFormatError } from "../parser";
import { chartScene } from "./chartScene";
import { type Container, NotHg3Error, SIGNATURES, documentTypeName, readContainer } from "./container";
import { showToPresentation } from "./presentation";
import { prepareHg3Fonts } from "./scene/prepareFonts";
import { parseShow } from "./show";

/** Extensions of the files the viewer opens (SPEC §2). .SY3 is not needed for playback. */
const EXTENSIONS = [".ch3", ".sh3", ".pl3", ".pc3"];

/** Confidence for a known extension without a matching signature. */
const EXTENSION_ONLY_CONFIDENCE = 0.2;

function hasSignature(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  return Object.hasOwn(SIGNATURES, String.fromCharCode(...bytes.subarray(0, 4)));
}

// Per-kind builders. They append their warnings to `warnings`. Palettes are
// not drawn: they return no scenes, and `parse` reports that as an info
// warning. Shows produce a presentation instead of scenes.
function buildChart(container: Container, context: ParseContext | undefined, warnings: string[]): Scene[] {
  return [chartScene(container, context, warnings)];
}
function buildShow(container: Container, filename: string, context: ParseContext | undefined, warnings: string[]): Presentation {
  const parsed = parseShow(container);
  warnings.push(...parsed.warnings);
  // Opened on its own: no other files can be found, so every slide file is missing.
  const ctx: ParseContext = context ?? { path: filename, resolve: () => null };
  return showToPresentation(parsed.show, ctx, warnings);
}

/** E.g. "Chart (Pie chart, type 0x15)" or "Show (Show, type 0x2e)". */
function describe(container: Container): string {
  const { kind } = container;
  const code = container.version.documentType;
  const name = documentTypeName(code) ?? "unknown type";
  const typeLabel = kind === "chart" ? `${name} chart` : name;
  const hex = `0x${code.toString(16).padStart(2, "0")}`;
  return `${kind[0].toUpperCase()}${kind.slice(1)} (${typeLabel}, type ${hex})`;
}

export const hg3Parser: FormatParser = {
  id: "hg3",
  name: "Harvard Graphics 3",

  detect(bytes: Uint8Array, filename: string): Confidence {
    if (hasSignature(bytes)) return 1;
    const lower = filename.toLowerCase();
    return EXTENSIONS.some((ext) => lower.endsWith(ext)) ? EXTENSION_ONLY_CONFIDENCE : 0;
  },

  /** Loads the outline clone fonts the document's text needs (scene/prepareFonts.ts). */
  async prepare(bytes: Uint8Array, _filename: string, context?: ParseContext): Promise<void> {
    try {
      await prepareHg3Fonts(bytes, context);
    } catch {
      // parse falls back to CSS fonts.
    }
  },

  parse(bytes: Uint8Array, filename: string, context?: ParseContext): Document {
    let container: Container;
    try {
      container = readContainer(bytes);
    } catch (e) {
      if (e instanceof NotHg3Error) throw new UnsupportedFormatError(`This file is ${e.message}`);
      throw e;
    }

    const warnings = [...container.warnings];
    if (container.damaged) {
      warnings.unshift("The file is damaged: it ends inside a record. Only the part before the damage was read.");
    }

    const formatName = `Harvard Graphics 3 ${container.kind}`;
    switch (container.kind) {
      case "chart":
        return { formatName, scenes: buildChart(container, context, warnings), warnings };
      case "show": {
        const presentation = buildShow(container, filename, context, warnings);
        return { formatName, scenes: [], warnings, presentation };
      }
      case "palette":
        warnings.push(`${describe(container)}: drawing is not implemented yet.`);
        return { formatName, scenes: [], warnings };
    }
  },
};
