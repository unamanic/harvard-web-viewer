import { describe, expect, it } from "vitest";
import { LANDSCAPE_VIEW_BOX, centredViewBox } from "../model/scene";
import { standaloneSvg } from "./svgFile";

describe("standaloneSvg", () => {
  const rendered =
    '<svg viewBox="-16384 -12288 32768 24576" preserveAspectRatio="xMidYMid meet" width="100%" height="100%" class="scene" style="aspect-ratio:32768 / 24576" role="img" aria-label="Rendered slide">' +
    '<defs><pattern id="p1-a" patternUnits="userSpaceOnUse" width="8" height="8"><rect width="8" height="8" fill="#fff"/></pattern></defs>' +
    '<rect x="-16384" y="-12288" width="32768" height="24576" fill="url(#p1-a)"/></svg>';

  it("adds the namespace and a pixel size of the page's shape, keeps defs, role and label", () => {
    const out = standaloneSvg(rendered, LANDSCAPE_VIEW_BOX, 1280);
    expect(out.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="960" viewBox=')).toBe(true);
    expect(out).toContain('<defs><pattern id="p1-a"');
    expect(out).toContain('fill="url(#p1-a)"');
    expect(out).toContain('role="img" aria-label="Rendered slide"');
    expect(out).not.toContain('width="100%"');
    expect(out).not.toContain("class=");
    expect(out).not.toContain("style=");
    // The inner rect keeps its own width and height.
    expect(out).toContain('<rect x="-16384" y="-12288" width="32768" height="24576"');
    expect(out.endsWith("</svg>")).toBe(true);
  });

  it("does not repeat a namespace already serialised, adds xlink's when used", () => {
    const serialised = rendered.replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" ').replace("</defs>", '</defs><image xlink:href="data:,"/>');
    const out = standaloneSvg(serialised, centredViewBox(32768, 25320), 640);
    expect(out.match(/xmlns="/g)).toHaveLength(1);
    expect(out).toContain('xmlns:xlink="http://www.w3.org/1999/xlink"');
    expect(out).toContain('width="640" height="495"');
  });

  it("throws without an svg", () => {
    expect(() => standaloneSvg("<div/>", LANDSCAPE_VIEW_BOX, 10)).toThrow();
  });
});
