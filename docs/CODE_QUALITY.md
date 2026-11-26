# Code quality review

Reviewed at `ff781c4` (26 November 2026): about 33,700 lines of source in
`src/` (tests excluded), 1,215 tests passing.

This is a review of structure: how the code is split, which parts depend on
which, and where it is inconsistent. It did not look for drawing bugs or
format errors; those are tracked in [formats.md](formats.md).

Each item gives the evidence, why it matters and a suggested fix. Sizes are
rough: **S** is under an hour, **M** is a few hours, **L** is a day or more.

## Summary

The overall design is sound and worth keeping: bytes become a typed
document, the document becomes a `Scene`, and the renderer, player and
video export only know about scenes. The problems are at the edges of that
design.

| # | Issue | Priority | Size | Status |
| --- | --- | --- | --- | --- |
| 1 | The 1.x/2.x code is a second, separate implementation | High | L | Partly done; the rest reconsidered (see below) |
| 2 | Nothing checks a change before it reaches `main` | High | S | Not done: not wanted for now |
| 3 | Several modules depend on each other in both directions | High | M | Done |
| 4 | A few very large files and functions | Medium | L | Done for the layout code and the dialog; `assumptions.ts` kept whole |
| 5 | The 1.x/2.x code has no unit tests | Medium | M | Done |
| 6 | Small helpers are copied between modules | Medium | M | Done |
| 7 | `App` holds all loading and settings state | Medium | M | Done |
| 8 | `tools/` and `scripts/` are not type-checked | Medium | S | Done |
| 9 | `components/` and `ui/` have no clear dividing rule | Low | S | Done |
| 10 | Project docs lag behind the code | Low | S | Done |
| 11 | Unused exported constants | Low | S | Done |
| 12 | 165 non-null assertions (`!`) | Low | M | Left as a guideline, as suggested |

The fixes are on the `code-quality` branch. Every step that moved drawing
code was checked by hashing the scene of every sample and test chart
(1,482 scenes: 3.x laid out from data and from the drawn copy, and every
1.x/2.x chart) before and after; they were identical. The "Outcome" note
under each item says what was done.

## What is in good shape

These are worth protecting when fixing the items below.

- **One-way pipeline.** `render/`, `player/` and `video/` import only the
  shared types from `formats/types.ts`, never a specific format. Adding the
  1.x/2.x parser needed no change to any of them.
- **Parser registry.** `formats/registry.ts` is the only place that lists
  formats, and each parser has the same `detect` / `parse` shape.
- **Guesses are kept apart from facts.** Each format has an
  `assumptions.ts` holding every fitted or inferred number, with the spec
  as the source of confirmed ones.
- **Strict TypeScript.** `strict`, `noUnusedLocals` and
  `noUnusedParameters` are on. There is one `any`, no `@ts-ignore`, and two
  TODO comments in the whole tree.
- **Tests sit beside the code** and need no browser. `formats/hg3/` has 29
  test files for 45 source files; `render/` has 8 for 9.
- **Heavy parts load on demand.** The outline font faces, the video
  exporter and the image exporter are each loaded only when used.
- **Two runtime dependencies** (React and React DOM).

## High priority

### 1. The 1.x/2.x code is a second, separate implementation

`src/formats/hg2/` imports nothing from `src/formats/hg3/` or `src/fonts/`.
It solves the same problems again, differently:

| Concern | 3.x | 1.x/2.x |
| --- | --- | --- |
| Reading bytes | `hg3/ByteReader.ts` (used by 10 files) | its own `hg2/bytes.ts` `Bytes` class |
| Text | Glyph outlines from the Speedo fonts or the clone fonts, measured exactly (`scene/data/text.ts`) | Browser font "Helvetica, Arial", width guessed as 0.6 × size per character (`hg2/text.ts`) |
| Bar/line charts | `scene/data/xy.ts` | `hg2/graph.ts` |
| Pies, organisation charts | `scene/data/pie.ts`, `org.ts` | `hg2/pie.ts`, `orgChart.ts` |
| Number formatting | `scene/data/xyFormat.ts` | `formatValue` in `hg2/graph.ts` |
| Axis scale and tick steps | inside `xy.ts` | `niceStep`, `makeScale` in `hg2/graph.ts` |
| Colour shading | `shadeCss` in `hg3/scene/objectLayer.ts` | `shade` in `hg2/assumptions.ts` |

Why it matters:

- Every chart fix has to be made twice, or the two versions drift apart.
- 1.x/2.x text looks different from 3.x text and depends on the fonts
  installed on the viewer's computer. The 3.x code avoids this on purpose.

Suggested fix, in order:

1. Move `ByteReader` to `src/formats/` and use it in `hg2/`. (S)
2. Draw 1.x/2.x text through the glyph pipeline, with a clone face in
   place of the browser font. This removes the 0.6 guess. (M)
3. Pull the parts both chart builders need into a shared module: axis
   scale, tick steps, number formatting, legend rows. Keep the two layouts
   separate where the programs really differ. (L)

Step 3 is the big one and can wait; steps 1 and 2 give most of the value.

**Outcome:**

- Step 2 done (`fa51766`): 1.x/2.x text is drawn with the HWV Sans clone
  faces in each run's weight and slant, and every width is measured from
  them. The parser's `prepare()` loads the faces; until then it falls back
  to CSS text. The generic glyph-line element moved to `fonts/glyphRun.ts`
  for both formats.
- Step 3 done where the code really was the same (`ca4bf0c`): colour
  building (`rgbToCss`, `shadeCss`) is shared in `model/color.ts`. The axis
  scales, tick steps and number formats were left separate: 3.x rounds its
  tick step geometrically (fitted to the 3.05 samples), 1.x/2.x rounds up,
  and each formats numbers by its own options. Sharing them would change one
  format's output with no evidence for it.
- Step 1 reconsidered, not done: `hg2/bytes.ts` and `ByteReader` have
  different contracts. `ByteReader` is a cursor that throws on a short
  record, which suits 3.x records. `Bytes` reads fields at fixed offsets and
  returns 0 past the end, which is how SPEC-HG1-HG2 describes its formats.
  Moving 157 call sites onto a cursor would need a try/catch per field. What
  the two did share, the code page 437 table, is now in `formats/cp437.ts`
  (item 6).

### 2. Nothing checks a change before it reaches `main`

- The only workflow is `.github/workflows/deploy.yml`. It runs on a push
  to `main`, so tests run only after the change is already there. Pull
  requests and other branches are not checked.
- There is no linter and no formatter. Style is consistent today only
  because few people write the code.

Why it matters: a failing test on `main` blocks the deploy but does not
stop the merge, and a second contributor has no automatic guide to the
house style.

Suggested fix:

- Add a `ci.yml` that runs `yarn typecheck` and `yarn test` on pull
  requests and on every branch push. (S)
- Add ESLint (with the TypeScript and React hooks rules) and Prettier, and
  run both in that workflow. Expect one large formatting commit. (S to M)

**Outcome:** not done. A check before merging is not wanted for now, so
ESLint, Prettier and an unused-export check were not added either.

### 3. Several modules depend on each other in both directions

The intended direction is formats → scene → render/player → components.
These imports go against it:

| From | To | Import |
| --- | --- | --- |
| `fonts/` | `formats/hg3/` | `charset` and `fontKey` (6 imports), while `formats/hg3/scene/` imports `fonts/` (7 imports): a cycle |
| `files/openFiles.ts` | `ui/fileGroups` | To tell shows from charts |
| `video/rasterize.ts` | `components/exportScene` | The exporter depends on the UI folder |
| `ui/`, `components/` | `loadFile.ts` | For the `LoadedFile` and `LoadOptions` types, while `loadFile.ts` sits at the top next to `App` |
| `player/ShowPlayer.tsx` | `ui/hooks`, `ui/transitionLabel` | The player depends on the UI folder |

Also, the scene model that every layer shares lives in `formats/types.ts`
(648 lines), together with the parser interface and the show types. Its
location suggests it belongs to the parsers.

Why it matters: cycles make it hard to test or reuse a module alone, and
they hide which layer owns a concept.

Suggested fix (each is a move, with no behaviour change):

- Move `charset.ts` and `fontKey.ts` out of `hg3/` to a place both sides
  may import (for example `src/fonts/`, since they describe fonts). (S)
- Move `fileGroupKind` to `src/files/`; move `exportScene.ts` to
  `src/render/`; move the `LoadedFile` types into their own file under
  `src/files/` or `src/formats/`. (S each)
- Split `formats/types.ts` into `scene.ts` (elements, fills), `show.ts`
  (slides, transitions) and `parser.ts` (parser interface, context). Keep
  `types.ts` re-exporting them so no import has to change at once. (M)
- Once ESLint is in (item 2), add an import rule that enforces the layer
  order so this does not come back.

**Outcome:** done (`3947dd6`). The scene, show and document model moved
to `src/model/`, and the parser interface to `formats/parser.ts`;
`types.ts` is gone and every import points at the right module.
`ByteReader` and the character set moved to `src/formats/`, `fontKey` to
`src/fonts/`, the show/chart classifier to `files/fileKind.ts`, `loadFile`
into `files/`, and the SVG file making to `render/`; `ShowPlayer` moved to
`components/`. No folder imports another that imports it back. Without a
linter (item 2) nothing enforces this; the README states the direction.

## Medium priority

### 4. A few very large files and functions

| File | Lines | Note |
| --- | --- | --- |
| `formats/hg3/scene/data/xy.ts` | 1,522 | 48 functions: axes, grid, bars, lines, legend, data table and 3-D in one file |
| `formats/hg3/scene/objectLayer.ts` | 1,168 | 56 functions: every stored shape, text, fills, embedded charts |
| `formats/hg3/assumptions.ts` | 1,081 | 153 exports across 14 sections |
| `formats/hg3/objects.ts` | 1,068 | All object decoding |

| Function | Lines |
| --- | --- |
| `drawGraph` in `hg2/graph.ts` | 422 |
| `VideoExportDialog` | 328 |
| `App` | 209 |
| `drawXYChart` in `scene/data/xy.ts` | 199 |
| `readFalc` in `hg2/falc.ts` | 175 |
| `applyScreen` in `render/dither.ts` | 162 |

Why it matters: `xy.ts` and `drawGraph` are where most layout work
happens, and their size makes a change in one chart style risky for the
others.

Suggested fix:

- Split `xy.ts` by part, as the pie code already is (`pie.ts`,
  `pieLabels.ts`, `pieLegend.ts`): `xyAxes.ts`, `xyBars.ts`, `xyLines.ts`,
  `xyLegend.ts`, `xyTable.ts`, with `xy.ts` left as the layout and the
  entry point. (M)
- Break `drawGraph` into the same parts. Do this together with item 1,
  step 3, not before. (M)
- Split `assumptions.ts` along its existing section headings into a folder
  (`assumptions/text.ts`, `pie.ts`, `xy.ts`, …) with an index that
  re-exports. (S)
- Move the export steps of `VideoExportDialog` into a hook, leaving the
  component as the form. (M)

**Outcome:**

- `xy.ts` split into eight files, as suggested (`b40ae83`). The largest,
  `xySeries.ts`, is 430 lines.
- `drawGraph` split into `layoutGraph`, `prepareValues` and one function
  per part (`f66ea76`).
- `VideoExportDialog`: the export run moved to `ui/useVideoExport.ts`, and
  the dialog keyboard handling to `useDialogKeys`, shared with
  `DocumentPicker` (`185f400`). It is now 295 lines, most of them the form.
- `assumptions.ts` kept as one file. Its header says to keep every guess in
  this one file, so a reference render means editing one file; it is a list
  of constants, not logic.
- `objectLayer.ts` and `objects.ts` (about 1,100 lines each) were listed
  but had no fix suggested; they are unchanged.

### 5. The 1.x/2.x code has no unit tests

`src/formats/hg2/` has 14 source files and one test file,
`hg2.samples.test.tsx`, which runs over the committed sample charts. That
test is valuable, but it is the only one.

Why it matters: the sample test shows that real files still open. It
cannot easily show what a damaged or unusual file does, and when it fails
it does not point at the cause. Elsewhere the rule is "unit tests use
synthetic bytes" (README, Sample files).

Suggested fix: add synthetic-byte tests for `bytes.ts`, `pcok.ts`,
`falc.ts` (including truncated and unknown records) and for the pure
helpers in `graph.ts` (`niceStep`, `makeScale`, `formatValue`). (M)

**Outcome:** done (`50d0956`, plus the text and graph tests): the byte
reader, CP437, the 2.x record splitter, 2.x text, series, values and X
labels, unknown records, 1.0 blocks, the text drawing, and the value axes
and number format of `graph.ts`.

### 6. Small helpers are copied between modules

| Helper | Copies |
| --- | --- |
| Code page 437 table | `files/zip.ts`, `hg2/bytes.ts`, and `hg3/charset.ts` holds a close relative |
| Saving a setting in `localStorage` | `render/displayMode.ts`, `components/paletteSetting.ts`, `player/transitions/mode.ts`, `player/sound/controller.ts`: four copies of the same guarded read and write |
| `u16` / `ascii` byte readers | `pcx/pcx.ts`, `player/sound/format.ts`, `video/audio.ts` |
| `hex` | `hg3/objects.ts`, `hg3/show.ts` |
| Series type tables | `hg2/falc.ts` and `hg2/pcok.ts` (same list, one entry apart) |

Why it matters: none is a bug today, but the code page table is 128
characters that must match exactly in each copy, and the settings code
puts browser storage inside the render and player layers.

Suggested fix: one `src/formats/cp437.ts`; one `src/ui/storedSetting.ts`
with `load(key, valid, fallback)` and `save(key, value)`; use `ByteReader`
for the byte helpers once it is shared (item 1). (M in total)

**Outcome:** done (`cd26679`, `ca4bf0c`). One `formats/cp437.ts` (checked
identical to both copies), one `ui/settings.ts` for everything stored in
the browser (render/ and player/ no longer touch `localStorage`), one WAV
chunk walker, and shared colour building. Left alone on purpose: the two
`hex` helpers print different formats in warnings; the 1.0 and 2.x series
type tables differ because 1.0 has no area series; the PCX reader's
two-line `u16`.

### 7. `App` holds all loading and settings state

`App.tsx` keeps nine pieces of state, the request counter, the "last
work" to repeat when the palette changes, and the handlers for opening,
adding files and picking from an archive. Each new way of opening files
(folders, add missing files, archives) added to the same function.

Why it matters: the loading rules (only the latest request wins; a
palette change repeats the last load; an archive may ask first) can only
be tested by rendering the whole app.

Suggested fix: move loading into a `useDocumentLoader` hook that returns
`{ file, loading, error, open, add, pick }`, and the four saved settings
into a `useSettings` hook built on the helper from item 6. `App` then only
lays out the page. (M)

**Outcome:** done (`4570d2b`). The loading rules are in
`ui/documentLoader.ts`, a plain class with node tests for each rule, used
through `useDocumentLoader`; the settings are in `useSettings`. `App` went
from 239 to 128 lines.

### 8. `tools/` and `scripts/` are not type-checked

- `tsconfig.json` includes only `src` and `vite.config.ts`, so
  `tools/compare/` (863 lines) and `tools/copycheck/` (207 lines) are
  never checked by `yarn typecheck` or the build.
- `scripts/` is 930 lines of plain `.mjs` with no types and no tests. It
  generates the bundled fonts and palettes.
- Node types come from a hand-written shim, `src/samples/node-fs.d.ts`,
  instead of `@types/node`. Each new Node call needs the shim extended;
  the zip tests had to avoid `node:zlib` for this reason.

Suggested fix: add `@types/node` as a dev dependency, delete the shim, and
add a `tsconfig.tools.json` that covers `tools/` (and `scripts/` with
`checkJs`). Run it in CI. (S)

**Outcome:** done (`39d3219`). `tsconfig.json` covers the browser code;
`tsconfig.node.json` adds Node's types for tests, tools and the sample
suite; `tsconfig.scripts.json` checks the scripts as JavaScript.
`yarn typecheck` runs all three, and `yarn build` runs `yarn typecheck`.
`@types/node` replaced the shim. It found errors in four files.

## Low priority

### 9. `components/` and `ui/` have no clear dividing rule

`ui/` is mostly logic without React (`fileFacts`, `hexRows`,
`recordTree`), but also holds `hooks.ts`. `components/` is mostly React,
but also holds `paletteSetting.ts` and `exportScene.ts`, which are not
components.

Suggested fix: state the rule in the README ("`components/` is React
components only; `ui/` is everything they call") and move the two files.
(S)

**Outcome:** done. The README states the rule, `paletteSetting.ts` and
`exportScene.ts` moved to `ui/`, and `ShowPlayer.tsx` moved to
`components/`.

### 10. Project docs lag behind the code

- The README's project layout table has no row for `src/formats/hg2/`,
  `src/video/` or `tools/`, and still describes `src/files/` without
  archives.
- `package.json` still describes the project as a viewer for "Harvard
  Graphics 3 for DOS".
- `docs/RENDERER_TASKS.md` (538 lines) is the original build plan. Most of
  it is done, and it does not say which parts are. A new contributor
  cannot tell plan from history.

Suggested fix: update the table and the description; add a status line
under each task heading in `RENDERER_TASKS.md`, or move finished tasks to
a "Done" section. (S)

**Outcome:** done. The README layout table lists every folder and the
dependency direction, `package.json` describes both format families, and
`RENDERER_TASKS.md` opens with its status (every task built except 7c).

### 11. Unused exported constants

`DATA_TEXT_ASCENT` and `ELLIPSE_GRADIENT_IS_LINEAR` in
`formats/hg3/assumptions.ts` are exported and used nowhere. The compiler
only reports unused locals, not unused exports, so there may be more
across the tree.

Suggested fix: delete the two, and add an unused-export check (for
example `knip`) to CI with item 2. (S)

**Outcome:** done (`5c032ed`). A scan of the whole tree found nine unused
exports, including the two named here. Two format constants that record
spec facts (`FONT_KEY_LENGTH`, `JUSTIFICATION_FLAG_2000`) were kept.

### 12. 165 non-null assertions (`!`)

Most are array reads the code has just bounds-checked, so they are
correct today. They are also the places where a later edit can introduce
a crash that the compiler will not catch.

Suggested fix: do not sweep them. When touching a file for another
reason, replace `!` with a checked read where it is cheap. Turning on
`noUncheckedIndexedAccess` would force the issue, but would touch far
more than these 165 places; decide that only after item 4. (M, ongoing)

**Outcome:** left as a guideline, as suggested. There are now 167 (moved
code keeps its own; the new code in `model/color.ts`, `ui/hooks.ts` and
`ui/documentLoader.ts` adds a few after checked reads).

## Suggested order

As first written; what happened to each item is in the summary table and
the "Outcome" notes.

1. **CI and linting** (item 2), with `@types/node` and the tools
   type-check (item 8). Small, and it protects every later step.
2. **Untangle the imports** (item 3) and the shared helpers (item 6).
   These are moves with no behaviour change, so the existing tests cover
   them.
3. **1.x/2.x onto the shared byte reader and text pipeline** (item 1,
   steps 1 and 2), with unit tests (item 5).
4. **Split the large files** (item 4) and the `App` hooks (item 7).
5. **Shared chart helpers** (item 1, step 3), when the next round of
   chart work makes the duplication cost real.
6. The low-priority items, as files are touched.

Before any step that changes how text or charts are drawn (items 1 and
4), run `yarn compare` and `yarn copycheck` before and after, and keep the
numbers with the commit.
