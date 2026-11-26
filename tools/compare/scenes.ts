// Loads every sample chart as a Scene, the way the app does (a FileSet over the
// samples folder, then the HG3 parser's prepare + parse), and finds the
// reference renders. Paths come from the environment (see README.md).
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { FileSet } from "../../src/files/FileSet";
import { hg3Parser } from "../../src/formats/hg3/index";
import type { Scene } from "../../src/model/scene";

const REPO = resolve(__dirname, "../..");

/** The sample files (charts, palettes, fonts, bitmaps): CMP_SAMPLES, default samples-private/. */
export const SAMPLES = resolve(process.env.CMP_SAMPLES ?? join(REPO, "samples-private"));

/** Root of the reference renders: CMP_RENDERS, default <samples>/renders. */
export const RENDERS = resolve(process.env.CMP_RENDERS ?? join(SAMPLES, "renders"));

/** Which render set each display mode is compared with. */
export const RENDER_SET: Record<string, string> = { vga: "vga", ega: "ega", mono: "hercules", modern: "vga" };

/** The folder of NAME.png references for a mode: REFDIR, default <renders>/<set>/charts. */
export function refDir(mode: string): string {
  return resolve(process.env.REFDIR ?? join(RENDERS, RENDER_SET[mode] ?? mode, "charts"));
}

function walk(d: string, out: string[] = []): string[] {
  for (const f of readdirSync(d)) {
    if (f === "renders") continue;
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

let set: FileSet | null = null;
let files: string[] | null = null;
const allFiles = () => (files ??= existsSync(SAMPLES) ? walk(SAMPLES) : []);

export function fileSet(): FileSet {
  return (set ??= new FileSet(allFiles().map((f) => ({ path: relative(SAMPLES, f), bytes: new Uint8Array(readFileSync(f)) }))));
}

/** Paths (relative to SAMPLES) of every .CH3, optionally only those with these base names (no extension). */
export function chartPaths(filter?: string[]): string[] {
  return allFiles()
    .map((f) => relative(SAMPLES, f))
    .filter((p) => /\.CH3$/i.test(p))
    .filter((p) => !filter || filter.includes(basename(p).replace(/\.CH3$/i, "")))
    .sort();
}

export async function loadScene(path: string): Promise<{ scene: Scene; warnings: string[] }> {
  const s = fileSet();
  const e = s.get(path);
  if (!e) throw new Error("missing " + path);
  // CMP_LAYOUT=always draws data charts from their data (the fallback) instead of their stored copy.
  const layout = process.env.CMP_LAYOUT as "auto" | "always" | "never" | undefined;
  const ctx = () => (layout ? { ...s.contextFor(e.path), layoutFromData: layout } : s.contextFor(e.path));
  await hg3Parser.prepare!(e.bytes, e.name, ctx());
  const doc = hg3Parser.parse(e.bytes, e.name, ctx());
  return { scene: doc.scenes[0]!, warnings: doc.warnings ?? [] };
}
