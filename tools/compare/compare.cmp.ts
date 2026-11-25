/**
 * Reference comparison: our renders vs framebuffers captured from the real
 * Harvard Graphics 3.05 (see tools/compare/README.md for how to run it).
 *
 * For every chart (or CH=NAME1,NAME2): parse + prepare the .CH3, apply a display mode, rasterise
 * at the reference's own resolution (raster.ts: aliased, pixel-centre sampled, honours
 * Scene.patterns, so dithered modes compare pixel for pixel), then compare with the reference PNG
 * after a BLUR x BLUR box blur of both (default 2) to neutralise dithering:
 *   - meanErr: mean Euclidean RGB distance (0..441) of the blurred images
 *   - strict:  fraction of pixels whose blurred colours differ by more than TOL (default 48)
 *   - diff:    "shift-tolerant" fraction: a pixel only counts if no pixel within SHIFT (default 1)
 *              in the other image is within TOL, in either direction. This forgives glyph-edge
 *              jitter and 1-px rounding; it is the ranking score.
 * and notes WHERE the differences are: share near our text, top band (y < 0.2 H), bottom band
 * (y >= 0.9 H) and middle, the bounding box, and the most common colour confusions (ours -> ref).
 *
 * The resolution comes from the references (640x480 VGA, 640x350 EGA, 720x348 Hercules); the page
 * is mapped with non-square pixels, pixel aspect (4/3)/(W/H) (PA=<w/h> overrides).
 *
 * Writes to OUT (default tools/compare/out/<mode>, git-ignored):
 *   report.md     ranked table (worst first) + score distribution
 *   report.json   all metrics per chart
 *   heat/NAME.png 3W x H: reference | ours | heatmap (red = shift-tolerant diff, orange = strict only)
 *
 * The references and everything written here are private (renders of copyrighted samples):
 * never commit them.
 */
import { it } from "vitest";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { chartPaths, loadScene, refDir } from "./scenes";
import { rasterizeScene } from "./raster";
import { readPng, writePng } from "./png";
import { applyDisplayMode, type DisplayMode } from "../../src/render/displayMode";

const MODE = (process.env.CMP_MODE ?? "vga") as DisplayMode;
const REFDIR = refDir(MODE); // default: <renders>/<vga|ega|hercules>/charts
const BLUR = Number(process.env.BLUR ?? 2);
const TOL = Number(process.env.TOL ?? 48);
const SHIFT = Number(process.env.SHIFT ?? 1);
const OUT = resolve(process.env.OUT ?? join(__dirname, "out", MODE));
const HEAT = process.env.HEAT !== "0";
// Resolution: the reference set's own (from the first reference PNG): 640x480 VGA, 640x350 EGA, 720x348 Hercules.
// The page's 4:3 maps onto the whole framebuffer, so pixels are (4/3)/(W/H) as wide as tall (1, 0.729, 0.644).
let W = 640, H = 480, PA = 1;

function blur(rgb: Uint8Array, k: number): Float32Array {
  // k x k box, anchored top-left, clamped at the edges; output same size.
  const out = new Float32Array(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let r = 0, g = 0, b = 0;
    for (let dy = 0; dy < k; dy++) for (let dx = 0; dx < k; dx++) {
      const yy = Math.min(H - 1, y + dy), xx = Math.min(W - 1, x + dx), o = (yy * W + xx) * 3;
      r += rgb[o]; g += rgb[o + 1]; b += rgb[o + 2];
    }
    const o = (y * W + x) * 3, n = k * k;
    out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n;
  }
  return out;
}

const dist = (a: Float32Array, i: number, b: Float32Array, j: number) =>
  Math.hypot(a[i] - b[j], a[i + 1] - b[j + 1], a[i + 2] - b[j + 2]);

/** Colour names for the confusion notes: the 16 screen colours and their dark (+black) / light (+white) halves. */
const NAMED: [string, number[]][] = (() => {
  const base: [string, number[]][] = [
    ["black", [0, 0, 0]], ["white", [255, 255, 255]], ["red", [255, 0, 0]], ["orange", [255, 128, 0]], ["yellow", [255, 255, 0]],
    ["yel-grn", [128, 255, 0]], ["green", [0, 255, 0]], ["grn-cyn", [0, 255, 128]], ["cyan", [0, 255, 255]], ["blu-cyn", [0, 128, 255]],
    ["blue", [0, 0, 255]], ["purple", [128, 0, 255]], ["magenta", [255, 0, 255]], ["mag-red", [255, 0, 128]], ["grey85", [85, 85, 85]], ["grey170", [170, 170, 170]],
  ];
  const out = [...base];
  for (const [n, c] of base.slice(2, 14)) {
    out.push([n + " D", c.map((v) => v / 2)]);
    out.push([n + " L", c.map((v) => (v + 255) / 2)]);
  }
  out.push(["grey42", [42, 42, 42]], ["grey128", [128, 128, 128]], ["grey212", [212, 212, 212]]);
  return out;
})();
function nameOf(a: Float32Array, i: number): string {
  let best = "", bd = Infinity;
  for (const [n, c] of NAMED) { const d = (a[i] - c[0]) ** 2 + (a[i + 1] - c[1]) ** 2 + (a[i + 2] - c[2]) ** 2; if (d < bd) { bd = d; best = n; } }
  return best;
}

interface Result {
  name: string; path: string; meanErr: number; strict: number; diff: number;
  text: number; top: number; middle: number; bottom: number;
  bbox: [number, number, number, number] | null; confusions: string[]; warnings: number; error?: string;
}

function where(r: Result): string {
  if (r.error) return "ERROR " + r.error;
  if (r.diff < 0.002) return "matches";
  const parts: string[] = [];
  const zones = [["top band", r.top], ["plot/middle", r.middle], ["bottom band", r.bottom]] as const;
  const main = zones.filter(([, v]) => v >= 0.25).map(([n, v]) => `${n} ${Math.round(v * 100)}%`);
  parts.push(main.join(", "));
  if (r.text >= 0.3) parts.push(`${Math.round(r.text * 100)}% near our text`);
  if (r.bbox) parts.push(`bbox x${r.bbox[0]}-${r.bbox[2]} y${r.bbox[1]}-${r.bbox[3]}`);
  if (r.confusions.length) parts.push("ours->ref: " + r.confusions.slice(0, 3).join("; "));
  return parts.filter(Boolean).join(" | ");
}

const filter = process.env.CH ? process.env.CH.split(",") : undefined;
const available = existsSync(REFDIR) && chartPaths(filter).length > 0;
if (!available) {
  console.warn(`compare: skipped. No reference renders in ${REFDIR} or no sample charts found; ` +
    "set CMP_SAMPLES / CMP_RENDERS / REFDIR (tools/compare/README.md).");
}

it.skipIf(!available)(`compare ${MODE} with the reference renders in ${REFDIR}`, async () => {
  mkdirSync(join(OUT, "heat"), { recursive: true });
  for (const p of chartPaths(filter)) {
    const f = join(REFDIR, p.split("/").pop()!.replace(/\.CH3$/i, "") + ".png");
    if (existsSync(f)) { const im = readPng(f); W = im.width; H = im.height; break; }
  }
  PA = Number(process.env.PA ?? (4 / 3) / (W / H));
  const results: Result[] = [];
  for (const p of chartPaths(filter)) {
    const name = p.split("/").pop()!.replace(/\.CH3$/i, "");
    const refPath = join(REFDIR, name + ".png");
    if (!existsSync(refPath)) continue;
    const res: Result = { name, path: p, meanErr: NaN, strict: NaN, diff: NaN, text: 0, top: 0, middle: 0, bottom: 0, bbox: null, confusions: [], warnings: 0 };
    try {
      const { scene, warnings } = await loadScene(p);
      res.warnings = warnings.length;
      let sc = scene;
      if (process.env.CMP_SCALE) {
        // Experiment: shrink everything about the page centre (to test the data-chart inset hypothesis).
        const k = Number(process.env.CMP_SCALE), vb = scene.viewBox, cx = vb.minX + vb.width / 2, cy = vb.minY + vb.height / 2;
        sc = { ...scene, elements: [{ kind: "group", transform: [k, 0, 0, k, cx * (1 - k), cy * (1 - k)], children: scene.elements }] };
      }
      const r = rasterizeScene(applyDisplayMode(sc, MODE), W, H, { pixelAspect: PA });
      const ref = readPng(refPath);
      if (ref.width !== W || ref.height !== H) throw new Error(`reference is ${ref.width}x${ref.height}, expected ${W}x${H}`);
      const A = blur(r.rgb, BLUR), B = blur(ref.rgb, BLUR);
      // our text, dilated by 3 px
      const textNear = new Uint8Array(W * H);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (r.kind[y * W + x] === 3)
        for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
          const yy = y + dy, xx = x + dx; if (yy >= 0 && yy < H && xx >= 0 && xx < W) textNear[yy * W + xx] = 1;
        }
      let sum = 0, strict = 0, diff = 0, nText = 0, nTop = 0, nMid = 0, nBot = 0;
      let x0 = W, y0 = H, x1 = -1, y1 = -1;
      const conf = new Map<string, number>();
      const heat = new Uint8Array(W * H * 3);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 3;
        const d = dist(A, i, B, i);
        sum += d;
        const g = (0.299 * ref.rgb[i] + 0.587 * ref.rgb[i + 1] + 0.114 * ref.rgb[i + 2]) * 0.3;
        heat[i] = heat[i + 1] = heat[i + 2] = g;
        if (d <= TOL) continue;
        strict++;
        // shift tolerance, both directions
        let okAB = false, okBA = false;
        for (let dy = -SHIFT; dy <= SHIFT && !(okAB && okBA); dy++) for (let dx = -SHIFT; dx <= SHIFT; dx++) {
          const yy = y + dy, xx = x + dx; if (yy < 0 || yy >= H || xx < 0 || xx >= W) continue;
          const j = (yy * W + xx) * 3;
          if (!okAB && dist(A, i, B, j) <= TOL) okAB = true;
          if (!okBA && dist(B, i, A, j) <= TOL) okBA = true;
        }
        if (okAB && okBA) { heat[i] = 255; heat[i + 1] = 150; heat[i + 2] = 0; continue; }
        diff++;
        const v = Math.min(255, 96 + d);
        heat[i] = v; heat[i + 1] = 0; heat[i + 2] = 0;
        if (textNear[y * W + x]) nText++;
        if (y < H * 0.2) nTop++; else if (y >= H * 0.9) nBot++; else nMid++;
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
        const k = nameOf(A, i) + "->" + nameOf(B, i);
        conf.set(k, (conf.get(k) ?? 0) + 1);
      }
      res.meanErr = sum / (W * H);
      res.strict = strict / (W * H);
      res.diff = diff / (W * H);
      if (diff) {
        res.text = nText / diff; res.top = nTop / diff; res.middle = nMid / diff; res.bottom = nBot / diff;
        res.bbox = [x0, y0, x1, y1];
        res.confusions = [...conf].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, n]) => `${k} ${n}`);
      }
      if (HEAT) {
        const out = new Uint8Array(W * 3 * H * 3);
        for (let y = 0; y < H; y++) {
          out.set(ref.rgb.subarray(y * W * 3, (y + 1) * W * 3), y * W * 9);
          out.set(r.rgb.subarray(y * W * 3, (y + 1) * W * 3), y * W * 9 + W * 3);
          out.set(heat.subarray(y * W * 3, (y + 1) * W * 3), y * W * 9 + W * 6);
        }
        writePng(join(OUT, "heat", name + ".png"), W * 3, H, out);
      }
    } catch (e) {
      res.error = e instanceof Error ? e.message : String(e);
    }
    results.push(res);
  }
  results.sort((a, b) => (b.diff || 0) - (a.diff || 0) || b.meanErr - a.meanErr);
  writeFileSync(join(OUT, "report.json"), JSON.stringify(results, null, 1));
  const ds = results.filter((r) => !r.error).map((r) => r.diff).sort((a, b) => a - b);
  const q = (f: number) => ds.length ? ds[Math.min(ds.length - 1, Math.floor(f * ds.length))] : NaN;
  const pct = (v: number) => (v * 100).toFixed(2) + "%";
  const buckets = [0.002, 0.01, 0.03, 0.1, 0.3, 1].map((t, i, a) => {
    const lo = i ? a[i - 1] : 0; return `${pct(lo)}-${pct(t)}: ${ds.filter((d) => d >= lo && d < t).length}`;
  });
  const lines = [
    `# Reference comparison: mode ${MODE}, ${W}x${H} (pixel aspect ${PA.toFixed(3)}), refs ${REFDIR}, blur ${BLUR}, tol ${TOL}, shift ${SHIFT}`, "",
    `${results.length} charts. Shift-tolerant diff: median ${pct(q(0.5))}, p75 ${pct(q(0.75))}, p90 ${pct(q(0.9))}, max ${pct(q(1))}.`,
    `Mean colour error: median ${results.map((r) => r.meanErr).sort((a, b) => a - b)[Math.floor(results.length / 2)]?.toFixed(1)}.`, "",
    "Distribution (diff): " + buckets.join(", "), "",
    "| # | chart | diff | strict | meanErr | where |", "|---|---|---|---|---|---|",
    ...results.map((r, i) => `| ${i + 1} | ${r.name} | ${pct(r.diff || 0)} | ${pct(r.strict || 0)} | ${(r.meanErr || 0).toFixed(1)} | ${where(r)} |`),
  ];
  writeFileSync(join(OUT, "report.md"), lines.join("\n") + "\n");
  process.stdout.write(lines.slice(0, 6).join("\n") + `\n\nFull report: ${join(OUT, "report.md")}\n`);
}, 1800000);
