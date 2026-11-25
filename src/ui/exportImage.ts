/**
 * Export of the slide shown as SVG or PNG (pure parts, no DOM): making the
 * serialised slide SVG a standalone file, the PNG sizes offered and the
 * download file names.
 */
import type { ViewBox } from "../formats/types";

const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";

export type ExportFormat = "svg" | "png";

export interface ExportChoice {
  id: string;
  format: ExportFormat;
  /** Pixel width of the file (the height follows the page shape). */
  width: number;
  label: string;
}

/** Pixel height for a width, keeping the page shape. */
export function heightFor(viewBox: ViewBox, width: number): number {
  return Math.max(1, Math.round((width * viewBox.height) / viewBox.width));
}

/** The export menu's choices for a page shape. */
export function exportChoices(viewBox: ViewBox): ExportChoice[] {
  return [
    { id: "svg", format: "svg", width: 1280, label: "SVG (vector, any size)" },
    { id: "png-1280", format: "png", width: 1280, label: `PNG, 1280 × ${heightFor(viewBox, 1280)}` },
    { id: "png-640", format: "png", width: 640, label: `PNG, 640 × ${heightFor(viewBox, 640)} (original screen size)` },
  ];
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

/** "SALES93.CH3", slide 1 → "SALES93-slide1.png". */
export function exportFileName(fileName: string, slideNumber: number | null, format: ExportFormat): string {
  const dot = fileName.lastIndexOf(".");
  const base = (dot > 0 ? fileName.slice(0, dot) : fileName).replace(/[^A-Za-z0-9_&-]+/g, "_") || "slide";
  return `${base}${slideNumber !== null ? `-slide${slideNumber}` : ""}.${format}`;
}
