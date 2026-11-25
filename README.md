# Harvard Web Viewer

A browser-only viewer for **Harvard Graphics 3 for DOS** files: charts (`.CH3`), screen shows (`.SH3`) and palettes (`.PL3`, `.PC3`).

**Open the viewer: <https://unamanic.github.io/harvard-web-viewer/>**

Harvard Graphics was one of the leading charting and presentation programs of the late 1980s and early 1990s, and its files are hard to open today. This viewer reads them in your browser with nothing to install. Files you open are read in the browser tab and are never uploaded anywhere.

## What it can do

- **Charts (`.CH3`).** Draws the copy of the chart stored in the file (the drawn object layer, embedded charts included). When a chart has no stored copy, lays it out from its data: XY (bar, line, area, high/low, point), pie, title, bullet, organisation and table charts.
- **Shows (`.SH3`).** Plays shows like the original Projector:
  - HyperShow keys and clickable buttons, including nested shows
  - transitions decoded from the file (erase, then draw, with direction and speed), plus timed slides; auto-advance can be paused (button, or the Pause key)
  - WAV sound slides
  - a slide strip and a full-screen presentation mode
- **Fonts.** Uses the original Bitstream Speedo fonts (`BX*.SPD`) when your files include them. Otherwise it uses the project's own clone fonts, which are fitted to the originals' measured metrics.
- **Display modes**, matched to the original screen drivers using reference renders from the real program:
  - **VGA ScreenShow** (default): 16 colours, dithered
  - **EGA**: 640×350, 16 of 64 colours, dithered
  - **Hercules monochrome**: 720×348
  - **Modern**: 24-bit colour, exactly as stored
- **Greyscale palettes.** Redraw any chart with the program's MONOCHRB or MONOCHRW palette, as an original user could.
- **Export** the current slide as PNG or SVG, or a whole show as a video (WebM, or MP4 where the browser can encode it). The video plays the show as if nobody pressed a key, with the show's transitions, timing and WAV sound, in the display mode you've chosen; slides that wait for a key are held for a time you set. It is made in your browser tab; browsers with WebCodecs encode faster than real time, others record in real time.
- **Whole folders.** Drop a folder (or choose one) and the viewer finds the palettes, fonts, bitmaps (`.PCX`/`.PCC`), sounds and nested shows that a chart or show names, case-insensitively.
- **Inspection tools.** A record tree, a hex inspector and a diagnostics panel that lists warnings, missing files and where each font came from.

## Not yet supported

The open items are tracked in [docs/formats.md](docs/formats.md). The main ones:

- The Harvard Graphics stroke fonts (`.FN3`) are not decoded yet. Text in those fonts is always drawn with the Hershey-based clones.
- MIDI sound slides are skipped.
- A few drawing details still differ from the original, for example bitmap tiling, bitmap patterns in the EGA and Hercules modes, and some 3-D shapes.
- Other Harvard Graphics versions (2.x, Windows) and the editor's own file types (such as `.SY3` symbol libraries) are out of scope for now.

## Clean-room approach

The file formats are documented in [docs/SPEC.md](docs/SPEC.md). The spec was written as the clean side of a clean-room process: it describes data layout and behaviour in its own words, and contains no program code, disassembly or decompiled code. The viewer is written from that spec and from sample files.

**Contributors must never disassemble or decompile the original program code.** New findings come from the sample files and from renders made with the real program, and are recorded in [docs/formats.md](docs/formats.md) along with the sample files they were checked against.

## Project layout

| Path | Contents |
| --- | --- |
| `src/formats/hg3/` | Harvard Graphics 3 parsers (records, charts, shows, palettes, font index) and the scene builder |
| `src/formats/speedo/`, `src/formats/pcx/` | Bitstream Speedo font reader, PCX bitmap decoder |
| `src/fonts/` | Text drawing, plus the bundled outline clones (`outline/`) and stroke clones (`stroke/`) |
| `src/render/` | SVG scene renderer and the display modes (VGA ScreenShow, EGA, Hercules) |
| `src/player/` | Show player, transitions and sound |
| `src/files/` | The set of files you opened, with name resolution |
| `src/components/`, `src/ui/` | React user interface |
| `src/samples/` | Regression suite over the private sample files |
| `scripts/` | Generators for the built-in palettes and fonts |
| `docs/` | Format spec, verified findings and the implementation plan |

## Development

Requirements:

- [Node.js](https://nodejs.org/) (current LTS or newer)
- [Yarn](https://yarnpkg.com/), via Corepack: `corepack enable`

```sh
yarn install   # install dependencies
yarn dev       # run the local dev server
yarn test      # run the test suite
yarn build     # type-check and produce a static build in dist/
```

A dev container is included: open the folder in VS Code and choose **Reopen in Container**, or use GitHub Codespaces.

### Sample files

- `samples/` is for files that may be shared publicly.
- `samples-private/` is git-ignored and is for files you may not share, such as the contents of the original program disks.

Unit tests use synthetic bytes, so they need no samples. The sample regression suite (`src/samples/`) runs over `samples-private/`, or the folder named by `HWV_SAMPLES_DIR`, and skips when it is empty. CI runs without samples.

### Reference-render comparison

`yarn compare` compares the viewer's output with screenshots of the real program, which are kept in `samples-private/renders/` (made with Harvard Graphics 3.05 in DOSBox-X). It lives in [`tools/compare/`](tools/compare/README.md); `CMP_MODE=ega` or `mono` compares the other display modes. Use it when changing how anything is drawn.

### Deploying

[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) runs the tests, builds the site and publishes it to GitHub Pages on every push to `main`.

## Fonts and other bundled data

- **Interface fonts:** Newsreader and Inter, under the SIL Open Font License (`src/assets/fonts/`).
- **Outline clone fonts** (HWV Sans, Serif, Slab and Mono) stand in for the Bitstream Speedo faces. Their outlines are modified from Liberation (OFL), Roboto (Apache 2.0) and Rokkitt (OFL), and are scaled to metrics measured from the originals. No outline is taken from the original fonts. See [src/fonts/outline/README.md](src/fonts/outline/README.md) and `src/fonts/outline/licenses/`.
- **Stroke clone fonts** come only from the public-domain Hershey fonts. See [src/fonts/stroke/README.md](src/fonts/stroke/README.md).
- **Built-in data from the original disks:** copies of a few palettes (HG3.PL3, MONOCHRB, MONOCHRW) and the font catalogue (the 22 entries of HG3.FGF). They let charts display correctly when those files are missing.

## Contributing sample files

Sample files are the main limit on what can be verified. If you have Harvard Graphics 3 files (`.CH3`, `.SH3`, `.PL3`, `.PC3`, or anything else it produced), they are welcome for testing. Please share only files you have the right to share. Renders of the same files made with the real program are especially useful.

## License

[MIT](LICENSE). The bundled fonts keep their own licences, as described above.

Harvard Graphics is a trademark of its owner. This project is not affiliated with or endorsed by the trademark owner, Bitstream or any other company named here.
