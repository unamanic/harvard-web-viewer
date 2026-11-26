/** Grouping of the opened files for the file list (pure, no React). */

export type FileGroupKind = "show" | "chart" | "other";

export interface FileGroup<T> {
  kind: FileGroupKind;
  label: string;
  files: T[];
}

const GROUP_LABELS: Record<FileGroupKind, string> = {
  show: "Shows",
  chart: "Charts",
  other: "Other files",
};

const ORDER: readonly FileGroupKind[] = ["show", "chart", "other"];

function signatureOf(bytes: Uint8Array | undefined): string {
  if (!bytes || bytes.length < 4) return "";
  return String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
}

/**
 * What kind of file this is for the list: the HG3 signature decides when
 * present (HGB1 show, HGB3 chart), as are the 1.x/2.x signatures
 * (show/SHOW shows, PCOK/Falc charts); else the extension (.SH3, .SHW,
 * .CH3, .CHT).
 */
export function fileGroupKind(name: string, bytes?: Uint8Array): FileGroupKind {
  const signature = signatureOf(bytes);
  if (signature === "HGB1" || signature === "SHOW" || signature === "show") return "show";
  if (signature === "HGB3" || signature === "PCOK" || signature === "Falc") return "chart";
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  if (ext === "sh3" || ext === "shw") return "show";
  if (ext === "ch3" || ext === "cht") return "chart";
  return "other";
}

/** Files grouped as shows, charts, other (in that order; empty groups left out), input order kept within a group. */
export function groupFiles<T extends { name: string; bytes?: Uint8Array }>(files: readonly T[]): FileGroup<T>[] {
  const byKind = new Map<FileGroupKind, T[]>();
  for (const f of files) {
    const kind = fileGroupKind(f.name, f.bytes);
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
