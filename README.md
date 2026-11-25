# Harvard Web Viewer

A digital archaeology project: a browser-only viewer for **Harvard Graphics for DOS** files.

Harvard Graphics was the dominant presentation and charting package of the late 1980s and early 1990s. Millions of charts and slide shows were saved in its proprietary formats, and today almost nothing can open them. This project aims to make those files viewable again by anyone, with nothing to install.

> **Status:** early scaffolding. The app shell, format-detection layer, renderer and hex inspector work; the Harvard Graphics parser itself is not written yet.

## Goals

- Open Harvard Graphics for DOS files (charts, slides, symbols, palettes) in a web page.
- Run **entirely client-side**. Files you open are read by your browser and never uploaded anywhere.
- Host the viewer on **GitHub Pages**, so anyone can drop in an old file and see it.
- Document the file formats as we learn them, as a preservation resource in its own right.

### Stretch goals

- Support newer Harvard Graphics formats (Windows versions and later).
- Export to modern formats (PNG, SVG, PDF).

## How it will work

1. The user drags a file onto the page.
2. A format detector identifies the file type from its contents, not just its extension.
3. A format-specific parser decodes it into an internal scene model (text, shapes, chart data, colours, fonts).
4. A renderer draws the scene to a canvas or SVG, approximating the original DOS look.

Parsers will be pluggable, so each file format, old or new, is its own module.

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

### Dev container

Open the folder in VS Code and choose **Reopen in Container** (or use GitHub Codespaces). The container installs dependencies and forwards port 5173 for `yarn dev`.

### Code layout

| Path | Purpose |
| --- | --- |
| `src/formats/types.ts` | `Scene` model and the `FormatParser` interface |
| `src/formats/registry.ts` | Parser list and format detection |
| `src/formats/hg3/` | Harvard Graphics 3 parser (detection and record container; drawing in progress) |
| `src/render/` | Draws a `Scene` as SVG |
| `src/components/` | React UI (dropzone, viewer, hex inspector) |
| `docs/formats.md` | Verified notes on file formats |

### Deploying

`.github/workflows/deploy.yml` publishes to GitHub Pages on push to `main`. Set **Settings → Pages → Source** to "GitHub Actions" once.

## Contributing sample files

The biggest obstacle is sample data. If you have Harvard Graphics files (`.CH3`, `.SH3`, `.PL3`, `.PC3`, or anything else it produced), they are very welcome for building and testing the parsers. Please only share files you have the right to share.

## License

[MIT](LICENSE)
