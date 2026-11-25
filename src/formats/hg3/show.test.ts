import { describe, expect, it } from "vitest";
import { DocumentType, readContainer } from "./container";
import { decodeDestination, parseShow } from "./show";
import {
  type RecordSpec,
  block,
  buildDocument,
  concat,
  cstr,
  f64,
  i16,
  leaf,
  padded,
  u16,
  u8,
} from "./testing/bytes";

interface EntryOptions {
  number: number;
  kind: number;
  /** Offsets 5..7: Draw effect, direction, speed codes. */
  draw?: [number, number, number];
  /** Offsets 8..10: Erase effect, direction, speed codes. */
  erase?: [number, number, number];
  keyCount?: number;
  buttonCount?: number;
  /** Offset 14 (u16); 0xFFFF (the default) waits. */
  displayTime?: number;
  description?: string;
  b3?: number;
  b17?: number;
}

/** A 702 slide entry (SPEC §4.2). */
function slideEntry(o: EntryOptions): RecordSpec {
  const fixed = new Uint8Array(102);
  const dv = new DataView(fixed.buffer);
  dv.setUint16(0, o.number, true);
  fixed[2] = o.kind;
  fixed[3] = o.b3 ?? 0;
  fixed.set(o.draw ?? [0, 0, 0], 5);
  fixed.set(o.erase ?? [0, 0, 0], 8);
  fixed[11] = o.keyCount ?? 0;
  fixed[12] = o.buttonCount ?? 0;
  dv.setUint16(14, o.displayTime ?? 0xffff, true);
  fixed[17] = o.b17 ?? 0;
  return leaf(702, concat(fixed, cstr(o.description ?? "")));
}

const slideRef = (index: number, name: string): RecordSpec => leaf(404, concat(u16(20), u16(index), cstr(name)));
const keyTable = (entries: number[][]): RecordSpec => leaf(704, concat(...entries));
const buttonTable = (entries: [string, number][]): RecordSpec =>
  leaf(706, concat(...entries.map(([n, d]) => concat(padded(n, 13), u8(d)))));

function styleEntry(size: number, role: number): Uint8Array {
  return concat(f64(size), u8(role), u8(1), u16(3), u16(3), u16(0x4268));
}

function settings(): RecordSpec[] {
  return [
    leaf(708, [0, 1, 2]),
    leaf(710, new Uint8Array(1941)),
    leaf(712, concat([1, 2, 3, 4], styleEntry(10, 1), styleEntry(20, 2), styleEntry(30, 3))),
    leaf(714, [0, 0]),
  ];
}

function show(body: RecordSpec[], description = "My show") {
  const bytes = buildDocument("HGB1", DocumentType.Show, [
    block(500, [leaf(400, cstr(description))]),
    block(520, [...settings(), ...body]),
  ]);
  return parseShow(readContainer(bytes));
}

describe("parseShow", () => {
  it("reads a three-slide show", () => {
    const { show: s, warnings } = show([
      slideEntry({ number: 0, kind: 0x2e, keyCount: 5, draw: [1, 0, 0] }),
      keyTable([
        [0x31, 0, 2, 0x55],
        [0, 0x3c, 0xf3, 0x12],
        [0, 0, 0, 0],
        [0xfe, 0, 1, 0],
        [0, 0, 1, 0x33],
      ]),
      slideEntry({
        number: 1,
        kind: 0x15,
        draw: [9, 6, 3],
        erase: [10, 1, 1],
        buttonCount: 2,
        displayTime: 50,
        description: "Pie",
      }),
      slideRef(1, "PIE.CH3"),
      buttonTable([
        ["next  ", 0xf4],
        ["home", 0xf8],
      ]),
      slideEntry({ number: 2, kind: 0x2d }),
    ]);
    expect(warnings).toEqual([]);
    expect(s.description).toBe("My show");
    expect(s.settings.raw708).toEqual(Uint8Array.of(0, 1, 2));
    expect(s.settings.raw710?.length).toBe(1941);
    expect(s.settings.raw712Prefix).toEqual(Uint8Array.of(1, 2, 3, 4));
    expect(s.settings.styles712.map((e) => e.size)).toEqual([10, 20, 30]);
    expect(s.settings.raw714).toEqual(Uint8Array.of(0, 0));
    expect(s.slides.map((x) => x.kindName)).toEqual(["show", "chart", "empty"]);

    const [s0, s1, s2] = s.slides;
    expect(s0.fileName).toBeNull();
    expect(s.globalKeys).toBe(s0.keys);
    expect(s.globalKeys).toEqual([
      { char: 0x31, scanCode: 0, destination: { kind: "slide", index: 2, raw: 2 }, raw3: 0x55, unused: false },
      { char: 0, scanCode: 0x3c, destination: { kind: "lastView", raw: 0xf3 }, raw3: 0x12, unused: false },
      { char: 0, scanCode: 0, destination: { kind: "none", raw: 0 }, raw3: 0, unused: true },
      { char: 0xfe, scanCode: 0, destination: { kind: "slide", index: 1, raw: 1 }, raw3: 0, unused: true },
      { char: 0, scanCode: 0, destination: { kind: "slide", index: 1, raw: 1 }, raw3: 0x33, unused: true },
    ]);

    expect(s1).toMatchObject({
      number: 1,
      kind: 0x15,
      chartType: 0x15,
      chartTypeName: "Pie",
      fileName: "PIE.CH3",
      fileRefIndex: 1,
      draw: { effect: "iris", direction: "out", speed: "fast" },
      erase: { effect: "keep", direction: "left", speed: "slow" },
      keyCount: 0,
      buttonCount: 2,
      displaySeconds: 50,
      description: "Pie",
      keys: [],
    });
    expect(s1.raw702.length).toBe(106);
    expect(s1.raw.b18to101.length).toBe(84);
    expect(s1.raw.b5to10).toEqual(Uint8Array.of(9, 6, 3, 10, 1, 1));
    expect(s1.raw.b12).toBe(2);
    expect(s.defaultDraw).toBe("replace");
    expect(s.settings.recalculate).toBe(false);
    expect(s1.buttons).toEqual([
      { name: "next", destination: { kind: "next", raw: 0xf4 } },
      { name: "home", destination: { kind: "top", raw: 0xf8 } },
    ]);

    expect(s2).toMatchObject({
      kindName: "empty",
      fileName: null,
      displaySeconds: null,
      description: "",
      draw: { effect: null, direction: null, speed: null },
      erase: { effect: null, direction: null, speed: null },
    });
  });

  it("decodes display time in seconds: 0xFFFF is null (wait for a key), 0 at once", () => {
    const { show: s } = show([
      slideEntry({ number: 0, kind: 0x2e }),
      slideEntry({ number: 1, kind: 0x2d, displayTime: 0xffff }),
      slideEntry({ number: 2, kind: 0x2d, displayTime: 0 }),
      slideEntry({ number: 3, kind: 0x2d, displayTime: 5 }),
      slideEntry({ number: 4, kind: 0x2d, displayTime: 90 }),
      slideEntry({ number: 5, kind: 0x2d, displayTime: 359 }),
    ]);
    expect(s.slides.map((x) => x.displaySeconds)).toEqual([null, null, 0, 5, 90, 359]);
    expect(s.slides[1].raw.u14).toBe(0xffff);
  });

  // Synthetic copies of the settings in the HG 3.05 test shows (one setting changed at a time).
  describe("transition bytes (702 offsets 5..10)", () => {
    const effects = ["replace", "overlay", "wipe", "scroll", "fade", "open", "close", "blinds", "iris"];
    const directions = ["left", "right", "up", "down", "in", "out"];
    const speeds = ["slow", "medium", "fast"];
    const slide2 = (o: Partial<EntryOptions>) => {
      const { show: s, warnings } = show([slideEntry({ number: 0, kind: 0x2e, draw: [1, 0, 0] }), slideEntry({ number: 1, kind: 0x2d, ...o })]);
      return { slide: s.slides[1], warnings };
    };

    it("Draw effect codes 1..9 in the editor's order; Keep (10) is not a Draw effect", () => {
      effects.forEach((effect, i) => expect(slide2({ draw: [i + 1, 0, 0] }).slide.draw.effect).toBe(effect));
      const keep = slide2({ draw: [10, 0, 0] });
      expect(keep.slide.draw.effect).toBeNull();
      expect(keep.warnings).toEqual(["slide 1: unknown draw effect code 10; read as blank"]);
    });

    it("Draw direction and speed codes", () => {
      directions.forEach((d, i) => expect(slide2({ draw: [9, i + 1, 0] }).slide.draw).toEqual({ effect: "iris", direction: d, speed: null }));
      speeds.forEach((sp, i) => expect(slide2({ draw: [9, 6, i + 1] }).slide.draw).toEqual({ effect: "iris", direction: "out", speed: sp }));
    });

    it("Erase effect codes 1..10 (Keep), direction and speed", () => {
      [...effects, "keep"].forEach((effect, i) => expect(slide2({ erase: [i + 1, 0, 0] }).slide.erase.effect).toBe(effect));
      directions.forEach((d, i) => expect(slide2({ erase: [10, i + 1, 0] }).slide.erase.direction).toBe(d));
      speeds.forEach((sp, i) => expect(slide2({ erase: [10, 6, i + 1] }).slide.erase.speed).toBe(sp));
    });

    it("unknown codes read as blank with a warning", () => {
      const { slide, warnings } = slide2({ draw: [12, 7, 4], erase: [11, 0, 0] });
      expect(slide.draw).toEqual({ effect: null, direction: null, speed: null });
      expect(slide.erase.effect).toBeNull();
      expect(warnings).toEqual([
        "slide 1: unknown draw effect code 12; read as blank",
        "slide 1: unknown draw direction code 7; read as blank",
        "slide 1: unknown draw speed code 4; read as blank",
        "slide 1: unknown erase effect code 11; read as blank",
      ]);
    });

    it("the show default is slide 0's Draw effect", () => {
      const { show: s } = show([slideEntry({ number: 0, kind: 0x2e, draw: [2, 0, 0] })]);
      expect(s.defaultDraw).toBe("overlay");
    });
  });

  it("reads the HyperShow automatic recalculation flag from 708 byte 2", () => {
    const parse = (b: number) => {
      const bytes = buildDocument("HGB1", DocumentType.Show, [
        block(500, [leaf(400, cstr("s"))]),
        block(520, [leaf(708, [1, 1, b]), ...settings().slice(1), slideEntry({ number: 0, kind: 0x2e })]),
      ]);
      return parseShow(readContainer(bytes));
    };
    expect(parse(1).show.settings.recalculate).toBe(true);
    expect(parse(2).show.settings.recalculate).toBe(false);
    const other = parse(0);
    expect(other.show.settings.recalculate).toBeNull();
    expect(other.warnings).toEqual(["settings record 708 byte 2 (automatic recalculation) is 0, expected 1 or 2"]);
  });

  it("checks the key and button counts against the 704 and 706 tables", () => {
    const { warnings } = show([
      slideEntry({ number: 0, kind: 0x2e }),
      slideEntry({ number: 1, kind: 0x2d, keyCount: 2, buttonCount: 1 }),
      keyTable([[0x31, 0, 0xf4, 0]]),
      buttonTable([
        ["a", 0xf4],
        ["b", 0xf5],
      ]),
      // As in 10 sample tables: an entry naming no key is not counted.
      slideEntry({ number: 2, kind: 0x2d, keyCount: 2 }),
      keyTable([
        [0x31, 0, 0xf4, 0],
        [0, 0, 0x12, 0x34],
        [0, 0x3b, 0xf5, 0],
      ]),
    ]);
    expect(warnings).toEqual([
      "slide 1: slide entry gives 2 key(s), the key table (704) has 1; all are used",
      "slide 1: slide entry gives 1 button(s), the button table (706) has 2; all are used",
    ]);
  });

  it("keeps raw bytes", () => {
    const { show: s } = show([slideEntry({ number: 0, kind: 0x2e, b3: 1, b17: 3 })]);
    expect(s.slides[0].raw.b3).toBe(1);
    expect(s.slides[0].raw.b17).toBe(3);
  });

  it("treats an unknown kind as empty with a warning", () => {
    const { show: s, warnings } = show([slideEntry({ number: 0, kind: 0x2e }), slideEntry({ number: 1, kind: 0x9f })]);
    expect(s.slides[1].kindName).toBe("unknown");
    expect(warnings.some((w) => /unknown kind 0x9f.*empty/.test(w))).toBe(true);
  });

  it("warns when the 404 index does not match the slide number", () => {
    const { show: s, warnings } = show([
      slideEntry({ number: 0, kind: 0x2e }),
      slideEntry({ number: 1, kind: 0x01 }),
      slideRef(5, "XY.CH3"),
    ]);
    expect(s.slides[1].fileName).toBe("XY.CH3");
    expect(s.slides[1].fileRefIndex).toBe(5);
    expect(warnings.some((w) => /index 5 does not match/.test(w))).toBe(true);
  });

  it("recognises sound, MIDI and nested-show slides", () => {
    const { show: s, warnings } = show([
      slideEntry({ number: 0, kind: 0x2e }),
      slideEntry({ number: 1, kind: 0x09 }),
      slideRef(1, "A.WAV"),
      slideEntry({ number: 2, kind: 0x0a }),
      slideRef(2, "B.MID"),
      slideEntry({ number: 3, kind: 0x2e }),
      slideRef(3, "SUB.SH3"),
    ]);
    expect(warnings).toEqual([]);
    expect(s.slides.map((x) => [x.kindName, x.fileName])).toEqual([
      ["show", null],
      ["sound", "A.WAV"],
      ["midi", "B.MID"],
      ["show", "SUB.SH3"],
    ]);
  });

  it("keeps unknown body records raw with a warning", () => {
    const { show: s, warnings } = show([
      leaf(999, [1]),
      slideEntry({ number: 0, kind: 0x2e }),
      leaf(998, [2, 3]),
      leaf(404, concat(u16(1), u16(0), cstr("BTN.CH3"))),
    ]);
    expect(s.otherRecords).toHaveLength(1);
    expect(s.slides[0].otherRecords.map((r) => (r.type === "record" ? r.tag : -1))).toEqual([998, 404]);
    expect(warnings.filter((w) => /kept raw/.test(w))).toHaveLength(3);
  });

  it("tolerates a short 702 and missing settings", () => {
    const bytes = buildDocument("HGB1", DocumentType.Show, [
      block(500, [leaf(400, cstr(""))]),
      block(520, [leaf(702, concat(u16(0), u8(0x2e), i16(0)))]),
    ]);
    const { show: s, warnings } = parseShow(readContainer(bytes));
    expect(s.slides).toHaveLength(1);
    expect(s.settings.raw708).toBeNull();
    expect(warnings.some((w) => /missing bytes read as 0/.test(w))).toBe(true);
    expect(warnings.some((w) => /no settings record 710/.test(w))).toBe(true);
  });

  it("throws for a chart container", () => {
    const bytes = buildDocument("HGB3", DocumentType.Pie, []);
    expect(() => parseShow(readContainer(bytes))).toThrow(/not a show/);
  });
});

describe("decodeDestination", () => {
  it("decodes slide numbers and special bytes", () => {
    expect(decodeDestination(3, 10)).toEqual({ kind: "slide", index: 3, raw: 3 });
    expect(decodeDestination(0, 10)).toEqual({ kind: "none", raw: 0 });
    expect(decodeDestination(10, 10)).toEqual({ kind: "unknown", raw: 10 });
    expect(decodeDestination(0xf3, 10).kind).toBe("lastView");
    expect(decodeDestination(0xf4, 10).kind).toBe("next");
    expect(decodeDestination(0xf5, 10).kind).toBe("previous");
    expect(decodeDestination(0xf6, 10).kind).toBe("edit");
    expect(decodeDestination(0xf7, 10).kind).toBe("edit");
    expect(decodeDestination(0xf8, 10).kind).toBe("top");
    expect(decodeDestination(0x96, 10)).toEqual({ kind: "top", raw: 0x96 });
    expect(decodeDestination(0x97, 10).kind).toBe("top");
    expect(decodeDestination(0xf9, 10).kind).toBe("unknown");
    // A slide-count-sized show still gives special bytes priority.
    expect(decodeDestination(0x96, 300).kind).toBe("top");
  });
});
