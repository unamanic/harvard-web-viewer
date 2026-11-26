/**
 * Export of the slide shown as SVG or PNG (pure parts, no DOM): the PNG
 * sizes offered and the download file names. The SVG file itself is made
 * by render/svgFile.ts.
 */
import type { ViewBox } from "../model/scene";
import { heightFor } from "../render/svgFile";

export type ExportFormat = "svg" | "png";

export interface ExportChoice {
  id: string;
  format: ExportFormat;
  /** Pixel width of the file (the height follows the page shape). */
  width: number;
  label: string;
}

/** The export menu's choices for a page shape. */
export function exportChoices(viewBox: ViewBox): ExportChoice[] {
  return [
    { id: "svg", format: "svg", width: 1280, label: "SVG (vector, any size)" },
    { id: "png-1280", format: "png", width: 1280, label: `PNG, 1280 × ${heightFor(viewBox, 1280)}` },
    { id: "png-640", format: "png", width: 640, label: `PNG, 640 × ${heightFor(viewBox, 640)} (original screen size)` },
  ];
}

/** "SALES93.CH3", slide 1 → "SALES93-slide1.png". */
export function exportFileName(fileName: string, slideNumber: number | null, format: ExportFormat): string {
  const dot = fileName.lastIndexOf(".");
  const base = (dot > 0 ? fileName.slice(0, dot) : fileName).replace(/[^A-Za-z0-9_&-]+/g, "_") || "slide";
  return `${base}${slideNumber !== null ? `-slide${slideNumber}` : ""}.${format}`;
}
