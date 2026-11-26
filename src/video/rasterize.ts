/**
 * Pictures for the video (browser only): each picture slide's scene, with
 * the display mode applied, drawn once at the output size through the same
 * SVG → image path as the PNG export (patterns, gradients and tiled bitmaps
 * are inside the standalone SVG), letterboxed on black when the slide's
 * page shape differs from the video's. Only a few pictures are kept: the
 * timeline moves forward, so the least recently used ones are dropped.
 */
import type { PresentationSlide } from "../model/presentation";
import type { Scene } from "../model/scene";
import { type DisplayMode, applyDisplayMode } from "../render/displayMode";
import { sceneToSvg, svgToImage } from "../render/sceneToSvg";
import { BLACK, fitRect } from "./compose";
import type { PictureStore } from "./encode";

/** Pictures kept at once (each is width × height × 4 bytes). */
export const MAX_PICTURES_KEPT = 6;

type Canvas = HTMLCanvasElement | OffscreenCanvas;

export function createCanvas(width: number, height: number): Canvas {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export function context2d(canvas: Canvas): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D {
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) throw new Error("This browser cannot draw on a canvas.");
  return ctx;
}

async function renderPicture(scene: Scene | null, transparent: boolean, width: number, height: number): Promise<Canvas> {
  const canvas = createCanvas(width, height);
  const ctx = context2d(canvas);
  if (!transparent) {
    ctx.fillStyle = BLACK;
    ctx.fillRect(0, 0, width, height);
  }
  if (!scene) return canvas;
  const shown = transparent ? { ...scene, background: "none" } : scene;
  const rect = fitRect(scene.viewBox.width, scene.viewBox.height, width, height);
  const img = await svgToImage(sceneToSvg(shown, rect.w));
  ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h);
  return canvas;
}

export function createPictureStore(pictures: readonly PresentationSlide[], displayMode: DisplayMode, width: number, height: number): PictureStore {
  const kept = new Map<string, Canvas>();
  const scenes = new Map<number, Scene | null>();
  const keyOf = (picture: number, transparent: boolean) => `${picture}:${transparent ? "t" : "o"}`;
  const sceneOf = (picture: number): Scene | null => {
    if (!scenes.has(picture)) {
      const raw = pictures[picture]?.scene() ?? null;
      scenes.set(picture, raw && applyDisplayMode(raw, displayMode));
      // Display-mode scenes are only needed while drawing; keep the map small too.
      if (scenes.size > MAX_PICTURES_KEPT) scenes.delete(scenes.keys().next().value!);
    }
    return scenes.get(picture) ?? null;
  };
  return {
    async prepare(needed) {
      for (const { picture, transparent } of needed) {
        const key = keyOf(picture, transparent);
        const have = kept.get(key);
        if (have) {
          // Most recently used last.
          kept.delete(key);
          kept.set(key, have);
          continue;
        }
        kept.set(key, await renderPicture(sceneOf(picture), transparent, width, height));
        while (kept.size > MAX_PICTURES_KEPT) {
          const oldest = kept.keys().next().value!;
          freeCanvas(kept.get(oldest)!);
          kept.delete(oldest);
        }
      }
    },
    get(picture, transparent) {
      const canvas = kept.get(keyOf(picture, transparent));
      if (!canvas) throw new Error(`Picture ${picture} was not prepared`);
      return canvas;
    },
    clear() {
      for (const c of kept.values()) freeCanvas(c);
      kept.clear();
      scenes.clear();
    },
  };
}

/** Shrinking a canvas releases its pixels at once instead of at garbage collection. */
function freeCanvas(canvas: Canvas): void {
  canvas.width = 0;
  canvas.height = 0;
}
