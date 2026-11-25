/** What the diagnostics panel lists (pure, no React). */
import type { MissingFile } from "../files/FileSet";
import type { LoadedFile } from "../loadFile";
import type { PresentationSlide } from "../formats/types";

export interface Diagnostics {
  /** Files the document named that are not open, read from the file set now (includes names met in lazy slide builds). */
  missing: MissingFile[];
  documentWarnings: readonly string[];
  /** The current slide's build problems so far (shows only). */
  slideWarnings: readonly string[];
  slideLabel: string | null;
  /** Total number of items listed. */
  count: number;
}

/**
 * Collect the diagnostics for the file shown. Missing files come from the
 * file set's record of every unresolved name requested by this file, not
 * the list taken at load time: slides build lazily and find more missing
 * files after loading. Call on every render.
 */
export function collectDiagnostics(file: LoadedFile, slide: PresentationSlide | null): Diagnostics {
  const missing = mergeMissing(file.missing, file.fileSet.missing(file.path));
  const documentWarnings = file.warnings;
  const slideWarnings = slide?.warnings() ?? [];
  return {
    missing,
    documentWarnings,
    slideWarnings,
    slideLabel: slide ? slide.label || null : null,
    count: missing.length + documentWarnings.length + slideWarnings.length,
  };
}

/** Load-time list first, then later finds; one entry per name and purpose. */
function mergeMissing(...lists: readonly MissingFile[][]): MissingFile[] {
  const seen = new Set<string>();
  const out: MissingFile[] = [];
  for (const list of lists) {
    for (const m of list) {
      const key = `${m.name.toLowerCase()}\n${m.purpose ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(m);
    }
  }
  return out;
}
