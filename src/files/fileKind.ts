/** Whether a file is a show, a chart or something else (pure, no React). */

export type FileKind = "show" | "chart" | "other";

function signatureOf(bytes: Uint8Array | undefined): string {
  if (!bytes || bytes.length < 4) return "";
  return String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
}

/**
 * The HG3 signature decides when present (HGB1 show, HGB3 chart), as do
 * the 1.x/2.x signatures (show/SHOW shows, PCOK/Falc charts); else the
 * extension (.SH3, .SHW, .CH3, .CHT).
 */
export function fileKind(name: string, bytes?: Uint8Array): FileKind {
  const signature = signatureOf(bytes);
  if (signature === "HGB1" || signature === "SHOW" || signature === "show") return "show";
  if (signature === "HGB3" || signature === "PCOK" || signature === "Falc") return "chart";
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  if (ext === "sh3" || ext === "shw") return "show";
  if (ext === "ch3" || ext === "cht") return "chart";
  return "other";
}
