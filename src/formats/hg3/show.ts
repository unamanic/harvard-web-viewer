/**
 * Harvard Graphics 3 show parsing (SPEC §4.1 to 4.6, errors per §7.1).
 *
 * A show (.SH3, signature HGB1, document type 0x2E) is a header block
 * (500, 400, 501) and a show body (520 ... 521). The body holds four settings
 * records (708, 710, 712, 714) and then one group per slide: a 702 slide
 * entry followed by optional 404 kind 20 (the slide's file), 704 (key table)
 * and 706 (button table) records, up to the next 702.
 *
 * This module only reads the structure; it does not resolve files or play
 * anything. Unknown records and the 702 bytes whose meaning is not known are
 * kept raw. Fields marked [I] are tentative readings from SPEC §4.2. The
 * transition and timing bytes (702 offsets 5 to 12 and 14, 708 byte 2) were
 * decoded from test shows saved by Harvard Graphics 3.05, one setting
 * changed at a time.
 */
import { ByteReader } from "../ByteReader";
import {
  type Container,
  DocumentType,
  FileReferenceKind,
  type LeafRecord,
  type RecordNode,
  TAG_DESCRIPTION,
  TAG_FILE_REFERENCE,
  documentTypeName,
  findBlock,
  readDescription,
  readFileReference,
} from "./container";
import { decodeHg3Text } from "../charset";
import { STYLE_ENTRY_LENGTH, type StyleEntry, readStyleTable } from "./text";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Show record tags (SPEC §4.1). */
export const ShowTag = {
  Settings708: 708,
  Settings710: 710,
  Settings712: 712,
  Settings714: 714,
  SlideEntry: 702,
  KeyTable: 704,
  ButtonTable: 706,
} as const;

const SETTINGS_TAGS: readonly number[] = [708, 710, 712, 714];

/** Expected settings record sizes (SPEC §4.1); others are kept with a warning. */
const SETTINGS_LENGTHS: ReadonlyMap<number, number> = new Map([
  [708, 3],
  [710, 1941],
  [712, 52],
  [714, 2],
]);

/** Bytes before the style entries in 712 (SPEC §4.1). */
const SETTINGS_712_PREFIX = 4;

/** Fixed part of a 702 slide entry; the description string starts here (SPEC §4.2). */
export const SLIDE_ENTRY_FIXED_LENGTH = 102;
/** Bytes per 704 key table entry (SPEC §4.3). */
export const KEY_ENTRY_LENGTH = 4;
/** Bytes per 706 button table entry (SPEC §4.4). */
export const BUTTON_ENTRY_LENGTH = 14;
/** Length of the padded button name in a 706 entry (SPEC §4.4). */
const BUTTON_NAME_LENGTH = 13;

/** Slide kinds that are not chart document types (SPEC §4.2). */
export const SlideKind = {
  Show: 0x2e,
  Empty: 0x2d,
  Sound: 0x09,
  Midi: 0x0a,
} as const;

/** Chart document types allowed as slide kinds (SPEC §4.2). */
const CHART_KINDS: readonly number[] = [
  DocumentType.XY,
  DocumentType.Pie,
  DocumentType.Organization,
  DocumentType.Title,
  DocumentType.Bullet,
  DocumentType.Table,
  DocumentType.Drawing,
];

/** Special destination bytes (SPEC §4.6) [I]. */
export const DestinationByte = {
  /** No destination: slide 0 is the show itself (SPEC §4.6) [I]. */
  None: 0x00,
  LastView: 0xf3,
  Next: 0xf4,
  Previous: 0xf5,
  Edit: 0xf6,
  EditClear: 0xf7,
  Top: 0xf8,
  /** Named "home" [?]; treated as Top until confirmed. */
  Home1: 0x96,
  Home2: 0x97,
} as const;

/**
 * Effect codes of 702 offsets 5 (Draw) and 8 (Erase), in the order of the
 * show editor's list; 0 is blank (not set). Keep is offered only for Erase.
 */
export const EFFECT_CODES: readonly (Hg3Effect | null)[] = [
  null,
  "replace",
  "overlay",
  "wipe",
  "scroll",
  "fade",
  "open",
  "close",
  "blinds",
  "iris",
  "keep",
];
/** Direction codes of 702 offsets 6 (Draw) and 9 (Erase); 0 is blank. */
export const DIRECTION_CODES: readonly (Hg3Direction | null)[] = [null, "left", "right", "up", "down", "in", "out"];
/** Speed codes of 702 offsets 7 (Draw) and 10 (Erase); 0 is blank. */
export const SPEED_CODES: readonly (Hg3Speed | null)[] = [null, "slow", "medium", "fast"];
/** 702 offset 14 value for "no display time": wait for a key or click. */
export const DISPLAY_TIME_WAIT = 0xffff;
/** 708 byte 2 values for HyperShow automatic recalculation. */
export const RecalculationByte = { Yes: 1, No: 2 } as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Effects of the show editor's Draw and Erase lists. */
export type Hg3Effect =
  | "replace"
  | "overlay"
  | "wipe"
  | "scroll"
  | "fade"
  | "open"
  | "close"
  | "blinds"
  | "iris"
  | "keep";
export type Hg3Direction = "left" | "right" | "up" | "down" | "in" | "out";
export type Hg3Speed = "slow" | "medium" | "fast";

/**
 * One Draw or Erase setting of a slide (702 offsets 5..7 or 8..10). Each
 * field is null when blank (code 0) or when the code is not known (with a
 * warning). The show editor fills in no direction or speed by itself.
 */
export interface Hg3EffectSetting {
  effect: Hg3Effect | null;
  direction: Hg3Direction | null;
  speed: Hg3Speed | null;
}

/** "unknown" kinds should be played as empty slides (SPEC §4.2). */
export type SlideKindName = "show" | "empty" | "chart" | "sound" | "midi" | "unknown";

/** A decoded destination byte (SPEC §4.6). `raw` is the byte as stored. */
export type Destination =
  | { kind: "none"; raw: number }
  | { kind: "slide"; index: number; raw: number }
  | { kind: "lastView"; raw: number }
  | { kind: "next"; raw: number }
  | { kind: "previous"; raw: number }
  | { kind: "edit"; raw: number }
  | { kind: "top"; raw: number }
  | { kind: "unknown"; raw: number };

/** One 704 entry (SPEC §4.3) [I]. */
export interface KeyEntry {
  /** ASCII code of the key, 0 for an extended key. */
  char: number;
  /** PC scan code for an extended key (0x3B = F1 ... 0x44 = F10), or 0. */
  scanCode: number;
  destination: Destination;
  /** Offset 3; not meaningful [I]. */
  raw3: number;
  /** First byte 0xFE, or neither a character nor a scan code (includes all zero). */
  unused: boolean;
}

/** One 706 entry (SPEC §4.4). */
export interface ButtonEntry {
  /** Name, NUL-terminated and with trailing spaces trimmed. */
  name: string;
  destination: Destination;
}

export interface Slide {
  /** Offset 0. */
  number: number;
  /** Offset 2. */
  kind: number;
  kindName: SlideKindName;
  /** Document type for chart slides (equal to `kind`), else null. */
  chartType: number | null;
  /** Name of the chart type ("Pie" etc.) for chart slides, else null. */
  chartTypeName: string | null;
  /** File name from the group's 404 kind 20, or null. */
  fileName: string | null;
  /** Index field of that 404 (should equal `number`), or null. */
  fileRefIndex: number | null;
  /**
   * Offsets 5..7: how the slide is drawn. A blank effect on a slide uses the
   * show's default, which slide 0 holds in its offset 5 (`Show.defaultDraw`).
   */
  draw: Hg3EffectSetting;
  /** Offsets 8..10: how the slide is erased before the next one is drawn. */
  erase: Hg3EffectSetting;
  /** Offset 11: number of HyperShow key entries (704). */
  keyCount: number;
  /** Offset 12: number of HyperShow button entries (706). */
  buttonCount: number;
  /**
   * Offset 14 (u16): seconds the slide shows before the show moves on, or
   * null for 0xFFFF (blank: wait for a key or click). 0 moves on at once.
   */
  displaySeconds: number | null;
  /** String at offset 102. */
  description: string;
  /** 704 entries (empty when the slide has none). */
  keys: KeyEntry[];
  /** 706 entries (empty when the slide has none). */
  buttons: ButtonEntry[];
  /**
   * The fixed bytes as stored (SPEC §4.2). Offsets 3, 4, 13, 16, 17 and
   * 18..101 have no known meaning (3 and 4 look like sound options).
   */
  raw: {
    /** Offset 3: 0, or 1 on the sample sound slides [?]. */
    b3: number;
    /** Offset 4: 0, 3 or 255 [?]. */
    b4: number;
    /** Offsets 5..10 as stored (also `draw` and `erase`). */
    b5to10: Uint8Array;
    /** Offset 11 (also `keyCount`). */
    b11: number;
    /** Offset 12 (also `buttonCount`). */
    b12: number;
    /** Offset 13. */
    b13: number;
    /** Offsets 14..15 as u16 (also `displaySeconds`). */
    u14: number;
    /** Offset 16. */
    b16: number;
    /** Offset 17: 0, 1, 3 or 128 in the samples, 0x17 in shows saved by HG 3.05 [?]. */
    b17: number;
    /** Offsets 18..101. */
    b18to101: Uint8Array;
  };
  /** The whole 702 data. */
  raw702: Uint8Array;
  /** File offset of the 702 record. */
  offset: number;
  /** Other records in the slide's group (extra 404s, 704s, 706s, unknown tags). */
  otherRecords: RecordNode[];
}

export interface ShowSettings {
  /** 708 data, or null if absent. */
  raw708: Uint8Array | null;
  raw710: Uint8Array | null;
  raw712: Uint8Array | null;
  /** 712 bytes 0..3 [?]. */
  raw712Prefix: Uint8Array | null;
  /** 712 style entries (three in every sample) [I: show-level text styles]. */
  styles712: StyleEntry[];
  raw714: Uint8Array | null;
  /**
   * 708 byte 2 (file offset 0x23): HyperShow automatic recalculation, 1 Yes,
   * 2 No; null when absent or another value.
   */
  recalculate: boolean | null;
}

export interface Show {
  /** Record 400 (empty if absent). */
  description: string;
  settings: ShowSettings;
  /** Slides in file order. */
  slides: Slide[];
  /**
   * The show's default Draw effect: slide 0's offset 5 (Replace in a new
   * show), used by slides whose own Draw effect is blank. Null if slide 0
   * has none.
   */
  defaultDraw: Hg3Effect | null;
  /** Slide 0's key table: applies to the whole show (SPEC §4.3) [I]. */
  globalKeys: KeyEntry[];
  /** Body records that belong to no slide group and are not settings. */
  otherRecords: RecordNode[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Decode a key or button destination byte (SPEC §4.6) [I]. */
export function decodeDestination(byte: number, slideCount: number): Destination {
  const raw = byte;
  switch (byte) {
    case DestinationByte.None:
      return { kind: "none", raw };
    case DestinationByte.LastView:
      return { kind: "lastView", raw };
    case DestinationByte.Next:
      return { kind: "next", raw };
    case DestinationByte.Previous:
      return { kind: "previous", raw };
    case DestinationByte.Edit:
    case DestinationByte.EditClear:
      return { kind: "edit", raw };
    case DestinationByte.Top:
    case DestinationByte.Home1:
    case DestinationByte.Home2:
      return { kind: "top", raw };
  }
  if (byte < slideCount) return { kind: "slide", index: byte, raw };
  return { kind: "unknown", raw };
}

/**
 * Decode a Draw (`erase` false) or Erase setting from its three codes.
 * Unknown codes (and Keep for Draw) read as blank, with a warning.
 */
export function decodeEffectSetting(
  codes: readonly [number, number, number],
  erase: boolean,
  where: string,
  warnings: string[],
): Hg3EffectSetting {
  const [e, d, s] = codes;
  const name = erase ? "erase" : "draw";
  const lookup = <T>(table: readonly (T | null)[], code: number, what: string, limit = table.length): T | null => {
    if (code < limit) return table[code];
    warnings.push(`${where}: unknown ${name} ${what} code ${code}; read as blank`);
    return null;
  };
  return {
    effect: lookup(EFFECT_CODES, e, "effect", erase ? EFFECT_CODES.length : EFFECT_CODES.length - 1),
    direction: lookup(DIRECTION_CODES, d, "direction"),
    speed: lookup(SPEED_CODES, s, "speed"),
  };
}

/**
 * Whether a 702 key or button count fits its table. Buttons: the count is
 * the table length. Keys: the length, or the number of entries that name a
 * key (character or scan code not 0): 10 sample tables each hold one entry
 * with neither, which the count leaves out.
 */
function countFits(count: number, table: KeyEntry[] | ButtonEntry[], keys: boolean): boolean {
  if (count === table.length) return true;
  if (!keys) return false;
  return count === (table as KeyEntry[]).filter((k) => k.char !== 0 || k.scanCode !== 0).length;
}

function kindInfo(kind: number): { kindName: SlideKindName; chartType: number | null; chartTypeName: string | null } {
  if (kind === SlideKind.Show) return { kindName: "show", chartType: null, chartTypeName: null };
  if (kind === SlideKind.Empty) return { kindName: "empty", chartType: null, chartTypeName: null };
  if (kind === SlideKind.Sound) return { kindName: "sound", chartType: null, chartTypeName: null };
  if (kind === SlideKind.Midi) return { kindName: "midi", chartType: null, chartTypeName: null };
  if (CHART_KINDS.includes(kind)) {
    return { kindName: "chart", chartType: kind, chartTypeName: documentTypeName(kind) ?? null };
  }
  return { kindName: "unknown", chartType: null, chartTypeName: null };
}

function readKeyTable(record: LeafRecord, slideCount: number, warnings: string[]): KeyEntry[] {
  const data = record.data;
  if (data.length % KEY_ENTRY_LENGTH !== 0) {
    warnings.push(
      `key table (704) at offset ${record.offset} length ${data.length} is not a multiple of ${KEY_ENTRY_LENGTH}; partial entry ignored`,
    );
  }
  const out: KeyEntry[] = [];
  for (let at = 0; at + KEY_ENTRY_LENGTH <= data.length; at += KEY_ENTRY_LENGTH) {
    const [char, scanCode, dest, raw3] = data.subarray(at, at + KEY_ENTRY_LENGTH);
    // SPEC §4.3 says "all zeros or first byte 0xFE". In the samples, entries
    // with neither a character nor a scan code also carry random bytes 2..3
    // (raw3 is never meaningful), so no key at all also means unused.
    const unused = char === 0xfe || (char === 0 && scanCode === 0);
    out.push({ char, scanCode, destination: decodeDestination(dest, slideCount), raw3, unused });
  }
  return out;
}

function readButtonTable(record: LeafRecord, slideCount: number, warnings: string[]): ButtonEntry[] {
  const data = record.data;
  if (data.length % BUTTON_ENTRY_LENGTH !== 0) {
    warnings.push(
      `button table (706) at offset ${record.offset} length ${data.length} is not a multiple of ${BUTTON_ENTRY_LENGTH}; partial entry ignored`,
    );
  }
  const r = new ByteReader(data);
  const out: ButtonEntry[] = [];
  while (r.remaining >= BUTTON_ENTRY_LENGTH) {
    const name = r.paddedString(BUTTON_NAME_LENGTH);
    out.push({ name, destination: decodeDestination(r.u8(), slideCount) });
  }
  return out;
}

function hex(n: number): string {
  return `0x${n.toString(16).padStart(2, "0")}`;
}

function readSlideEntry(
  record: LeafRecord,
  group: LeafRecord[],
  others: RecordNode[],
  slideCount: number,
  warnings: string[],
): Slide {
  let data = record.data;
  const at = `slide entry (702) at offset ${record.offset}`;
  if (data.length < SLIDE_ENTRY_FIXED_LENGTH) {
    warnings.push(`${at} is ${data.length} bytes, expected at least ${SLIDE_ENTRY_FIXED_LENGTH + 1}; missing bytes read as 0`);
    const padded = new Uint8Array(SLIDE_ENTRY_FIXED_LENGTH);
    padded.set(data);
    data = padded;
  }
  const r = new ByteReader(data);
  const number = r.u16();
  const kind = r.u8();
  const b3 = r.u8();
  const b4 = r.u8();
  const b5to10 = r.bytes(6);
  const b11 = r.u8();
  const b12 = r.u8();
  const b13 = r.u8();
  const u14 = r.u16();
  const b16 = r.u8();
  const b17 = r.u8();
  const b18to101 = r.bytes(84);
  const descBytes = r.bytes(r.remaining);
  const nul = descBytes.indexOf(0);
  if (descBytes.length > 0 && nul < 0) warnings.push(`${at}: description has no NUL terminator`);
  else if (nul >= 0 && nul + 1 < descBytes.length) {
    warnings.push(`${at}: ${descBytes.length - nul - 1} byte(s) after the description`);
  }
  const description = decodeHg3Text(nul < 0 ? descBytes : descBytes.subarray(0, nul));

  const info = kindInfo(kind);
  const where = `slide ${number}`;
  if (info.kindName === "unknown") warnings.push(`${where} has unknown kind ${hex(kind)}; treated as an empty slide`);

  let fileName: string | null = null;
  let fileRefIndex: number | null = null;
  let keys: KeyEntry[] | null = null;
  let buttons: ButtonEntry[] | null = null;
  for (const rec of group) {
    if (rec.tag === TAG_FILE_REFERENCE) {
      let ref;
      try {
        ref = readFileReference(rec.data);
      } catch {
        warnings.push(`${where}: file reference at offset ${rec.offset} is truncated; kept raw`);
        others.push(rec);
        continue;
      }
      if (ref.kind !== FileReferenceKind.Slide || fileName !== null) {
        warnings.push(
          `${where}: ${fileName !== null ? "extra " : ""}file reference kind ${ref.kind} at offset ${rec.offset} kept raw`,
        );
        others.push(rec);
        continue;
      }
      fileName = ref.name;
      fileRefIndex = ref.index;
      if (ref.index !== number) warnings.push(`${where}: file reference index ${ref.index} does not match the slide number`);
    } else if (rec.tag === ShowTag.KeyTable) {
      if (keys !== null) {
        warnings.push(`${where}: extra key table at offset ${rec.offset} kept raw`);
        others.push(rec);
      } else keys = readKeyTable(rec, slideCount, warnings);
    } else if (rec.tag === ShowTag.ButtonTable) {
      if (buttons !== null) {
        warnings.push(`${where}: extra button table at offset ${rec.offset} kept raw`);
        others.push(rec);
      } else buttons = readButtonTable(rec, slideCount, warnings);
    }
  }

  if (info.kindName === "chart" || info.kindName === "sound" || info.kindName === "midi") {
    if (fileName === null) warnings.push(`${where} (${info.kindName}) has no file reference`);
  } else if (info.kindName === "show") {
    if (number === 0 && fileName !== null) warnings.push(`slide 0 (the show itself) names a file`);
    if (number !== 0 && fileName === null) warnings.push(`${where} (nested show) has no file reference`);
  } else if (fileName !== null) {
    warnings.push(`${where} (${info.kindName}) names a file`);
  }

  const keyList = keys ?? [];
  const buttonList = buttons ?? [];
  if (!countFits(b11, keyList, true)) {
    warnings.push(`${where}: slide entry gives ${b11} key(s), the key table (704) has ${keyList.length}; all are used`);
  }
  if (!countFits(b12, buttonList, false)) {
    warnings.push(`${where}: slide entry gives ${b12} button(s), the button table (706) has ${buttonList.length}; all are used`);
  }

  return {
    number,
    kind,
    ...info,
    fileName,
    fileRefIndex,
    draw: decodeEffectSetting([b5to10[0], b5to10[1], b5to10[2]], false, where, warnings),
    erase: decodeEffectSetting([b5to10[3], b5to10[4], b5to10[5]], true, where, warnings),
    keyCount: b11,
    buttonCount: b12,
    displaySeconds: u14 === DISPLAY_TIME_WAIT ? null : u14,
    description,
    keys: keyList,
    buttons: buttonList,
    raw: { b3, b4, b5to10, b11, b12, b13, u14, b16, b17, b18to101 },
    raw702: record.data,
    offset: record.offset,
    otherRecords: others,
  };
}

function describeNode(n: RecordNode): string {
  return n.type === "record" ? `record ${n.tag} at offset ${n.offset}` : `block ${n.openTag} at offset ${n.offset}`;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Read a show from its container (SPEC §4). Throws only when the container
 * is not a show; everything else becomes a warning (SPEC §7.1).
 */
export function parseShow(container: Container): { show: Show; warnings: string[] } {
  if (container.kind !== "show") throw new Error(`not a show (container kind ${container.kind})`);
  const warnings: string[] = [];
  if (container.version.documentType !== DocumentType.Show) {
    warnings.push(`show has document type ${hex(container.version.documentType)}, expected 0x2e`);
  }

  const header = findBlock(container.root, 500);
  const descRecord = header?.children.find((n): n is LeafRecord => n.type === "record" && n.tag === TAG_DESCRIPTION);
  const description = descRecord ? readDescription(descRecord.data) : "";

  const bodyBlock = findBlock(container.root, 520);
  if (!bodyBlock) warnings.push("show has no body (520 block)");
  const body = bodyBlock?.children ?? [];

  const settings: ShowSettings = {
    raw708: null,
    raw710: null,
    raw712: null,
    raw712Prefix: null,
    styles712: [],
    raw714: null,
    recalculate: null,
  };
  const otherRecords: RecordNode[] = [];

  // Split the body into the pre-slide part and slide groups (SPEC §4.1).
  interface Group {
    entry: LeafRecord;
    members: LeafRecord[];
    others: RecordNode[];
  }
  const groups: Group[] = [];
  for (const node of body) {
    if (node.type === "record" && node.tag === ShowTag.SlideEntry) {
      groups.push({ entry: node, members: [], others: [] });
      continue;
    }
    if (node.type === "record" && SETTINGS_TAGS.includes(node.tag)) {
      const key = `raw${node.tag}` as "raw708" | "raw710" | "raw712" | "raw714";
      if (groups.length > 0) warnings.push(`settings record ${node.tag} at offset ${node.offset} comes after a slide entry`);
      if (settings[key] !== null) {
        warnings.push(`duplicate settings record ${node.tag} at offset ${node.offset} kept raw`);
        otherRecords.push(node);
        continue;
      }
      const expected = SETTINGS_LENGTHS.get(node.tag);
      if (node.data.length !== expected) {
        warnings.push(`settings record ${node.tag} at offset ${node.offset} is ${node.data.length} bytes, expected ${expected}`);
      }
      settings[key] = node.data;
      continue;
    }
    const isGroupMember =
      node.type === "record" &&
      (node.tag === TAG_FILE_REFERENCE || node.tag === ShowTag.KeyTable || node.tag === ShowTag.ButtonTable);
    if (groups.length === 0) {
      warnings.push(`${describeNode(node)} in the show body before any slide entry kept raw`);
      otherRecords.push(node);
    } else if (isGroupMember) {
      groups[groups.length - 1].members.push(node);
    } else {
      const g = groups[groups.length - 1];
      warnings.push(`${describeNode(node)} in slide group of offset ${g.entry.offset} not understood; kept raw`);
      g.others.push(node);
    }
  }

  for (const tag of SETTINGS_TAGS) {
    if (settings[`raw${tag}` as "raw708"] === null) warnings.push(`show has no settings record ${tag}`);
  }
  if (settings.raw708 !== null && settings.raw708.length > 2) {
    const flag = settings.raw708[2];
    if (flag === RecalculationByte.Yes) settings.recalculate = true;
    else if (flag === RecalculationByte.No) settings.recalculate = false;
    else warnings.push(`settings record 708 byte 2 (automatic recalculation) is ${flag}, expected 1 or 2`);
  }
  if (settings.raw712 !== null) {
    const data = settings.raw712;
    settings.raw712Prefix = data.subarray(0, Math.min(SETTINGS_712_PREFIX, data.length));
    if (data.length > SETTINGS_712_PREFIX) {
      const styleData = data.subarray(SETTINGS_712_PREFIX);
      const pseudo: LeafRecord = { type: "record", tag: 712, offset: 0, data: styleData };
      const styleWarnings: string[] = [];
      settings.styles712 = readStyleTable(pseudo, styleWarnings);
      if (styleData.length % STYLE_ENTRY_LENGTH !== 0) {
        warnings.push(`settings record 712 style part is not a multiple of ${STYLE_ENTRY_LENGTH} bytes; partial entry ignored`);
      }
    }
  }

  const slideCount = groups.length;
  const slides = groups.map((g) => readSlideEntry(g.entry, g.members, g.others, slideCount, warnings));
  slides.forEach((s, i) => {
    if (s.number !== i) warnings.push(`slide entry ${i} in file order has slide number ${s.number}`);
  });
  if (slides.length === 0) warnings.push("show has no slides");
  else if (slides[0].kindName !== "show") warnings.push(`slide 0 has kind ${hex(slides[0].kind)}, expected 0x2e (the show itself)`);

  const globalKeys = slides[0]?.keys ?? [];
  const defaultDraw = slides[0]?.draw.effect ?? null;
  return { show: { description, settings, slides, defaultDraw, globalKeys, otherRecords }, warnings };
}
