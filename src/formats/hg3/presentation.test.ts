import { describe, expect, it } from "vitest";
import { baseName } from "../../files/FileSet";
import { clickButton, currentSlide, navigate, pressKey, startPlayer } from "../../player/player";
import type { ParseContext, Presentation, ResolvedFile, Scene, TextElement } from "../types";
import { DocumentType } from "./container";
import { hg3Parser } from "./index";
import { keyName } from "./presentation";
import { type RecordSpec, block, buildDocument, concat, cstr, leaf, padded, u16, u8 } from "./testing/bytes";

/** A 702 slide entry (SPEC §4.2). */
function slideEntry(number: number, kind: number, description = "", displayTime = -1): RecordSpec {
  const fixed = new Uint8Array(102);
  const dv = new DataView(fixed.buffer);
  dv.setUint16(0, number, true);
  fixed[2] = kind;
  fixed[12] = 9;
  dv.setInt16(14, displayTime, true);
  return leaf(702, concat(fixed, cstr(description)));
}
const slideRef = (index: number, name: string): RecordSpec => leaf(404, concat(u16(20), u16(index), cstr(name)));
const keyTable = (entries: number[][]): RecordSpec => leaf(704, concat(...entries));
const buttonTable = (entries: [string, number][]): RecordSpec =>
  leaf(706, concat(...entries.map(([n, d]) => concat(padded(n, 13), u8(d)))));

function showBytes(description: string, body: RecordSpec[]): Uint8Array {
  return buildDocument("HGB1", DocumentType.Show, [
    block(500, [leaf(400, cstr(description))]),
    block(520, [
      leaf(708, [0, 1, 2]),
      leaf(710, new Uint8Array(1941)),
      leaf(712, new Uint8Array(52)),
      leaf(714, [2, 2]),
      ...body,
    ]),
  ]);
}

/** A drawing whose background colour identifies it (no palette: default). */
function chartBytes(): Uint8Array {
  return buildDocument("HGB3", DocumentType.Drawing, [block(500, [leaf(400, cstr("c"))]), block(504, [block(508, [])])]);
}

/** A fake file set: resolves base names case-insensitively, records misses and parses. */
function fakeSet(files: Record<string, Uint8Array>) {
  const missing: string[] = [];
  const context = (path: string): ParseContext => ({
    path,
    resolve(name, purpose) {
      const key = Object.keys(files).find((k) => k.toLowerCase() === baseName(name).toLowerCase());
      if (!key) {
        missing.push(`${name} (${purpose})`);
        return null;
      }
      const file: ResolvedFile = { path: key, name: key, bytes: files[key] };
      return file;
    },
  });
  const open = (path: string) => hg3Parser.parse(files[path], path, context(path));
  return { open, missing };
}

const texts = (scene: Scene | null) =>
  (scene?.elements ?? []).filter((e): e is TextElement => e.kind === "text").map((e) => e.text);

describe("show → presentation", () => {
  const main = showBytes("Main show", [
    slideEntry(0, 0x2e),
    keyTable([
      [0x31, 0, 2, 0x55], // "1" → slide 2
      [0, 0x3d, 0xf5, 0], // F3 → previous
      [0, 0x3e, 0xf4, 0], // F4 → next
      [0x0d, 0, 0xf8, 0], // Enter → top
      [0, 0, 0, 0], // unused
    ]),
    slideEntry(1, DocumentType.Drawing, "First chart"),
    slideRef(1, "C:\\HG3\\DATA\\ONE.CH3"),
    buttonTable([
      ["NEXTPAL      ", 0xf4],
      ["lastview", 0xf3],
    ]),
    slideEntry(2, DocumentType.Drawing),
    slideRef(2, "GONE.CH3"),
    slideEntry(3, 0x2d, "placeholder"),
    slideEntry(4, 0x09, "", 0),
    slideRef(4, "BEEP.WAV"),
    slideEntry(5, 0x2e, "Inner"),
    slideRef(5, "INNER.SH3"),
    slideEntry(6, 0x2e, "Loop"),
    slideRef(6, "MAIN.SH3"),
  ]);
  const inner = showBytes("Inner show", [
    slideEntry(0, 0x2e),
    slideEntry(1, DocumentType.Drawing, "Inner chart"),
    slideRef(1, "one.ch3"),
    slideEntry(2, 0x2e, "Back to main"),
    slideRef(2, "MAIN.SH3"),
  ]);
  const files = { "MAIN.SH3": main, "INNER.SH3": inner, "ONE.CH3": chartBytes() };

  it("converts slides, keys and buttons", () => {
    const set = fakeSet(files);
    const doc = set.open("MAIN.SH3");
    expect(doc.scenes).toEqual([]);
    const p = doc.presentation as Presentation;
    expect(p.title).toBe("Main show");
    expect(p.id).toBe("MAIN.SH3");
    expect(p.firstSlide).toBe(1);
    expect(p.slides.map((s) => s.kind)).toEqual(["empty", "picture", "picture", "empty", "sound", "nested", "nested"]);
    expect(p.slides.map((s) => s.label)).toEqual([
      "Show",
      "First chart",
      "GONE.CH3",
      "placeholder",
      "BEEP.WAV",
      "Inner",
      "Loop",
    ]);
    expect(p.globalKeys).toEqual([
      { key: "1", destination: { kind: "slide", index: 2 } },
      { key: "F3", destination: { kind: "previous" } },
      { key: "F4", destination: { kind: "next" } },
      { key: "Enter", destination: { kind: "top" } },
    ]);
    expect(p.slides[1].buttons).toEqual([
      { name: "NEXTPAL", destination: { kind: "next" } },
      { name: "lastview", destination: { kind: "lastView" } },
    ]);
    expect(p.slides[1].waitForKey).toBe(true);
    expect(p.slides[4].waitForKey).toBe(false);
    expect(p.slides[1].transition).toEqual({ speed: 0, transitionA: 0, transitionB: 9 });
    // Files are looked up at once (so missing ones are listed), charts not yet parsed.
    expect(set.missing).toEqual(["GONE.CH3 (slide)"]);
    expect(doc.warnings).toContain("slide 2: file GONE.CH3 was not opened; shown as an empty slide");
  });

  it("builds chart scenes lazily and caches them; a missing file gives a placeholder with its name", () => {
    const p = fakeSet(files).open("MAIN.SH3").presentation as Presentation;
    const scene = p.slides[1].scene();
    expect(scene).not.toBeNull();
    expect(p.slides[1].scene()).toBe(scene);
    const missing = p.slides[2].scene();
    expect(texts(missing)).toContain("GONE.CH3");
    expect(p.slides[3].scene()).toBeNull();
    expect(p.slides[4].scene()).toBeNull();
  });

  it("plays through, entering the nested show and skipping self-inclusion", () => {
    const p = fakeSet(files).open("MAIN.SH3").presentation as Presentation;
    let s = startPlayer(p);
    const seen: string[] = [];
    while (!s.ended) {
      seen.push(currentSlide(s)!.label);
      s = navigate(s, { kind: "next" });
    }
    // INNER's slide 2 and MAIN's slide 6 both name MAIN.SH3, already playing.
    expect(seen).toEqual(["First chart", "GONE.CH3", "Inner chart"]);
    expect(p.slides[6].nested!()).toBeNull();
    expect(p.slides[6].warnings()).toEqual(["slide 6: nested show MAIN.SH3 includes itself; skipped"]);
    const innerP = p.slides[5].nested!()!;
    expect(innerP.slides[2].nested!()).toBeNull();
    expect(innerP.slides[2].warnings()[0]).toMatch(/includes itself/);
  });

  it("navigates with keys and buttons", () => {
    const p = fakeSet(files).open("MAIN.SH3").presentation as Presentation;
    let s = startPlayer(p);
    s = clickButton(s, "nextpal");
    expect(currentSlide(s)!.label).toBe("GONE.CH3");
    s = pressKey(s, "F3");
    expect(currentSlide(s)!.label).toBe("First chart");
    s = pressKey(s, "1");
    expect(currentSlide(s)!.label).toBe("GONE.CH3");
    s = pressKey(s, "Enter"); // bound to top
    expect(currentSlide(s)!.label).toBe("First chart");
  });

  it("reports a slide file that is not a chart", () => {
    const set = fakeSet({ "S.SH3": showBytes("s", [slideEntry(0, 0x2e), slideEntry(1, 0x29), slideRef(1, "X.CH3")]), "X.CH3": inner });
    const p = set.open("S.SH3").presentation as Presentation;
    expect(texts(p.slides[1].scene())).toContain("X.CH3");
    expect(p.slides[1].warnings()[0]).toMatch(/X\.CH3 cannot be drawn: it is a show/);
  });

  it("works without a file set (every slide file missing)", () => {
    const doc = hg3Parser.parse(main, "MAIN.SH3");
    const p = doc.presentation as Presentation;
    expect(texts(p.slides[1].scene())).toContain("C:\\HG3\\DATA\\ONE.CH3");
    expect(p.slides[5].nested!()).toBeNull();
  });
});

describe("keyName", () => {
  it("maps characters, control keys and scan codes", () => {
    expect(keyName({ char: 0x31, scanCode: 0 })).toBe("1");
    expect(keyName({ char: 0x20, scanCode: 0 })).toBe(" ");
    expect(keyName({ char: 0x0d, scanCode: 0 })).toBe("Enter");
    expect(keyName({ char: 0x1b, scanCode: 0 })).toBe("Escape");
    expect(keyName({ char: 0, scanCode: 0x3b })).toBe("F1");
    expect(keyName({ char: 0, scanCode: 0x44 })).toBe("F10");
    expect(keyName({ char: 0, scanCode: 0x49 })).toBe("PageUp");
    expect(keyName({ char: 0, scanCode: 0x01 })).toBeNull();
    expect(keyName({ char: 0x02, scanCode: 0 })).toBeNull();
  });
});
