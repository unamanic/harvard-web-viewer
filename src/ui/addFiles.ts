/**
 * "Add missing files" (pure, no React): files the user adds to the set
 * already open are placed beside the file shown, so that its lookups (which
 * prefer the same folder) find them first. A file whose name is already in
 * that folder replaces it.
 */

export interface AddedFile {
  path: string;
  bytes: Uint8Array;
}

/** Base name of a path ("DIR/sub/LOGO.PCX" → "LOGO.PCX"). */
function nameOf(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1];
}

/** Paths for the added files: each beside `currentPath`, under its own name; later duplicates win. */
export function placeAddedFiles(currentPath: string, added: readonly AddedFile[]): AddedFile[] {
  const slash = currentPath.lastIndexOf("/");
  const dir = slash >= 0 ? currentPath.slice(0, slash + 1) : "";
  const byName = new Map<string, AddedFile>();
  for (const f of added) {
    const name = nameOf(f.path);
    if (!name) continue;
    byName.set(name.toLowerCase(), { path: dir + name, bytes: f.bytes });
  }
  return [...byName.values()];
}

/** Files in `missing` (by name, case-insensitive) that `added` provides. */
export function providedNames(missing: readonly { name: string }[], added: readonly { path: string }[]): string[] {
  const names = new Set(added.map((f) => nameOf(f.path).toLowerCase()));
  return missing.filter((m) => names.has(m.name.toLowerCase())).map((m) => m.name);
}

/** "Using LOGO.PCX." / "None of the added files were missing." */
export function addedSummary(provided: readonly string[], addedCount: number): string {
  if (addedCount === 0) return "";
  if (provided.length === 0) return `Added ${addedCount} file${addedCount === 1 ? "" : "s"}; none of them was a missing one.`;
  return `Added ${provided.join(", ")}.`;
}

