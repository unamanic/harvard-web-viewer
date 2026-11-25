/**
 * Harvard Graphics 3 palettes (.PL3, .PC3): parsing, colour-role lookup and
 * the chart palette fallback chain.
 *
 * - File layout: SPEC §6.2 "Palette file" (signature HGA2, document type
 *   0x33 or 0x34, palette body 524 ... 525 holding records 1551 to 1555).
 * - Roles: SPEC §6.2. Every colour in a chart is a role number r; r refers to
 *   palette entry r − 1 and role 0 means "none".
 * - Which palette a chart uses: SPEC §3 "File reference" (404 kind 2; with no
 *   kind 2 reference use HG3.PL3) and SPEC §7.1 (missing, empty or
 *   out-of-range palette falls back to the default palette).
 *
 * The result keeps RGB exactly as stored. A display mode (CGA/EGA/VGA, task
 * 6b) is applied afterwards by mapping the RGB returned by `colorForRole`;
 * the raw 1554/1555 records are kept on the Palette for that purpose.
 */
import { DEFAULT_PALETTE_ENTRIES } from "./defaultPalette";
import { decodeHg3Text } from "./charset";
import {
  DocumentType,
  type LeafRecord,
  type RecordNode,
  TAG_DESCRIPTION,
  TAG_END,
  TAG_VERSION,
  findBlock,
  readContainer,
  readDescription,
} from "./container";
import type { ParseContext } from "../types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Palette record tags (SPEC §6.2). */
export const PaletteTag = {
  /** u16 number of colours (64). */
  Count: 1551,
  /** u16 index, u8 role, u8 red, u8 green, u8 blue. */
  Color: 1552,
  /** u16 index, padded string[16] name. */
  Name: 1553,
  /** 14 bytes, palette options [?]. */
  Options: 1554,
  /** 64 bytes, 16 entries of 4 bytes [?]. */
  SixteenColor: 1555,
} as const;

/** Palette body block (SPEC §3 "Block markers"). */
const TAG_PALETTE_BODY = 524;
/** Document header block (SPEC §3). */
const TAG_HEADER = 500;

/** Number of entries in every known palette (SPEC §6.2). */
export const PALETTE_SIZE = 64;

/**
 * Role byte of every 1552 record in the .PC3 (type 0x34) samples (5 of 5):
 * custom palettes hold plain named colours ("White", "Gray L"), not roles,
 * and have no 1554/1555. Not yet in SPEC §6.2.
 */
export const CUSTOM_PALETTE_ROLE = 0xff;

/** Name of the palette used when a chart names none (SPEC §3). */
export const DEFAULT_PALETTE_NAME = "HG3.PL3";

/**
 * Colour role numbers with fixed meanings (SPEC §6.2 role table). Role r is
 * palette entry r − 1; roles 43 to 64 are extra named colours.
 */
export const ROLE = {
  None: 0,
  Title: 1,
  SubTitl1: 2,
  SubTitl2: 3,
  Text: 4,
  TextHigh: 5,
  TextDim: 6,
  Footnote: 7,
  XLabel: 8,
  Y1Label: 9,
  Y2Label: 10,
  XTitle: 11,
  Y1Title: 12,
  Y2Title: 13,
  Frame: 14,
  /** Page background. */
  FrameBkg: 15,
  Bullet: 16,
  /** Dimmed bullet. */
  BulletDm: 17,
  Lines: 18,
  Shadow: 19,
  Legend: 20,
  Series1: 21,
  Series2: 22,
  Series3: 23,
  Series4: 24,
  Series5: 25,
  Series6: 26,
  GoalY1: 27,
  GoalY2: 28,
  Draw1: 29,
  Draw2: 30,
  Draw3: 31,
  Outlines: 32,
  Range1: 33,
  Range2: 34,
  Range3: 35,
  Range4: 36,
  Range5: 37,
  Range6: 38,
  Range7: 39,
  Range8: 40,
  Range9: 41,
  Range10: 42,
} as const;

export type RoleName = Exclude<keyof typeof ROLE, "None">;

/**
 * Role names by role number (index 0 is role 1), as they appear after the
 * "|" in the entry names of entries 0 to 41 (SPEC §6.2).
 */
export const ROLE_NAMES: readonly RoleName[] = (Object.keys(ROLE) as (keyof typeof ROLE)[])
  .filter((k): k is RoleName => k !== "None")
  .sort((a, b) => ROLE[a] - ROLE[b]);

/** Fixed role name for a role number, or undefined for 0 and 43 upwards. */
export function roleName(role: number): RoleName | undefined {
  return ROLE_NAMES[role - 1];
}

/**
 * Colour role of data series `n` (1-based). Series beyond the sixth reuse
 * Series1 to Series6 in turn (SPEC §6.2): 7 → Series1, 8 → Series2, ...
 */
export function seriesRole(n: number): number {
  const i = (((Math.trunc(n) - 1) % 6) + 6) % 6;
  return ROLE.Series1 + i;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Red, green, blue, each 0 to 255, as stored in record 1552. */
export type RGB = readonly [number, number, number];

export interface PaletteEntry {
  /** Entry index, 0 to 63. Role index + 1 refers to it. */
  index: number;
  /**
   * Role byte stored in record 1552: index + 1 in every .PL3 sample, 0xFF in
   * every .PC3 sample. Lookups use `index`, not this byte.
   */
  role: number;
  /** Full name from record 1553, trailing spaces removed, e.g. "Yel  L|Title". */
  name: string;
  /** Part of the name before "|" (trailing spaces removed), e.g. "Yel  L". */
  description: string;
  /** Part of the name after "|", e.g. "Title"; "" when the name has no "|". */
  roleName: string;
  rgb: RGB;
}

export interface Palette {
  /** 0x33 (.PL3) or 0x34 (.PC3) (SPEC §3 version record). */
  documentType: number;
  /** Document description (tag 400), "" when absent. */
  description: string;
  /** Colour count from record 1551, or null if the record is missing. */
  count: number | null;
  /**
   * Entries that have an RGB value (record 1552), sorted by index, at most
   * one per index. 64 in a well-formed file; may have gaps in a damaged one.
   */
  entries: PaletteEntry[];
  /** Data of record 1554 (14 bytes, meaning unknown), if present. */
  raw1554?: Uint8Array;
  /** Data of record 1555 (16 entries of 4 bytes, meaning unknown), if present. */
  raw1555?: Uint8Array;
  /** Records the parser does not interpret, kept for the hex inspector. */
  unknownRecords: LeafRecord[];
}

/** Thrown when an HG3 file is not a palette (wrong signature kind). */
export class NotPaletteError extends Error {
  constructor(kind: string) {
    super(`not a Harvard Graphics 3 palette (this is a ${kind} file)`);
    this.name = "NotPaletteError";
  }
}

/** Receives a warning message; see `uniqueWarningSink`. */
export type WarningSink = (message: string) => void;

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/** Split "colour description|role" (SPEC §6.2) into its two parts. */
export function splitEntryName(name: string): { description: string; roleName: string } {
  const bar = name.indexOf("|");
  if (bar < 0) return { description: name.trimEnd(), roleName: "" };
  return { description: name.slice(0, bar).trimEnd(), roleName: name.slice(bar + 1).trim() };
}

function makeEntry(index: number, role: number, name: string, rgb: RGB): PaletteEntry {
  const trimmed = name.trimEnd();
  return { index, role, name: trimmed, ...splitEntryName(trimmed), rgb };
}

/** CP437 text up to the first NUL (the rest of a padded string is junk). */
function paddedString(data: Uint8Array): string {
  const nul = data.indexOf(0);
  return decodeHg3Text(nul < 0 ? data : data.subarray(0, nul));
}

const u16le = (d: Uint8Array, at: number): number => d[at] | (d[at + 1] << 8);

/**
 * Parse a .PL3 or .PC3 palette (SPEC §6.2). Throws NotHg3Error for a non-HG3
 * file and NotPaletteError for an HG3 chart or show; everything else is a
 * warning (SPEC §7.1): records of the wrong size, entries with an index or
 * role that disagree, duplicates, and a count that does not match the
 * entries found.
 */
export function parsePalette(bytes: Uint8Array): { palette: Palette; warnings: string[] } {
  const container = readContainer(bytes);
  if (container.kind !== "palette") throw new NotPaletteError(container.kind);
  const warnings = [...container.warnings];
  const { documentType } = container.version;
  if (documentType !== DocumentType.Palette && documentType !== DocumentType.CustomPalette) {
    warnings.push(`palette has document type 0x${documentType.toString(16)}, expected 0x33 or 0x34`);
  }

  const header = findBlock(container.root, TAG_HEADER);
  const descriptionRecord = header?.children.find(
    (n): n is LeafRecord => n.type === "record" && n.tag === TAG_DESCRIPTION,
  );
  const body = findBlock(container.root, TAG_PALETTE_BODY);
  if (!body) warnings.push("no palette body (524); palette records looked for at top level");

  // Flatten the records to read: the body, else everything outside the header.
  const records: LeafRecord[] = [];
  const unknownRecords: LeafRecord[] = [];
  const collect = (nodes: readonly RecordNode[], inBody: boolean): void => {
    for (const n of nodes) {
      if (n.type === "block") {
        if (n.openTag === TAG_HEADER) {
          for (const c of n.children) {
            if (c.type === "record" && c !== descriptionRecord) unknownRecords.push(c);
          }
        } else if (n.openTag === TAG_PALETTE_BODY || !body) {
          collect(n.children, inBody || n.openTag === TAG_PALETTE_BODY);
        }
        continue;
      }
      if (n.tag === TAG_VERSION || n.tag === TAG_END) continue;
      if (inBody || !body) records.push(n);
      else unknownRecords.push(n);
    }
  };
  collect(container.root, false);

  let count: number | null = null;
  let raw1554: Uint8Array | undefined;
  let raw1555: Uint8Array | undefined;
  const names = new Map<number, string>();
  const colors = new Map<number, { role: number; rgb: RGB }>();

  for (const rec of records) {
    const d = rec.data;
    const at = `record ${rec.tag} at offset ${rec.offset}`;
    switch (rec.tag) {
      case PaletteTag.Count:
        if (d.length < 2) {
          warnings.push(`${at} is ${d.length} byte(s), expected 2; ignored`);
          break;
        }
        if (count !== null) warnings.push(`${at}: duplicate colour count; first kept`);
        else count = u16le(d, 0);
        break;
      case PaletteTag.Name: {
        if (d.length < 2) {
          warnings.push(`${at} is ${d.length} byte(s), expected 18; ignored`);
          break;
        }
        if (d.length !== 18) warnings.push(`${at} is ${d.length} byte(s), expected 18`);
        const index = u16le(d, 0);
        if (names.has(index)) warnings.push(`${at}: duplicate name for entry ${index}; first kept`);
        else names.set(index, paddedString(d.subarray(2, 18)));
        break;
      }
      case PaletteTag.Color: {
        if (d.length < 6) {
          warnings.push(`${at} is ${d.length} byte(s), expected 6; ignored`);
          break;
        }
        if (d.length !== 6) warnings.push(`${at} is ${d.length} byte(s), expected 6`);
        const index = u16le(d, 0);
        if (colors.has(index)) {
          warnings.push(`${at}: duplicate colour for entry ${index}; first kept`);
          break;
        }
        const role = d[2];
        const customNoRole = documentType === DocumentType.CustomPalette && role === CUSTOM_PALETTE_ROLE;
        if (role !== index + 1 && !customNoRole) warnings.push(`${at}: entry ${index} has role ${role}, expected ${index + 1}`);
        colors.set(index, { role, rgb: [d[3], d[4], d[5]] });
        break;
      }
      case PaletteTag.Options:
        if (raw1554) warnings.push(`${at}: duplicate; first kept`);
        else raw1554 = d;
        break;
      case PaletteTag.SixteenColor:
        if (raw1555) warnings.push(`${at}: duplicate; first kept`);
        else raw1555 = d;
        break;
      default:
        unknownRecords.push(rec);
    }
  }

  const limit = count ?? PALETTE_SIZE;
  const entries: PaletteEntry[] = [];
  for (const [index, { role, rgb }] of colors) {
    if (index >= limit) warnings.push(`entry ${index} is outside the colour count ${limit}`);
    const name = names.get(index);
    if (name === undefined) warnings.push(`entry ${index} has a colour but no name (1553)`);
    entries.push(makeEntry(index, role, name ?? "", rgb));
  }
  for (const index of names.keys()) {
    if (!colors.has(index)) warnings.push(`entry ${index} has a name but no colour (1552); entry dropped`);
  }
  entries.sort((a, b) => a.index - b.index);

  if (count === null) warnings.push("no colour count (1551)");
  else if (count !== entries.length) warnings.push(`colour count is ${count} but ${entries.length} entries found`);
  if (entries.length === 0) warnings.push("palette has no colours");

  return {
    palette: {
      documentType,
      description: descriptionRecord ? readDescription(descriptionRecord.data) : "",
      count,
      entries,
      ...(raw1554 && { raw1554 }),
      ...(raw1555 && { raw1555 }),
      unknownRecords,
    },
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Built-in default palette
// ---------------------------------------------------------------------------

/**
 * The built-in copy of HG3.PL3 (generated into defaultPalette.ts), used when
 * no palette file is available (SPEC §7.1).
 */
export const DEFAULT_PALETTE: Palette = {
  documentType: DocumentType.Palette,
  description: "built-in copy of HG3.PL3",
  count: DEFAULT_PALETTE_ENTRIES.length,
  entries: DEFAULT_PALETTE_ENTRIES.map((e) => makeEntry(e.index, e.role, e.name, e.rgb)),
  unknownRecords: [],
};

// ---------------------------------------------------------------------------
// Role lookup
// ---------------------------------------------------------------------------

/** The entry with `index`, or undefined. */
export function entryAt(palette: Palette, index: number): PaletteEntry | undefined {
  const guess = palette.entries[index];
  if (guess?.index === index) return guess;
  return palette.entries.find((e) => e.index === index);
}

/**
 * RGB for colour role `role` (SPEC §6.2): role 0 is "none" (null); role r is
 * entry r − 1. A role with no entry in `palette` (out of range, or missing
 * from a damaged file) falls back to the default palette (SPEC §7.1) and is
 * reported to `warn`. A role the default palette lacks too (above 64) gets
 * the default Text colour [I: the original's behaviour is unknown].
 *
 * Messages depend only on the palette size and the role, so a caller can
 * deduplicate them with `uniqueWarningSink`.
 */
export function colorForRole(palette: Palette, role: number, warn?: WarningSink): RGB | null {
  if (role === ROLE.None) return null;
  const valid = Number.isInteger(role) && role > 0;
  const own = valid ? entryAt(palette, role - 1) : undefined;
  if (own) return own.rgb;
  const fallback = valid ? entryAt(DEFAULT_PALETTE, role - 1) : undefined;
  if (fallback) {
    warn?.(`colour role ${role} is not in the palette (${palette.entries.length} colours); default palette used`);
    return fallback.rgb;
  }
  warn?.(`colour role ${role} is out of range; default Text colour used`);
  return entryAt(DEFAULT_PALETTE, ROLE.Text - 1)?.rgb ?? [255, 255, 255];
}

/** CSS colour "#rrggbb" for an RGB triple (values clamped to 0..255). */
export function rgbToCss(rgb: RGB): string {
  return "#" + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
}

/**
 * A WarningSink that appends each distinct message to `target` once, e.g.
 *
 *   const warn = uniqueWarningSink(doc.warnings);
 *   colorForRole(palette, role, warn);
 */
export function uniqueWarningSink(target: string[]): WarningSink {
  const seen = new Set(target);
  return (message) => {
    if (seen.has(message)) return;
    seen.add(message);
    target.push(message);
  };
}

// ---------------------------------------------------------------------------
// Chart palette resolution
// ---------------------------------------------------------------------------

export type PaletteSource = "file" | "HG3.PL3" | "built-in";

export interface ResolvedPalette {
  palette: Palette;
  /**
   * Where the palette came from: the file the chart names, HG3.PL3 from the
   * file set, or the built-in copy of HG3.PL3.
   */
  source: PaletteSource;
  /** Path inside the file set of the palette used; absent for built-in. */
  path?: string;
  warnings: string[];
}

/**
 * Pick a chart's palette (SPEC §3 "File reference", §7.1):
 *
 * 1. The file named by the chart's 404 kind 2 reference (`paletteRefName`),
 *    found through `ctx.resolve(name, "palette")`.
 * 2. If there is no reference, or the named file is missing, unreadable or
 *    empty: HG3.PL3 from the file set.
 * 3. Otherwise the built-in copy of HG3.PL3.
 *
 * Warnings name the missing or bad file; the parse warnings of the palette
 * used are included, prefixed with its name.
 */
export function resolveChartPalette(paletteRefName: string | null, ctx?: ParseContext): ResolvedPalette {
  const warnings: string[] = [];

  const tryLoad = (name: string): { palette: Palette; path: string } | null => {
    const file = ctx?.resolve(name, "palette") ?? null;
    if (!file) return null;
    try {
      const parsed = parsePalette(file.bytes);
      if (parsed.palette.entries.length === 0) {
        warnings.push(`palette ${file.name} is empty`);
        return null;
      }
      warnings.push(...parsed.warnings.map((w) => `${file.name}: ${w}`));
      return { palette: parsed.palette, path: file.path };
    } catch (e) {
      warnings.push(`palette ${file.name} could not be read: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  };

  const name = paletteRefName?.trim() || null;
  const namesDefault = name !== null && name.toUpperCase() === DEFAULT_PALETTE_NAME;

  if (name !== null) {
    const before = warnings.length;
    const found = tryLoad(name);
    if (found) return { ...found, source: namesDefault ? "HG3.PL3" : "file", warnings };
    if (warnings.length === before) warnings.push(`palette file ${name} not found`);
  }

  if (!namesDefault) {
    const found = tryLoad(DEFAULT_PALETTE_NAME);
    if (found) {
      if (name !== null) warnings.push(`using ${DEFAULT_PALETTE_NAME} instead of ${name}`);
      return { ...found, source: "HG3.PL3", warnings };
    }
  }

  if (name !== null) warnings.push(`using the built-in copy of ${DEFAULT_PALETTE_NAME} instead of ${name}`);
  return { palette: DEFAULT_PALETTE, source: "built-in", warnings };
}
