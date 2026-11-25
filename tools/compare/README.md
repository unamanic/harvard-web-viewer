# Reference comparison (`yarn compare`)

Compares the viewer's renders with framebuffers captured from the real
Harvard Graphics 3.05, chart by chart, and writes a ranked report. It is the
tool used to fit the display modes and the drawing rules recorded in
`docs/formats.md` ("Verified findings") and `src/formats/hg3/assumptions.ts`.

It needs private material that is not in the repository: the sample files
(`samples-private/`) and the reference renders (`samples-private/renders/`,
see its `NOTES.md`). Without them it skips with a message. The normal test
run (`yarn test`) never runs it: its entry is `compare.cmp.ts`, which
vitest's default `*.test.ts` pattern does not match, and it has its own
config (`vitest.config.ts`).

## What it does

For every `.CH3` under the samples folder that has a reference `NAME.png`:

1. Loads the chart as the app does (a `FileSet` over the samples folder, so
   palettes, fonts, bitmaps and button charts resolve; then the HG3 parser's
   `prepare` + `parse`).
2. Applies the display mode (`CMP_MODE`).
3. Rasterises the scene with `raster.ts`, an aliased rasteriser that samples
   pixel centres like the original's drawing, honours `Scene.patterns`
   (dithers compare pixel for pixel), gradients with bands, glyph paths,
   halos, groups and images (tiled, or stretched nearest-neighbour as HG
   fits a bitmap to its box: src/render/screenImage.ts), at the reference's own
   resolution (640×480 VGA, 640×350 EGA, 720×348 Hercules) with the page
   mapped onto non-square pixels (pixel aspect (4/3)/(W/H)).
4. Blurs both images with a BLUR×BLUR box (default 2, to even out dithers)
   and scores:
   - `diff` (the ranking score): share of pixels that differ by more than
     TOL (RGB distance, default 48) with no matching pixel within SHIFT
     (default 1 px) in either direction, which forgives glyph-edge jitter
     and 1-px rounding;
   - `strict`: share of pixels that differ by more than TOL;
   - `meanErr`: mean RGB distance (0–441);
   - where the differences are (top band, middle, bottom band, near our
     text, bounding box) and the most common colour confusions
     (ours → reference, by named screen colour).

## Running

```sh
yarn compare                                  # VGA ScreenShow vs renders/vga, all charts (~30 s)
CMP_MODE=ega yarn compare                     # EGA vs renders/ega
CMP_MODE=mono yarn compare                    # Hercules vs renders/hercules
CH=FLOOR,PATTVIEW yarn compare                # only these charts
CMP_MODE=mono CH=FLOOR HEAT=0 yarn compare    # no heatmaps
```

| Variable | Default | Meaning |
|---|---|---|
| `CMP_MODE` | `vga` | Display mode: `vga`, `ega`, `mono` (Hercules) or `modern`. Not `MODE`, which vitest sets. |
| `CH` | all | Comma-separated chart names (no extension). |
| `CMP_SAMPLES` | `samples-private/` | Folder with the sample files (searched recursively; `renders/` is skipped). |
| `CMP_RENDERS` | `<samples>/renders` | Root of the reference renders. |
| `REFDIR` | `<renders>/<set>/charts` | Folder of `NAME.png` references; `<set>` is `vga` for vga and modern, `ega`, `hercules` for mono. |
| `OUT` | `tools/compare/out/<mode>` | Output folder (git-ignored). |
| `BLUR`, `TOL`, `SHIFT` | 2, 48, 1 | Blur box, colour tolerance, shift tolerance (px). |
| `HEAT` | on | `HEAT=0` skips the heatmap PNGs. |
| `PA` | (4/3)/(W/H) | Pixel aspect override. |
| `CMP_SCALE` | none | Experiment: shrink the whole scene about the page centre by this factor. |

### The shareable sample show (samples/claude-vs-codex)

Its references are the F2-Preview screenshots `screenshots/CLAUDEVX_slideNN.png`
(VGA ScreenShow, 640×480), named by slide, not by chart. Make a folder of
`NAME.png` links in slide order (README table) and point `REFDIR` at it:

```sh
R=/tmp/cvcref; mkdir -p $R
names=(CVC01 CVC02 CVCP01 CVC03 CVCP02 CVC04 CVCP03 CVC05 CVCP04 CVC06
       CVCP05 CVC07 CVCP06 CVC08 CVCP07 CVCP08 CVC09 CVCP09 CVCP10 CVC10)
for i in ${!names[@]}; do
  ln -sf "$PWD/samples/claude-vs-codex/screenshots/CLAUDEVX_slide$(printf %02d $((i+1))).png" "$R/${names[$i]}.png"
done
CMP_SAMPLES=samples/claude-vs-codex REFDIR=$R yarn compare
```

The picture slides' bitmap placement is also checked pixel for pixel in the
normal test run (src/samples/claudeVsCodex.test.ts).

## Output

- `OUT/report.md`: summary (median, p75, p90, max of `diff`, distribution)
  and a table of every chart, worst first, with where it differs.
- `OUT/report.json`: all metrics per chart.
- `OUT/heat/NAME.png`: reference | ours | heatmap side by side (red: real
  difference; orange: only a 1-px shift or a glyph edge).

Everything in `out/` is derived from the private renders: keep it out of the
repository (it is git-ignored) and out of anything published.

## Files

- `compare.cmp.ts`: the comparison (a vitest test, so it runs with the
  project's TypeScript setup).
- `raster.ts`: the Scene rasteriser.
- `scenes.ts`: sample and reference locations, chart loading.
- `png.ts`: PNG decode (8-bit RGB/RGBA/grey, 1–8-bit indexed) and encode,
  node zlib only.
- `vitest.config.ts`: config for `yarn compare`.

These files use Node APIs and are not part of `yarn typecheck` (the project
has no Node type definitions); vitest strips their types when it runs them.
