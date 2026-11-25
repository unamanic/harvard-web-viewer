# Stroke font clones (task 7d-1)

The viewer's own single-line fonts, used for the seven HG stroke fonts of the
HG3.FGF font index when the original `.FN3` files are not loaded
(docs/RENDERER_TASKS.md task 7d, SPEC §2 and §6.4). They are built **only**
from the public-domain Hershey fonts. Nothing is read, traced or derived from
the Harvard Graphics `.FN3` or `.SPD` files.

## Files

| File | What |
| --- | --- |
| `hersheyData.ts` | Generated glyph data, 7 Hershey sets × 96 glyphs (codes 32–127), about 48 KB |
| `strokeFont.ts` | Decoding, composition of accented letters by Harvard Graphics code, `textToStrokePaths` |
| `clones.ts` | Font key → clone table, `strokeCloneFor` |
| `index.ts` | Public exports |
| `../../../scripts/gen-stroke-fonts.mjs` | Generator: `.jhf` files → `hersheyData.ts` |

## How the viewer draws with them (task 7f)

The HG stroke font keys are drawn with these clones (no loading step: they are built
in) as stroked `glyphs` scene elements, pen width `strokeWidthEm`; see `../glyphRun.ts`,
`../sources.ts` (`strokeGlyphSource`) and `src/formats/hg3/scene/textFaces.ts`. The
original .FN3 files cannot be decoded yet (task 7c), so the clones are used even when
they are loaded.

## Data source

- Distribution: Kamal Mostafa's `hershey-fonts` package, Git tag
  `hershey-fonts-0.1` (also the Debian `hershey-fonts` source), which carries
  the Usenet Hershey distribution in James Hurt's `.jhf` format
  (upstream: http://emergent.unpythonic.net/software/hershey).
- Fetched 2026-11-24 with plain GET requests from jsDelivr's GitHub mirror:
  `https://cdn.jsdelivr.net/gh/kamalmostafa/hershey-fonts@hershey-fonts-0.1/hershey-fonts/<file>.jhf`
- Files used (SHA-256 of the downloaded files):

  | File | Hershey set | SHA-256 |
  | --- | --- | --- |
  | rowmans.jhf | Roman Simplex | 8718fb129c0f6bce89c84fe41bc467e39534d215a6f7c3220cc5789a8a7d8618 |
  | rowmand.jhf | Roman Duplex | c56497b162a3831f0da2e189ada4a7335ce81b1c3c1cf380b2ced04287313d2e |
  | timesr.jhf | Roman Complex (Times-style serif) | c454a5ed471aa33c1aac8c5b21c2d343e828805af2b48eebba20c46f492d9457 |
  | rowmant.jhf | Roman Triplex | 8b280fa0c63aa003a80cbb5bbe4ef2535e0b61ca464d3b8e6e634ce0881b9b67 |
  | scripts.jhf | Script Simplex | 6b391b2ea3a0771cf18caff0ed111db3d05681fa586d423a740cc0b2b155a873 |
  | scriptc.jhf | Script Complex | 747f9384b0adbec3f6826cc374727adb262c6a96e2a758a2472d11291b7104c7 |
  | gothiceng.jhf | Gothic English | 2d7a62784906897ca3707ae73423c319295567efbf2c27825d3b72c28d00c061 |

- Fix applied by the generator: `rowmant.jhf` gives "J" zero width (side
  bearings `JJ`); the generator uses `JZ`, as `timesrb.jhf` does for the same
  Triplex J.

To regenerate: download the files above into a directory outside the repo and
run `node scripts/gen-stroke-fonts.mjs <that directory>`.

## Licence and acknowledgements

The Hershey fonts are in the public domain. The `.jhf` distribution carries
this use restriction, which the acknowledgement below satisfies (it is also
in the header of `hersheyData.ts`):

> This distribution of the Hershey Fonts may be used by anyone for any
> purpose, commercial or otherwise, providing that:
> 1. The following acknowledgements must be distributed with the font data:
>    - The Hershey Fonts were originally created by Dr. A. V. Hershey while
>      working at the U. S. National Bureau of Standards.
>    - The format of the Font data in this distribution was originally
>      created by James Hurt, Cognition, Inc., 900 Technology Park Drive,
>      Billerica, MA 01821 (mit-eddie!ci-dandelion!hurt).
> 2. The font data in this distribution may be converted into any other
>    format *EXCEPT* the format distributed by the U.S. NTIS.

The GPL-2 of the `hershey-fonts` package covers its C library and tools,
which are not used here; the `.jhf` data is under the restriction above.

## Faces

Our own family names; the HG names are only used to identify the originals.

| Key | Original (HG3.FGF) | Clone | Hershey set | Stroke width (em) |
| --- | --- | --- | --- | --- |
| 2:12:0x5848 | HG Roman Light | HWV Stroke Roman, light | Roman Complex | 0.040 |
| 2:13:0x5858 | HG Roman Bold | HWV Stroke Roman, bold | Roman Triplex | 0.055 |
| 2:16:0x5848 | HG Sans serif Light | HWV Stroke Sans, light | Roman Simplex | 0.040 |
| 2:17:0x5858 | HG Sans serif Bold | HWV Stroke Sans, bold | Roman Duplex | 0.060 |
| 2:20:0x5849 | HG Script Light | HWV Stroke Script, light | Script Simplex | 0.040 |
| 2:21:0x5859 | HG Script Bold | HWV Stroke Script, bold | Script Complex | 0.060 |
| 2:25:0x5878 | HG Gothic Bold | HWV Stroke Gothic, bold | Gothic English | 0.050 |

Why these sets:

- **Roman**: the serif Hershey romans form a natural light/bold pair, Complex
  (single stroke) and Triplex (the same design drawn with three strokes).
- **Sans serif**: Simplex and Duplex are Hershey's unserifed romans, single and
  double stroke.
- **Script**: Simplex and Complex, single and double stroke.
- **Gothic**: only a Bold face exists; Gothic English is the most legible of the
  three blackletters (English, German, Italian) and is closest to a generic
  "gothic" (Old English) display face.

Light and Bold differ by Hershey set and by the recommended pen width
(`strokeWidthEm`, times the em size). Multi-stroke sets already carry weight
in their strokes, so their pen is only a little wider.

## Metrics and coverage

- Units: `unitsPerEm` = 32 (the Hershey body), y down, baseline at y = 0;
  nominal `ascent` 25 and `descent` 7. Cap height (21 for the romans) and
  x-height are measured from H and x per face. These are Hershey metrics;
  scaling to the originals' measured metrics is a later step (task 7d).
- Codes 32–126 (ASCII) come straight from the Hershey sets.
- Composed from the same set's ASCII glyphs, keyed by Harvard Graphics code
  (src/formats/hg3/charset.ts): accented letters, including the capitals and
  tildes at 0xB5–0xEB (acute from `/`, grave from `\`, circumflex from the
  head of `^`, tilde from `~`, diaeresis from two `.`, ring from a small `o`,
  cedilla from `,`, dotless i from `i`), ø Ø (slashed), æ Æ (two letters
  overlapped), ¢ ¥, ª º, ¿ ¡ (turned ? !), « », °, ·, and copies of `*` and
  `-` at 0xFC and 0xFD.
- Not drawn (`glyph()` returns null): control codes, £ ₧ ƒ, the box-drawing
  and shade blocks, Greek and maths symbols, and the 90 codes the originals
  lack as well. `textToStrokePaths` advances by a space for them.
