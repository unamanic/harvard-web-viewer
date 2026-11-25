import { describe, expect, it } from "vitest";
import {
  LANDSCAPE_VIEW_BOX,
  type ButtonBinding,
  type KeyBinding,
  type Presentation,
  type PresentationSlide,
  type PresentationSlideKind,
  type Scene,
} from "../formats/types";
import {
  type PlayerState,
  MAX_DEPTH,
  clickButton,
  currentSlide,
  describePosition,
  jumpTo,
  navigate,
  pressKey,
  resolveKey,
  restorePlayer,
  savePosition,
  startPlayer,
} from "./player";

interface SlideSpec {
  label: string;
  kind?: PresentationSlideKind;
  keys?: KeyBinding[];
  buttons?: ButtonBinding[];
  nested?: () => Presentation | null;
}

function slide(spec: SlideSpec): PresentationSlide {
  const kind = spec.kind ?? "picture";
  const scene: Scene | null = kind === "picture" ? { viewBox: LANDSCAPE_VIEW_BOX, background: spec.label, elements: [] } : null;
  const out: PresentationSlide = {
    label: spec.label,
    kind,
    fileName: null,
    scene: () => scene,
    warnings: () => [],
    keys: spec.keys ?? [],
    buttons: spec.buttons ?? [],
    waitForKey: kind !== "sound",
  };
  if (spec.nested) out.nested = spec.nested;
  return out;
}

/** Slide 0 is the show placeholder, as in HG3. */
function show(id: string, slides: SlideSpec[], globalKeys: KeyBinding[] = []): Presentation {
  return {
    id,
    title: id,
    slides: [slide({ label: `${id}:0`, kind: "empty" }), ...slides.map(slide)],
    firstSlide: 1,
    globalKeys,
  };
}

const label = (s: PlayerState) => currentSlide(s)?.label ?? (s.ended ? "ended" : "none");
const keys = (s: PlayerState, ...ks: string[]) => ks.reduce(pressKey, s);

describe("player", () => {
  it("starts at slide 1 and walks to the end", () => {
    let s = startPlayer(show("A", [{ label: "a1" }, { label: "a2" }]));
    expect(label(s)).toBe("a1");
    s = navigate(s, { kind: "next" });
    expect(label(s)).toBe("a2");
    s = navigate(s, { kind: "next" });
    expect(s.ended).toBe(true);
    expect(currentSlide(s)).toBeNull();
    // Further "next" stays ended; "previous" shows the last slide again.
    expect(navigate(s, { kind: "next" })).toBe(s);
    expect(label(navigate(s, { kind: "previous" }))).toBe("a2");
  });

  it("skips empty and sound slides in both directions", () => {
    const p = show("A", [
      { label: "e1", kind: "empty" },
      { label: "a2" },
      { label: "snd", kind: "sound" },
      { label: "e4", kind: "empty" },
      { label: "a5" },
    ]);
    let s = startPlayer(p);
    expect(label(s)).toBe("a2");
    s = navigate(s, { kind: "next" });
    expect(label(s)).toBe("a5");
    s = navigate(s, { kind: "previous" });
    expect(label(s)).toBe("a2");
  });

  it("stays put on previous at the first slide", () => {
    const s = startPlayer(show("A", [{ label: "a1" }, { label: "a2" }]));
    expect(navigate(s, { kind: "previous" })).toBe(s);
  });

  it("reports an empty show", () => {
    const s = startPlayer(show("A", [{ label: "e", kind: "empty" }]));
    expect(s.empty).toBe(true);
    expect(s.ended).toBe(true);
    expect(navigate(s, { kind: "next" })).toBe(s);
  });

  it("uses default keys: Enter/Space/Right/PageDown next, Backspace/Left/PageUp previous, Escape ends", () => {
    const s = startPlayer(show("A", [{ label: "a1" }, { label: "a2" }, { label: "a3" }]));
    for (const k of ["Enter", " ", "ArrowRight", "PageDown"]) expect(label(pressKey(s, k))).toBe("a2");
    const at3 = keys(s, "Enter", "Enter");
    for (const k of ["Backspace", "ArrowLeft", "PageUp"]) expect(label(pressKey(at3, k))).toBe("a2");
    expect(pressKey(s, "Escape").ended).toBe(true);
    expect(pressKey(s, "x")).toBe(s);
  });

  it("looks keys up in the slide table, then the show-wide table, then the defaults", () => {
    const p = show(
      "A",
      [
        { label: "a1", keys: [{ key: "x", destination: { kind: "slide", index: 3 } }] },
        { label: "a2" },
        { label: "a3", keys: [{ key: "Enter", destination: { kind: "slide", index: 1 } }] },
      ],
      [
        { key: "x", destination: { kind: "slide", index: 2 } },
        { key: "1", destination: { kind: "slide", index: 2 } },
        { key: "Enter", destination: { kind: "none" } },
      ],
    );
    const s = startPlayer(p);
    expect(label(pressKey(s, "x"))).toBe("a3"); // slide table wins
    expect(label(pressKey(s, "1"))).toBe("a2"); // show-wide
    expect(label(pressKey(s, "X"))).toBe("a3"); // case-insensitive fallback
    expect(pressKey(s, "Enter")).toBe(s); // a "none" binding switches the default off
    const at3 = pressKey(s, "x");
    expect(label(pressKey(at3, "x"))).toBe("a2"); // a3 has no "x": show-wide applies
    expect(label(pressKey(at3, "Enter"))).toBe("a1"); // the slide table comes before the show-wide "none"
    expect(resolveKey(at3, "Escape")).toEqual({ kind: "end" });
  });

  it("follows F-key destinations: lastView, previous, next (gallery style)", () => {
    const p = show(
      "G",
      [{ label: "menu" }, { label: "s2" }, { label: "s3" }, { label: "s4" }, { label: "s5" }],
      [
        { key: "F2", destination: { kind: "lastView" } },
        { key: "F3", destination: { kind: "previous" } },
        { key: "F4", destination: { kind: "next" } },
        { key: "4", destination: { kind: "slide", index: 4 } },
        { key: "e", destination: { kind: "edit" } },
      ],
    );
    let s = startPlayer(p);
    s = pressKey(s, "F4");
    expect(label(s)).toBe("s2");
    s = pressKey(s, "F3");
    expect(label(s)).toBe("menu");
    s = pressKey(s, "4");
    expect(label(s)).toBe("s4");
    s = pressKey(s, "F2");
    expect(label(s)).toBe("menu"); // the slide viewed before s4
    s = pressKey(s, "F2");
    expect(label(s)).toBe("s4"); // and back again
    expect(pressKey(s, "e")).toBe(s); // edit does nothing
  });

  it("lets a slide switch off a show-wide key with a \"none\" binding (gallery help slides)", () => {
    const p = show(
      "G",
      [{ label: "s1" }, { label: "help", keys: [{ key: "F4", destination: { kind: "none" } }] }, { label: "s3" }],
      [{ key: "F4", destination: { kind: "next" } }],
    );
    const atHelp = pressKey(startPlayer(p), "F4");
    expect(label(atHelp)).toBe("help");
    expect(pressKey(atHelp, "F4")).toBe(atHelp);
  });

  it("does nothing for lastView without history and for out-of-range slides", () => {
    const s = startPlayer(show("A", [{ label: "a1" }, { label: "a2" }]));
    expect(navigate(s, { kind: "lastView" })).toBe(s);
    expect(navigate(s, { kind: "slide", index: 0 })).toBe(s);
    expect(navigate(s, { kind: "slide", index: 9 })).toBe(s);
    expect(navigate(s, { kind: "none" })).toBe(s);
  });

  it("goes on past an empty destination slide", () => {
    const s = startPlayer(show("A", [{ label: "a1" }, { label: "e", kind: "empty" }, { label: "a3" }]));
    expect(label(navigate(s, { kind: "slide", index: 2 }))).toBe("a3");
  });

  it("clicks buttons ignoring case and trailing spaces", () => {
    const p = show("A", [
      {
        label: "a1",
        buttons: [
          { name: "NextPal  ", destination: { kind: "next" } },
          { name: "third", destination: { kind: "slide", index: 3 } },
        ],
      },
      { label: "a2" },
      { label: "a3" },
    ]);
    const s = startPlayer(p);
    expect(label(clickButton(s, "nextpal"))).toBe("a2");
    expect(label(clickButton(s, "THIRD "))).toBe("a3");
    expect(clickButton(s, "nothing")).toBe(s);
    // a2 has no buttons.
    const at2 = clickButton(s, "nextpal");
    expect(clickButton(at2, "nextpal")).toBe(at2);
  });

  it("plays a nested show and returns to the next slide of the parent", () => {
    const inner = show("B", [{ label: "b1" }, { label: "e", kind: "empty" }, { label: "b3" }], [
      { key: "2", destination: { kind: "slide", index: 1 } },
    ]);
    const outer = show(
      "A",
      [{ label: "a1" }, { label: "nest", kind: "nested", nested: () => inner }, { label: "a3" }],
      [{ key: "2", destination: { kind: "slide", index: 3 } }],
    );
    let s = startPlayer(outer);
    s = navigate(s, { kind: "next" });
    expect(label(s)).toBe("b1");
    expect(describePosition(s).map((p) => p.index)).toEqual([2, 1]);
    s = navigate(s, { kind: "next" });
    expect(label(s)).toBe("b3");
    // Inside B, "2" uses B's own table and slide numbers.
    expect(label(pressKey(s, "2"))).toBe("b1");
    s = navigate(s, { kind: "next" });
    expect(label(s)).toBe("a3");
    expect(label(pressKey(s, "2"))).toBe("a3");
    // Going back enters the nested show at its end, then leaves it at its start.
    s = navigate(s, { kind: "previous" });
    expect(label(s)).toBe("b3");
    s = navigate(navigate(s, { kind: "previous" }), { kind: "previous" });
    expect(label(s)).toBe("a1");
  });

  it("goes to the outermost show's first slide on top", () => {
    const inner = show("B", [{ label: "b1" }, { label: "b2" }]);
    const outer = show("A", [
      { label: "e", kind: "empty" },
      { label: "a2" },
      { label: "nest", kind: "nested", nested: () => inner },
    ]);
    let s = keys(startPlayer(outer), "Enter", "Enter");
    expect(label(s)).toBe("b2");
    s = navigate(s, { kind: "top" });
    expect(label(s)).toBe("a2");
    expect(s.position).toHaveLength(1);
    // "top" also restarts an ended show.
    const ended = navigate(s, { kind: "end" });
    expect(label(navigate(ended, { kind: "top" }))).toBe("a2");
  });

  it("skips a nested show that includes itself, or is missing", () => {
    const self: Presentation = show("A", [
      { label: "a1" },
      { label: "loop", kind: "nested", nested: () => self },
      { label: "gone", kind: "nested", nested: () => null },
      { label: "a4" },
    ]);
    let s = startPlayer(self);
    s = navigate(s, { kind: "next" });
    expect(label(s)).toBe("a4");
    expect(s.position).toHaveLength(1);
  });

  it("stops nesting at MAX_DEPTH even when every level has a new id", () => {
    let n = 0;
    const make = (): Presentation => {
      n++;
      return show(`P${n}`, [{ label: `deep${n}`, kind: "nested", nested: make }, { label: `after${n}` }]);
    };
    const s = startPlayer(make());
    expect(s.position).toHaveLength(MAX_DEPTH);
    expect(label(s)).toBe(`after${MAX_DEPTH}`);
  });

  it("ends when the nested show is the last slide and finishes", () => {
    const inner = show("B", [{ label: "b1" }]);
    let s = startPlayer(show("A", [{ label: "a1" }, { label: "nest", kind: "nested", nested: () => inner }]));
    s = navigate(navigate(s, { kind: "next" }), { kind: "next" });
    expect(s.ended).toBe(true);
  });

  it("navigates a three-slide show with a key table and one button (task 22 done-when)", () => {
    const p = show(
      "T",
      [
        { label: "one", buttons: [{ name: "goto3", destination: { kind: "slide", index: 3 } }] },
        { label: "two" },
        { label: "three", keys: [{ key: "F1", destination: { kind: "top" } }] },
      ],
      [{ key: "2", destination: { kind: "slide", index: 2 } }],
    );
    let s = startPlayer(p);
    s = clickButton(s, "GOTO3");
    expect(label(s)).toBe("three");
    s = pressKey(s, "2");
    expect(label(s)).toBe("two");
    s = pressKey(s, "Enter");
    expect(label(s)).toBe("three");
    s = pressKey(s, "F1");
    expect(label(s)).toBe("one");
    s = pressKey(s, "Escape");
    expect(s.ended).toBe(true);
  });

  describe("sound side effects", () => {
    const sounds = (s: PlayerState) => s.sounds.map((x) => x.label);

    it("lists the sound slides passed moving forward, and only then", () => {
      const p = show("A", [{ label: "a1" }, { label: "s1", kind: "sound" }, { label: "a3" }, { label: "a4" }]);
      let s = startPlayer(p);
      expect(sounds(s)).toEqual([]);
      s = navigate(s, { kind: "next" });
      expect(label(s)).toBe("a3");
      expect(sounds(s)).toEqual(["s1"]);
      s = navigate(s, { kind: "next" });
      expect(sounds(s)).toEqual([]);
      // Backwards over the sound slide: nothing to play.
      s = navigate(navigate(s, { kind: "previous" }), { kind: "previous" });
      expect(label(s)).toBe("a1");
      expect(sounds(s)).toEqual([]);
      // lastView goes back to a3 without passing anything.
      expect(sounds(navigate(s, { kind: "lastView" }))).toEqual([]);
    });

    it("lists several sound slides in a row, and those before the first picture", () => {
      const p = show("A", [{ label: "s0", kind: "sound" }, { label: "a1" }, { label: "s2", kind: "sound" }, { label: "e", kind: "empty" }, { label: "s3", kind: "sound" }, { label: "a4" }]);
      let s = startPlayer(p);
      expect(label(s)).toBe("a1");
      expect(sounds(s)).toEqual(["s0"]);
      s = navigate(s, { kind: "next" });
      expect(sounds(s)).toEqual(["s2", "s3"]);
    });

    it("reports sounds passed when the show runs off the end (PLAY_ALL: a menu, then sound slides)", () => {
      const p = show("PLAY_ALL", [
        { label: "menu", keys: [{ key: "1", destination: { kind: "slide", index: 2 } }, { key: "7", destination: { kind: "slide", index: 8 } }] },
        ...["RIMSHOT.WAV", "SPFAIRY.MID", "PETE&WLF.MID", "CANNON_D.MID", "INVENT8.MID", "ACTION1.MID", "IMAGE2.MID"].map(
          (l) => ({ label: l, kind: "sound" as const }),
        ),
      ]);
      const s = startPlayer(p);
      const one = pressKey(s, "1");
      expect(one.ended).toBe(true);
      expect(sounds(one)).toEqual(["RIMSHOT.WAV", "SPFAIRY.MID", "PETE&WLF.MID", "CANNON_D.MID", "INVENT8.MID", "ACTION1.MID", "IMAGE2.MID"]);
      expect(sounds(pressKey(s, "7"))).toEqual(["IMAGE2.MID"]);
      expect(sounds(navigate(s, { kind: "next" }))).toHaveLength(7);
      // Going back to the menu after the end, and Escape, play nothing.
      expect(sounds(navigate(one, { kind: "previous" }))).toEqual([]);
      expect(sounds(pressKey(s, "Escape"))).toEqual([]);
      expect(sounds(navigate(one, { kind: "top" }))).toEqual([]);
    });

    it("lists sounds inside nested shows and on top", () => {
      const inner = show("B", [{ label: "bs", kind: "sound" }, { label: "b1" }]);
      const p = show("A", [{ label: "as", kind: "sound" }, { label: "a1" }, { label: "nest", kind: "nested", nested: () => inner }]);
      let s = startPlayer(p);
      expect(sounds(s)).toEqual(["as"]);
      s = navigate(s, { kind: "next" });
      expect(label(s)).toBe("b1");
      expect(sounds(s)).toEqual(["bs"]);
      s = navigate(s, { kind: "top" });
      expect(label(s)).toBe("a1");
      expect(sounds(s)).toEqual(["as"]);
      // Previous from b1 leaves the nested show backwards: nothing.
      expect(sounds(navigate(navigate(s, { kind: "next" }), { kind: "previous" }))).toEqual([]);
    });
  });

  describe("jumpTo (slide strip)", () => {
    const nested = show("B", [{ label: "b1" }, { label: "b2" }]);
    const p = show("A", [{ label: "a1" }, { label: "n", kind: "nested", nested: () => nested }, { label: "a3" }]);

    it("jumps to a slide of the outermost show and records history", () => {
      const s = startPlayer(p);
      const j = jumpTo(s, 3);
      expect(label(j)).toBe("a3");
      expect(j.history.at(-1)).toBe(s.position);
      expect(label(navigate(j, { kind: "lastView" }))).toBe("a1");
    });

    it("leaves a nested show to jump in the outer one", () => {
      const inNested = navigate(startPlayer(p), { kind: "next" });
      expect(label(inNested)).toBe("b1");
      const j = jumpTo(inNested, 1);
      expect(label(j)).toBe("a1");
      expect(j.position).toHaveLength(1);
      expect(j.history.at(-1)).toBe(inNested.position);
    });

    it("enters a nested slide's show and works after the end", () => {
      const ended = navigate(startPlayer(p), { kind: "end" });
      expect(label(jumpTo(ended, 2))).toBe("b1");
    });

    it("ignores indices out of range", () => {
      const s = startPlayer(p);
      expect(jumpTo(s, 0)).toBe(s);
      expect(jumpTo(s, 9)).toBe(s);
    });
  });
});

describe("savePosition / restorePlayer", () => {
  const build = (innerCount = 2, outerExtra: SlideSpec[] = []) => {
    const inner = show("IN", Array.from({ length: innerCount }, (_, i) => ({ label: `in${i + 1}` })));
    return show("OUT", [{ label: "a1" }, { label: "nest", kind: "nested", nested: () => inner }, { label: "a3" }, ...outerExtra]);
  };

  it("saves the slide index and slide count at each level", () => {
    const s = keys(startPlayer(build()), "ArrowRight", "ArrowRight");
    expect(label(s)).toBe("in2");
    expect(savePosition(s)).toEqual({ indices: [2, 2], counts: [4, 3], ended: false });
    expect(savePosition(startPlayer(show("E", [{ label: "x", kind: "empty" }])))).toBeNull();
  });

  it("restores the position on a re-parse with the same structure", () => {
    const saved = savePosition(keys(startPlayer(build()), "ArrowRight", "ArrowRight"));
    const restored = restorePlayer(build(), saved);
    expect(label(restored)).toBe("in2");
    expect(restored.history).toEqual([]);
    expect(restored.sounds).toEqual([]);
    // It plays on from there.
    expect(label(keys(restored, "ArrowRight"))).toBe("a3");
  });

  it("restores the outer position and the ended state", () => {
    const ended = keys(startPlayer(build()), "Escape");
    const restored = restorePlayer(build(), savePosition(ended));
    expect(restored.ended).toBe(true);
    expect(label(keys(restored, "ArrowLeft"))).toBe("a1");
  });

  it("starts over when the structure differs or the position no longer fits", () => {
    const saved = savePosition(keys(startPlayer(build()), "ArrowRight", "ArrowRight"))!;
    expect(label(restorePlayer(build(3), saved))).toBe("a1");
    expect(label(restorePlayer(build(2, [{ label: "a4" }]), saved))).toBe("a1");
    expect(label(restorePlayer(build(), { ...saved, indices: [3, 2] }))).toBe("a1");
    expect(label(restorePlayer(build(), { indices: [2], counts: [4], ended: false }))).toBe("a1");
    expect(label(restorePlayer(build(), { indices: [0], counts: [4], ended: false }))).toBe("a1");
    expect(label(restorePlayer(build(), null))).toBe("a1");
  });
});
