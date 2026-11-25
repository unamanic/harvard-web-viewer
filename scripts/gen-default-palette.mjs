#!/usr/bin/env node
/**
 * Generate src/formats/hg3/defaultPalette.ts, the viewer's built-in copy of
 * the Harvard Graphics 3 default palette HG3.PL3 (SPEC §6.2, §7.1;
 * docs/RENDERER_TASKS.md task 6).
 *
 * Usage, from the repository root:
 *
 *   node scripts/gen-default-palette.mjs [path/to/HG3.PL3]
 *
 * The default input is samples-private/PALETTE/HG3.PL3. The palette is read
 * with the viewer's own parser (src/formats/hg3/palette.ts), loaded through
 * Vite's module runner so no extra TypeScript tooling is needed.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runnerImport } from "vite";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const input = resolve(process.argv[2] ?? join(root, "samples-private/PALETTE/HG3.PL3"));
const output = join(root, "src/formats/hg3/defaultPalette.ts");

const TYPE_DECL = `/** One entry of the built-in palette (see palette.ts PaletteEntry). */
export interface DefaultPaletteEntry {
  index: number;
  role: number;
  name: string;
  rgb: readonly [number, number, number];
}
`;

// palette.ts imports defaultPalette.ts; on a first run write a stub so the
// parser can load.
if (!existsSync(output)) {
  writeFileSync(output, `${TYPE_DECL}\nexport const DEFAULT_PALETTE_ENTRIES: readonly DefaultPaletteEntry[] = [];\n`);
}

const { module: paletteModule } = await runnerImport(join(root, "src/formats/hg3/palette.ts"), {
  configFile: false,
  logLevel: "error",
});

const { palette, warnings } = paletteModule.parsePalette(new Uint8Array(readFileSync(input)));
if (warnings.length) {
  console.error(`warnings while reading ${input}:\n  ${warnings.join("\n  ")}`);
  process.exit(1);
}
if (palette.entries.length !== 64) {
  console.error(`expected 64 entries, found ${palette.entries.length}`);
  process.exit(1);
}

const line = (e) =>
  `  { index: ${e.index}, role: ${e.role}, name: ${JSON.stringify(e.name)}, rgb: [${e.rgb.join(", ")}] },`;

const source = `/**
 * Built-in copy of the Harvard Graphics 3 default palette ${basename(input)}
 * (SPEC §6.2), used when a chart's palette file and HG3.PL3 are both
 * unavailable, or a palette is empty (SPEC §7.1).
 *
 * GENERATED FILE, do not edit. Generated from ${relative(root, input)} by
 * scripts/gen-default-palette.mjs. To regenerate, from the repository root:
 *
 *   node scripts/gen-default-palette.mjs
 */

${TYPE_DECL}
/** The ${palette.entries.length} entries in index order; role = index + 1. */
export const DEFAULT_PALETTE_ENTRIES: readonly DefaultPaletteEntry[] = [
${palette.entries.map(line).join("\n")}
];
`;

writeFileSync(output, source);
console.log(`wrote ${relative(root, output)} (${palette.entries.length} entries)`);
