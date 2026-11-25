/**
 * Export of a slide (browser only): the scene is drawn by SceneRenderer into
 * a detached element (react-dom's client renderer, already in the bundle),
 * serialised and made standalone (ui/exportImage.ts); PNG draws that SVG on
 * a canvas. Everything happens in this tab; the file is saved by the
 * browser's own download.
 */
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { Scene } from "../formats/types";
import { SceneRenderer } from "../render/SceneRenderer";
import { type ExportChoice, exportFileName, heightFor, standaloneSvg } from "../ui/exportImage";

/** The scene (display mode already applied) as a standalone SVG file's text. */
export function sceneToSvg(scene: Scene, width: number): string {
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    flushSync(() => root.render(createElement(SceneRenderer, { scene })));
    const svg = host.querySelector("svg");
    if (!svg) throw new Error("The slide could not be drawn for export.");
    return standaloneSvg(new XMLSerializer().serializeToString(svg), scene.viewBox, width);
  } finally {
    root.unmount();
  }
}

function download(blob: Blob, name: string): void {
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

function svgToPng(svgText: string, width: number, height: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([svgText], { type: "image/svg+xml" }));
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("This browser cannot draw the PNG.");
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("The PNG could not be made."))), "image/png");
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("The slide could not be drawn as a PNG."));
    };
    img.src = url;
  });
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
