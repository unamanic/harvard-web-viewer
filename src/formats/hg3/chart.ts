/**
 * Chart common records (SPEC §5.1 to §5.3): chart type, description, file
 * references, page areas, page setup, button names, text lines and text
 * style tables. Chart-type data records (§5.4, task 11) and the object layer
 * (§5.6, task 10) are kept for later tasks.
 */
import { ByteReader } from "../ByteReader";
import {
  type BlockRecord,
  type Container,
  type FileReference,
  type LeafRecord,
  type RecordNode,
  DocumentType,
  FileReferenceKind,
  TAG_DESCRIPTION,
  TAG_FILE_REFERENCE,
  documentTypeName,
  findAll,
  findBlock,
  readDescription,
  readFileReference,
} from "./container";
import { type FontKey, isEmptyFontKey } from "../../fonts/fontKey";
import {
  type StyleEntry,
  type TextLine,
  STYLE_TABLE_TAGS,
  TAG_TEXT_LINE,
  TextSlot,
  readStyleTable,
  readTextLine,
} from "./text";

/** Page record tags (SPEC §5.2). */
export const PageTag = {
  Frame: 802,
  Title: 804,
  Plot: 806,
  Footnote: 808,
  Legend: 810,
  ButtonNames: 814,
  PageSetup: 816,
  Colors820: 820,
  Options822: 822,
  Raw824: 824,
  Drawing1700: 1700,
} as const;

/** An area in page coordinates (SPEC §5.2, §6.1). */
export interface PageArea {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** The u16 after the box (0 in samples); absent if the record was 8 bytes. */
  trailer: number;
}

export interface PageAreas {
  frame: PageArea | null;
  title: PageArea | null;
  plot: PageArea | null;
  footnote: PageArea | null;
  legend: PageArea | null;
}

export type Orientation = "landscape" | "portrait" | "unknown";

/** Record 816 (SPEC §5.2). */
export interface PageSetup {
  orientation: Orientation;
  /** Raw orientation byte: 1 landscape, 2 portrait. */
  orientationCode: number;
  /** Index into the paper size list (1 Letter, 14 screen 10 × 7.5 in). */
  paperSize: number;
  widthIn: number;
  heightIn: number;
}

/** Entry of record 814 (SPEC §4.4 layout). */
export interface ButtonName {
  name: string;
  /** u8 after the name; destination in show button tables [I]. */
  destination: number;
}

export interface ChartFileRefs {
  /** Every 404 record, in file order. */
  all: FileReference[];
  /** Kind 2; null means use HG3.PL3 (SPEC §3). */
  paletteName: string | null;
  /** Kind 1. */
  buttonChartName: string | null;
  /** Kind 4: charts embedded in this one (SPEC §3), in file order. */
  embeddedChartNames: string[];
  /** Kind 5, in file order. */
  bitmapNames: string[];
}

export interface Chart {
  /** Document type code from the version record (SPEC §3). */
  chartType: number;
  /** Name of the type code, e.g. "Pie"; undefined for unknown codes. */
  name: string | undefined;
  /** Record 400 (empty if absent). */
  description: string;
  fileRefs: ChartFileRefs;
  areas: PageAreas;
  pageSetup: PageSetup | null;
  buttonNames: ButtonName[];
  /** Every 800 record, in file order. */
  textLines: TextLine[];
  /** Style tables by tag (906, 1002, 1102, 1202, 1308, 1412). */
  styleTables: Map<number, StyleEntry[]>;
  raw820: Uint8Array | null;
  raw822: Uint8Array | null;
  raw824: Uint8Array | null;
  raw1700: Uint8Array | null;
  /** Leaf records inside 508 that this module does not interpret (task 11). */
  dataRecords: LeafRecord[];
  /** The 516 block (task 10), or null. */
  objectLayer: BlockRecord | null;
}

/** Style table tag for each chart type (SPEC §5.3, §5.4). */
export const STYLE_TABLE_FOR_TYPE: ReadonlyMap<number, number> = new Map([
  [DocumentType.Organization, 906],
  [DocumentType.Title, 1002],
  [DocumentType.Bullet, 1102],
  [DocumentType.Table, 1202],
  [DocumentType.Pie, 1308],
  [DocumentType.XY, 1412],
]);

const AREA_TAGS = [
  [PageTag.Frame, "frame"],
  [PageTag.Title, "title"],
  [PageTag.Plot, "plot"],
  [PageTag.Footnote, "footnote"],
  [PageTag.Legend, "legend"],
] as const;

/** Tags inside 508 handled here; everything else there goes to `dataRecords`. */
const COMMON_TAGS: ReadonlySet<number> = new Set<number>([
  TAG_TEXT_LINE,
  TAG_FILE_REFERENCE,
  ...AREA_TAGS.map(([t]) => t),
  PageTag.ButtonNames,
  PageTag.PageSetup,
  PageTag.Colors820,
  PageTag.Options822,
  PageTag.Raw824,
  PageTag.Drawing1700,
  ...STYLE_TABLE_TAGS,
]);

const BUTTON_ENTRY_LENGTH = 14;

function readArea(rec: LeafRecord, warnings: string[]): PageArea | null {
  if (rec.data.length < 8) {
    warnings.push(`page area (${rec.tag}) at offset ${rec.offset} too short (${rec.data.length} bytes); skipped`);
    return null;
  }
  if (rec.data.length !== 10) {
    warnings.push(`page area (${rec.tag}) at offset ${rec.offset} has ${rec.data.length} bytes, expected 10`);
  }
  const r = new ByteReader(rec.data);
  const x1 = r.i16();
  const y1 = r.i16();
  const x2 = r.i16();
  const y2 = r.i16();
  const trailer = r.remaining >= 2 ? r.u16() : 0;
  if (x1 === 0 && y1 === 0 && x2 === 0 && y2 === 0) return null;
  return { x1, y1, x2, y2, trailer };
}

function readPageSetup(rec: LeafRecord, warnings: string[]): PageSetup | null {
  if (rec.data.length < 10) {
    warnings.push(`page setup (816) at offset ${rec.offset} too short (${rec.data.length} bytes); skipped`);
    return null;
  }
  if (rec.data.length !== 10) {
    warnings.push(`page setup (816) at offset ${rec.offset} has ${rec.data.length} bytes, expected 10`);
  }
  const r = new ByteReader(rec.data);
  const orientationCode = r.u8();
  const paperSize = r.u8();
  const widthIn = r.f32();
  const heightIn = r.f32();
  const orientation: Orientation =
    orientationCode === 1 ? "landscape" : orientationCode === 2 ? "portrait" : "unknown";
  if (orientation === "unknown") warnings.push(`page setup (816) has unknown orientation ${orientationCode}`);
  return { orientation, orientationCode, paperSize, widthIn, heightIn };
}

function readButtonNames(rec: LeafRecord, warnings: string[]): ButtonName[] {
  if (rec.data.length % BUTTON_ENTRY_LENGTH !== 0) {
    warnings.push(
      `button names (814) at offset ${rec.offset} length ${rec.data.length} is not a multiple of ${BUTTON_ENTRY_LENGTH}; partial entry ignored`,
    );
  }
  const r = new ByteReader(rec.data);
  const out: ButtonName[] = [];
  while (r.remaining >= BUTTON_ENTRY_LENGTH) {
    const name = r.paddedString(13);
    const destination = r.u8();
    out.push({ name, destination });
  }
  return out;
}

/** First record with `tag`; warns if there are more. */
function single(nodes: readonly RecordNode[], tag: number, warnings: string[]): LeafRecord | undefined {
  const all = findAll(nodes, tag);
  if (all.length > 1) warnings.push(`${all.length} records with tag ${tag}; using the first`);
  return all[0];
}

/** Leaf records inside `nodes` (recursively) whose tag is not in COMMON_TAGS. */
function collectDataRecords(nodes: readonly RecordNode[], out: LeafRecord[]): void {
  for (const n of nodes) {
    if (n.type === "block") collectDataRecords(n.children, out);
    else if (!COMMON_TAGS.has(n.tag)) out.push(n);
  }
}

/**
 * Parse the common chart records. Throws only when the container is not a
 * chart; damaged or short records become warnings (SPEC §7.1). The returned
 * warnings are this module's own; the container's warnings are separate.
 */
export function parseChart(container: Container): { chart: Chart; warnings: string[] } {
  if (container.kind !== "chart") throw new Error(`parseChart: container is a ${container.kind}, not a chart`);
  const warnings: string[] = [];
  const root = container.root;
  const chartType = container.version.documentType;

  const descRec = single(root, TAG_DESCRIPTION, warnings);
  const description = descRec ? readDescription(descRec.data) : "";

  const all: FileReference[] = [];
  for (const rec of findAll(root, TAG_FILE_REFERENCE)) {
    if (rec.data.length < 4) {
      warnings.push(`file reference (404) at offset ${rec.offset} too short (${rec.data.length} bytes); skipped`);
      continue;
    }
    all.push(readFileReference(rec.data));
  }
  const allOfKind = (kind: number): string[] => all.filter((f) => f.kind === kind).map((f) => f.name);
  const firstOfKind = (kind: number): string | null => {
    const refs = all.filter((f) => f.kind === kind);
    if (refs.length > 1) warnings.push(`${refs.length} file references of kind ${kind}; using the first`);
    return refs[0]?.name ?? null;
  };
  const known = new Set<number>(Object.values(FileReferenceKind));
  for (const f of all) {
    if (!known.has(f.kind) || f.kind === FileReferenceKind.Slide) {
      warnings.push(`file reference of unexpected kind ${f.kind} in a chart`);
    }
  }
  const fileRefs: ChartFileRefs = {
    all,
    paletteName: firstOfKind(FileReferenceKind.Palette),
    buttonChartName: firstOfKind(FileReferenceKind.ButtonChart),
    embeddedChartNames: allOfKind(FileReferenceKind.EmbeddedChart),
    bitmapNames: allOfKind(FileReferenceKind.Bitmap),
  };

  const areas: PageAreas = { frame: null, title: null, plot: null, footnote: null, legend: null };
  for (const [tag, key] of AREA_TAGS) {
    const rec = single(root, tag, warnings);
    if (rec) areas[key] = readArea(rec, warnings);
  }

  const setupRec = single(root, PageTag.PageSetup, warnings);
  const pageSetup = setupRec ? readPageSetup(setupRec, warnings) : null;

  const buttonRec = single(root, PageTag.ButtonNames, warnings);
  const buttonNames = buttonRec ? readButtonNames(buttonRec, warnings) : [];

  const textLines: TextLine[] = [];
  for (const rec of findAll(root, TAG_TEXT_LINE)) {
    const line = readTextLine(rec, warnings);
    if (line) textLines.push(line);
  }

  const styleTables = new Map<number, StyleEntry[]>();
  for (const tag of STYLE_TABLE_TAGS) {
    const rec = single(root, tag, warnings);
    if (rec) styleTables.set(tag, readStyleTable(rec, warnings));
  }

  const rawOf = (tag: number): Uint8Array | null => single(root, tag, warnings)?.data ?? null;

  const page = findBlock(root, 504);
  if (!page) warnings.push("chart has no page block (504)");
  const chartBlock = findBlock(root, 508);
  if (!chartBlock) warnings.push("chart has no chart block (508)");
  const dataRecords: LeafRecord[] = [];
  if (chartBlock) collectDataRecords(chartBlock.children, dataRecords);
  const objectLayer = findBlock(root, 516) ?? null;
  if (!objectLayer) warnings.push("chart has no object layer (516)");

  const chart: Chart = {
    chartType,
    name: documentTypeName(chartType),
    description,
    fileRefs,
    areas,
    pageSetup,
    buttonNames,
    textLines,
    styleTables,
    raw820: rawOf(PageTag.Colors820),
    raw822: rawOf(PageTag.Options822),
    raw824: rawOf(PageTag.Raw824),
    raw1700: rawOf(PageTag.Drawing1700),
    dataRecords,
    objectLayer,
  };
  return { chart, warnings };
}

/** Lines of one slot, sorted by row then column (stable for ties). */
export function linesBySlot(chart: Chart, slot: number): TextLine[] {
  return chart.textLines
    .filter((l) => l.slot === slot)
    .sort((a, b) => a.row - b.row || a.column - b.column);
}

// ---------------------------------------------------------------------------
// Style table entry for a line.
//
// [I] SPEC §5.3 says one entry per "text slot or level". The samples show the
// entries are per text role, not per slot number, and the colour roles in the
// default tables identify them (role names from §6.2):
//
//   all tables but 1002: entries 0, 1, 2 = Title, SubTitl1, SubTitl2
//                        (slot 1 rows 0, 1, 2).
//   906  (org, 9):   3-5 box text (Text/SubTitl1, size 0; for 914 boxes, not
//                    800 lines), 6-8 footnote (Footnote, slot 2).
//   1002 (title, 3): top, middle, bottom sections of slot 7 (Title, SubTitl1,
//                    Footnote). In samples the sections start at rows 0, 4
//                    and 12 (raw6 of a section's first line counts 4, 8, 4
//                    rows), so rows 0-3, 4-11, 12+.
//   1102 (bullet, 7): 3 bullet lines (Text, slot 8), 4-6 footnote.
//   1202 (table, 9): 3 cell text (Text, slot 6), 4-6 footnote, 7 (XTitle)
//                    and 8 (XLabel) unknown.
//   1308 (pie, 20):  3-5 footnote, 6-11 pie titles (slot 5, one per pie),
//                    12 (XTitle) unknown, 13-18 slice labels (XLabel, one
//                    per pie; for 1316, not 800 lines), 19 unknown.
//   1412 (XY, 16):   3-5 footnote, 6-8 axis titles X/Y1/Y2 (slot 3 rows
//                    0-2), 9 XTitle unknown, 10-13 axis labels, 14 unknown,
//                    15 (XLabel, left) series names (slot 4).
//
// Footnote rows beyond 2, subtitle rows beyond 2 and so on use the last entry
// of their range.
// ---------------------------------------------------------------------------

/** A run of style entries for one slot: rows 0..count-1 map to first..first+count-1. */
interface SlotStyleRange {
  slot: number;
  first: number;
  count: number;
}

const TITLE_ROWS: SlotStyleRange = { slot: TextSlot.Title, first: 0, count: 3 };

/** [I] Slot → style entry ranges per style table tag (see comment above). */
export const STYLE_RANGES: ReadonlyMap<number, readonly SlotStyleRange[]> = new Map([
  [906, [TITLE_ROWS, { slot: TextSlot.Footnote, first: 6, count: 3 }]],
  [1102, [TITLE_ROWS, { slot: TextSlot.BulletList, first: 3, count: 1 }, { slot: TextSlot.Footnote, first: 4, count: 3 }]],
  [1202, [TITLE_ROWS, { slot: TextSlot.TableCells, first: 3, count: 1 }, { slot: TextSlot.Footnote, first: 4, count: 3 }]],
  [
    1308,
    [TITLE_ROWS, { slot: TextSlot.Footnote, first: 3, count: 3 }, { slot: TextSlot.PieTitles, first: 6, count: 6 }],
  ],
  [
    1412,
    [
      TITLE_ROWS,
      { slot: TextSlot.Footnote, first: 3, count: 3 },
      { slot: TextSlot.AxisTitles, first: 6, count: 3 },
      { slot: TextSlot.SeriesNames, first: 15, count: 1 },
    ],
  ],
]);

/** [I] Title chart (1002) section start rows: top, middle, bottom. */
export const TITLE_CHART_SECTION_ROWS = [0, 4, 12] as const;

/** Index of the style entry for a line of `slot`/`row` in `tag`'s table, or undefined. */
export function styleIndexFor(tag: number, slot: number, row: number): number | undefined {
  if (tag === 1002) {
    if (slot !== TextSlot.TitleChart) return undefined;
    let section = 0;
    TITLE_CHART_SECTION_ROWS.forEach((start, i) => {
      if (row >= start) section = i;
    });
    return section;
  }
  const range = STYLE_RANGES.get(tag)?.find((r) => r.slot === slot);
  if (!range) return undefined;
  return range.first + Math.min(Math.max(row, 0), range.count - 1);
}

/** The style table entry that goes with a line of this chart, if any. */
export function styleEntryFor(chart: Chart, line: Pick<TextLine, "slot" | "row">): StyleEntry | undefined {
  const tag = STYLE_TABLE_FOR_TYPE.get(chart.chartType);
  if (tag === undefined) return undefined;
  const table = chart.styleTables.get(tag);
  const index = styleIndexFor(tag, line.slot, line.row);
  if (!table || index === undefined) return undefined;
  return table[index];
}

/** The values a line is drawn with. */
export interface EffectiveTextStyle {
  size: number;
  color: number;
  justification: number;
  fontKey: FontKey;
  /** Which values came from the style table. */
  fromStyleTable: Array<"size" | "color" | "justification" | "fontKey">;
}

/**
 * The line's own size, colour, justification and font key; any that are
 * missing (size 0, colour 0, justification 0, font key all zero) are taken
 * from the style entry (SPEC §5.3 [I]). A style entry with size 0 is unused
 * and supplies nothing.
 */
export function effectiveStyle(
  line: Pick<TextLine, "size" | "color" | "justification" | "fontKey">,
  styleEntry?: StyleEntry,
): EffectiveTextStyle {
  const s = styleEntry && styleEntry.size !== 0 ? styleEntry : undefined;
  const fromStyleTable: EffectiveTextStyle["fromStyleTable"] = [];
  let { size, color, justification, fontKey } = line;
  if (s) {
    if (size === 0 && s.size !== 0) {
      size = s.size;
      fromStyleTable.push("size");
    }
    if (color === 0 && s.colorRole !== 0) {
      color = s.colorRole;
      fromStyleTable.push("color");
    }
    if (justification === 0 && s.justification !== 0) {
      justification = s.justification;
      fromStyleTable.push("justification");
    }
    if (isEmptyFontKey(fontKey) && !isEmptyFontKey(s.fontKey)) {
      fontKey = s.fontKey;
      fromStyleTable.push("fontKey");
    }
  }
  return { size, color, justification, fontKey, fromStyleTable };
}
