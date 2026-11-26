/**
 * A rendered slide as a standalone SVG file (pure, no DOM): used by the
 * image export and the video export.
 */
import type { ViewBox } from "../model/scene";

const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";

/** Pixel height for a width, keeping the page shape. */
export function heightFor(viewBox: ViewBox, width: number): number {
  return Math.max(1, Math.round((width * viewBox.height) / viewBox.width));
}

/**
 * A slide SVG as serialised from the page (XMLSerializer or innerHTML) made
 * a standalone file: the SVG namespace (and xlink's when used), a pixel
 * width and height of the page's shape instead of "100%", no page-only
 * class or inline style on the root; the content (defs, patterns, role and
 * label) is kept as is.
 */
export function standaloneSvg(markup: string, viewBox: ViewBox, width: number): string {
  const start = markup.indexOf("<svg");
  if (start < 0) throw new Error("No <svg> element to export");
  const end = markup.indexOf(">", start);
  const selfClosing = markup[end - 1] === "/";
  let attrs = markup.slice(start + 4, selfClosing ? end - 1 : end);
  const rest = markup.slice(end + 1);

  const drop = (name: string) => {
    attrs = attrs.replace(new RegExp(`\\s${name}=("[^"]*"|'[^']*')`, "g"), "");
  };
  for (const name of ["width", "height", "style", "class", "xmlns", "xmlns:xlink"]) drop(name);
  const height = heightFor(viewBox, width);
  let head = `<svg xmlns="${SVG_NS}"`;
  if (/\bxlink:/.test(markup)) head += ` xmlns:xlink="${XLINK_NS}"`;
  head += ` width="${width}" height="${height}"${attrs}`;
  const body = selfClosing ? `${head}/>` : `${head}>${rest}`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n${body}`;
}
