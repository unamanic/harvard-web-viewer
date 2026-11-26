/**
 * A scene as an SVG file's text, and that text as an image (browser only):
 * the scene is drawn by SceneRenderer into a detached element (react-dom's
 * client renderer, already in the bundle), serialised and made standalone
 * (svgFile.ts). Used by the image export and the video export.
 */
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { Scene } from "../model/scene";
import { SceneRenderer } from "./SceneRenderer";
import { standaloneSvg } from "./svgFile";

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

/** An SVG file's text loaded as an image (for drawing on a canvas). */
export function svgToImage(svgText: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([svgText], { type: "image/svg+xml" }));
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("The slide could not be drawn as a picture."));
    };
    img.src = url;
  });
}
