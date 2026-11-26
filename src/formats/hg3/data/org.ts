/**
 * Organization chart data (type 0x1A, SPEC §5.4, task 11c): one 914 record
 * per box, built into a tree; options 900 to 912 kept raw.
 *
 * 914 layout, from all 65 boxes in the 7 sample org charts (corrects §5.4):
 *
 * | Offset | Type | Meaning |
 * | 0   | u8 | 3 in every box: the number of text fields? [?] (not a level) |
 * | 1   | 47 bytes × 3 | fields name, title, comment: u8 width (18), padded string[23], 22-byte text tail (§5.3), u8 (0) |
 * | 142 | i16 x, i16 y | box centre in page coordinates [I]: 32 of the 52 drawn boxes are centred exactly here; the other 20 (GALD721, GALD751, ORGTUT) are all moved by one (−d, +d) per chart, d = 171 to 241 (a shadow style?); boxes without a drawn box are last-level list entries |
 * | 146 | i16, i16 | x extent of the box's subtree [I] |
 * | 150 | 4 × u16 | layout grid values [?] |
 * | 158 | u16 | level: 1 = top [I] |
 * | 160 | u16 | number of subordinates [I] |
 * | 162 | u16, u16 | 0, 256 [?] |
 * | 166 | u16 | 1 [?] |
 * | 168 | u16 | this box's index in file order [I] |
 * | 170 | u16 flag, u16 index | parent (flag 0 on the root) [I] |
 * | 174 | u16 flag, u16 index | first subordinate [I] |
 * | 178 | u16 flag, u16 index | next sibling [I] |
 * | 182 | u16 flag, u16 index | previous sibling [I] |
 * | 186 | 4 bytes | 0 [?] |
 *
 * The boxes are NOT in tree order: in GALD711 the fourth level lists the
 * children of the third-level boxes in reverse, so SPEC §5.4's rule ("each
 * box is a subordinate of the nearest earlier box one level higher") gives
 * wrong parents. The stored links are used; the rule is only a fallback for
 * boxes without them.
 */
import type { Chart } from "../chart";
import type { LeafRecord } from "../container";
import { ByteReader } from "../../ByteReader";
import { type TextTail, readTextTail } from "../text";
import { type RawRecord, i16At, otherRecords, recordsOf, singleRaw, u16At } from "./common";

export const OrgTag = {
  Options900: 900,
  Options902: 902,
  Options904: 904,
  StyleTable: 906,
  Options910: 910,
  Options912: 912,
  Box: 914,
} as const;

export const BOX_RECORD_LENGTH = 190;
const FIELD_LENGTH = 47;
const FIELD_TEXT_LENGTH = 23;
const FIELD_COUNT = 3;
const FIELDS_START = 1;
const LINKS_START = FIELDS_START + FIELD_COUNT * FIELD_LENGTH; // 142
const LINKS_END = 186;

export interface OrgField {
  /** u8 before the text (18 in samples): field width in characters [I]. */
  width: number;
  text: string;
  tail: TextTail;
  /** u8 after the tail (0 in samples) [?]. */
  rawEnd: number;
}

/** Stored layout and tree links (offsets 142 to 186). */
export interface OrgBoxLinks {
  x: number;
  y: number;
  subtreeX1: number;
  subtreeX2: number;
  /** u16 at 150, 152, 154, 156 [?]. */
  grid: [number, number, number, number];
  level: number;
  childCount: number;
  storedIndex: number;
  parent: number | null;
  firstChild: number | null;
  nextSibling: number | null;
  prevSibling: number | null;
}

export interface OrgBox {
  offset: number;
  /** Position in file order. */
  index: number;
  /** Byte 0 [?] (3 in samples). */
  raw0: number;
  name: OrgField | null;
  title: OrgField | null;
  comment: OrgField | null;
  /** Null when the record is too short to hold them. */
  links: OrgBoxLinks | null;
  /** Level used for the tree: the stored level, or derived from the parent. 1 = top. */
  level: number;
  /** Parent index in `boxes`, null for a root. */
  parent: number | null;
  /** Subordinate indexes, in sibling order. */
  children: number[];
  raw: Uint8Array;
}

export interface OrgData {
  kind: "org";
  /** In file order. */
  boxes: OrgBox[];
  /** Indexes of boxes without a parent. */
  roots: number[];
  /** True when the tree came from the stored links for every box. */
  fromStoredLinks: boolean;
  raw900: Uint8Array | null;
  raw902: Uint8Array | null;
  raw904: Uint8Array | null;
  raw910: Uint8Array | null;
  raw912: Uint8Array | null;
  otherRecords: RawRecord[];
}

const KNOWN: ReadonlySet<number> = new Set(Object.values(OrgTag));

function readField(data: Uint8Array, at: number): OrgField | null {
  if (at + FIELD_LENGTH - 1 > data.length) return null;
  const r = new ByteReader(data);
  r.seek(at);
  const width = r.u8();
  const text = r.paddedString(FIELD_TEXT_LENGTH);
  const tail = readTextTail(r);
  const rawEnd = r.remaining > 0 ? r.u8() : 0;
  return { width, text, tail, rawEnd };
}

function readLinks(d: Uint8Array): OrgBoxLinks | null {
  if (d.length < LINKS_END) return null;
  const link = (at: number): number | null => (u16At(d, at) ? u16At(d, at + 2) : null);
  return {
    x: i16At(d, 142),
    y: i16At(d, 144),
    subtreeX1: i16At(d, 146),
    subtreeX2: i16At(d, 148),
    grid: [u16At(d, 150), u16At(d, 152), u16At(d, 154), u16At(d, 156)],
    level: u16At(d, 158),
    childCount: u16At(d, 160),
    storedIndex: u16At(d, 168),
    parent: link(170),
    firstChild: link(174),
    nextSibling: link(178),
    prevSibling: link(182),
  };
}

function readBox(rec: LeafRecord, index: number, warnings: string[]): OrgBox {
  const d = rec.data;
  const at = `org box (914) at offset ${rec.offset}`;
  if (d.length !== BOX_RECORD_LENGTH) warnings.push(`${at} has ${d.length} bytes, expected ${BOX_RECORD_LENGTH}`);
  const fields = [0, 1, 2].map((i) => readField(d, FIELDS_START + i * FIELD_LENGTH));
  if (fields.some((f) => f === null)) warnings.push(`${at} too short for all text fields`);
  const links = readLinks(d);
  if (!links && d.length >= LINKS_START) warnings.push(`${at} too short for the tree links`);
  return {
    offset: rec.offset,
    index,
    raw0: d.length > 0 ? d[0]! : 0,
    name: fields[0] ?? null,
    title: fields[1] ?? null,
    comment: fields[2] ?? null,
    links,
    level: links?.level ?? 0,
    parent: null,
    children: [],
    raw: d,
  };
}

/** Stored links are usable when every box has them and they are consistent. */
function linksValid(boxes: OrgBox[]): boolean {
  if (boxes.length === 0) return false;
  return boxes.every((b) => {
    const l = b.links;
    if (!l || l.storedIndex !== b.index) return false;
    if (l.parent === null) return true;
    return l.parent < boxes.length && l.parent !== b.index;
  }) && !hasCycle(boxes.map((b) => b.links!.parent));
}

function hasCycle(parents: (number | null)[]): boolean {
  for (let i = 0; i < parents.length; i++) {
    let p = parents[i];
    for (let steps = 0; p !== null && p !== undefined; steps++) {
      if (steps > parents.length) return true;
      p = parents[p];
    }
  }
  return false;
}

/** Sibling order: follow the stored firstChild/nextSibling chain if it lists exactly `kids`, else file order. */
function orderChildren(parent: OrgBox, kids: number[], boxes: OrgBox[]): number[] {
  const chain: number[] = [];
  let c = parent.links?.firstChild ?? null;
  while (c !== null && c < boxes.length && !chain.includes(c)) {
    chain.push(c);
    c = boxes[c]!.links?.nextSibling ?? null;
  }
  const same = chain.length === kids.length && kids.every((k) => chain.includes(k));
  return same ? chain : kids;
}

export function parseOrgData(chart: Chart, warnings: string[]): OrgData {
  const boxes = recordsOf(chart, OrgTag.Box).map((rec, i) => readBox(rec, i, warnings));
  const fromStoredLinks = linksValid(boxes);

  if (fromStoredLinks) {
    for (const b of boxes) b.parent = b.links!.parent;
  } else {
    if (boxes.length) warnings.push("org boxes lack consistent tree links; using the level rule of SPEC §5.4");
    // SPEC §5.4 [I]: a box's parent is the nearest earlier box one level higher.
    boxes.forEach((b, i) => {
      if (b.level <= 1) return;
      for (let j = i - 1; j >= 0; j--) {
        if (boxes[j]!.level === b.level - 1) {
          b.parent = j;
          break;
        }
      }
      if (b.parent === null) warnings.push(`org box ${i} at level ${b.level} has no box one level higher before it`);
    });
  }

  for (const b of boxes) {
    const kids = boxes.filter((k) => k.parent === b.index).map((k) => k.index);
    b.children = orderChildren(b, kids, boxes);
    if (b.links && b.links.childCount !== kids.length && fromStoredLinks) {
      warnings.push(`org box ${b.index} stores ${b.links.childCount} subordinates but has ${kids.length}`);
    }
  }
  // Derive levels from the tree where none is stored.
  const levelOf = (b: OrgBox, depth = 0): number =>
    b.parent === null || depth > boxes.length ? 1 : levelOf(boxes[b.parent]!, depth + 1) + 1;
  for (const b of boxes) {
    const derived = levelOf(b);
    if (b.level === 0) b.level = derived;
    else if (fromStoredLinks && b.level !== derived) warnings.push(`org box ${b.index} stores level ${b.level} but sits at level ${derived}`);
  }

  return {
    kind: "org",
    boxes,
    roots: boxes.filter((b) => b.parent === null).map((b) => b.index),
    fromStoredLinks,
    raw900: singleRaw(chart, OrgTag.Options900, warnings),
    raw902: singleRaw(chart, OrgTag.Options902, warnings),
    raw904: singleRaw(chart, OrgTag.Options904, warnings),
    raw910: singleRaw(chart, OrgTag.Options910, warnings),
    raw912: singleRaw(chart, OrgTag.Options912, warnings),
    otherRecords: otherRecords(chart, KNOWN),
  };
}
