/**
 * The "things to know" notice (pure, no React): the diagnostics in plain
 * language, short. Missing files come first, one sentence each; warnings
 * that only repeat a missing file are dropped; the font report is left out
 * (the Fonts row shows it); technical decoding notes are counted in one
 * line (as are notes about built-in copies, which are the originals). The
 * full list stays reachable ("Show all": DiagnosticsPanel).
 */
import type { MissingFile } from "../files/FileSet";
import type { Diagnostics } from "./diagnostics";
import { isFontReport } from "./fileFacts";

/** What happens without the file, by the purpose the parser gave. */
const CONSEQUENCE: Record<string, (name: string) => string> = {
  bitmap: (n) => `Bitmap ${n} was not provided, so it is not drawn.`,
  font: (n) => `Font file ${n} was not provided, so a look-alike font is used.`,
  "font index": (n) => `${n} was not provided, so a built-in font table is used.`,
  palette: (n) => `Palette ${n} was not provided, so other colours are used.`,
  slide: (n) => `Chart ${n} was not provided, so its slide shows a placeholder.`,
  "nested show": (n) => `Show ${n} was not provided, so it cannot be played.`,
  "embedded chart": (n) => `Chart ${n} was not provided, so it is not drawn.`,
  "button chart": (n) => `Button chart ${n} was not provided, so its buttons are not drawn.`,
  sound: (n) => `Sound ${n} was not provided, so it is not played.`,
};

/** One plain sentence for a missing file. */
export function missingSentence(m: MissingFile): string {
  const say = m.purpose ? CONSEQUENCE[m.purpose] : undefined;
  if (say) return say(m.name);
  return `${m.name}${m.purpose ? ` (${m.purpose})` : ""} was not provided.`;
}

/** "CHART.CH3: text" → "text" (slide warnings are prefixed with the chart's name). */
function stripFilePrefix(w: string): string {
  return w.replace(/^[^\s:]+\.[A-Za-z0-9]{1,4}: /, "");
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** The notice's items, most useful first. */
export function noticeItems(d: Pick<Diagnostics, "missing" | "documentWarnings" | "slideWarnings">): string[] {
  const items = d.missing.map(missingSentence);
  const missingNames = d.missing.map((m) => m.name.toLowerCase());
  const plain: string[] = [];
  const technicalNotes = new Set<string>();
  for (const raw of [...d.documentWarnings, ...d.slideWarnings]) {
    if (isFontReport(raw)) continue;
    const w = stripFilePrefix(raw);
    const lower = w.toLowerCase();
    if (missingNames.some((n) => lower.includes(n))) continue;
    // Something the reader sees is missing or replaced; other notes (e.g. a
    // built-in copy used, which is the original) are only counted.
    if (/not drawn|substitute|could not|cannot/.test(lower)) {
      const sentence = capitalise(w.replace(/;\s*/g, ", ")) + (w.endsWith(".") ? "" : ".");
      if (!plain.includes(sentence)) plain.push(sentence);
    } else technicalNotes.add(w);
  }
  items.push(...plain);
  const technical = technicalNotes.size;
  if (technical > 0) {
    items.push(
      technical === 1
        ? "1 small problem in the file was worked around."
        : `${technical} small problems in the file were worked around.`,
    );
  }
  return items;
}

/** "1 thing to know", "3 things to know". */
export function noticeTitle(count: number): string {
  return `${count} thing${count === 1 ? "" : "s"} to know`;
}
