/**
 * Loads the private sample files (samples-private/, git-ignored) once for the
 * regression suite (task 26). Never copies or snapshots their contents.
 *
 * Override the folder with HWV_SAMPLES_DIR (absolute, or relative to the
 * directory Vitest runs in); a missing or empty folder means "no samples" and
 * the suite skips.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { FileSet } from "../files/FileSet";

const DEFAULT_DIR = new URL("../../samples-private/", import.meta.url);

/** The sample folder: HWV_SAMPLES_DIR if set, else samples-private/. */
export function samplesDir(): string | URL {
  const override = (import.meta.env as Record<string, unknown>).HWV_SAMPLES_DIR;
  return typeof override === "string" && override !== "" ? override : DEFAULT_DIR;
}

function join(dir: string | URL, rel: string): string | URL {
  if (dir instanceof URL) return new URL(rel.split("/").map(encodeURIComponent).join("/"), dir);
  return `${dir.replace(/[\\/]+$/, "")}/${rel}`;
}

function load(): FileSet | null {
  const dir = samplesDir();
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return null;
  const set = new FileSet();
  for (const raw of readdirSync(dir, { recursive: true, encoding: "utf8" })) {
    const rel = raw.replace(/\\/g, "/");
    // Skip dotfiles such as the folder's .gitkeep.
    if (rel.split("/").some((part) => part.startsWith("."))) continue;
    // Skip the reference renders (and the test shows made alongside them):
    // the suite checks the files from the original disks only.
    if (rel.split("/")[0] === "renders") continue;
    const full = join(dir, rel);
    if (!statSync(full).isFile()) continue;
    set.add(rel, new Uint8Array(readFileSync(full))); // a copy, not a Buffer view
  }
  return set.size > 0 ? set : null;
}

let cached: FileSet | null | undefined;

/** Every sample file, loaded on first call; null when there are none. */
export function sampleFiles(): FileSet | null {
  if (cached === undefined) cached = load();
  return cached;
}

/** Sample files whose name ends with one of `extensions` (case-insensitive, with the dot). */
export function samplesWithExtension(set: FileSet, ...extensions: string[]) {
  const exts = extensions.map((e) => e.toLowerCase());
  return set.entries().filter((e) => exts.some((x) => e.name.toLowerCase().endsWith(x)));
}
