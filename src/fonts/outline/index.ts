/**
 * Outline clone fonts (task 7d-2): our own stand-ins for the 15 Bitstream
 * Speedo faces of the Harvard Graphics 3 font index, used when the original
 * .SPD files are not loaded. Metrics (advances, heights) are the originals';
 * outlines come from open-licensed fonts (README.md in this folder).
 *
 * Faces load lazily: each lives in its own generated module under faces/,
 * fetched by dynamic import on first use.
 */
import { type FontKey, fontKeyString } from "../fontKey";
import { codeForChar } from "./charset";
import { OUTLINE_FACE_METRICS } from "./metrics";
import { outlineCloneEntry } from "./table";
import type { OutlineCloneInfo, OutlineFaceData, OutlineFont, OutlineGlyph } from "./types";

export type { OutlineCloneInfo, OutlineFaceData, OutlineFont, OutlineGlyph } from "./types";
export { OUTLINE_CLONES } from "./table";
export { HG3_OUTLINE_CHARSET, codeForChar } from "./charset";

type Loader = () => Promise<{ default: OutlineFaceData }>;

/** One explicit import() per face so the bundler splits them into chunks. */
const LOADERS: Readonly<Record<string, Loader>> = {
  "hwv-sans-regular": () => import("./faces/hwv-sans-regular"),
  "hwv-sans-italic": () => import("./faces/hwv-sans-italic"),
  "hwv-sans-bold": () => import("./faces/hwv-sans-bold"),
  "hwv-sans-bold-italic": () => import("./faces/hwv-sans-bold-italic"),
  "hwv-sans-thin": () => import("./faces/hwv-sans-thin"),
  "hwv-sans-thin-italic": () => import("./faces/hwv-sans-thin-italic"),
  "hwv-serif-regular": () => import("./faces/hwv-serif-regular"),
  "hwv-serif-italic": () => import("./faces/hwv-serif-italic"),
  "hwv-serif-bold": () => import("./faces/hwv-serif-bold"),
  "hwv-serif-bold-italic": () => import("./faces/hwv-serif-bold-italic"),
  "hwv-slab-medium": () => import("./faces/hwv-slab-medium"),
  "hwv-slab-medium-italic": () => import("./faces/hwv-slab-medium-italic"),
  "hwv-slab-light": () => import("./faces/hwv-slab-light"),
  "hwv-slab-light-italic": () => import("./faces/hwv-slab-light-italic"),
  "hwv-mono-regular": () => import("./faces/hwv-mono-regular"),
};

/** Clone info for a font key (sync, no outlines loaded), or null. */
export function outlineCloneInfo(key: FontKey): OutlineCloneInfo | null {
  const entry = outlineCloneEntry(key);
  const m = OUTLINE_FACE_METRICS[fontKeyString(key)];
  if (!entry || !m) return null;
  return {
    id: entry.id,
    family: entry.family,
    style: entry.style,
    originalFile: entry.originalFile,
    unitsPerEm: 1000,
    ascent: m.ascent,
    descent: m.descent,
    capHeight: m.capHeight,
    xHeight: m.xHeight,
    italicAngle: m.italicAngle,
    advance(code) {
      const a = m.advances[code];
      return a === undefined || a < 0 ? null : a;
    },
  };
}

const cache = new Map<string, Promise<OutlineFont>>();
/** Faces whose load has finished, by clone id (read synchronously by scene builders). */
const loaded = new Map<string, OutlineFont>();

/** Load the clone face for a font key; null if the key has no clone. */
export function outlineCloneFor(key: FontKey): Promise<OutlineFont | null> {
  const info = outlineCloneInfo(key);
  const loader = info && LOADERS[info.id];
  if (!info || !loader) return Promise.resolve(null);
  let p = cache.get(info.id);
  if (!p) {
    p = loader().then((mod) => {
      const font = makeFont(info, mod.default);
      loaded.set(info.id, font);
      return font;
    });
    // A failed load (e.g. network) may be retried later.
    p.catch(() => cache.delete(info.id));
    cache.set(info.id, p);
  }
  return p;
}

/**
 * The clone face for a font key if it has already been loaded by
 * outlineCloneFor, else null. Synchronous: scene building cannot wait for a
 * load, so callers load faces first (see src/formats/hg3/scene/prepareFonts.ts)
 * and fall back when a face is not there yet.
 */
export function loadedOutlineClone(key: FontKey): OutlineFont | null {
  const info = outlineCloneInfo(key);
  return (info && loaded.get(info.id)) ?? null;
}

function makeFont(info: OutlineCloneInfo, data: OutlineFaceData): OutlineFont {
  return {
    family: data.family,
    style: data.style,
    unitsPerEm: 1000,
    ascent: info.ascent,
    descent: info.descent,
    capHeight: info.capHeight,
    xHeight: info.xHeight,
    glyph(code: number): OutlineGlyph | null {
      const path = data.paths[code];
      const advance = data.advances[code];
      if (path === null || path === undefined || advance === undefined || advance < 0) return null;
      return { advance, path };
    },
  };
}

const TOKEN = /[MmLlHhVvQqZz]|-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?/g;

/** Round to 3 decimals and drop trailing zeros. */
const fmt = (n: number): string => String(Math.round(n * 1000) / 1000);

/**
 * Re-emit a glyph path (y up, font units) scaled by `scale`, flipped to y down
 * and moved by (dx, 0). Handles the commands the generator writes.
 */
function placePath(path: string, scale: number, dx: number): string {
  const tokens = path.match(TOKEN) ?? [];
  let out = "";
  let cmd = "";
  let i = 0;
  const num = () => Number(tokens[i++]);
  while (i < tokens.length) {
    const t = tokens[i]!;
    if (/[A-Za-z]/.test(t)) {
      cmd = t;
      i++;
      if (cmd === "z" || cmd === "Z") {
        out += "Z";
        continue;
      }
    }
    switch (cmd) {
      case "M":
      case "L": {
        const x = num(), y = num();
        out += `${cmd}${fmt(x * scale + dx)} ${fmt(-y * scale)}`;
        break;
      }
      case "m":
      case "l": {
        const x = num(), y = num();
        out += `${cmd}${fmt(x * scale)} ${fmt(-y * scale)}`;
        break;
      }
      case "h":
        out += `h${fmt(num() * scale)}`;
        break;
      case "v":
        out += `v${fmt(-num() * scale)}`;
        break;
      case "q": {
        const a = num(), b = num(), c = num(), d = num();
        out += `q${fmt(a * scale)} ${fmt(-b * scale)} ${fmt(c * scale)} ${fmt(-d * scale)}`;
        break;
      }
      case "Q": {
        const a = num(), b = num(), c = num(), d = num();
        out += `Q${fmt(a * scale + dx)} ${fmt(-b * scale)} ${fmt(c * scale + dx)} ${fmt(-d * scale)}`;
        break;
      }
      default:
        throw new Error(`unexpected path command ${JSON.stringify(cmd)}`);
    }
  }
  return out;
}

/**
 * Lay out text in a clone font as one SVG path: y down, baseline at y = 0,
 * starting at x = 0, `sizeUnits` = em size in output units. Strings map to
 * byte codes through the HG3 character set (codeForChar); characters with no
 * code are skipped, codes with no glyph advance nothing.
 */
export function textToOutlinePath(
  font: OutlineFont,
  text: string | readonly number[] | Uint8Array,
  sizeUnits: number,
): { d: string; advance: number } {
  const codes: number[] = [];
  if (typeof text === "string") {
    for (const ch of text) {
      const c = codeForChar(ch);
      if (c !== undefined) codes.push(c);
    }
  } else {
    for (const c of text) codes.push(c);
  }
  const scale = sizeUnits / font.unitsPerEm;
  let pen = 0;
  let d = "";
  for (const code of codes) {
    const g = font.glyph(code);
    if (!g) continue;
    if (g.path) d += placePath(g.path, scale, pen * scale);
    pen += g.advance;
  }
  return { d, advance: pen * scale };
}
