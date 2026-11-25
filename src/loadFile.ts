import { choosePrimary } from "./files/choosePrimary";
import type { FileEntry, FileSet, MissingFile } from "./files/FileSet";
import { detectFormat } from "./formats/registry";
import type { Document, ParseContext } from "./formats/types";

/** Viewer options that change how files are parsed (not just drawn). */
export interface LoadOptions {
  /**
   * File name of a palette to draw every chart with in place of its own
   * (e.g. "MONOCHRW.PL3"; see ParseContext.paletteOverride). Absent: as saved.
   */
  paletteOverride?: string;
}

/** The parser's view of the set for `path`, with the load options applied. */
function parseContext(fileSet: FileSet, path: string, options: LoadOptions): ParseContext {
  const context = fileSet.contextFor(path);
  if (options.paletteOverride) context.paletteOverride = options.paletteOverride;
  return context;
}

/** Everything the UI needs to know about the file being shown. */
export interface LoadedFile {
  /** Path inside the file set (folders separated by "/"). */
  path: string;
  name: string;
  bytes: Uint8Array;
  /** Parser name, or null if no parser recognised the file. */
  formatName: string | null;
  document: Document | null;
  /** Set when the file was recognised but could not be decoded. */
  error: string | null;
  /** The document's non-fatal warnings (empty if not decoded). */
  warnings: string[];
  /** Files this document named that are not in the set. */
  missing: MissingFile[];
  /** Every file the user opened, for resolving references and switching. */
  fileSet: FileSet;
}

/**
 * Detect and parse one entry of a file set, synchronously. Resources the
 * parser loads on demand (outline clone fonts) are used only if already
 * loaded; prefer `loadEntry`.
 */
export function openEntry(fileSet: FileSet, entry: FileEntry, options: LoadOptions = {}): LoadedFile {
  const base = { path: entry.path, name: entry.name, bytes: entry.bytes, fileSet };
  const detection = detectFormat(entry.bytes, entry.name);
  if (!detection) {
    return { ...base, formatName: null, document: null, error: null, warnings: [], missing: [] };
  }
  const formatName = detection.parser.name;
  try {
    const document = detection.parser.parse(entry.bytes, entry.name, parseContext(fileSet, entry.path, options));
    return {
      ...base,
      formatName,
      document,
      error: null,
      warnings: document.warnings,
      missing: fileSet.missing(entry.path),
    };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return {
      ...base,
      formatName,
      document: null,
      error,
      warnings: [],
      missing: fileSet.missing(entry.path),
    };
  }
}

/**
 * Detect, prepare and parse one entry: awaits the parser's optional
 * `prepare` step (e.g. loading the clone fonts the document needs) so the
 * first picture is drawn with them, then parses as `openEntry` does.
 */
export async function loadEntry(fileSet: FileSet, entry: FileEntry, options: LoadOptions = {}): Promise<LoadedFile> {
  const detection = detectFormat(entry.bytes, entry.name);
  if (detection?.parser.prepare) {
    try {
      await detection.parser.prepare(entry.bytes, entry.name, parseContext(fileSet, entry.path, options));
    } catch {
      // Parse anyway; the parser falls back.
    }
  }
  return openEntry(fileSet, entry, options);
}

/** The entry to open first: first .SH3, else .CH3, else recognised, else first. */
export function primaryEntry(fileSet: FileSet): FileEntry | null {
  return choosePrimary(fileSet.entries(), (e) => detectFormat(e.bytes, e.name) !== null);
}

/** Prepare and open the primary file of a set (see `loadEntry`), or null if the set is empty. */
export async function loadFileSet(fileSet: FileSet, options: LoadOptions = {}): Promise<LoadedFile | null> {
  const entry = primaryEntry(fileSet);
  return entry ? loadEntry(fileSet, entry, options) : null;
}

/** Open the primary file of a set, or null if the set is empty (synchronously; see `openEntry`). */
export function openFileSet(fileSet: FileSet, options: LoadOptions = {}): LoadedFile | null {
  const entry = primaryEntry(fileSet);
  return entry ? openEntry(fileSet, entry, options) : null;
}
