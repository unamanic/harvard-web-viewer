import type { ParseContext, ResolvedFile } from "../formats/types";

/** One file the user opened. */
export type FileEntry = ResolvedFile;

/** A name a document asked for that is not in the set. */
export interface MissingFile {
  /** The base name that was asked for, as written in the document. */
  name: string;
  /** Path of the file that asked for it, or null if unknown. */
  requestedBy: string | null;
  /** What the file was wanted for (e.g. "palette"), if the caller said. */
  purpose?: string;
}

/** Normalise a relative path: forward slashes, no leading "/" or "./". */
export function normalisePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^(\.\/|\/)+/, "");
}

/**
 * Base name of a file name stored in a document or on disk. Strips any
 * directory (either slash) and DOS drive prefix ("C:\HG3\DATA\HG3.PL3",
 * "C:HG3.PL3"), plus padding spaces and NULs from fixed-width fields.
 */
export function baseName(name: string): string {
  const trimmed = name.replace(/[\0\s]+$/g, "").trim();
  const parts = trimmed.split(/[\\/]/);
  const last = parts[parts.length - 1];
  const colon = last.lastIndexOf(":");
  return colon >= 0 ? last.slice(colon + 1) : last;
}

/** Directory part of a set path ("" for the root), lower-cased for comparison. */
function dirKey(path: string): string {
  const p = normalisePath(path);
  const slash = p.lastIndexOf("/");
  return slash >= 0 ? p.slice(0, slash).toLowerCase() : "";
}

function compareEntries(a: FileEntry, b: FileEntry): number {
  if (a.path.length !== b.path.length) return a.path.length - b.path.length;
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}

/**
 * Every file the user opened (several files or whole folders), so that
 * parsers can find the palettes, fonts and bitmaps a document names.
 * Pure TypeScript: build it from browser `File`s with `fileSetFromBrowser`
 * (which also unpacks ZIP archives, see openFiles.ts).
 */
export class FileSet {
  private readonly byPath = new Map<string, FileEntry>();
  private readonly byName = new Map<string, FileEntry[]>();
  private readonly missingList: MissingFile[] = [];
  private readonly missingKeys = new Set<string>();

  /**
   * Shared by a set and the sets made from it with `withFiles`: the same
   * files the user opened, plus some added later (the viewer treats opening
   * the same path again in such a set as a reload, not a new file).
   */
  readonly lineage: object;

  /**
   * Things worth telling the user about the set as a whole, such as entries
   * of an opened ZIP archive that could not be read. Shown with the
   * warnings of whatever file is open; kept by `withFiles`.
   */
  readonly notes: string[] = [];

  constructor(entries: Iterable<{ path: string; bytes: Uint8Array }> = [], lineage: object = {}) {
    this.lineage = lineage;
    for (const e of entries) this.add(e.path, e.bytes);
  }

  /**
   * A new set with this set's files plus `files` (a file at an existing path
   * replaces it), in the same lineage. Its missing-file record starts empty;
   * this set is not changed.
   */
  withFiles(files: Iterable<{ path: string; bytes: Uint8Array }>): FileSet {
    const set = new FileSet(this.entries(), this.lineage);
    set.notes.push(...this.notes);
    for (const f of files) set.add(f.path, f.bytes);
    return set;
  }

  /** Add a file; a second file at the same path replaces the first. */
  add(path: string, bytes: Uint8Array): FileEntry {
    const p = normalisePath(path);
    const entry: FileEntry = { path: p, name: baseName(p), bytes };
    const old = this.byPath.get(p);
    this.byPath.set(p, entry);
    const key = entry.name.toLowerCase();
    const list = (this.byName.get(key) ?? []).filter((e) => e !== old);
    list.push(entry);
    list.sort(compareEntries);
    this.byName.set(key, list);
    return entry;
  }

  /** Every file, sorted by path (case-insensitive, then exact). */
  entries(): FileEntry[] {
    return [...this.byPath.values()].sort((a, b) => {
      const la = a.path.toLowerCase();
      const lb = b.path.toLowerCase();
      if (la !== lb) return la < lb ? -1 : 1;
      return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
    });
  }

  get size(): number {
    return this.byPath.size;
  }

  /** The entry at exactly this path, or null. */
  get(path: string): FileEntry | null {
    return this.byPath.get(normalisePath(path)) ?? null;
  }

  /**
   * Find a file by name, case-insensitively and ignoring any directory or
   * drive in `name`. Prefers a file in the same directory as `nearPath`,
   * then any other match: shortest path first, then alphabetical. Unlike
   * `resolve`, a name that is not found is not recorded.
   */
  find(name: string, nearPath?: string): FileEntry | null {
    const base = baseName(name);
    const matches = base ? this.byName.get(base.toLowerCase()) : undefined;
    if (!matches || matches.length === 0) return null;
    if (nearPath !== undefined) {
      const dir = dirKey(nearPath);
      const beside = matches.find((e) => dirKey(e.path) === dir);
      if (beside) return beside;
    }
    return matches[0];
  }

  /** As `find`, but an unresolved name is recorded (see `missing`). */
  resolve(name: string, nearPath?: string, purpose?: string): FileEntry | null {
    const found = this.find(name, nearPath);
    if (found) return found;
    const base = baseName(name);
    const requestedBy = nearPath === undefined ? null : normalisePath(nearPath);
    const key = `${base.toLowerCase()}\n${requestedBy ?? ""}\n${purpose ?? ""}`;
    if (!this.missingKeys.has(key)) {
      this.missingKeys.add(key);
      const record: MissingFile = { name: base || name, requestedBy };
      if (purpose !== undefined) record.purpose = purpose;
      this.missingList.push(record);
    }
    return null;
  }

  /** Every name that `resolve` could not find, once each, in request order. */
  missing(requestedBy?: string): MissingFile[] {
    if (requestedBy === undefined) return [...this.missingList];
    const p = normalisePath(requestedBy);
    return this.missingList.filter((m) => m.requestedBy === p);
  }

  /** A parser's view of the set, resolving names beside `path`. */
  contextFor(path: string): ParseContext {
    const p = normalisePath(path);
    return {
      path: p,
      resolve: (name, purpose) => this.resolve(name, p, purpose),
      find: (name) => this.find(name, p),
    };
  }
}
