#!/usr/bin/env node
/**
 * Generate the outline clone faces src/fonts/outline/faces/*.ts
 * (docs/RENDERER_TASKS.md task 7d-2) from open-licensed TrueType fonts.
 *
 * Usage, from the repository root:
 *
 *   node scripts/gen-outline-faces.mjs <source-dir> [--report]
 *
 * <source-dir> holds the downloaded source fonts (any sub-folders); they are
 * found by file name. See src/fonts/outline/README.md for the download URLs
 * and versions. Needs src/fonts/outline/metrics.ts (gen-outline-metrics.mjs).
 *
 * Method, per clone face and per byte code 0–255:
 *
 *  1. Character: HG3_OUTLINE_CHARSET (src/fonts/outline/charset.ts) gives the
 *     Unicode character; the glyph comes from the face's primary source font,
 *     else from its fallback fonts (for symbols the primary lacks).
 *  2. Em: coordinates are scaled by 1000 / unitsPerEm of the source.
 *  3. Vertical: lowercase letters are scaled so the source 'x' top lands on
 *     the original x-height; every other glyph so the source 'H' top lands on
 *     the original cap height (one factor per class and source font, so no
 *     glyph is distorted, only scaled).
 *  4. Horizontal: first a face-wide factor "base" (median over ASCII letters
 *     and digits of original advance / source advance), then per glyph
 *     r = original advance / (base × source advance). The outline is scaled
 *     horizontally by base × k, k = r clamped to
 *     [1 - MAX_SQUEEZE, 1 + MAX_STRETCH] (box-drawing and block glyphs:
 *     exactly r, so they still join), and the space left over
 *     (original advance - k × base × source advance) is split equally
 *     between the two side bearings. The advance is always the original's.
 *  5. Obliques (OBLIQUE): x += (y - xHeight / 2) × tan(original italic
 *     angle), i.e. sheared about half the x-height so the ink stays centred.
 *
 * Only advance widths and font-wide heights of the originals are used (from
 * metrics.ts); nothing of their outlines.
 */
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runnerImport } from "vite";
import { readTrueType, contoursBBox } from "./lib/sfnt.mjs";

const MAX_SQUEEZE = 0.12;
const MAX_STRETCH = 0.12;

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const srcDir = args.find((a) => !a.startsWith("--"));
const wantReport = args.includes("--report");
if (!srcDir) {
  console.error("usage: node scripts/gen-outline-faces.mjs <source-dir> [--report]");
  process.exit(2);
}
const outDir = join(root, "src/fonts/outline/faces");

const load = async (p) => (await runnerImport(join(root, p), { configFile: false, logLevel: "error" })).module;
const { OUTLINE_CLONES } = await load("src/fonts/outline/table.ts");
const { OUTLINE_FACE_METRICS } = await load("src/fonts/outline/metrics.ts");
const { HG3_OUTLINE_CHARSET } = await load("src/fonts/outline/charset.ts");
const { fontKeyString } = await load("src/formats/hg3/fontKey.ts");

/** Source fonts per clone id: primary first, then fallbacks (merged in order). */
const L = (n) => `LiberationSans-${n}.ttf`;
const SOURCES = {
  "hwv-sans-regular": [L("Regular")],
  "hwv-sans-italic": [L("Italic")],
  "hwv-sans-bold": [L("Bold")],
  "hwv-sans-bold-italic": [L("BoldItalic")],
  "hwv-sans-thin": ["Roboto-Thin.ttf", L("Regular")],
  "hwv-sans-thin-italic": ["Roboto-ThinItalic.ttf", L("Italic")],
  "hwv-serif-regular": ["LiberationSerif-Regular.ttf", L("Regular")],
  "hwv-serif-italic": ["LiberationSerif-Italic.ttf", L("Italic")],
  "hwv-serif-bold": ["LiberationSerif-Bold.ttf", L("Bold")],
  "hwv-serif-bold-italic": ["LiberationSerif-BoldItalic.ttf", L("BoldItalic")],
  "hwv-slab-medium": ["rokkitt-latin-400-normal.woff", "rokkitt-latin-ext-400-normal.woff", L("Regular")],
  "hwv-slab-medium-italic": ["rokkitt-latin-500-normal.woff", "rokkitt-latin-ext-500-normal.woff", L("Regular")],
  "hwv-slab-light": ["rokkitt-latin-300-normal.woff", "rokkitt-latin-ext-300-normal.woff", L("Regular")],
  "hwv-slab-light-italic": ["rokkitt-latin-300-normal.woff", "rokkitt-latin-ext-300-normal.woff", L("Regular")],
  "hwv-mono-regular": ["LiberationMono-Regular.ttf", L("Regular")],
};

/**
 * Faces drawn as obliques: the upright source sheared by the original's
 * italic angle (Geo Slab 712's italics are sloped romans, while Rokkitt's
 * italics are cursive).
 */
const OBLIQUE = new Set(["hwv-slab-medium-italic", "hwv-slab-light-italic"]);

// Index the source directory by file name.
const files = new Map();
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (!files.has(name)) files.set(name, p);
  }
})(resolve(srcDir));

const fontCache = new Map();
function source(name) {
  if (!fontCache.has(name)) {
    const p = files.get(name);
    if (!p) throw new Error(`source font ${name} not found under ${srcDir}`);
    const f = readTrueType(readFileSync(p));
    const em = 1000 / f.unitsPerEm;
    const top = (ch) => {
      const gid = f.glyphId(ch.codePointAt(0));
      const bb = gid === undefined ? null : contoursBBox(f.contours(gid));
      return bb ? bb.yMax * em : null;
    };
    fontCache.set(name, { name, f, em, cap: top("H"), x: top("x"), asc: top("d") });
  }
  return fontCache.get(name);
}

const isLower = (ch) => ch.length > 0 && ch === ch.toLowerCase() && ch !== ch.toUpperCase();
const isBoxOrBlock = (ch) => {
  const cp = ch.codePointAt(0) ?? 0;
  return cp >= 0x2500 && cp <= 0x259f;
};

/** Compact number list: no separator before a minus sign. */
function nums(list) {
  let s = "";
  for (const n of list) {
    const t = String(n);
    s += s && !t.startsWith("-") ? " " + t : t;
  }
  return s;
}

/** TrueType contours (already transformed, unrounded) → compact SVG path. */
function contoursToPath(contours) {
  let d = "";
  for (const raw of contours) {
    if (raw.length < 2) continue;
    const pts = raw.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y), on: p.on }));
    // Start at an on-curve point (or the midpoint of two off-curve points).
    let startIdx = pts.findIndex((p) => p.on);
    let seq;
    if (startIdx < 0) {
      const m = { x: Math.round((pts[0].x + pts[1].x) / 2), y: Math.round((pts[0].y + pts[1].y) / 2), on: true };
      seq = [m, ...pts.slice(1), pts[0]];
    } else {
      seq = [...pts.slice(startIdx), ...pts.slice(0, startIdx)];
    }
    const start = seq[0];
    let cx = start.x, cy = start.y;
    d += `M${nums([cx, cy])}`;
    let last = "";
    const cmd = (c, list) => {
      d += (c === last && !String(list[0]).startsWith("-") ? " " : c === last ? "" : c) + nums(list);
      last = c;
    };
    const lineTo = (x, y) => {
      if (x === cx && y === cy) return;
      if (y === cy) cmd("h", [x - cx]);
      else if (x === cx) cmd("v", [y - cy]);
      else cmd("l", [x - cx, y - cy]);
      cx = x;
      cy = y;
    };
    const quadTo = (qx, qy, x, y) => {
      cmd("q", [qx - cx, qy - cy, x - cx, y - cy]);
      cx = x;
      cy = y;
    };
    const n = seq.length;
    for (let i = 1; i <= n; i++) {
      const p = seq[i % n];
      if (p.on) {
        lineTo(p.x, p.y);
        continue;
      }
      const next = seq[(i + 1) % n];
      if (next.on) {
        quadTo(p.x, p.y, next.x, next.y);
        i++;
      } else {
        quadTo(p.x, p.y, Math.round((p.x + next.x) / 2), Math.round((p.y + next.y) / 2));
      }
    }
    d += "z";
  }
  return d;
}

/**
 * Face-wide horizontal factor for a source font: the median, over ASCII
 * letters and digits, of original advance / source advance (em-normalised).
 */
function baseX(src, metrics) {
  const cacheKey = "baseX" + metrics.advances.join(",");
  src.baseX ??= new Map();
  if (!src.baseX.has(cacheKey)) {
    const ratios = [];
    for (let code = 0x30; code < 0x7b; code++) {
      const ch = HG3_OUTLINE_CHARSET[code];
      if (!/[0-9A-Za-z]/.test(ch) || metrics.advances[code] <= 0) continue;
      const gid = src.f.glyphId(ch.codePointAt(0));
      if (gid !== undefined) ratios.push(metrics.advances[code] / (src.f.advance(gid) * src.em));
    }
    ratios.sort((a, b) => a - b);
    src.baseX.set(cacheKey, ratios[Math.floor(ratios.length / 2)]);
  }
  return src.baseX.get(cacheKey);
}

mkdirSync(outDir, { recursive: true });
const report = [];
for (const clone of OUTLINE_CLONES) {
  const metrics = OUTLINE_FACE_METRICS[fontKeyString(clone.key)];
  const srcs = SOURCES[clone.id].map(source);
  const shear = OBLIQUE.has(clone.id) ? Math.tan((metrics.italicAngle * Math.PI) / 180) : 0;
  if (srcs[0].cap === null || srcs[0].x === null) throw new Error(`${srcs[0].name} has no 'H' or 'x'`);
  /** @type {(string | null)[]} */
  const paths = [];
  /** @type {{ fallback: string[]; missing: string[]; clamped: string[] }} */
  const notes = { fallback: [], missing: [], clamped: [] };
  let maxDev = 0;
  for (let code = 0; code < 256; code++) {
    const target = metrics.advances[code];
    const ch = HG3_OUTLINE_CHARSET[code];
    if (target < 0) {
      paths.push(null);
      continue;
    }
    if (!ch || ch === " " || ch === " ") {
      paths.push("");
      continue;
    }
    const cp = ch.codePointAt(0);
    const s = srcs.find((x) => x.f.glyphId(cp) !== undefined);
    if (!s) {
      notes.missing.push(`${code.toString(16)} ${ch}`);
      paths.push("");
      continue;
    }
    if (srcs.length > 1 && s === srcs[srcs.length - 1]) notes.fallback.push(ch);
    const gid = s.f.glyphId(cp);
    // A subset file without 'H'/'x' (latin-ext) uses its family's main file.
    const ref = s.cap !== null && s.x !== null ? s : srcs[0];
    const base = baseX(ref, metrics);
    const srcAdv = s.f.advance(gid) * s.em * base;
    const r = srcAdv > 0 ? target / srcAdv : 1;
    let k = r;
    if (!isBoxOrBlock(ch)) {
      k = Math.min(1 + MAX_STRETCH, Math.max(1 - MAX_SQUEEZE, r));
      if (k !== r) notes.clamped.push(`${ch}${r.toFixed(2)}`);
      maxDev = Math.max(maxDev, Math.abs(k - 1));
    }
    const shift = (target - srcAdv * k) / 2;
    const sx = s.em * base * k;
    const sy = s.em * (isLower(ch) ? metrics.xHeight / ref.x : metrics.capHeight / ref.cap);
    const cs = s.f.contours(gid).map((c) => c.map((p) => ({ x: p.x * sx + shift + (p.y * sy - metrics.xHeight / 2) * shear, y: p.y * sy, on: p.on })));
    paths.push(contoursToPath(cs));
  }
  const advances = metrics.advances.map((a) => (a < 0 ? -1 : a));
  const src = `/**
 * ${clone.family} ${clone.style}: outline clone standing in for the original face
 * ${fontKeyString(clone.key)} (${clone.originalFile}). GENERATED FILE, do not edit;
 * made by scripts/gen-outline-faces.mjs from ${SOURCES[clone.id].join(", ")}
 * (see ../README.md for sources, licences and modifications).
 *
 * paths[code]: SVG path data in 1000 units per em, y up, baseline at 0;
 * "" = blank glyph, null = no glyph. advances[code]: -1 = no glyph.
 */
import type { OutlineFaceData } from "../types";

const face: OutlineFaceData = {
  id: ${JSON.stringify(clone.id)},
  family: ${JSON.stringify(clone.family)},
  style: ${JSON.stringify(clone.style)},
  advances: [${advances.join(",")}],
  paths: [
${paths.map((p) => "    " + JSON.stringify(p) + ",").join("\n")}
  ],
};

export default face;
`;
  const out = join(outDir, `${clone.id}.ts`);
  writeFileSync(out, src);
  const s0 = srcs[0];
  report.push(
    `${clone.id}: ${(src.length / 1024).toFixed(1)} KiB; source cap ${s0.cap.toFixed(0)} x ${s0.x.toFixed(0)} → ` +
      `${metrics.capHeight}/${metrics.xHeight}; 'd' top ${((s0.asc * metrics.xHeight) / s0.x).toFixed(0)} vs ${metrics.ascent} (sy cap ${(metrics.capHeight / s0.cap).toFixed(3)}, x ${(metrics.xHeight / s0.x).toFixed(3)}, sx ${baseX(s0, metrics).toFixed(3)}); ` +
      `max |k-1| ${maxDev.toFixed(3)}; clamped ${notes.clamped.length}${notes.clamped.length ? " [" + notes.clamped.join(" ") + "]" : ""}; ` +
      `fallback ${notes.fallback.length}${notes.fallback.length ? " [" + notes.fallback.join("") + "]" : ""}; ` +
      `missing ${notes.missing.length}${notes.missing.length ? " [" + notes.missing.join(", ") + "]" : ""}`,
  );
  console.log(`wrote ${relative(root, out)}`);
}
if (wantReport) console.log("\n" + report.join("\n"));
