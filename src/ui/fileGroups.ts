/** Grouping of the opened files for the file list (pure, no React). */

import { type FileKind, fileKind } from "../files/fileKind";

export interface FileGroup<T> {
  kind: FileKind;
  label: string;
  files: T[];
}

const GROUP_LABELS: Record<FileKind, string> = {
  show: "Shows",
  chart: "Charts",
  other: "Other files",
};

const ORDER: readonly FileKind[] = ["show", "chart", "other"];

/** Files grouped as shows, charts, other (in that order; empty groups left out), input order kept within a group. */
export function groupFiles<T extends { name: string; bytes?: Uint8Array }>(files: readonly T[]): FileGroup<T>[] {
  const byKind = new Map<FileKind, T[]>();
  for (const f of files) {
    const kind = fileKind(f.name, f.bytes);
    const list = byKind.get(kind) ?? [];
    list.push(f);
    byKind.set(kind, list);
  }
  return ORDER.filter((k) => byKind.has(k)).map((kind) => ({
    kind,
    label: GROUP_LABELS[kind],
    files: byKind.get(kind)!,
  }));
}
