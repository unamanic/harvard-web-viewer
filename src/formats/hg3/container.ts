/**
 * Harvard Graphics 3 record container (SPEC §3 "Common file structure",
 * error handling per §7.1).
 *
 * Every HG3 document (chart, show, palette) is a 4-byte signature followed by
 * records `{u16 tag, u16 length, data[length]}`. The first record is the
 * version record (tag 0), the last is the end record (tag 1). Some tags open
 * and close blocks; this module turns the flat stream into a tree.
 */
import { ByteReader } from "./ByteReader";
import { decodeFileName, decodeHg3Text } from "./charset";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Signature to file kind (SPEC §3 "Signature"). */
export const SIGNATURES = {
  HGB3: "chart",
  HGB1: "show",
  HGA2: "palette",
} as const;

export type ContainerKind = (typeof SIGNATURES)[keyof typeof SIGNATURES];

/** Tag of the version record, always first (SPEC §3). */
export const TAG_VERSION = 0;
/** Tag of the end record (SPEC §3). */
export const TAG_END = 1;
/** Document description string (SPEC §3 "Header records"). */
export const TAG_DESCRIPTION = 400;
/** File reference (SPEC §3 "File reference"). */
export const TAG_FILE_REFERENCE = 404;

/** Block open/close tags (SPEC §3 "Block markers"). */
export const BLOCKS = [
  { open: 500, close: 501, name: "header" },
  { open: 504, close: 505, name: "page" },
  { open: 508, close: 509, name: "chartTextAndData" },
  { open: 516, close: 517, name: "objectLayer" },
  { open: 520, close: 521, name: "showBody" },
  { open: 524, close: 525, name: "paletteBody" },
  { open: 608, close: 610, name: "objectGroup" },
] as const;

export const BLOCK_CLOSE_FOR_OPEN: ReadonlyMap<number, number> = new Map(BLOCKS.map((b) => [b.open, b.close]));
export const BLOCK_OPEN_FOR_CLOSE: ReadonlyMap<number, number> = new Map(BLOCKS.map((b) => [b.close, b.open]));

/**
 * Data length expected on a block open record; 0 for tags not listed.
 * SPEC §3 says 516 is the only open record with data (16 bytes, two i16
 * boxes). In all 287 samples 608 (object group) also always carries 16 bytes
 * (213 of 213 occurrences); presumably the group's bounding box(es) [I]. SPEC
 * §3 should be corrected.
 */
export const BLOCK_OPEN_DATA_LENGTH: ReadonlyMap<number, number> = new Map([
  [516, 16],
  [608, 16],
]);

/** Document type byte of the version record (SPEC §3 "Version record"). */
export const DocumentType = {
  XY: 0x01,
  Pie: 0x15,
  Organization: 0x1a,
  Title: 0x1f,
  Bullet: 0x20,
  Table: 0x21,
  Drawing: 0x29,
  Show: 0x2e,
  Palette: 0x33,
  CustomPalette: 0x34,
} as const;

export type DocumentTypeName = keyof typeof DocumentType;

/** Name of a document type code, or undefined if unknown. */
export function documentTypeName(code: number): DocumentTypeName | undefined {
  return (Object.keys(DocumentType) as DocumentTypeName[]).find((k) => DocumentType[k] === code);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A plain record. `offset` is the absolute file offset of its 4-byte header. */
export interface LeafRecord {
  type: "record";
  tag: number;
  offset: number;
  data: Uint8Array;
}

/**
 * A block pair. `offset` is the open record's header offset; `data` is the
 * open record's data (16 bytes for 516 and 608, empty otherwise).
 */
export interface BlockRecord {
  type: "block";
  openTag: number;
  closeTag: number;
  offset: number;
  data: Uint8Array;
  children: RecordNode[];
}

export type RecordNode = LeafRecord | BlockRecord;

export interface ContainerVersion {
  major: number;
  minor: number;
  /** Third version byte (0 in every sample). */
  patch: number;
  documentType: number;
}

export interface Container {
  kind: ContainerKind;
  signature: string;
  version: ContainerVersion;
  /**
   * Top-level records in file order, including the version record (tag 0)
   * and the end record (tag 1) when present.
   */
  root: RecordNode[];
  warnings: string[];
  /** True when a record ran past the end of the file (SPEC §7.1). */
  damaged: boolean;
  /** Bytes consumed: up to and including the end record, or where reading stopped. */
  endOffset: number;
}

/** Thrown when the bytes are not an HG3 document (SPEC §7.1). */
export class NotHg3Error extends Error {
  constructor(detail?: string) {
    super(
      "not a Harvard Graphics 3 file" +
        (detail ? ` (${detail})` : "") +
        ". Harvard Graphics 2 files (.CHT, .SHW) are a different format.",
    );
    this.name = "NotHg3Error";
  }
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

const SIGNATURE_LENGTH = 4;
const HEADER_LENGTH = 4;

/**
 * Parse the record container (SPEC §3). Throws NotHg3Error only for a wrong
 * signature or a missing/malformed version record; everything else becomes a
 * warning (SPEC §7.1):
 *
 * - A record length past EOF stops reading; `damaged` is set.
 * - No end record: warning; end of file is the end.
 * - Bytes after the end record: warning; they are not read.
 * - Blocks still open at the end are closed there, with a warning.
 * - A close tag that matches an outer open block closes the inner blocks
 *   too (warning). A close tag that matches no open block is kept as a
 *   plain leaf record (warning), so nothing is lost.
 * - Unknown tags are kept as leaf records.
 */
export function readContainer(bytes: Uint8Array): Container {
  if (bytes.length < SIGNATURE_LENGTH) throw new NotHg3Error("file too short");
  const signature = String.fromCharCode(...bytes.subarray(0, SIGNATURE_LENGTH));
  if (!Object.hasOwn(SIGNATURES, signature)) throw new NotHg3Error(`unknown signature`);
  const kind = SIGNATURES[signature as keyof typeof SIGNATURES];

  const r = new ByteReader(bytes);
  r.seek(SIGNATURE_LENGTH);
  if (r.remaining < HEADER_LENGTH + 4) throw new NotHg3Error("no version record");
  const versionOffset = r.pos;
  const versionTag = r.u16();
  const versionLength = r.u16();
  if (versionTag !== TAG_VERSION || versionLength !== 4) throw new NotHg3Error("version record is not first");
  const versionData = r.bytes(4);
  const version: ContainerVersion = {
    major: versionData[0],
    minor: versionData[1],
    patch: versionData[2],
    documentType: versionData[3],
  };

  const warnings: string[] = [];
  if (version.major !== 0 || version.minor !== 3 || version.patch !== 0) {
    warnings.push(`unexpected version bytes ${version.major}.${version.minor}.${version.patch}`);
  }
  if (documentTypeName(version.documentType) === undefined) {
    warnings.push(`unknown document type 0x${version.documentType.toString(16)}`);
  }

  const root: RecordNode[] = [{ type: "record", tag: TAG_VERSION, offset: versionOffset, data: versionData }];
  const stack: BlockRecord[] = [];
  const append = (node: RecordNode): void => {
    (stack.length ? stack[stack.length - 1].children : root).push(node);
  };
  const closeAll = (why: string): void => {
    while (stack.length) {
      const b = stack.pop()!;
      warnings.push(`block ${b.openTag} at offset ${b.offset} not closed; closed at ${why}`);
    }
  };

  let damaged = false;
  let sawEnd = false;

  while (r.remaining > 0) {
    const offset = r.pos;
    if (r.remaining < HEADER_LENGTH) {
      damaged = true;
      warnings.push(`damaged: truncated record header at offset ${offset}`);
      r.seek(offset);
      break;
    }
    const tag = r.u16();
    const length = r.u16();
    if (length > r.remaining) {
      damaged = true;
      warnings.push(
        `damaged: record ${tag} at offset ${offset} has length ${length} but only ${r.remaining} byte(s) remain`,
      );
      r.seek(offset);
      break;
    }
    const data = r.bytes(length);

    if (tag === TAG_END) {
      if (length !== 0) warnings.push(`end record at offset ${offset} has ${length} data byte(s)`);
      closeAll("end record");
      root.push({ type: "record", tag, offset, data });
      sawEnd = true;
      break;
    }

    const closeTag = BLOCK_CLOSE_FOR_OPEN.get(tag);
    if (closeTag !== undefined) {
      const expected = BLOCK_OPEN_DATA_LENGTH.get(tag) ?? 0;
      if (length !== expected) {
        warnings.push(`block open ${tag} at offset ${offset} has ${length} data byte(s), expected ${expected}`);
      }
      const node: BlockRecord = { type: "block", openTag: tag, closeTag, offset, data, children: [] };
      append(node);
      stack.push(node);
      continue;
    }

    const openTag = BLOCK_OPEN_FOR_CLOSE.get(tag);
    if (openTag !== undefined) {
      if (length !== 0) warnings.push(`block close ${tag} at offset ${offset} has ${length} data byte(s)`);
      let depth = stack.length - 1;
      while (depth >= 0 && stack[depth].openTag !== openTag) depth--;
      if (depth < 0) {
        warnings.push(`stray block close ${tag} at offset ${offset} kept as a record`);
        append({ type: "record", tag, offset, data });
        continue;
      }
      while (stack.length > depth + 1) {
        const inner = stack.pop()!;
        warnings.push(`block ${inner.openTag} at offset ${inner.offset} not closed; closed by ${tag} at offset ${offset}`);
      }
      stack.pop();
      continue;
    }

    if (tag === TAG_VERSION) warnings.push(`extra version record at offset ${offset}`);
    append({ type: "record", tag, offset, data });
  }

  if (!sawEnd) {
    closeAll("end of file");
    warnings.push("no end record (tag 1); end of file treated as the end");
  }
  const endOffset = r.pos;
  if (sawEnd && endOffset < bytes.length) {
    warnings.push(`${bytes.length - endOffset} byte(s) after the end record ignored`);
  }

  return { kind, signature, version, root, warnings, damaged, endOffset };
}

// ---------------------------------------------------------------------------
// Tree helpers
// ---------------------------------------------------------------------------

/** All leaf records with `tag`, depth-first in file order. */
export function findAll(nodes: readonly RecordNode[], tag: number): LeafRecord[] {
  const out: LeafRecord[] = [];
  const walk = (list: readonly RecordNode[]): void => {
    for (const n of list) {
      if (n.type === "record") {
        if (n.tag === tag) out.push(n);
      } else walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

/** First leaf record with `tag` (deep), or undefined. */
export function findFirst(nodes: readonly RecordNode[], tag: number): LeafRecord | undefined {
  return findAll(nodes, tag)[0];
}

/** First block with `openTag`, depth-first in file order, or undefined. */
export function findBlock(nodes: readonly RecordNode[], openTag: number): BlockRecord | undefined {
  for (const n of nodes) {
    if (n.type !== "block") continue;
    if (n.openTag === openTag) return n;
    const inner = findBlock(n.children, openTag);
    if (inner) return inner;
  }
  return undefined;
}

/** Children of the first block with `openTag` (empty if there is none). */
export function childrenOf(nodes: readonly RecordNode[], openTag: number): RecordNode[] {
  return findBlock(nodes, openTag)?.children ?? [];
}

// ---------------------------------------------------------------------------
// Header record decoders
// ---------------------------------------------------------------------------

/** Text up to the first NUL (or the whole data if none), decoded by `decode`. */
function dataString(data: Uint8Array, decode: (bytes: Uint8Array) => string): string {
  const nul = data.indexOf(0);
  return decode(nul < 0 ? data : data.subarray(0, nul));
}

/** Tag 400: the document description, may be empty (SPEC §3 "Header records"). */
export function readDescription(data: Uint8Array): string {
  return dataString(data, decodeHg3Text);
}

/** Kinds of tag 404 file reference (SPEC §3 "File reference"). */
export const FileReferenceKind = {
  ButtonChart: 1,
  Palette: 2,
  /** A chart embedded in this one (SPEC §3). */
  EmbeddedChart: 4,
  Bitmap: 5,
  Slide: 20,
} as const;

export interface FileReference {
  kind: number;
  /** Slide number for kind 20, otherwise 0. */
  index: number;
  /** File name, no directory. */
  name: string;
}

/**
 * Tag 404 file reference: u16 kind, u16 index, string name (SPEC §3).
 * Throws TruncatedError if the data is shorter than 4 bytes.
 */
export function readFileReference(data: Uint8Array): FileReference {
  const r = new ByteReader(data);
  const kind = r.u16();
  const index = r.u16();
  return { kind, index, name: dataString(r.bytes(r.remaining), decodeFileName) };
}
