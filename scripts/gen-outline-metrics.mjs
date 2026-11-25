#!/usr/bin/env node
/**
 * Generate src/fonts/outline/metrics.ts: the measured metrics of the 15
 * original Bitstream Speedo faces (docs/RENDERER_TASKS.md tasks 7d, 7d-2).
 *
 * Usage, from the repository root:
 *
 *   node scripts/gen-outline-metrics.mjs [path/to/HG3.FGF] [path/to/FONT/]
 *
 * Defaults: samples-private/HG3.FGF and samples-private/FONT/.
 *
 * Only numbers are written: per byte code the advance width, and per face
 * cap height, x-height, ascender, descender and italic angle, all in 1000
 * units per em. Never outlines, glyph bounding boxes or other shape data.
 * The fonts are read with the viewer's own readers (src/formats/hg3/fgf.ts,
 * src/formats/speedo/speedo.ts), loaded through Vite's module runner.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runnerImport } from "vite";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fgfPath = resolve(process.argv[2] ?? join(root, "samples-private/HG3.FGF"));
const fontDir = resolve(process.argv[3] ?? join(root, "samples-private/FONT"));
const output = join(root, "src/fonts/outline/metrics.ts");

const load = async (p) => (await runnerImport(join(root, p), { configFile: false, logLevel: "error" })).module;
const { parseFgf } = await load("src/formats/hg3/fgf.ts");
const { parseSpeedo, fontMetricsTable } = await load("src/formats/speedo/speedo.ts");
const { fontKeyString } = await load("src/formats/hg3/fontKey.ts");
const { OUTLINE_CLONES } = await load("src/fonts/outline/table.ts");

const { entries, warnings } = parseFgf(new Uint8Array(readFileSync(fgfPath)));
if (warnings.length) console.warn(`warnings reading ${fgfPath}:\n  ${warnings.join("\n  ")}`);

const toEm = (v, orus) => (v === undefined || v === null ? null : Math.round((v * 1000) / orus));

const faces = [];
for (const clone of OUTLINE_CLONES) {
  const ks = fontKeyString(clone.key);
  const entry = entries.find((e) => fontKeyString(e.key) === ks);
  if (!entry) throw new Error(`${ks} not in ${fgfPath}`);
  if (entry.fileName.toUpperCase() !== clone.originalFile) {
    throw new Error(`${ks}: index names ${entry.fileName}, table says ${clone.originalFile}`);
  }
  const font = parseSpeedo(new Uint8Array(readFileSync(join(fontDir, clone.originalFile))));
  const t = fontMetricsTable(font, entry.charMap);
  const res = font.metricResolution || t.orusPerEm;
  faces.push({
    key: ks,
    capHeight: toEm(t.capHeight, t.orusPerEm),
    xHeight: toEm(t.xHeight, t.orusPerEm),
    ascent: toEm(t.ascender, t.orusPerEm),
    descent: toEm(t.descender, t.orusPerEm),
    italicAngle: Math.round(t.header.italicAngle * 100) / 100,
    advances: t.advances.map((a) => (a === null ? -1 : Math.round((a * 1000) / res))),
  });
}

const line = (f) =>
  `  ${JSON.stringify(f.key)}: {\n` +
  `    capHeight: ${f.capHeight}, xHeight: ${f.xHeight}, ascent: ${f.ascent}, descent: ${f.descent}, italicAngle: ${f.italicAngle},\n` +
  `    advances: [${f.advances.join(",")}],\n  },`;

const source = `/**
 * Measured metrics of the 15 original Bitstream Speedo faces of the
 * Harvard Graphics 3 font index (task 7d-2), in 1000 units per em.
 *
 * Facts about the fonts only (advance widths and font-wide heights), no
 * outline data. GENERATED FILE, do not edit. Generated from
 * ${relative(root, fgfPath)} and the .SPD files by scripts/gen-outline-metrics.mjs:
 *
 *   node scripts/gen-outline-metrics.mjs
 *
 * capHeight = top of 'H', xHeight = top of 'x', ascent = top of 'd',
 * descent = bottom of 'p' (negative, y up). advances[code] is the advance
 * of byte code 0–255 through the HG3.FGF character map; -1 = no glyph.
 */

export interface OutlineFaceMetrics {
  capHeight: number;
  xHeight: number;
  ascent: number;
  descent: number;
  /** Degrees, positive = leaning right. */
  italicAngle: number;
  /** 256 advance widths by byte code; -1 = no glyph. */
  advances: readonly number[];
}

/** Keyed by fontKeyString (e.g. "3:3:0x4268"). */
export const OUTLINE_FACE_METRICS: Readonly<Record<string, OutlineFaceMetrics>> = {
${faces.map(line).join("\n")}
};
`;

writeFileSync(output, source);
console.log(`wrote ${relative(root, output)} (${faces.length} faces)`);
