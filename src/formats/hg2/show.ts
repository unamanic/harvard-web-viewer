/**
 * Harvard Graphics 1.0 and 2.x slide show files (.SHW), docs/SPEC-HG1-HG2.md §5.
 *
 * A show only names its slides: the charts (and 2.x bitmaps and nested
 * shows) are separate files beside it. Both layouts keep a table of slots
 * (one per file) and a separate play order that lists slot numbers, so
 * moving a slide rewrites only the order list.
 *
 * 2.x (`SHOW`, 8192 bytes; decoded from one-setting 2.30 saves, 2.10 and
 * 2.12 use the same layout):
 *   0  "SHOW"   4 u16 slide count   6 u16 16 (unknown)
 *   8  pstring show description (41-byte field)
 *   50 u8 default minutes, 51 u8 default seconds (ff ff: none)
 *   52 default draw effect, 53 its direction, 54 default erase, 55 its direction
 *   56 u16[90] play order: 1-based slot numbers
 *   236 + 88*(slot-1): slot
 *      0 pstring 8.3 file name (13), 14 u8 class, 15 u8 subtype,
 *      16 pstring description, 60 u8 minutes, 61 u8 seconds (ff ff: wait
 *      for a key), 62 draw effect, 63 direction, 64 erase effect,
 *      65 direction, 68 u8[10] HyperShow keys, 78 u8[10] their "Go To"
 *      play positions.
 *
 * 1.0 (`show`; decoded from the shipped sample and the story show only):
 *   0 "show"  4 u16 slide count  6 u16[49] play order
 *   104 + 60*(slot-1): slot: 0 pstring file name (13), 14 class,
 *      15 subtype, 16 pstring description. No times, effects or keys.
 */
import { Bytes, hasSignature } from "./bytes";

export const SHOW_2X = "SHOW";
export const SHOW_1X = "show";

/** Effect codes of the 2.x ScreenShow Effects screen, in its F6 list order (1-based; 0 = blank). */
export const EFFECT_NAMES = [
  "replace",
  "overlay",
  "wipe",
  "scroll",
  "fade",
  "weave",
  "open",
  "close",
  "blinds",
  "iris",
  "rain",
] as const;
export type ClassicEffectName = (typeof EFFECT_NAMES)[number];

/** Direction codes of the same screen (1-based; 0 = blank). */
export const DIRECTION_NAMES = ["left", "right", "up", "down", "in", "out"] as const;
export type ClassicDirectionName = (typeof DIRECTION_NAMES)[number];

export interface ClassicEffect {
  effect: ClassicEffectName;
  direction: ClassicDirectionName | null;
}

export interface HyperShowKey {
  /** The character typed in the Key column, as stored (case kept). */
  key: string;
  /** "Go To": a play position, 1-based (the program renumbers it when slides move). */
  goTo: number;
}

export interface ClassicShowSlide {
  /** Play position, 1-based. */
  position: number;
  /** Slot number the play order names, 1-based. */
  slot: number;
  fileName: string;
  /** Class and subtype bytes as the program cached them (see `slideFileKind`). */
  classCode: number;
  subtype: number;
  description: string;
  /** Seconds on screen, or null when the time is blank (wait for a key, or the show's default). */
  displaySeconds: number | null;
  draw: ClassicEffect | null;
  erase: ClassicEffect | null;
  keys: HyperShowKey[];
}

export interface ClassicShow {
  version: "1.0" | "2.x";
  description: string;
  /** Show-wide defaults (2.x "Default" row), used where a slide leaves a field blank. */
  defaultSeconds: number | null;
  defaultDraw: ClassicEffect | null;
  defaultErase: ClassicEffect | null;
  /** Slides in play order. */
  slides: ClassicShowSlide[];
}

/** The kind of file a slot names: from the extension first, then the class byte. */
export type SlideFileKind = "chart" | "show" | "bitmap" | "template";

export function slideFileKind(slide: Pick<ClassicShowSlide, "fileName" | "classCode" | "subtype">): SlideFileKind {
  const ext = slide.fileName.replace(/^.*\./, "").toUpperCase();
  if (ext === "SHW") return "show";
  if (ext === "PCX") return "bitmap";
  if (ext === "TPL") return "template";
  if (ext === "CHT") return "chart";
  if (slide.classCode === 0 && slide.subtype === 1) return "show";
  if (slide.classCode === 0 && slide.subtype === 3) return "bitmap";
  if (slide.classCode === 0 && slide.subtype === 0) return "template";
  return "chart";
}

export function isClassicShow(bytes: Uint8Array): boolean {
  return hasSignature(bytes, SHOW_2X) || hasSignature(bytes, SHOW_1X);
}

interface Layout {
  version: "1.0" | "2.x";
  orderOffset: number;
  orderLength: number;
  slotOffset: number;
  slotSize: number;
}

const LAYOUT_2X: Layout = { version: "2.x", orderOffset: 56, orderLength: 90, slotOffset: 236, slotSize: 88 };
const LAYOUT_1X: Layout = { version: "1.0", orderOffset: 6, orderLength: 49, slotOffset: 104, slotSize: 60 };

function time(b: Bytes, offset: number): number | null {
  const minutes = b.u8(offset);
  const seconds = b.u8(offset + 1);
  if (minutes === 0xff && seconds === 0xff) return null;
  return minutes * 60 + seconds;
}

function effect(b: Bytes, offset: number, where: string, warnings: string[]): ClassicEffect | null {
  const code = b.u8(offset);
  if (code === 0) return null;
  const name = EFFECT_NAMES[code - 1];
  if (!name) {
    warnings.push(`${where}: effect code ${code} is not known; drawn with Replace`);
    return { effect: "replace", direction: null };
  }
  const dir = b.u8(offset + 1);
  return { effect: name, direction: DIRECTION_NAMES[dir - 1] ?? null };
}

function hyperKeys(b: Bytes, slotStart: number, where: string, warnings: string[]): HyperShowKey[] {
  const out: HyperShowKey[] = [];
  for (let k = 0; k < 10; k++) {
    const char = b.u8(slotStart + 68 + k);
    const goTo = b.u8(slotStart + 78 + k);
    if (char === 0 || goTo === 0) continue;
    if (char < 0x20 || char >= 0x7f) {
      warnings.push(`${where}: HyperShow button ${k + 1} has key code ${char}, which is not understood; ignored`);
      continue;
    }
    out.push({ key: String.fromCharCode(char), goTo });
  }
  return out;
}

/** Read a 1.0 or 2.x show. Throws if the signature is neither. */
export function readClassicShow(bytes: Uint8Array, warnings: string[]): ClassicShow {
  let layout: Layout;
  if (hasSignature(bytes, SHOW_2X)) layout = LAYOUT_2X;
  else if (hasSignature(bytes, SHOW_1X)) layout = LAYOUT_1X;
  else throw new Error("not a Harvard Graphics 1.x or 2.x show (it does not start with show or SHOW).");
  const b = new Bytes(bytes);
  const is2x = layout.version === "2.x";

  let count = b.u16(4);
  if (count > layout.orderLength) {
    warnings.push(`The show says it has ${count} slides; only ${layout.orderLength} fit, so the rest are ignored.`);
    count = layout.orderLength;
  }

  const slides: ClassicShowSlide[] = [];
  for (let position = 1; position <= count; position++) {
    const slot = b.u16(layout.orderOffset + 2 * (position - 1));
    const where = `Slide ${position}`;
    if (slot < 1 || slot > layout.orderLength) {
      warnings.push(`${where}: the play order names slot ${slot}, which does not exist; skipped`);
      continue;
    }
    const start = layout.slotOffset + layout.slotSize * (slot - 1);
    if (start + layout.slotSize > bytes.length) {
      warnings.push(`${where}: slot ${slot} is past the end of the file; skipped`);
      continue;
    }
    const fileName = b.pstring(start, 13).replace(/\s+\./, ".").trim();
    if (!fileName) {
      warnings.push(`${where}: slot ${slot} names no file; skipped`);
      continue;
    }
    slides.push({
      position,
      slot,
      fileName,
      classCode: b.u8(start + 14),
      subtype: b.u8(start + 15),
      description: b.pstring(start + 16, 41).trim(),
      displaySeconds: is2x ? time(b, start + 60) : null,
      draw: is2x ? effect(b, start + 62, where, warnings) : null,
      erase: is2x ? effect(b, start + 64, where, warnings) : null,
      keys: is2x ? hyperKeys(b, start, where, warnings) : [],
    });
  }

  return {
    version: layout.version,
    description: is2x ? b.pstring(8, 41).trim() : "",
    defaultSeconds: is2x ? time(b, 50) : null,
    defaultDraw: is2x ? effect(b, 52, "Default row", warnings) : null,
    defaultErase: is2x ? effect(b, 54, "Default row", warnings) : null,
    slides,
  };
}
