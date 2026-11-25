// Turn a decoded image into a data URL for SVG/HTML `image` elements (§6.3).
import type { PcxImage } from './pcx';

type Rgba = Pick<PcxImage, 'width' | 'height' | 'rgba'>;

/** True when a DOM canvas can be created (browser, not Vitest's node env). */
export function canvasAvailable(): boolean {
  return typeof document !== 'undefined' && typeof document.createElement === 'function';
}

/**
 * PNG data URL via a canvas element when one exists, otherwise the
 * canvas-free BMP fallback. (OffscreenCanvas only offers an async blob, so
 * the synchronous path uses a canvas element.)
 */
export function pcxToDataUrl(image: Rgba): string {
  if (canvasAvailable() && image.width > 0 && image.height > 0) {
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const pixels = new Uint8ClampedArray(image.rgba);
      ctx.putImageData(new ImageData(pixels, image.width, image.height), 0, 0);
      return canvas.toDataURL('image/png');
    }
  }
  return encodeBmpDataUrl(image);
}

/** Uncompressed 32-bit BMP (BITMAPINFOHEADER, BI_RGB, bottom-up) bytes. */
export function encodeBmp(image: Rgba): Uint8Array {
  const { width, height, rgba } = image;
  const pixelBytes = width * height * 4;
  const out = new Uint8Array(54 + pixelBytes);
  const v = new DataView(out.buffer);
  out[0] = 0x42; // 'B'
  out[1] = 0x4d; // 'M'
  v.setUint32(2, out.length, true);
  v.setUint32(10, 54, true);
  v.setUint32(14, 40, true);
  v.setInt32(18, width, true);
  v.setInt32(22, height, true);
  v.setUint16(26, 1, true);
  v.setUint16(28, 32, true);
  v.setUint32(30, 0, true); // BI_RGB
  v.setUint32(34, pixelBytes, true);
  v.setInt32(38, 2835, true); // 72 dpi
  v.setInt32(42, 2835, true);
  let d = 54;
  for (let y = height - 1; y >= 0; y--) {
    for (let x = 0; x < width; x++) {
      const s = (y * width + x) * 4;
      out[d++] = rgba[s + 2];
      out[d++] = rgba[s + 1];
      out[d++] = rgba[s];
      out[d++] = rgba[s + 3];
    }
  }
  return out;
}

export function encodeBmpDataUrl(image: Rgba): string {
  const bytes = encodeBmp(image);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return 'data:image/bmp;base64,' + btoa(bin);
}
