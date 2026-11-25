#!/usr/bin/env node
/**
 * Generate src/formats/hg3/greyscalePalettes.ts, the viewer's built-in
 * copies of the Harvard Graphics 3 greyscale palettes MONOCHRB.PL3 (black
 * background) and MONOCHRW.PL3 (white background), used by the "Palette"
 * viewer option when the files were not opened (docs/RENDERER_TASKS.md task
 * 6c). Same approach as scripts/gen-default-palette.mjs.
 *
 * Usage, from the repository root:
 *
 *   node scripts/gen-greyscale-palettes.mjs [path/to/PALETTE-directory]
 *
 * The default input directory is samples-private/PALETTE. The palettes are
 * read with the viewer's own parser (src/formats/hg3/palette.ts), loaded
 * through Vite's module runner so no extra TypeScript tooling is needed.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runnerImport } from "vite";

const NAMES = ["MONOCHRB.PL3", "MONOCHRW.PL3"];

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const inputDir = resolve(process.argv[2] ?? join(root, "samples-private/PALETTE"));
const output = join(root, "src/formats/hg3/greyscalePalettes.ts");

const HEADER = `import type { DefaultPaletteEntry } from "./defaultPalette";

/** A built-in palette: its description (tag 400) and 64 entries. */
export interface BuiltInPalette {
  description: string;
  entries: readonly DefaultPaletteEntry[];
}
`;

// palette.ts imports greyscalePalettes.ts; on a first run write a stub so
// the parser can load.
if (!existsSync(output)) {
  writeFileSync(output, `${HEADER}\nexport const GREYSCALE_PALETTES: Readonly<Record<string, BuiltInPalette>> = {};\n`);
}

const { module: paletteModule } = await runnerImport(join(root, "src/formats/hg3/palette.ts"), {
  configFile: false,
  logLevel: "error",
});

const line = (e) =>
  `      { index: ${e.index}, role: ${e.role}, name: ${JSON.stringify(e.name)}, rgb: [${e.rgb.join(", ")}] },`;

const blocks = [];
for (const name of NAMES) {
  const input = join(inputDir, name);
  const { palette, warnings } = paletteModule.parsePalette(new Uint8Array(readFileSync(input)));
  if (warnings.length) {
    console.error(`warnings while reading ${input}:\n  ${warnings.join("\n  ")}`);
    process.exit(1);
  }
  if (palette.entries.length !== 64) {
    console.error(`${input}: expected 64 entries, found ${palette.entries.length}`);
    process.exit(1);
  }
  blocks.push(`  ${JSON.stringify(name)}: {
    description: ${JSON.stringify(palette.description)},
    entries: [
${palette.entries.map(line).join("\n")}
    ],
  },`);
}

const source = `/**
 * Built-in copies of the Harvard Graphics 3 greyscale palettes
 * ${NAMES.join(" and ")} (SPEC §6.2), used by the viewer's "Palette" option
 * (docs/RENDERER_TASKS.md task 6c) when the files were not opened.
 * Entries are in index order; role = index + 1.
 *
 * GENERATED FILE, do not edit. Generated from ${relative(root, inputDir)} by
 * scripts/gen-greyscale-palettes.mjs. To regenerate, from the repository root:
 *
 *   node scripts/gen-greyscale-palettes.mjs
 */

${HEADER}
/** Keyed by upper-case file name. */
export const GREYSCALE_PALETTES: Readonly<Record<string, BuiltInPalette>> = {
${blocks.join("\n")}
};
`;

writeFileSync(output, source);
console.log(`wrote ${relative(root, output)} (${NAMES.join(", ")})`);
