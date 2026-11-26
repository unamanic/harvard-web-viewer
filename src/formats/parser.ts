/**
 * The interface every file-format parser implements, and what a parser may
 * ask about the other files the user opened. Parsers are listed in
 * registry.ts; adding a format means adding one parser module there.
 */
import type { Document } from "../model/document";

/** How sure a parser is that it can handle a file. 0 = no, 1 = certain. */
export type Confidence = number;

export interface FormatParser {
  /** Stable identifier, e.g. "hg3". */
  id: string;
  /** Human-readable name shown in the UI. */
  name: string;
  /** Inspect the file and report how likely this parser can read it. */
  detect(bytes: Uint8Array, filename: string): Confidence;
  /**
   * Decode the file. Throw `UnsupportedFormatError` if not (yet) possible.
   * `context` gives access to the other files the user opened (palettes,
   * fonts, bitmaps); it is absent when the file was opened on its own.
   */
  parse(bytes: Uint8Array, filename: string, context?: ParseContext): Document;
  /**
   * Optional: load, asynchronously, resources that `parse` draws better
   * with (e.g. font outlines fetched on demand) into caches `parse` reads
   * synchronously. Call it before `parse` with the same arguments; `parse`
   * still works without it, falling back (e.g. to CSS fonts). Must not
   * throw or reject for bad input: `parse` reports problems.
   */
  prepare?(bytes: Uint8Array, filename: string, context?: ParseContext): Promise<void>;
}

/** A file from the set the user opened, as seen by a parser. */
export interface ResolvedFile {
  /** Relative path inside the set, folders separated by "/". */
  path: string;
  /** Base name as found on disk. */
  name: string;
  bytes: Uint8Array;
}

/** What a parser may ask about the files around the one it is decoding. */
export interface ParseContext {
  /** Path (inside the file set) of the file being parsed. */
  path: string;
  /**
   * Find a file named inside the document (case-insensitive; any directory
   * or drive prefix is ignored), preferring one beside the file being
   * parsed (SPEC section 2). Returns null and records the name as missing
   * if no such file was opened. `purpose` (e.g. "palette") labels the
   * missing-file list.
   */
  resolve(name: string, purpose?: string): ResolvedFile | null;
  /**
   * Optional: like `resolve`, but a file that is not there is not recorded
   * as missing. For lookups the parser can do without because it has a
   * built-in copy, so that the missing-file list names only files that
   * matter. Use through `findFile`, which falls back to `resolve`.
   */
  find?(name: string): ResolvedFile | null;
  /**
   * Viewer option: the file name of a palette to draw with in place of the
   * document's own (e.g. "MONOCHRW.PL3"); absent to draw as saved. The
   * format decides what it means and reports, once, if it cannot be used.
   */
  paletteOverride?: string;
  /**
   * Viewer option for formats whose charts store both their data and a
   * drawn copy of themselves: "auto" (default) lays a chart out from its
   * data only when it has no drawn copy, "always" lays it out from data and
   * skips the copy (for comparison), "never" draws the copy only.
   */
  layoutFromData?: LayoutFromData;
}

/** See `ParseContext.layoutFromData`. */
export type LayoutFromData = "auto" | "always" | "never";

/**
 * Look a file up without recording it as missing (`ParseContext.find`); a
 * context without `find` falls back to `resolve`, which may record it.
 */
export function findFile(context: ParseContext | undefined, name: string, purpose?: string): ResolvedFile | null {
  if (!context) return null;
  return context.find ? context.find(name) : context.resolve(name, purpose);
}

/** Thrown when a file is recognised but cannot be decoded yet. */
export class UnsupportedFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedFormatError";
  }
}
