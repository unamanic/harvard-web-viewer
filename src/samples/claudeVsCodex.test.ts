/**
 * The shareable sample show samples/claude-vs-codex (made in the real
 * Harvard Graphics 3.05 for this project; committed, so this suite runs in
 * CI). See that folder's README.md for the slide table these checks follow.
 *
 * Checks: the show decodes to the README's 20 slides with their effects and
 * display times; its slides name the charts by full DOS path (C:\CVC\...)
 * and the viewer finds them by base name; every chart builds one scene
 * without regression warnings; and each picture slide's linked PCX is drawn
 * once, stretched to its box (0x1140 byte 3 = 2, assumptions.ts
 * BITMAP_FIT_TO_BOX), not tiled, and on the VGA ScreenShow screen matches
 * the real program's screenshot pixel for pixel in the picture area.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FileSet } from "../files/FileSet";
import { readContainer } from "../formats/hg3/container";
import { hg3Parser } from "../formats/hg3/index";
import { parseShow } from "../formats/hg3/show";
import type { ImageElement, Scene, SceneElement } from "../formats/types";
import { applyDisplayMode } from "../render/displayMode";
import { screenGeometry } from "../render/dither";

const DIR = new URL("../../samples/claude-vs-codex/", import.meta.url);

function load(): FileSet | null {
  if (!existsSync(DIR) || !statSync(DIR).isDirectory()) return null;
  const set = new FileSet();
  for (const raw of readdirSync(DIR, { recursive: true })) {
    const rel = raw.replace(/\\/g, "/");
    const full = new URL(rel.split("/").map(encodeURIComponent).join("/"), DIR);
    if (statSync(full).isFile()) set.add(rel, new Uint8Array(readFileSync(full)));
  }
  return set;
}

const files = load();

/** README "Slides" table: file, chart type, Draw effect / direction / speed, Erase effect / direction / speed. */
const SLIDES: readonly [string, string, string, string, string, string, string, string][] = [
  ["CVC01", "Title", "fade", "", "slow", "", "", ""],
  ["CVC02", "Bullet", "wipe", "right", "medium", "", "", ""],
  ["CVCP01", "Title", "iris", "out", "medium", "", "", ""],
  ["CVC03", "XY", "blinds", "down", "fast", "", "", ""],
  ["CVCP02", "Title", "scroll", "left", "medium", "wipe", "right", "fast"],
  ["CVC04", "Pie", "iris", "in", "medium", "", "", ""],
  ["CVCP03", "Title", "open", "up", "medium", "", "", ""],
  ["CVC05", "Bullet", "scroll", "up", "medium", "", "", ""],
  ["CVCP04", "Title", "close", "in", "fast", "", "", ""],
  ["CVC06", "XY", "open", "right", "medium", "", "", ""],
  ["CVCP05", "Title", "wipe", "down", "medium", "blinds", "up", "fast"],
  ["CVC07", "Table", "close", "in", "medium", "", "", ""],
  ["CVCP06", "Title", "fade", "", "medium", "", "", ""],
  ["CVC08", "Organization", "overlay", "", "", "", "", ""],
  ["CVCP07", "Title", "wipe", "left", "fast", "scroll", "down", "medium"],
  ["CVCP08", "Title", "blinds", "right", "slow", "", "", ""],
  ["CVC09", "Bullet", "wipe", "left", "fast", "blinds", "up", "fast"],
  ["CVCP09", "Title", "open", "out", "medium", "", "", ""],
  ["CVCP10", "Title", "iris", "out", "slow", "fade", "", "medium"],
  ["CVC10", "Title", "fade", "", "slow", "", "", ""],
];

/** Screenshot of each picture slide (README: slide number of CVCPnn). */
const PICTURE_SLIDE: Readonly<Record<string, number>> = {
  CVCP01: 3, CVCP02: 5, CVCP03: 7, CVCP04: 9, CVCP05: 11, CVCP06: 13, CVCP07: 15, CVCP08: 16, CVCP09: 18, CVCP10: 19,
};

/**
 * Warnings that mean something this sample used to get right is now broken.
 * The folder ships without HG's own files, so "palette file ...HG3.PL3 not
 * found" (the built-in copy is used), "HG3.FGF not found" and "font file
 * ... not found; using a substitute" are expected and not listed.
 */
const REGRESSION_PATTERNS: readonly RegExp[] = [
  /bitmap .*not found/i,
  /chart .*not found/i,
  /\.CH3 .*not found/i,
  /could not be read/i,
  /names no bitmap/i,
  /unknown/i,
  /damaged/i,
  /skipped/i,
  /kept raw/i,
];

function set(): FileSet {
  if (!files) throw new Error("samples/claude-vs-codex is missing");
  return files;
}

function parseChart(name: string) {
  const path = set().entries().find((e) => e.name.toUpperCase() === `${name}.CH3`)?.path;
  if (!path) throw new Error(`${name}.CH3 not found`);
  const entry = set().get(path)!;
  return hg3Parser.parse(entry.bytes, entry.name, set().contextFor(entry.path));
}

function images(els: readonly SceneElement[], out: ImageElement[] = []): ImageElement[] {
  for (const el of els) {
    if (el.kind === "group") images(el.children, out);
    else if (el.kind === "image") out.push(el);
  }
  return out;
}

/** Minimal PNG decoder (8-bit indexed or RGB, no interlace) to RGB, with the platform's inflate. */
async function decodePng(bytes: Uint8Array): Promise<{ width: number; height: number; rgb: Uint8Array }> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  let palette: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  while (pos < bytes.length) {
    const len = view.getUint32(pos);
    const type = String.fromCharCode(...bytes.subarray(pos + 4, pos + 8));
    const data = bytes.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = view.getUint32(pos + 8);
      height = view.getUint32(pos + 12);
      if (data[8] !== 8 || data[12] !== 0) throw new Error("only 8-bit, non-interlaced PNGs");
      colorType = data[9]!;
    } else if (type === "PLTE") palette = data;
    else if (type === "IDAT") idat.push(data);
    pos += 12 + len;
  }
  const stream = new Blob(idat as BlobPart[]).stream().pipeThrough(new DecompressionStream("deflate"));
  const raw = new Uint8Array(await new Response(stream).arrayBuffer());
  const bpp = colorType === 3 ? 1 : colorType === 2 ? 3 : 0;
  if (!bpp) throw new Error(`PNG colour type ${colorType} not supported`);
  const stride = width * bpp;
  const lines = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    for (let i = 0; i < stride; i++) {
      const x = raw[y * (stride + 1) + 1 + i]!;
      const a = i >= bpp ? lines[y * stride + i - bpp]! : 0;
      const b = y > 0 ? lines[(y - 1) * stride + i]! : 0;
      const c = i >= bpp && y > 0 ? lines[(y - 1) * stride + i - bpp]! : 0;
      const p = a + b - c;
      const paeth = Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c;
      const pred = [0, a, b, (a + b) >> 1, paeth][filter] ?? 0;
      lines[y * stride + i] = (x + pred) & 0xff;
    }
  }
  if (bpp === 3) return { width, height, rgb: lines };
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i++) rgb.set(palette!.subarray(lines[i]! * 3, lines[i]! * 3 + 3), i * 3);
  return { width, height, rgb };
}

describe.skipIf(!files)("samples/claude-vs-codex", () => {
  it("the show decodes to the README's 20 slides, effects and 0:15 display times", () => {
    const show = set().entries().find((e) => e.name.toUpperCase() === "CLAUDEVX.SH3")!;
    const { show: s, warnings } = parseShow(readContainer(show.bytes));
    expect(warnings).toEqual([]);
    const slides = s.slides.filter((sl) => sl.number > 0);
    expect(slides).toHaveLength(20);
    expect(s.slides[0]!.fileName).toBeNull(); // slide 0: Replace, no file
    slides.forEach((sl, i) => {
      const [name, type, draw, dir, speed, erase, eDir, eSpeed] = SLIDES[i]!;
      const at = `slide ${i + 1}`;
      expect(sl.number, at).toBe(i + 1);
      expect(sl.kindName, at).toBe("chart");
      expect(sl.fileName, at).toBe(`${name}.CH3`);
      expect(sl.chartTypeName, at).toBe(type);
      expect(sl.draw, at).toEqual({ effect: draw, direction: dir || null, speed: speed || null });
      expect(sl.erase, at).toEqual({ effect: erase || null, direction: eDir || null, speed: eSpeed || null });
      expect(sl.displaySeconds, at).toBe(15);
    });
  });

  it("plays: every slide finds its chart by base name and builds a scene with the README's effects", () => {
    const show = set().entries().find((e) => e.name.toUpperCase() === "CLAUDEVX.SH3")!;
    const doc = hg3Parser.parse(show.bytes, show.name, set().contextFor(show.path));
    const p = doc.presentation!;
    const slides = p.slides.slice(p.firstSlide);
    expect(slides).toHaveLength(20);
    slides.forEach((sl, i) => {
      const [name, , draw, dir, speed, erase] = SLIDES[i]!;
      const at = `slide ${i + 1} (${name})`;
      expect(sl.kind, at).toBe("picture");
      expect(sl.waitForKey, at).toBe(false);
      expect(sl.displaySeconds, at).toBe(15);
      expect(sl.effects?.draw.effect, at).toBe(draw);
      expect(sl.effects?.draw.direction, at).toBe(dir || undefined);
      expect(sl.effects?.draw.speed, at).toBe(speed || undefined);
      expect(sl.effects?.erase?.effect, at).toBe(erase || undefined);
      const scene = sl.scene();
      expect(scene, at).not.toBeNull();
      expect(sl.warnings().filter((w) => REGRESSION_PATTERNS.some((re) => re.test(w))), at).toEqual([]);
    });
    // Only HG's own files (not shipped with the sample) may be missing: no chart or bitmap.
    expect(set().missing().map((m) => m.name).filter((n) => /\.(ch3|pcx)$/i.test(n))).toEqual([]);
  });

  it("every chart (show and extras) builds one scene without regression warnings", () => {
    const charts = set().entries().filter((e) => /\.ch3$/i.test(e.name));
    expect(charts).toHaveLength(25);
    const problems: string[] = [];
    for (const e of charts) {
      const doc = hg3Parser.parse(e.bytes, e.name, set().contextFor(e.path));
      if (doc.scenes.length !== 1) problems.push(`${e.path}: ${doc.scenes.length} scenes`);
      for (const w of doc.warnings ?? []) if (REGRESSION_PATTERNS.some((re) => re.test(w))) problems.push(`${e.path}: ${w}`);
    }
    expect(problems).toEqual([]);
  });

  it("each picture slide draws its linked PCX once, stretched to the ±14894 × ±11170 box, not tiled", () => {
    for (const name of Object.keys(PICTURE_SLIDE)) {
      const imgs = images(parseChart(name).scenes[0]!.elements);
      expect(imgs, name).toHaveLength(1);
      const img = imgs[0]!;
      expect(img.tile, name).toBeUndefined();
      expect({ x: img.x, y: img.y, width: img.width, height: img.height }, name).toEqual({ x: -14894, y: -11170, width: 29788, height: 22340 });
      expect([img.pixels?.width, img.pixels?.height], name).toEqual([530, 290]);
    }
  });

  it("on the VGA ScreenShow screen each picture matches the HG 3.05 screenshot pixel for pixel (rows 90-394)", async () => {
    for (const [name, slide] of Object.entries(PICTURE_SLIDE)) {
      const scene: Scene = parseChart(name).scenes[0]!;
      const screened = applyDisplayMode(scene, "vga");
      const imgs = images(screened.elements);
      expect(imgs, name).toHaveLength(1);
      const img = imgs[0]!;
      const px = img.pixels!;
      const geo = screenGeometry(scene.viewBox, { width: 640, height: 480, pixelAspect: 1 });
      const left = Math.round((img.x - geo.originX) / geo.pixelWidth);
      const top = Math.round((img.y - geo.originY) / geo.pixelHeight);
      // The box's screen pixels: 564 × 424 from (38, 28) (assumptions.ts BITMAP_FIT_TO_BOX).
      expect([left, top, px.width, px.height], name).toEqual([38, 28, 564, 424]);
      const shot = set().entries().find((e) => e.name === `CLAUDEVX_slide${String(slide).padStart(2, "0")}.png`)!;
      const ref = await decodePng(shot.bytes);
      let wrong = 0;
      let total = 0;
      // Rows 90-394 hold only the picture (the title is above, the dialogue below).
      for (let y = 90; y < 395; y++) {
        for (let x = left; x < left + px.width; x++) {
          const css = px.palette[px.data[(y - top) * px.width + (x - left)]!];
          const o = (y * ref.width + x) * 3;
          const shown = `#${[0, 1, 2].map((k) => ref.rgb[o + k]!.toString(16).padStart(2, "0")).join("")}`;
          total++;
          if ((css ?? "#000000").toLowerCase() !== shown) wrong++;
        }
      }
      expect(wrong, `${name}: ${wrong} of ${total} pixels differ from slide ${slide}`).toBe(0);
    }
  });
});
