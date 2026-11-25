/**
 * Pick the file to show first from a set: the first show (.SH3), else the
 * first chart (.CH3), else the first file a parser recognises, else the
 * first file (still useful in the hex inspector). `entries` should already
 * be in display order. Returns null for an empty set.
 */
export function choosePrimary<T extends { name: string }>(
  entries: readonly T[],
  isRecognised: (entry: T) => boolean,
): T | null {
  const byExt = (ext: string) => entries.find((e) => e.name.toLowerCase().endsWith(ext));
  return byExt(".sh3") ?? byExt(".ch3") ?? entries.find(isRecognised) ?? entries[0] ?? null;
}
