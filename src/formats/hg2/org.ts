/**
 * The org chart options tail, identical in 1.0 (at 4570) and 2.x (at 10770
 * in tag 62); offsets relative to its start (docs/SPEC-HG1-HG2.md §4.6).
 */
import type { Bytes } from "./bytes";
import type { OrgData, OrgNode, OrgOptions } from "./model";

export function readOrgOptions(b: Bytes, t: number): OrgOptions {
  const levelsCode = b.u16(t + 4);
  const size = (o: number, fallback: number) => {
    const v = b.f32(t + o);
    return Number.isFinite(v) && v > 0 && v < 100 ? v : fallback;
  };
  return {
    // 1 = all; n + 1 shows n levels.
    levels: levelsCode > 1 ? levelsCode - 1 : 0,
    nameSize: size(6, 6),
    titleSize: size(10, 4),
    commentSize: size(14, 2.5),
    linesUpper: b.u8(t + 22) || 2,
    linesLast: b.u8(t + 23) || 1,
    titlesUpper: b.u8(t + 24) === 1,
    titlesLast: b.u8(t + 25) === 1,
    commentsUpper: b.u8(t + 26) === 1,
    commentsLast: b.u8(t + 27) === 1,
    nameStyle: b.u8(t + 28),
    titleStyle: b.u8(t + 29),
    commentStyle: b.u8(t + 30),
    nameColor: b.u8(t + 36) || 1,
    titleColor: b.u8(t + 37) || 1,
    commentColor: b.u8(t + 38) || 1,
    abbreviations: b.u8(t + 40) === 1,
    lastLevelVertical: b.u8(t + 41) === 1,
    shadow: b.u8(t + 54) === 1,
  };
}

/** Nodes and options tail shared by 1.0 and 2.x (§4.6). Offsets are relative to `b`. */
export function readOrgBody(b: Bytes, nodeBase: number, nodeCount: number, tail: number): OrgData {
  const options = readOrgOptions(b, tail);
  const raw = new Map<number, { node: OrgNode; firstChild: number; next: number }>();
  for (let n = 1; n <= nodeCount; n++) {
    const o = nodeBase + 130 * (n - 1);
    if (o + 130 > b.length) break;
    raw.set(n, {
      node: {
        id: n,
        name: b.pstring(o, 24),
        title: b.pstring(o + 24, 24),
        comment: b.pstring(o + 48, 24),
        abbreviation: b.pstring(o + 72, 36),
        parent: b.u16(o + 108),
        children: [],
        depth: b.u16(o + 126),
      },
      firstChild: b.u16(o + 110),
      next: b.u16(o + 112),
    });
  }
  const rootId = b.u16(tail) || 1;
  const seen = new Set<number>();
  const build = (id: number): OrgNode | null => {
    const entry = raw.get(id);
    if (!entry || seen.has(id)) return null;
    seen.add(id);
    let child = entry.firstChild;
    const children: OrgNode[] = [];
    while (child !== 0 && !seen.has(child)) {
      const c = build(child);
      if (!c) break;
      children.push(c);
      child = raw.get(child)?.next ?? 0;
    }
    entry.node.children = children;
    return entry.node;
  };
  const root = build(rootId);
  return { root, nodeCount: seen.size, options };
}

