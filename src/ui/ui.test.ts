import { afterEach, describe, expect, it, vi } from "vitest";
import { DocumentType } from "../formats/hg3/container";
import { block, buildDocument, cstr, leaf } from "../formats/hg3/testing/bytes";
import { FileSet } from "../files/FileSet";
import type { LoadedFile } from "../files/loadFile";
import type { PresentationSlide } from "../model/presentation";
import { collectDiagnostics } from "./diagnostics";
import { fileKind } from "../files/fileKind";
import { groupFiles } from "./fileGroups";
import { hexRows, hexWindow, rowTouches } from "./hexRows";
import { createIdleTimer } from "./idleTimer";
import { recordTreeOf, visibleRows } from "./recordTree";

const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));

describe("groupFiles", () => {
  it("groups shows, charts and other files in that order, by signature then extension", () => {
    const files = [
      { name: "HG3.PL3" },
      { name: "B.CH3" },
      { name: "A.sh3" },
      { name: "ODD.BIN", bytes: ascii("HGB1....") },
      { name: "C.TXT", bytes: ascii("HGB3") },
      { name: "README" },
    ];
    const groups = groupFiles(files);
    expect(groups.map((g) => [g.kind, g.label, g.files.map((f) => f.name)])).toEqual([
      ["show", "Shows", ["A.sh3", "ODD.BIN"]],
      ["chart", "Charts", ["B.CH3", "C.TXT"]],
      ["other", "Other files", ["HG3.PL3", "README"]],
    ]);
  });

  it("leaves out empty groups", () => {
    expect(groupFiles([{ name: "X.PL3" }]).map((g) => g.kind)).toEqual(["other"]);
    expect(fileKind("noext")).toBe("other");
  });

  it("counts Harvard Graphics 1.x/2.x charts as charts", () => {
    expect(fileKind("OLD.CHT")).toBe("chart");
    expect(fileKind("ODD.BIN", ascii("PCOK...."))).toBe("chart");
    expect(fileKind("ODD.BIN", ascii("Falc...."))).toBe("chart");
  });
});

describe("recordTreeOf", () => {
  const bytes = buildDocument("HGB3", DocumentType.Title, [
    block(500, [leaf(400, cstr("Hi"))]),
    block(504, [block(516, [leaf(777, [1, 2])], new Uint8Array(16))]),
  ]);

  it("flattens records with depth, offsets and byte ranges", () => {
    const tree = recordTreeOf(bytes);
    if (!tree.ok) throw new Error(tree.error);
    const rows = tree.rows.map((r) => [r.kind, r.tag, r.depth, r.offset, r.length, r.start, r.end, r.name]);
    expect(rows).toEqual([
      ["signature", null, 0, 0, 4, 0, 4, "signature HGB3 (chart)"],
      ["record", 0, 0, 4, 4, 4, 12, "version"],
      // 500 open (4) + 400 record (4 + 3) + 501 close (4)
      ["block", 500, 0, 12, 0, 12, 27, "header block"],
      ["record", 400, 1, 16, 3, 16, 23, "description"],
      ["block", 504, 0, 27, 0, 27, 65, "page block"],
      ["block", 516, 1, 31, 16, 31, 61, "objectLayer block"],
      ["record", 777, 2, 51, 2, 51, 57, ""],
      ["record", 1, 0, 65, 0, 65, 69, "end"],
    ]);
    expect(tree.rows[tree.rows.length - 1].end).toBe(bytes.length);
  });

  it("hides rows inside collapsed blocks", () => {
    const tree = recordTreeOf(bytes);
    if (!tree.ok) throw new Error(tree.error);
    const shown = visibleRows(tree.rows, new Set(["27"]));
    expect(shown.map((r) => r.tag)).toEqual([null, 0, 500, 400, 504, 1]);
  });

  it("says why when the bytes are not HG3", () => {
    const tree = recordTreeOf(ascii("GIF89a"));
    expect(tree.ok).toBe(false);
  });
});

describe("hexRows", () => {
  const bytes = Uint8Array.from({ length: 40 }, (_, i) => i + 0x30);
  it("makes rows of 16 with absolute offsets", () => {
    const rows = hexRows(bytes, { start: 16, end: 40 });
    expect(rows.map((r) => [r.offset, r.hex.length])).toEqual([[16, 16], [32, 8]]);
    expect(rows[0].hex[0]).toBe("40");
    expect(rows[0].ascii[0]).toBe("@");
    expect(rowTouches(rows[1], { start: 39, end: 41 })).toBe(true);
    expect(rowTouches(rows[0], { start: 32, end: 33 })).toBe(false);
  });
  it("moves the window to a highlight past the first window", () => {
    expect(hexWindow(10000, 4096, null)).toEqual({ start: 0, end: 4096 });
    expect(hexWindow(10000, 4096, { start: 100, end: 120 })).toEqual({ start: 0, end: 4096 });
    expect(hexWindow(10000, 4096, { start: 5000, end: 5010 })).toEqual({ start: 4960, end: 9056 });
  });
});

describe("createIdleTimer", () => {
  afterEach(() => vi.useRealTimers());
  it("hides after the delay, shows again on activity, and stops when disposed", () => {
    vi.useFakeTimers();
    const changes: boolean[] = [];
    const t = createIdleTimer({ delayMs: 1000, onChange: (v) => changes.push(v) });
    expect(t.visible).toBe(true);
    vi.advanceTimersByTime(999);
    expect(t.visible).toBe(true);
    vi.advanceTimersByTime(1);
    expect(t.visible).toBe(false);
    t.poke();
    expect(t.visible).toBe(true);
    vi.advanceTimersByTime(600);
    t.poke(); // restarts the countdown
    vi.advanceTimersByTime(600);
    expect(t.visible).toBe(true);
    t.hold();
    vi.advanceTimersByTime(5000);
    expect(t.visible).toBe(true);
    t.poke();
    t.dispose();
    vi.advanceTimersByTime(5000);
    expect(t.visible).toBe(true);
    expect(changes).toEqual([false, true]);
  });
});

describe("collectDiagnostics", () => {
  function loaded(fileSet: FileSet, path: string): LoadedFile {
    const entry = fileSet.get(path)!;
    return {
      path,
      name: entry.name,
      bytes: entry.bytes,
      formatName: "test",
      document: null,
      error: null,
      warnings: ["doc warning"],
      missing: fileSet.missing(path),
      fileSet,
    };
  }

  it("reads missing files from the file set now, including names found after loading", () => {
    const set = new FileSet([{ path: "D/S.SH3", bytes: new Uint8Array() }, { path: "O.CH3", bytes: new Uint8Array() }]);
    set.resolve("FIRST.CH3", "D/S.SH3", "slide");
    const file = loaded(set, "D/S.SH3");
    expect(collectDiagnostics(file, null).missing.map((m) => m.name)).toEqual(["FIRST.CH3"]);
    // A lazy slide build asks for more later; another file's misses stay out.
    set.resolve("LATE.PL3", "D/S.SH3", "palette");
    set.resolve("OTHER.PL3", "O.CH3", "palette");
    const slide = { label: "Slide two", warnings: () => ["bad record"] } as unknown as PresentationSlide;
    const d = collectDiagnostics(file, slide);
    expect(d.missing.map((m) => m.name)).toEqual(["FIRST.CH3", "LATE.PL3"]);
    expect(d.slideWarnings).toEqual(["bad record"]);
    expect(d.slideLabel).toBe("Slide two");
    expect(d.count).toBe(4);
  });
});
