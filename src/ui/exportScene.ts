/**
 * Export of a slide (browser only): the scene as an SVG file
 * (render/sceneToSvg.ts); PNG draws that SVG on a canvas. Everything
 * happens in this tab; the file is saved by the browser's own download.
 */
import type { Scene } from "../model/scene";
import { sceneToSvg, svgToImage } from "../render/sceneToSvg";
import { heightFor } from "../render/svgFile";
import { type ExportChoice, exportFileName } from "./exportImage";

export function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

async function svgToPng(svgText: string, width: number, height: number): Promise<Blob> {
  const img = await svgToImage(svgText);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser cannot draw the PNG.");
  ctx.drawImage(img, 0, 0, width, height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("The PNG could not be made."))), "image/png"),
  );
}

/** Save the scene as the chosen file; `fileName` is the document's (e.g. "SALES93.CH3"). */
export async function exportScene(scene: Scene, choice: ExportChoice, fileName: string, slideNumber: number | null): Promise<void> {
  const svg = sceneToSvg(scene, choice.width);
  const name = exportFileName(fileName, slideNumber, choice.format);
  if (choice.format === "svg") {
    download(new Blob([svg], { type: "image/svg+xml" }), name);
    return;
  }
  download(await svgToPng(svg, choice.width, heightFor(scene.viewBox, choice.width)), name);
}
