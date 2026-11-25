import { describe, expect, it } from "vitest";
import { baseName, FileSet } from "./FileSet";
import { choosePrimary } from "./choosePrimary";

const b = (n: number) => new Uint8Array([n]);

describe("baseName", () => {
  it("strips DOS directories, drives and padding", () => {
    expect(baseName("C:\\HG3\\DATA\\HG3.PL3")).toBe("HG3.PL3");
    expect(baseName("C:HG3.PL3")).toBe("HG3.PL3");
    expect(baseName("fonts/bx000003.spd")).toBe("bx000003.spd");
    expect(baseName("HG3.PL3\0\0  ")).toBe("HG3.PL3");
  });
});

describe("FileSet.resolve", () => {
  it("matches case-insensitively", () => {
    const set = new FileSet([{ path: "HG3.PL3", bytes: b(1) }]);
    expect(set.resolve("hg3.pl3")?.path).toBe("HG3.PL3");
    expect(set.resolve("Hg3.Pl3", "SALES.CH3")?.name).toBe("HG3.PL3");
  });

  it("strips a DOS path from the requested name", () => {
    const set = new FileSet([{ path: "show/PALETTE/HG3.PL3", bytes: b(1) }]);
    expect(set.resolve("C:\\HG3\\DATA\\hg3.pl3", "show/A.CH3")?.path).toBe("show/PALETTE/HG3.PL3");
  });

  it("prefers a file beside the naming file", () => {
    const set = new FileSet([
      { path: "HG3.PL3", bytes: b(1) },
      { path: "deep/dir/hg3.pl3", bytes: b(2) },
      { path: "other/HG3.PL3", bytes: b(3) },
    ]);
    expect(set.resolve("HG3.PL3", "Deep/Dir/CHART.CH3")?.bytes[0]).toBe(2);
    expect(set.resolve("HG3.PL3", "other/CHART.CH3")?.bytes[0]).toBe(3);
    expect(set.resolve("HG3.PL3", "CHART.CH3")?.bytes[0]).toBe(1);
  });

  it("breaks ties by shortest path, then alphabetically", () => {
    const set = new FileSet([
      { path: "zz/HG3.PL3", bytes: b(1) },
      { path: "aa/HG3.PL3", bytes: b(2) },
      { path: "a/b/HG3.PL3", bytes: b(3) },
    ]);
    expect(set.resolve("hg3.pl3", "x/CHART.CH3")?.path).toBe("aa/HG3.PL3");
    expect(set.resolve("hg3.pl3")?.path).toBe("aa/HG3.PL3");
  });

  it("records missing names with who asked, once each", () => {
    const set = new FileSet([{ path: "dir/A.CH3", bytes: b(1) }]);
    expect(set.resolve("C:\\HG3\\LOGO.PCX", "dir/A.CH3", "bitmap")).toBeNull();
    expect(set.resolve("C:\\HG3\\LOGO.PCX", "dir/A.CH3", "bitmap")).toBeNull();
    expect(set.resolve("HG3.PL3", "B.CH3")).toBeNull();
    expect(set.missing()).toEqual([
      { name: "LOGO.PCX", requestedBy: "dir/A.CH3", purpose: "bitmap" },
      { name: "HG3.PL3", requestedBy: "B.CH3" },
    ]);
    expect(set.missing("dir/A.CH3")).toHaveLength(1);
  });

  it("gives parsers a context bound to their own path", () => {
    const set = new FileSet([
      { path: "a/HG3.PL3", bytes: b(1) },
      { path: "b/HG3.PL3", bytes: b(2) },
    ]);
    const ctx = set.contextFor("b\\CHART.CH3");
    expect(ctx.path).toBe("b/CHART.CH3");
    expect(ctx.resolve("hg3.pl3")?.bytes[0]).toBe(2);
    expect(ctx.resolve("NOPE.PL3", "palette")).toBeNull();
    expect(set.missing("b/CHART.CH3")).toEqual([
      { name: "NOPE.PL3", requestedBy: "b/CHART.CH3", purpose: "palette" },
    ]);
  });

  it("finds without recording a miss (find, context.find)", () => {
    const set = new FileSet([
      { path: "a/HG3.PL3", bytes: b(1) },
      { path: "b/HG3.PL3", bytes: b(2) },
    ]);
    expect(set.find("C:\\HG3\\hg3.pl3", "b/X.CH3")?.path).toBe("b/HG3.PL3");
    expect(set.find("MONOCHRW.PL3", "b/X.CH3")).toBeNull();
    const ctx = set.contextFor("b/X.CH3");
    expect(ctx.find?.("hg3.pl3")?.bytes[0]).toBe(2);
    expect(ctx.find?.("MONOCHRB.PL3")).toBeNull();
    expect(set.missing()).toEqual([]);
  });

  it("replaces a file added twice at the same path", () => {
    const set = new FileSet([
      { path: "HG3.PL3", bytes: b(1) },
      { path: "HG3.PL3", bytes: b(2) },
    ]);
    expect(set.size).toBe(1);
    expect(set.resolve("hg3.pl3")?.bytes[0]).toBe(2);
  });
});

describe("choosePrimary", () => {
  const e = (...names: string[]) => names.map((name) => ({ name }));
  const none = () => false;

  it("picks the first show, then the first chart", () => {
    expect(choosePrimary(e("A.CH3", "HG3.PL3", "x.sh3", "Y.SH3"), none)?.name).toBe("x.sh3");
    expect(choosePrimary(e("HG3.PL3", "b.ch3", "C.CH3"), none)?.name).toBe("b.ch3");
    expect(choosePrimary(e("HG.DIR", "OLD.CHT", "b.ch3"), none)?.name).toBe("b.ch3");
    expect(choosePrimary(e("HG.DIR", "OLD.CHT"), none)?.name).toBe("OLD.CHT");
  });

  it("falls back to a recognised file, then the first file", () => {
    expect(choosePrimary(e("readme.txt", "OLD.CHT"), (x) => x.name === "OLD.CHT")?.name).toBe("OLD.CHT");
    expect(choosePrimary(e("readme.txt", "photo.jpg"), none)?.name).toBe("readme.txt");
    expect(choosePrimary([], none)).toBeNull();
  });
});
