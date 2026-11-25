import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LANDSCAPE_VIEW_BOX, PORTRAIT_VIEW_BOX, type Scene } from "../formats/types";
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
      /^<svg[^>]*><rect x="-16384" y="-12288" width="32768" height="24576" fill="#000080"><\/rect>/,
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
  });

  it("marks button groups clickable when a handler is given", () => {
    const clickable = renderToStaticMarkup(
      <SceneRenderer scene={scene} onButtonClick={() => {}} />,
    );
    expect(clickable).toContain('data-button="Next" style="cursor:pointer"');
  });
});
