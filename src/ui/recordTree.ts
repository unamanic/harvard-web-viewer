/**
 * Flattens the HG3 record tree (src/formats/hg3/container.ts) into rows for
 * the inspector: one row per record or block, with its depth and the bytes it
 * covers in the file.
 */
import {
  BLOCKS,
  TAG_DESCRIPTION,
  TAG_END,
  TAG_FILE_REFERENCE,
  TAG_VERSION,
  readContainer,
  type Container,
  type RecordNode,
} from "../formats/hg3/container";

/** Bytes of a record header (u16 tag, u16 length). */
const HEADER = 4;

export interface RecordRow {
  /** Stable key: the record's header offset (the signature row uses -1). */
  key: string;
  /** Keys of the enclosing blocks, outermost first. */
  ancestors: string[];
  depth: number;
  kind: "signature" | "record" | "block";
  /** Tag (the open tag for a block). */
  tag: number | null;
  /** Close tag of a block. */
  closeTag?: number;
  /** Header offset in the file. */
  offset: number;
  /** Data length of the record (the open record's data for a block). */
  length: number;
  /** First byte covered (header included). */
  start: number;
  /** One past the last byte covered (for a block: up to its close record). */
  end: number;
  /** Short description, e.g. "header block" or "file reference". */
  name: string;
  /** Records inside a block. */
  childCount?: number;
}

const BLOCK_NAMES: ReadonlyMap<number, string> = new Map(BLOCKS.map((b) => [b.open, b.name]));
const TAG_NAMES: ReadonlyMap<number, string> = new Map([
  [TAG_VERSION, "version"],
  [TAG_END, "end"],
  [TAG_DESCRIPTION, "description"],
  [TAG_FILE_REFERENCE, "file reference"],
]);

/** One past the last byte of a node; a block ends after its (assumed empty) close record. */
function nodeEnd(node: RecordNode): number {
  if (node.type === "record") return node.offset + HEADER + node.data.length;
  const last = node.children[node.children.length - 1];
  const inner = last ? nodeEnd(last) : node.offset + HEADER + node.data.length;
  return inner + HEADER;
}

/** Rows for a container's records, depth-first in file order, starting with the signature. */
export function flattenRecords(container: Container, fileLength: number): RecordRow[] {
  const rows: RecordRow[] = [
    {
      key: "-1",
      ancestors: [],
      depth: 0,
      kind: "signature",
      tag: null,
      offset: 0,
      length: 4,
      start: 0,
      end: Math.min(4, fileLength),
      name: `signature ${container.signature} (${container.kind})`,
    },
  ];
  const walk = (nodes: readonly RecordNode[], ancestors: string[]): void => {
    for (const node of nodes) {
      const key = String(node.offset);
      // Unclosed blocks of a damaged file are closed at the end of the file.
      const end = Math.min(nodeEnd(node), fileLength);
      if (node.type === "record") {
        rows.push({
          key,
          ancestors,
          depth: ancestors.length,
          kind: "record",
          tag: node.tag,
          offset: node.offset,
          length: node.data.length,
          start: node.offset,
          end,
          name: TAG_NAMES.get(node.tag) ?? "",
        });
      } else {
        rows.push({
          key,
          ancestors,
          depth: ancestors.length,
          kind: "block",
          tag: node.openTag,
          closeTag: node.closeTag,
          offset: node.offset,
          length: node.data.length,
          start: node.offset,
          end,
          name: `${BLOCK_NAMES.get(node.openTag) ?? "unknown"} block`,
          childCount: node.children.length,
        });
        walk(node.children, [...ancestors, key]);
      }
    }
  };
  walk(container.root, []);
  return rows;
}

/** Rows not hidden inside a collapsed block. */
export function visibleRows(rows: readonly RecordRow[], collapsed: ReadonlySet<string>): RecordRow[] {
  if (collapsed.size === 0) return rows.slice();
  return rows.filter((r) => !r.ancestors.some((a) => collapsed.has(a)));
}

export type RecordTreeResult =
  | { ok: true; rows: RecordRow[]; warnings: string[] }
  | { ok: false; error: string };

/** Read and flatten the bytes as an HG3 container, or say why not (not an HG3 file). */
export function recordTreeOf(bytes: Uint8Array): RecordTreeResult {
  try {
    const container = readContainer(bytes);
    return { ok: true, rows: flattenRecords(container, bytes.length), warnings: container.warnings };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
