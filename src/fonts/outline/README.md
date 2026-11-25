# Outline clone fonts (HWV Sans, HWV Serif, HWV Slab, HWV Mono)

These are the project's own stand-ins for the 15 Bitstream Speedo faces of the Harvard
Graphics 3 font index (docs/RENDERER_TASKS.md, task 7d-2). The viewer uses them when the
original `.SPD` files are not loaded.

- **Metrics** (`metrics.ts`) are measured from the original fonts with the viewer's
  Speedo reader: the advance width of each byte code, plus cap height, x-height, ascender,
  descender and italic angle. These are numbers only. No outline, glyph bounding box or
  other shape data from the originals is stored here, and no outline comes from them.
  Regenerate with `node scripts/gen-outline-metrics.mjs`.
- **Outlines** (`faces/*.ts`) come from the open-licensed fonts listed below. They are
  rescaled to the original metrics by `node scripts/gen-outline-faces.mjs <source-dir>`
  (the method is described in that script's header comment).
- **Character set** (`charset.ts`): built from the shared Harvard Graphics table in
  `src/formats/hg3/charset.ts` (the upper half is not CP437); it says which character each
  code draws in the originals.

## How the viewer draws with them (task 7f)

Faces load by dynamic import (`outlineCloneFor`). Scene building is synchronous, so the
viewer loads the faces a document needs first: `hg3Parser.prepare` (called by
`loadEntry` / `loadFileSet` in `src/loadFile.ts`) lists the font keys the document's text
uses and awaits `outlineCloneFor` for each Speedo key the user's files cannot draw. The
scene builder then reads loaded faces with `loadedOutlineClone` (sync); a face not loaded
yet falls back to the CSS look-alike. Glyphs become `glyphs` scene elements through
`../glyphRun.ts` and `../sources.ts`; the order original .SPD → clone → CSS is in
`src/formats/hg3/scene/textFaces.ts`.

Code 0xFA draws a bullet (•), as in the originals (the faces were regenerated after the
character set was corrected; before, it was a middle dot).

## Faces and sources

| Original (font key, file) | Clone | Outline source |
|---|---|---|
| Swiss 721 Roman (3:3:0x4268, BX000003) | HWV Sans Regular | Liberation Sans Regular |
| Swiss 721 Italic (3:4:0x4269, BX000004) | HWV Sans Italic | Liberation Sans Italic |
| Swiss 721 Bold (3:5:0x42a8, BX000005) | HWV Sans Bold | Liberation Sans Bold |
| Swiss 721 Bold Italic (3:6:0x42a9, BX000006) | HWV Sans Bold Italic | Liberation Sans Bold Italic |
| Swiss 721 Thin (3:100:0x4228, BX000100) | HWV Sans Thin | Roboto Thin (symbols: Liberation Sans Regular) |
| Swiss 721 Thin Italic (3:101:0x4229, BX000101) | HWV Sans Thin Italic | Roboto Thin Italic (symbols: Liberation Sans Italic) |
| Dutch 801 Roman (3:11:0x4268, BX000011) | HWV Serif Regular | Liberation Serif Regular |
| Dutch 801 Italic (3:12:0x4269, BX000012) | HWV Serif Italic | Liberation Serif Italic |
| Dutch 801 Bold (3:13:0x42a8, BX000013) | HWV Serif Bold | Liberation Serif Bold |
| Dutch 801 Bold Italic (3:14:0x42a9, BX000014) | HWV Serif Bold Italic | Liberation Serif Bold Italic |
| Geo Slab 712 Medium (3:485:0x4278, BX000485) | HWV Slab Medium | Rokkitt 400 (symbols: Liberation Sans Regular) |
| Geo Slab 712 Medium Italic (3:486:0x4279, BX000486) | HWV Slab Medium Italic | Rokkitt 500, upright, sheared to 13.5° (symbols: Liberation Sans Regular, sheared) |
| Geo Slab 712 Light (3:483:0x4248, BX000483) | HWV Slab Light | Rokkitt 300 (symbols: Liberation Sans Regular) |
| Geo Slab 712 Light Italic (3:484:0x4249, BX000484) | HWV Slab Light Italic | Rokkitt 300, upright, sheared to 13.5° (symbols: Liberation Sans Regular, sheared) |
| Monospace 821 Roman (3:596:0x4268, BX000596) | HWV Mono Regular | Liberation Mono Regular |

The slab italics are obliques made from the upright Rokkitt because Geo Slab 712's italics
are sloped romans, while Rokkitt's italics are cursive. Medium Italic uses the heavier
Rokkitt 500 because the original italic is heavier than its roman.

"Symbols" are the CP437 pictographs, arrows, box-drawing and block characters and a few
signs (‰ ≥ ≤ ≈ √ ■) that the primary source lacks. Code 0xFF draws nothing: in the
originals it is a Bitstream pictograph with no Unicode equivalent. Its advance is kept.

## Provenance

| Source | Version | Where from | Licence | Licence file |
|---|---|---|---|---|
| Liberation Sans, Serif, Mono | 2.1.5 | `https://github.com/liberationfonts/liberation-fonts/files/7261482/liberation-fonts-ttf-2.1.5.tar.gz` (linked from the official 2.1.5 GitHub release); sha256 `7191c669bf38899f73a2094ed00f7b800553364f90e2637010a69c0e268f25d0` | SIL OFL 1.1; Reserved Font Names "Liberation", "Arimo", "Tinos", "Cousine" | `licenses/Liberation-OFL.txt` |
| Roboto Thin, Thin Italic | 2.138 | `https://github.com/googlefonts/roboto/releases/download/v2.138/roboto-unhinted.zip`; sha256 `70f64c718510a601fbcf752aafe644314dacaeb85474dc689c89787c4a72a728` | Apache License 2.0 | `licenses/Roboto-Apache-2.0.txt` |
| Rokkitt 300, 400, 500 (static instances, latin + latin-ext subsets, WOFF) | @fontsource/rokkitt 5.2.8 | `https://cdn.jsdelivr.net/npm/@fontsource/rokkitt@5.2.8/files/rokkitt-{latin,latin-ext}-{300,400,500}-normal.woff` | SIL OFL 1.1 | `licenses/Rokkitt-OFL.txt` |

sha256 of the Rokkitt files: latin-300 `6365b496…`, latin-400 `5f759c36…`,
latin-500 `798dab56…`, latin-ext-300 `42025f12…`, latin-ext-400 `ccbfe008…`,
latin-ext-500 `837a5915…`.

## Modifications

All clones are Modified Versions in the sense of the OFL (and modified files in the sense of
Apache 2.0, section 4(b)). The generator made these changes:

- It kept only the glyphs for the 256 HG3 byte codes and converted them to SVG path data at
  1000 units per em, with coordinates rounded to whole units.
- It scaled the outlines vertically, so that the cap height (and, for lowercase letters, the
  x-height) matches the original face.
- It applied a face-wide horizontal scale, plus a per-glyph horizontal scale limited to
  ±12%. It then redistributed the side bearings so that each advance width equals the
  original face's.
- It sheared the slab obliques.
- It merged symbols from Liberation Sans into the Roboto and Rokkitt based faces.

Following the OFL Reserved Font Name rules, the clones carry this project's own family names
(HWV Sans, HWV Serif, HWV Slab, HWV Mono). They do not use "Liberation", "Arimo", "Tinos",
"Cousine", "Roboto" or "Rokkitt". They also do not use the Bitstream names "Swiss 721",
"Dutch 801", "Geo Slab 712" or "Monospace 821", which identify only the originals they stand
in for. The clones may be used, modified and redistributed under the source licences above.
They may not be sold by themselves (OFL condition 1).
