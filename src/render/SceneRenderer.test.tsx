import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LANDSCAPE_VIEW_BOX, PORTRAIT_VIEW_BOX, type Scene } from "../model/scene";
import { SceneRenderer } from "./SceneRenderer";

const PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const scene: Scene = {
  viewBox: LANDSCAPE_VIEW_BOX,
  background: "#000080",
  elements: [
    { kind: "path", points: [{ x: 0, y: 0 }, { x: 1000, y: 0 }], closed: false, fill: null, stroke: "red" },
    {
      kind: "path",
      points: [{ x: 0, y: 0 }, { x: 1000, y: 500 }, { x: 2000, y: 0 }],
      closed: true,
      smooth: true,
      fill: "yellow",
      stroke: null,
    },
    { kind: "ellipse", cx: 1, cy: 2, rx: 300, ry: 200, fill: "lime", stroke: "white", strokeWidth: 60 },
    { kind: "arc", cx: 0, cy: 0, rx: 500, ry: 300, startAngle: 0, endAngle: 90, fill: null, stroke: "cyan" },
    {
      kind: "band", cx: 0, cy: 0, rx: 500, ry: 300, startAngle: 180, endAngle: 360, depth: 400,
      fill: "orange", stroke: "black",
    },
    { kind: "rect", x: -100, y: -100, width: 200, height: 100, fill: "blue", stroke: null },
    {
      kind: "rect", x: 0, y: 0, width: 800, height: 400, fill: "pink", stroke: "black",
      corners: { kind: "rounded", radius: 50 },
    },
    {
      kind: "text", x: 0, y: -8000, text: "Quarterly <Sales>", size: 2000, fill: "white",
      fontFamily: "Helvetica, Arial, sans-serif", fontWeight: 700, italic: true, anchor: "middle",
    },
    { kind: "image", href: PIXEL, x: -16384, y: -12288, width: 32768, height: 24576 },
    {
      kind: "group",
      transform: [1, 0, 0, 1, 500, -500],
      buttonName: "Next",
      children: [
        { kind: "group", children: [{ kind: "ellipse", cx: 0, cy: 0, rx: 10, ry: 10, fill: "gray", stroke: null }] },
      ],
    },
  ],
};

describe("SceneRenderer", () => {
  const html = renderToStaticMarkup(<SceneRenderer scene={scene} />);

  it("uses the scene viewBox and letterboxes it", () => {
    expect(html).toContain('viewBox="-16384 -12288 32768 24576"');
    expect(html).toContain('preserveAspectRatio="xMidYMid meet"');
  });

  it("paints the background over the whole viewBox first", () => {
    expect(html).toMatch(
      /^<svg[^>]*><rect x="-16384" y="-12288" width="32768" height="24576" fill="#000080" stroke="none"><\/rect>/,
    );
  });

  it("draws polylines and smooth closed curves", () => {
    expect(html).toContain('d="M 0 0 L 1000 0" stroke-linejoin="round" fill="none" stroke="red" stroke-width="30"');
    expect(html).toMatch(/<path d="M 0 0 C [^"]+ Z"[^>]*fill="yellow" stroke="none"/);
  });

  it("draws ellipses with their stroke width", () => {
    expect(html).toContain('<ellipse cx="1" cy="2" rx="300" ry="200" fill="lime" stroke="white" stroke-width="60"></ellipse>');
  });

  it("draws arcs and bands as paths", () => {
    expect(html).toContain('d="M 500 0 A 500 300 0 0 0 0 -300"');
    expect(html).toMatch(/<path d="M -500 0 A [^"]+ L 500 400 A [^"]+ Z"[^>]*fill="orange"/);
  });

  it("draws square and rounded rects", () => {
    expect(html).toContain('<rect x="-100" y="-100" width="200" height="100" fill="blue" stroke="none"></rect>');
    expect(html).toMatch(/<path d="M 50 0 H 750 A 50 50 0 0 1 800 50[^"]*Z"[^>]*fill="pink"/);
  });

  it("draws styled text, escaped", () => {
    expect(html).toContain("Quarterly &lt;Sales&gt;</text>");
    expect(html).toContain('font-size="2000"');
    expect(html).toContain('font-family="Helvetica, Arial, sans-serif"');
    expect(html).toContain('font-weight="700"');
    expect(html).toContain('font-style="italic"');
    expect(html).toContain('text-anchor="middle"');
  });

  it("draws stretched images", () => {
    expect(html).toContain(`href="${PIXEL}"`);
    expect(html).toContain('preserveAspectRatio="none"');
    expect(html).toContain("image-rendering:pixelated");
  });

  it("draws a tiled image as a pattern of the image at its pixel size, anchored at its hot spot, filling the box", () => {
    const tiled: Scene = {
      viewBox: LANDSCAPE_VIEW_BOX,
      background: "black",
      elements: [
        {
          kind: "image", href: PIXEL, x: -1000, y: -500, width: 2000, height: 1000,
          tile: { pixelWidth: 50, pixelHeight: 50, imageWidth: 4, imageHeight: 2, anchorX: 0, anchorY: 0, hotX: 2, hotY: 1.5, screenPixels: true },
        },
      ],
    };
    const out = renderToStaticMarkup(<SceneRenderer scene={tiled} />);
    expect(out).toMatch(/<pattern id="([^"]+)" patternUnits="userSpaceOnUse" x="-100" y="-75" width="200" height="100"><image href="data:image\/png[^"]*" width="200" height="100" preserveAspectRatio="none"/);
    const id = /<pattern id="([^"]+)"/.exec(out)![1];
    expect(out).toContain(`<rect x="-1000" y="-500" width="2000" height="1000" fill="url(#${id})"></rect>`);
  });

  it("draws nested groups with transform and button name", () => {
    expect(html).toContain('<g transform="matrix(1 0 0 1 500 -500)" data-button="Next"><g><ellipse');
  });

  it("draws glyph lines as a filled or stroked path with invisible, selectable text", () => {
    const glyphScene: Scene = {
      viewBox: LANDSCAPE_VIEW_BOX,
      background: "black",
      elements: [
        {
          kind: "glyphs", d: "M0 0l10 0z", transform: [2, 0, 0, 2, 100, 200], text: "A<B", advance: 600, em: 1000,
          fill: "#ff0000", stroke: null,
        },
        { kind: "glyphs", d: "M0 0l10 0", text: "s", advance: 0, em: 1000, fill: null, stroke: "#00ff00", strokeWidth: 40 },
      ],
    };
    const out = renderToStaticMarkup(<SceneRenderer scene={glyphScene} />);
    expect(out).toContain(
      '<g transform="matrix(2 0 0 2 100 200)"><path d="M0 0l10 0z" aria-hidden="true" fill="#ff0000" stroke="none"></path>' +
        '<text x="0" y="0" font-size="1000" fill="transparent" textLength="600" lengthAdjust="spacingAndGlyphs" style="white-space:pre">A&lt;B</text></g>',
    );
    expect(out).toContain(
      '<g><path d="M0 0l10 0" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" fill="none" stroke="#00ff00" stroke-width="40"></path>' +
        '<text x="0" y="0" font-size="1000" fill="transparent" style="white-space:pre">s</text></g>',
    );
  });

  it("supports portrait pages", () => {
    const portrait = renderToStaticMarkup(
      <SceneRenderer scene={{ viewBox: PORTRAIT_VIEW_BOX, background: "white", elements: [] }} />,
    );
    expect(portrait).toContain('viewBox="-12288 -16384 24576 32768"');
    expect(portrait).toContain('style="aspect-ratio:24576 / 32768"');
  });

  it("gives the SVG the page's own aspect ratio (a Letter page is 11:8.5, not 4:3)", () => {
    const letter = renderToStaticMarkup(
      <SceneRenderer scene={{ viewBox: { minX: -16384, minY: -12660, width: 32768, height: 25320 }, background: "white", elements: [] }} />,
    );
    expect(letter).toContain('viewBox="-16384 -12660 32768 25320"');
    expect(letter).toContain('style="aspect-ratio:32768 / 25320"');
  });

  it("marks button groups clickable when a handler is given", () => {
    const clickable = renderToStaticMarkup(
      <SceneRenderer scene={scene} onButtonClick={() => {}} />,
    );
    expect(clickable).toContain('data-button="Next" style="cursor:pointer"');
  });

  it("emits no <defs> when the scene has no patterns", () => {
    expect(html).not.toContain("<defs>");
    expect(html).not.toContain("<pattern");
  });

  it("emits pattern defs and resolves pattern fills to them", () => {
    const patterned: Scene = {
      viewBox: LANDSCAPE_VIEW_BOX,
      background: "#000000",
      patterns: {
        "mono-4": { rows: ["10", "01"], ink: "#ffffff", paper: "#000000", pixelWidth: 5, pixelHeight: 10 },
      },
      elements: [
        { kind: "rect", x: 0, y: 0, width: 100, height: 100, fill: "pattern:mono-4", stroke: "#ffffff" },
        { kind: "rect", x: 0, y: 0, width: 100, height: 100, fill: "pattern:missing", stroke: null },
      ],
    };
    const out = renderToStaticMarkup(<SceneRenderer scene={patterned} />);
    const id = /<pattern id="([^"]+)"/.exec(out)?.[1];
    expect(id).toMatch(/^p[A-Za-z0-9_-]*-mono-4$/);
    expect(out).toContain(
      `<pattern id="${id}" patternUnits="userSpaceOnUse" width="10" height="20" shape-rendering="crispEdges">` +
        '<rect width="10" height="20" fill="#000000"></rect>' +
        '<rect x="0" y="0" width="5" height="10" fill="#ffffff"></rect>' +
        '<rect x="5" y="10" width="5" height="10" fill="#ffffff"></rect></pattern>',
    );
    expect(out).toContain(`fill="url(#${id})" stroke="#ffffff"`);
    // An unknown pattern paints nothing rather than an invalid reference.
    expect(out).toContain('<rect x="0" y="0" width="100" height="100" fill="none" stroke="none">');
  });

  it("draws multi-colour, transformed patterns, also on outlines and text", () => {
    const patterned: Scene = {
      viewBox: LANDSCAPE_VIEW_BOX,
      background: "#000000",
      patterns: {
        v: {
          rows: ["012", "000"], ink: "#ff0000", paper: "#000000", colors: ["#000000", "#ffffff", "#ffff00"],
          pixelWidth: 2, pixelHeight: 3, transform: [1, 0, 0, 1, -5, 7],
        },
      },
      elements: [
        { kind: "rect", x: 0, y: 0, width: 10, height: 10, fill: null, stroke: "pattern:v" },
        {
          kind: "text", x: 0, y: 0, text: "Hi", size: 10, fill: "pattern:v", fontFamily: "sans-serif",
          fontWeight: 400, italic: false, anchor: "start",
        },
      ],
    };
    const out = renderToStaticMarkup(<SceneRenderer scene={patterned} />);
    const id = /<pattern id="([^"]+)"/.exec(out)?.[1];
    expect(out).toContain(
      `<pattern id="${id}" patternUnits="userSpaceOnUse" patternTransform="matrix(1 0 0 1 -5 7)" width="6" height="6" shape-rendering="crispEdges">` +
        '<rect width="6" height="6" fill="#000000"></rect>' +
        '<rect x="2" y="0" width="2" height="3" fill="#ffffff"></rect>' +
        '<rect x="4" y="0" width="2" height="3" fill="#ffff00"></rect></pattern>',
    );
    expect(out).toContain(`fill="none" stroke="url(#${id})"`);
    expect(out).toContain(`font-size="10" fill="url(#${id})"`);
  });

  it("gives each rendered scene its own pattern ids", () => {
    const patterned: Scene = {
      viewBox: LANDSCAPE_VIEW_BOX,
      background: "#000000",
      patterns: { a: { rows: ["1"], ink: "#fff", paper: "#000", pixelWidth: 1, pixelHeight: 1 } },
      elements: [{ kind: "rect", x: 0, y: 0, width: 1, height: 1, fill: "pattern:a", stroke: null }],
    };
    const out = renderToStaticMarkup(
      <>
        <SceneRenderer scene={patterned} />
        <SceneRenderer scene={patterned} />
      </>,
    );
    const ids = [...out.matchAll(/<pattern id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it("paints text halos under the glyphs", () => {
    const haloScene: Scene = {
      viewBox: LANDSCAPE_VIEW_BOX,
      background: "#000000",
      elements: [
        {
          kind: "text", x: 0, y: 0, text: "Hi", size: 100, fill: "#ffffff", fontFamily: "sans-serif",
          fontWeight: 400, italic: false, anchor: "start", halo: { color: "#000000", width: 7 },
        },
        { kind: "glyphs", d: "M0 0l10 0z", text: "A", advance: 1, em: 1000, fill: "#ffffff", stroke: null, halo: { color: "#000000", width: 5 } },
        { kind: "glyphs", d: "M0 0l10 0", text: "s", advance: 1, em: 1000, fill: null, stroke: "#ffffff", strokeWidth: 40, halo: { color: "#000000", width: 5 } },
      ],
    };
    const out = renderToStaticMarkup(<SceneRenderer scene={haloScene} />);
    expect(out).toContain('stroke="#000000" stroke-width="14" stroke-linejoin="round" paint-order="stroke"');
    // Outline glyphs: halo path (filled and stroked) before the glyph path.
    expect(out).toContain(
      '<g><path d="M0 0l10 0z" fill="#000000" stroke="#000000" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"></path>' +
        '<path d="M0 0l10 0z" aria-hidden="true" fill="#ffffff" stroke="none"></path>',
    );
    // Stroke glyphs: the halo widens the stroke on both sides.
    expect(out).toContain('<path d="M0 0l10 0" fill="none" stroke="#000000" stroke-width="50"');
  });
});

describe("SceneRenderer gradients", () => {
  const base = (bands?: { offset: number; paint: string }[]): Scene => ({
    viewBox: LANDSCAPE_VIEW_BOX,
    background: "#000000",
    elements: [{ kind: "rect", x: 0, y: 0, width: 100, height: 50, fill: "gradient:g", stroke: "#ffffff" }],
    gradients: { g: { from: "#000000", to: "#ff0000", angle: 0, ...(bands && { bands }) } },
  });

  it("draws a smooth gradient as a linearGradient across the shape's box", () => {
    const html = renderToStaticMarkup(<SceneRenderer scene={base()} />);
    expect(html).toMatch(/<linearGradient id="[^"]+" gradientUnits="userSpaceOnUse" x1="0" y1="25" x2="100" y2="25">/);
    expect(html).toContain('stop-color="#ff0000"');
    expect(html).toMatch(/<rect x="0" y="0" width="100" height="50" fill="url\(#[^)]+\)" stroke="#ffffff"/);
  });

  it("draws a banded gradient as strips clipped to the shape, outline on top", () => {
    const html = renderToStaticMarkup(<SceneRenderer scene={base([{ offset: 0, paint: "#000000" }, { offset: 0.5, paint: "#800000" }])} />);
    expect(html).toContain("<clipPath");
    expect(html).toContain('fill="#800000"');
    expect(html).toContain('d="M 50 0 L 100 0 L 100 50 L 50 50 Z"');
    expect(html).toMatch(/<rect x="0" y="0" width="100" height="50" fill="none" stroke="#ffffff"/);
  });

  it("paints a gradient background", () => {
    const html = renderToStaticMarkup(<SceneRenderer scene={{ ...base(), background: "gradient:g", elements: [] }} />);
    expect(html).toContain("<linearGradient");
  });
});
