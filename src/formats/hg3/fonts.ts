/**
 * Font resolution (task 7): font key → display name, weight, italic, the
 * original font file if the user's files include it, and a look-alike CSS
 * stack for when they don't.
 *
 * - Font key and font index: SPEC §2. The index comes from HG3.FGF in the
 *   file set (fgf.ts); without it, the built-in table BUILT_IN_FONTS.
 * - Missing font → substitute: SPEC §6.4, §7.1.
 *
 * `ResolvedFont.file` is the .SPD (task 7b) or .FN3 (task 7c) file when it
 * was found. Which glyphs actually draw a font (original, our clone, or the
 * `cssFamily` look-alike as a last resort) is decided by
 * scene/textFaces.ts (task 7f).
 */
import { type ParseContext, type ResolvedFile, findFile } from "../types";
import { BUILT_IN_FONTS, type FgfEntry, parseFgf } from "./fgf";
import { type FontKey, FontSource, fontKeyString } from "./fontKey";

/** Name of the font index file (SPEC §2). */
export const FONT_INDEX_NAME = "HG3.FGF";

export type FontKind = "speedo" | "stroke" | "unknown";

export interface ResolvedFont {
  key: FontKey;
  /** e.g. "Swiss 721"; "" when the key is in no index. */
  family: string;
  /** e.g. "Roman", "Bold Italic"; "" when unknown. */
  style: string;
  /** CSS font-weight from the style word (decodeStyleWord). */
  weight: number;
  /** Style word bit 0. */
  italic: boolean;
  kind: FontKind;
  /** Font file named by the index ("" when unknown). */
  fileName: string;
  /** The original font file when present in the file set; null → use cssFamily. */
  file: ResolvedFile | null;
  /** Look-alike CSS font-family stack. */
  cssFamily: string;
  /** CP437 code → the font's character id, from HG3.FGF; absent for the built-in table. */
  charMap?: Uint16Array;
}

// ---------------------------------------------------------------------------
// Style word (SPEC §2)
// ---------------------------------------------------------------------------

/**
 * CSS weight for the style word's low byte, italic bit masked off (SPEC §2,
 * meanings [I]). In the sample HG3.FGF the names agree with this table
 * except "HG Gothic|Bold", which has 0x78 (read here as medium).
 */
export const STYLE_WEIGHTS: ReadonlyMap<number, number> = new Map([
  [0x28, 100], // thin
  [0x48, 300], // light
  [0x58, 700], // bold (stroke fonts)
  [0x68, 400], // regular
  [0x78, 500], // medium
  [0xa8, 700], // bold
]);

/** Weight used for a low byte not in STYLE_WEIGHTS. */
export const DEFAULT_FONT_WEIGHT = 400;

/** Style word high byte by font kind (SPEC §2 [I]). */
const STYLE_HIGH_SPEEDO = 0x42;
const STYLE_HIGH_STROKE = 0x58;

/** Decode a style word: weight (low byte), italic (bit 0), kind (high byte). [I] */
export function decodeStyleWord(style: number): { weight: number; italic: boolean; kind: FontKind } {
  const low = style & 0xfe;
  const high = (style >> 8) & 0xff;
  const kind: FontKind = high === STYLE_HIGH_SPEEDO ? "speedo" : high === STYLE_HIGH_STROKE ? "stroke" : "unknown";
  return { weight: STYLE_WEIGHTS.get(low) ?? DEFAULT_FONT_WEIGHT, italic: (style & 1) !== 0, kind };
}

/** Kind from the key's source (SPEC §2 [C]), falling back to the style word's high byte. */
export function fontKind(key: FontKey): FontKind {
  if (key.source === FontSource.Speedo) return "speedo";
  if (key.source === FontSource.Stroke) return "stroke";
  return decodeStyleWord(key.style).kind;
}

// ---------------------------------------------------------------------------
// Look-alikes (SPEC §6.4)
// ---------------------------------------------------------------------------

export interface LookAlike {
  /** Lower-case substring of the index family name, e.g. "swiss 721". */
  match: string;
  /** CSS font-family stack. */
  css: string;
}

/** Stack for a family that matches nothing. */
export const DEFAULT_CSS_FAMILY = "Helvetica, Arial, 'Liberation Sans', sans-serif";

/**
 * Family name → look-alike stack, first match wins (SPEC §6.4 [I]). The last
 * resort: original fonts and our clones (src/fonts) come first, see
 * scene/textFaces.ts. The HG stroke fonts use the Hershey-based stroke
 * clones; these stacks only apply to keys without a clone.
 */
export const LOOK_ALIKES: readonly LookAlike[] = [
  // HG stroke fonts first: "hg roman" must not fall through to a generic match.
  { match: "hg roman", css: "'Times New Roman', Times, 'Liberation Serif', serif" },
  { match: "hg sans", css: "Helvetica, Arial, 'Liberation Sans', sans-serif" },
  { match: "hg script", css: "'Segoe Script', 'Brush Script MT', cursive" },
  { match: "hg gothic", css: "'Old English Text MT', 'UnifrakturMaguntia', serif" },
  // Bitstream Speedo faces.
  { match: "swiss 721", css: "Helvetica, Arial, 'Liberation Sans', sans-serif" },
  { match: "dutch 801", css: "'Times New Roman', Times, 'Liberation Serif', serif" },
  { match: "geo slab 712", css: "Rockwell, 'Roboto Slab', serif" },
  { match: "monospace 821", css: "'DejaVu Sans Mono', Menlo, Consolas, monospace" },
];

/** Look-alike stack for an index family name (case-insensitive substring). */
export function cssFamilyFor(family: string, table: readonly LookAlike[] = LOOK_ALIKES): string {
  const f = family.toLowerCase();
  for (const l of table) if (f.includes(l.match.toLowerCase())) return l.css;
  return DEFAULT_CSS_FAMILY;
}

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

export interface FontResolverOptions {
  /** Replaces LOOK_ALIKES (e.g. with project font clones, task 7d). */
  lookAlikes?: readonly LookAlike[];
}

export interface FontResolver {
  /** Resolve a key; cached per key. */
  resolve(key: FontKey): ResolvedFont;
  /** Where the index came from: HG3.FGF from the file set, or the built-in table (reading it loads the index). */
  readonly indexSource: "file" | "built-in";
  /** Fonts resolved so far, in first-use order (for "from files / substituted" lists). */
  used(): ResolvedFont[];
  /** Unique warnings so far: index problems, unknown keys, missing font files. */
  warnings(): string[];
}

interface IndexEntry {
  family: string;
  style: string;
  fileName: string;
  charMap?: Uint16Array;
}

/**
 * Create a resolver. Nothing is asked of `ctx` until the first `resolve`:
 * then HG3.FGF once, and each font file only when a key that uses it is
 * resolved, so the missing-file list names only fonts that matter.
 *
 * HG3.FGF is first looked up without recording it as missing: the built-in
 * table is a copy of the original index. It is recorded as missing only
 * when it would have made a difference: a key the built-in table lacks
 * (a font installed later), or an original .SPD file that was found but
 * cannot be used without the index's character map.
 */
export function createFontResolver(ctx?: ParseContext, options: FontResolverOptions = {}): FontResolver {
  const lookAlikes = options.lookAlikes ?? LOOK_ALIKES;
  const warnings = new Set<string>();
  const cache = new Map<string, ResolvedFont>();
  const files = new Map<string, ResolvedFile | null>();
  let index: Map<string, IndexEntry> | null = null;
  let indexSource: "file" | "built-in" = "built-in";
  /** Without HG3.FGF from the file set: list it as missing (once) because it matters. */
  const indexNeeded = () => {
    if (indexSource === "built-in") ctx?.resolve(FONT_INDEX_NAME, "font index");
  };

  const loadIndex = (): Map<string, IndexEntry> => {
    if (index) return index;
    index = new Map();
    const file = findFile(ctx, FONT_INDEX_NAME, "font index");
    let entries: FgfEntry[] | null = null;
    if (file) {
      try {
        const parsed = parseFgf(file.bytes);
        for (const w of parsed.warnings) warnings.add(`${file.name}: ${w}`);
        entries = parsed.entries;
        indexSource = "file";
      } catch (e) {
        warnings.add(`${file.name} could not be read (${e instanceof Error ? e.message : String(e)}); using built-in font table`);
      }
    } else if (ctx) {
      warnings.add(`${FONT_INDEX_NAME} not found; using built-in font table`);
    }
    if (entries) {
      for (const e of entries) {
        const k = fontKeyString(e.key);
        if (index.has(k)) warnings.add(`${FONT_INDEX_NAME}: duplicate entry for font ${k}; first kept`);
        else index.set(k, { family: e.family, style: e.style, fileName: e.fileName, charMap: e.charMap });
      }
    } else {
      for (const b of BUILT_IN_FONTS) index.set(fontKeyString(b.key), { family: b.family, style: b.style, fileName: b.fileName });
    }
    return index;
  };

  const fontFile = (fileName: string): ResolvedFile | null => {
    const k = fileName.toUpperCase();
    if (!files.has(k)) files.set(k, ctx?.resolve(fileName, "font") ?? null);
    return files.get(k) ?? null;
  };

  const resolve = (key: FontKey): ResolvedFont => {
    const k = fontKeyString(key);
    const cached = cache.get(k);
    if (cached) return cached;

    const entry = loadIndex().get(k);
    const { weight, italic } = decodeStyleWord(key.style);
    const kind = fontKind(key);
    const family = entry?.family ?? "";
    const style = entry?.style ?? "";
    const fileName = entry?.fileName ?? "";
    const cssFamily = cssFamilyFor(family, lookAlikes);
    const label = family ? `${family} ${style}`.trim() : `font ${k}`;

    // What substitutes (clone or CSS look-alike) is reported by scene/textFaces.ts.
    if (!entry) {
      warnings.add(`font ${k} is not in the font index; using a substitute`);
      indexNeeded();
    }
    const file = fileName ? fontFile(fileName) : null;
    if (file && /\.spd$/i.test(file.name)) indexNeeded();
    if (fileName && !file && ctx) warnings.add(`font file ${fileName} (${label}) not found; using a substitute`);

    const font: ResolvedFont = { key, family, style, weight, italic, kind, fileName, file, cssFamily };
    if (entry?.charMap) font.charMap = entry.charMap;
    cache.set(k, font);
    return font;
  };

  return {
    resolve,
    get indexSource() {
      loadIndex();
      return indexSource;
    },
    used: () => [...cache.values()],
    warnings: () => [...warnings],
  };
}
