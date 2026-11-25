import { describe, expect, it } from "vitest";
import { DocumentType } from "../container";
import { concat, i16, leaf, padded, u16, u8 } from "../testing/bytes";
import { parseOrgData } from "./org";
import { chartWith, textTail } from "./testing";

function field(text: string): Uint8Array {
  return concat(u8(18), padded(text, 23), textTail(text.length, 4), u8(0));
}

interface BoxSpec {
  name: string;
  title?: string;
  level: number;
  index: number;
  parent?: number;
  first?: number;
  next?: number;
  prev?: number;
  kids?: number;
  x?: number;
}

const link = (v?: number): Uint8Array => concat(u16(v === undefined ? 0 : 1), u16(v ?? 0));

function box(b: BoxSpec, withLinks = true): ReturnType<typeof leaf> {
  const fields = concat(u8(3), field(b.name), field(b.title ?? ""), field(""));
  if (!withLinks) return leaf(914, fields);
  const links = concat(
    i16(b.x ?? 0),
    i16(-1000 * b.level),
    i16(0),
    i16(0),
    u16(0),
    u16(0),
    u16(0),
    u16(0),
    u16(b.level),
    u16(b.kids ?? 0),
    u16(0),
    u16(256),
    u16(1),
    u16(b.index),
    link(b.parent),
    link(b.first),
    link(b.next),
    link(b.prev),
    new Uint8Array(4),
  );
  return leaf(914, concat(fields, links));
}

describe("parseOrgData", () => {
  it("reads fields and builds the tree from stored links, even out of tree order", () => {
    // 0 root; 1, 2 under 0; 3 under 2 listed before 4 under 1 (like GALD711's reversed last level).
    const chart = chartWith(DocumentType.Organization, [
      leaf(900, new Uint8Array(16)),
      leaf(912, new Uint8Array(17)),
      box({ name: "Boss", title: "President", level: 1, index: 0, first: 1, kids: 2 }),
      box({ name: "Ann", level: 2, index: 1, parent: 0, next: 2, first: 4, kids: 1, x: -500 }),
      box({ name: "Bob", level: 2, index: 2, parent: 0, prev: 1, first: 3, kids: 1, x: 500 }),
      box({ name: "Cy", level: 3, index: 3, parent: 2 }),
      box({ name: "Di", level: 3, index: 4, parent: 1 }),
    ]);
    const w: string[] = [];
    const d = parseOrgData(chart, w);
    expect(w).toEqual([]);
    expect(d.fromStoredLinks).toBe(true);
    expect(d.roots).toEqual([0]);
    const b = d.boxes;
    expect(b[0]!.name?.text).toBe("Boss");
    expect(b[0]!.title?.text).toBe("President");
    expect(b[0]!.name?.width).toBe(18);
    expect(b[0]!.name?.tail.color).toBe(4);
    expect(b[0]!.comment?.text).toBe("");
    expect(b[0]!.children).toEqual([1, 2]);
    expect(b[1]!.children).toEqual([4]);
    expect(b[2]!.children).toEqual([3]);
    expect(b[3]!.parent).toBe(2);
    expect(b[4]!.parent).toBe(1);
    expect(b.map((x) => x.level)).toEqual([1, 2, 2, 3, 3]);
    expect(b[1]!.links).toMatchObject({ x: -500, y: -2000, nextSibling: 2, prevSibling: null });
    expect(d.raw900?.length).toBe(16);
    expect(d.raw912?.length).toBe(17);
  });

  it("falls back to the SPEC level rule when links are missing", () => {
    const chart = chartWith(DocumentType.Organization, [
      box({ name: "A", level: 1, index: 0 }, false),
      box({ name: "B", level: 2, index: 1 }, false),
    ]);
    const w: string[] = [];
    const d = parseOrgData(chart, w);
    expect(d.fromStoredLinks).toBe(false);
    expect(d.boxes.map((x) => x.links)).toEqual([null, null]);
    // No stored levels: every box is a root at level 1.
    expect(d.roots).toEqual([0, 1]);
    expect(w.some((x) => x.includes("level rule"))).toBe(true);
    expect(w.some((x) => x.includes("expected 190"))).toBe(true);
  });

  it("uses the level rule when stored links are inconsistent", () => {
    const chart = chartWith(DocumentType.Organization, [
      box({ name: "A", level: 1, index: 0 }),
      box({ name: "B", level: 2, index: 7, parent: 0 }),
      box({ name: "C", level: 3, index: 2, parent: 1 }),
    ]);
    const w: string[] = [];
    const d = parseOrgData(chart, w);
    expect(d.fromStoredLinks).toBe(false);
    expect(d.boxes.map((x) => x.parent)).toEqual([null, 0, 1]);
  });

  it("does not throw on a very short box", () => {
    const w: string[] = [];
    const d = parseOrgData(chartWith(DocumentType.Organization, [leaf(914, [3, 18, 65])]), w);
    expect(d.boxes[0]!.name).toBeNull();
    expect(w.length).toBeGreaterThan(0);
  });
});
