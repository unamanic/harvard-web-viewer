/**
 * Layout-from-data check: for each chart, draw it twice, once from its data
 * alone (dataLayout "always", the fallback for charts with no drawn copy)
 * and once from its stored drawn copy alone ("never"), and compare.
 *
 *   yarn copycheck                         every .CH3 under samples/option-tests
 *   CC_DIR=samples-private yarn copycheck  another folder (recursively)
 *   CH=PBASE,PANG45 yarn copycheck         only these charts
 *
 * Writes to tools/copycheck/out/ (git-ignored):
 *   report.md        one row per chart, worst first: pixel diff, text diff, shape diff
 *   NAME.png         3W x H: drawn copy | from data | diff (red = differs)
 *   NAME.txt         both scenes flattened to one primitive per line (kind, page box,
 *                    fill/stroke, text), drawn copy first, then from data, for diffing
 *
 * Pixel diff: share of page pixels (after a 2 x 2 blur) whose colours differ by more
 * than 48 with no match within 1 px. Text diff: texts of the copy with no text of the
 * same string within TOL page units (default 60) in the data layout, and the reverse.
 * Shape diff: the same for non-text primitives, matched by kind, colour and box.
 */
import { it } from "vitest";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { FileSet } from "../../src/files/FileSet";
import { hg3Parser } from "../../src/formats/hg3/index";
import type { Scene, SceneElement } from "../../src/formats/types";
import { rasterizeScene } from "../compare/raster";
import { writePng } from "../compare/png";

const REPO = resolve(__dirname, "../..");
const DIR = resolve(REPO, process.env.CC_DIR ?? "samples/option-tests");
const OUT = resolve(process.env.OUT ?? join(__dirname, "out"));
const TOL = Number(process.env.TOL ?? 60);
const FILTER = process.env.CH ? process.env.CH.split(",").map((s) => s.toUpperCase()) : null;
const W = 640, H = 480;

function walk(d: string, out: string[] = []): string[] {
  for (const f of readdirSync(d)) {
    if (f === "renders") continue;
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

type M = [number, number, number, number, number, number];
const mul = (a: M, b: M): M => [
  a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
];
const ap = (m: M, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

export interface Prim { kind: string; box: [number, number, number, number]; fill: string; stroke: string; text: string }

/** Flatten a scene into primitives with page-space bounding boxes (approximate for curves). */
export function flatten(scene: Scene): Prim[] {
  const out: Prim[] = [];
  const boxOf = (m: M, pts: [number, number][]): [number, number, number, number] => {
    const t = pts.map(([x, y]) => ap(m, x, y));
    const xs = t.map((p) => p[0]), ys = t.map((p) => p[1]);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map(Math.round) as [number, number, number, number];
  };
  const visit = (e: SceneElement, m: M) => {
    const a = e as unknown as Record<string, unknown>;
    const fill = String(a.fill ?? ""), stroke = String(a.stroke ?? "");
    const tm = a.transform ? mul(m, a.transform as M) : m;
    switch (e.kind) {
      case "group":
        for (const c of e.children) visit(c, tm);
        return;
      case "text": {
        const x = Number(a.x ?? 0), y = Number(a.y ?? 0);
        out.push({ kind: "text", box: boxOf(tm, [[x, y]]), fill, stroke, text: String(a.text ?? "") });
        return;
      }
      case "glyphs": {
        const x = Number(a.x ?? 0), y = Number(a.y ?? 0);
        out.push({ kind: "glyphs", box: boxOf(tm, [[x, y]]), fill, stroke, text: String(a.text ?? "") });
        return;
      }
      default: {
        const pts: [number, number][] = [];
        const num = (k: string) => Number(a[k] ?? 0);
        if ("points" in a && Array.isArray(a.points)) for (const p of a.points as { x: number; y: number }[]) pts.push([p.x, p.y]);
        if ("cx" in a) {
          const rx = num("rx") || num("r"), ry = num("ry") || num("r");
          pts.push([num("cx") - rx, num("cy") - ry], [num("cx") + rx, num("cy") + ry]);
        }
        if ("width" in a && "x" in a) pts.push([num("x"), num("y")], [num("x") + num("width"), num("y") + num("height")]);
        if (typeof a.d === "string") {
          const n = (a.d.match(/-?\d+(\.\d+)?(e-?\d+)?/g) ?? []).map(Number);
          for (let i = 0; i + 1 < n.length; i += 2) pts.push([n[i], n[i + 1]]);
        }
        if (pts.length === 0) pts.push([0, 0]);
        out.push({ kind: e.kind, box: boxOf(tm, pts), fill, stroke, text: "" });
      }
    }
  };
  const id: M = [1, 0, 0, 1, 0, 0];
  for (const e of scene.elements) visit(e, id);
  return out;
}

const near = (a: Prim, b: Prim) => a.box.every((v, i) => Math.abs(v - b.box[i]) <= TOL);
function unmatched(from: Prim[], to: Prim[], text: boolean): Prim[] {
  const pool = to.filter((p) => (p.kind === "text" || p.kind === "glyphs") === text);
  return from
    .filter((p) => (p.kind === "text" || p.kind === "glyphs") === text)
    .filter((p) => !pool.some((q) => (text ? q.text.trim() === p.text.trim() : q.kind === p.kind && q.fill === p.fill) && near(p, q)));
}

const line = (p: Prim) => `${p.kind.padEnd(7)} [${p.box.join(",")}] fill=${p.fill || "-"} stroke=${p.stroke || "-"}${p.text ? ` "${p.text}"` : ""}`;

function pixelDiff(a: Uint8Array, b: Uint8Array): { share: number; mask: Uint8Array } {
  const blur = (rgb: Uint8Array) => {
    const o = new Float32Array(W * H * 3);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let c = 0; c < 3; c++) {
      let s = 0;
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) s += rgb[(Math.min(H - 1, y + dy) * W + Math.min(W - 1, x + dx)) * 3 + c];
      o[(y * W + x) * 3 + c] = s / 4;
    }
    return o;
  };
  const A = blur(a), B = blur(b), mask = new Uint8Array(W * H);
  const d = (i: number, j: number) => Math.hypot(A[i] - B[j], A[i + 1] - B[j + 1], A[i + 2] - B[j + 2]);
  let n = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 3;
    if (d(i, i) <= 48) continue;
    let ok = false;
    for (let dy = -1; dy <= 1 && !ok; dy++) for (let dx = -1; dx <= 1 && !ok; dx++) {
      const yy = y + dy, xx = x + dx;
      if (yy < 0 || xx < 0 || yy >= H || xx >= W) continue;
      const j = (yy * W + xx) * 3;
      if (d(i, j) <= 48 && d(j, i) <= 48) ok = true;
    }
    if (!ok) { mask[y * W + x] = 1; n++; }
  }
  return { share: n / (W * H), mask };
}

const charts = existsSync(DIR)
  ? walk(DIR).filter((p) => /\.CH3$/i.test(p)).filter((p) => !FILTER || FILTER.includes(basename(p).replace(/\.CH3$/i, "").toUpperCase())).sort()
  : [];

it.skipIf(charts.length === 0)(`layout from data vs drawn copy for ${relative(REPO, DIR)}`, async () => {
  mkdirSync(OUT, { recursive: true });
  const all = walk(DIR);
  const set = new FileSet(all.map((f) => ({ path: relative(DIR, f), bytes: new Uint8Array(readFileSync(f)) })));
  const rows: { name: string; px: number; tc: number; td: number; sc: number; sd: number; warn: number; err?: string }[] = [];
  for (const file of charts) {
    const name = basename(file).replace(/\.CH3$/i, "");
    const path = relative(DIR, file);
    try {
      const e = set.get(path)!;
      const scenes: Record<string, Scene> = {};
      let warn = 0;
      for (const mode of ["never", "always"] as const) {
        const ctx = { ...set.contextFor(e.path), layoutFromData: mode };
        await hg3Parser.prepare!(e.bytes, e.name, ctx);
        const doc = hg3Parser.parse(e.bytes, e.name, ctx);
        scenes[mode] = doc.scenes[0]!;
        if (mode === "always") warn = doc.warnings?.length ?? 0;
      }
      const copy = flatten(scenes.never), data = flatten(scenes.always);
      const tc = unmatched(copy, data, true), td = unmatched(data, copy, true);
      const sc = unmatched(copy, data, false), sd = unmatched(data, copy, false);
      const ra = rasterizeScene(scenes.never, W, H), rb = rasterizeScene(scenes.always, W, H);
      const { share, mask } = pixelDiff(ra.rgb, rb.rgb);
      const img = new Uint8Array(W * 3 * H * 3);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const s = (y * W + x) * 3;
        for (let c = 0; c < 3; c++) {
          img[(y * W * 3 + x) * 3 + c] = ra.rgb[s + c];
          img[(y * W * 3 + W + x) * 3 + c] = rb.rgb[s + c];
          const g = (ra.rgb[s] + ra.rgb[s + 1] + ra.rgb[s + 2]) / 9;
          img[(y * W * 3 + 2 * W + x) * 3 + c] = mask[y * W + x] ? (c === 0 ? 255 : 0) : g;
        }
      }
      writePng(join(OUT, name + ".png"), W * 3, H, img);
      writeFileSync(
        join(OUT, name + ".txt"),
        [
          `# ${path}: drawn copy (${copy.length} primitives)`, ...copy.map(line), "",
          `# from data (${data.length} primitives)`, ...data.map(line), "",
          "# copy texts missing from data", ...tc.map(line), "# data texts not in copy", ...td.map(line),
          "# copy shapes missing from data", ...sc.map(line), "# data shapes not in copy", ...sd.map(line),
        ].join("\n"),
      );
      rows.push({ name, px: share, tc: tc.length, td: td.length, sc: sc.length, sd: sd.length, warn });
    } catch (err) {
      rows.push({ name, px: 1, tc: 0, td: 0, sc: 0, sd: 0, warn: 0, err: String(err) });
    }
  }
  rows.sort((a, b) => b.px - a.px);
  const md = [
    `# Layout from data vs drawn copy (${relative(REPO, DIR)}, text/shape tolerance ${TOL} units)`, "",
    "| Chart | Pixel diff | Copy texts missing | Extra texts | Copy shapes missing | Extra shapes | Warnings |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map((r) => r.err ? `| ${r.name} | ERROR ${r.err} | | | | | |` :
      `| ${r.name} | ${(r.px * 100).toFixed(2)}% | ${r.tc} | ${r.td} | ${r.sc} | ${r.sd} | ${r.warn} |`),
  ].join("\n");
  writeFileSync(join(OUT, "report.md"), md + "\n");
  console.log(md);
});
