import { describe, expect, it } from "vitest";
import { DEMO_TRANSITIONS } from "../player/transitions/mode";
import { SPEED_MS } from "../player/transitions/types";
import { show } from "./testing";
import {
  MIN_HOLD_MS,
  type Segment,
  buildTimeline,
  frameCount,
  frameKey,
  frameLayers,
  frameTimeMs,
  holdMs,
  segmentAt,
  segmentLayers,
} from "./timeline";

const off = { waitSeconds: 5, transitionMode: "off" as const };
const file = { waitSeconds: 5, transitionMode: "file" as const };
const brief = (segments: Segment[]) => segments.map((s) => `${s.kind}:${s.picture}:${s.startMs}+${s.durationMs}`);

describe("buildTimeline", () => {
  it("holds each picture for its time, back to back", () => {
    const t = buildTimeline(show("A", [{ label: "a" }, { label: "b", waitForKey: false, displaySeconds: 2 }, { label: "c", waitForKey: false }]), off);
    expect(t.pictures.map((p) => p.label)).toEqual(["a", "b", "c"]);
    expect(brief(t.segments)).toEqual(["hold:0:0+5000", "hold:1:5000+2000", "hold:2:7000+5000"]);
    expect(t.durationMs).toBe(12000);
    // The first slide has nothing under it; later ones replace the one before.
    expect(t.segments[0].previous).toBeNull();
    expect(t.segments[1].previous).toEqual({ picture: 0 });
  });

  it("uses the chosen time for slides that wait for a key", () => {
    const t = buildTimeline(show("A", [{ label: "a" }, { label: "b" }]), { ...off, waitSeconds: 1.5 });
    expect(t.durationMs).toBe(3000);
  });

  it("shows a 0-second slide briefly, or not at all after an animated draw", () => {
    expect(holdMs(show("A", [{ label: "a", waitForKey: false, displaySeconds: 0 }]).slides[1], 5, false)).toBe(MIN_HOLD_MS);
    const t = buildTimeline(
      show("A", [
        { label: "a", waitForKey: false, displaySeconds: 0 },
        { label: "b", waitForKey: false, displaySeconds: 0, effects: { draw: { effect: "wipe", speed: "fast" } } },
        { label: "c" },
      ]),
      file,
    );
    expect(brief(t.segments)).toEqual(["hold:0:0+100", "draw:1:100+300", "hold:2:400+5000"]);
  });

  it("skips empty slides and starts sounds where they are passed", () => {
    const t = buildTimeline(
      show("A", [
        { label: "s0", kind: "sound", fileName: "INTRO.WAV" },
        { label: "a" },
        { label: "e", kind: "empty" },
        { label: "s1", kind: "sound", fileName: "BELL.WAV" },
        { label: "s2", kind: "sound", fileName: "TUNE.MID" },
        { label: "b" },
        { label: "s3", kind: "sound", fileName: "END.WAV" },
      ]),
      off,
    );
    expect(t.pictures.map((p) => p.label)).toEqual(["a", "b"]);
    expect(t.cues.map((c) => [c.slide.label, c.atMs, c.move])).toEqual([
      ["s0", 0, 0],
      ["s1", 5000, 1],
      ["s2", 5000, 1],
    ]);
    // After the last picture the video ends: that sound is not placed.
    expect(t.trailingSounds.map((s) => s.label)).toEqual(["s3"]);
  });

  it("plays nested shows inline", () => {
    const nested = show("N", [{ label: "n1" }, { label: "n2", waitForKey: false, displaySeconds: 1 }]);
    const t = buildTimeline(show("A", [{ label: "a" }, { label: "nest", kind: "nested", nested: () => nested }, { label: "b" }]), off);
    expect(t.pictures.map((p) => p.label)).toEqual(["a", "n1", "n2", "b"]);
    expect(t.durationMs).toBe(16000);
  });

  it("draws the file's erase, then draw, then holds", () => {
    const t = buildTimeline(
      show("A", [
        { label: "a", effects: { draw: { effect: "replace" }, erase: { effect: "wipe", direction: "left", speed: "fast" } } },
        { label: "b", effects: { draw: { effect: "fade", speed: "slow" } } },
      ]),
      file,
    );
    expect(brief(t.segments)).toEqual(["hold:0:0+5000", "erase:1:5000+300", "draw:1:5300+1500", "hold:1:6800+5000"]);
    const [, erase, draw, hold] = t.segments;
    expect(erase).toMatchObject({ previous: { picture: 0 }, current: "blank" });
    expect(erase.transition).toMatchObject({ effect: "wipe", direction: "left", durationMs: SPEED_MS.fast });
    // Erased: the new slide comes in over black.
    expect(draw).toMatchObject({ previous: "blank", current: { picture: 1 } });
    expect(hold).toMatchObject({ previous: "blank", current: { picture: 1 } });
  });

  it("keeps the old picture under an Overlay draw (Keep erase or none)", () => {
    const t = buildTimeline(
      show("A", [
        { label: "a", effects: { draw: { effect: "replace" }, erase: { effect: "keep" } } },
        { label: "b", effects: { draw: { effect: "overlay" } } },
      ]),
      file,
    );
    expect(brief(t.segments)).toEqual(["hold:0:0+5000", "hold:1:5000+5000"]);
    const layers = segmentLayers(t.segments[1], 6000);
    expect(layers.map((l) => [l.source, l.transparent])).toEqual([
      [{ picture: 0 }, false],
      [{ picture: 1 }, true],
    ]);
  });

  it("an instant erase still clears to black before the draw", () => {
    const t = buildTimeline(
      show("A", [
        { label: "a", effects: { draw: { effect: "replace" }, erase: { effect: "replace" } } },
        { label: "b", effects: { draw: { effect: "overlay" } } },
      ]),
      file,
    );
    expect(t.segments.map((s) => s.kind)).toEqual(["hold", "hold"]);
    expect(t.segments[1].previous).toBe("blank");
  });

  it("ignores the file's effects with transitions off", () => {
    const t = buildTimeline(
      show("A", [
        { label: "a", effects: { draw: { effect: "wipe" }, erase: { effect: "fade" } } },
        { label: "b", effects: { draw: { effect: "iris" } } },
      ]),
      off,
    );
    expect(t.segments.map((s) => s.kind)).toEqual(["hold", "hold"]);
  });

  it("counts slide changes for the demo cycle like the player", () => {
    const t = buildTimeline(show("A", [{ label: "a" }, { label: "b" }, { label: "c" }, { label: "d" }]), { waitSeconds: 1, transitionMode: "demo" });
    const draws = t.segments.filter((s) => s.kind === "hold").slice(1).map((s) => s.transition.effect);
    expect(draws).toEqual([DEMO_TRANSITIONS[0].effect, DEMO_TRANSITIONS[1].effect, DEMO_TRANSITIONS[2].effect]);
    expect(t.segments.filter((s) => s.kind === "draw")).toHaveLength(1);
  });

  it("gives an empty timeline for a show with no pictures", () => {
    const t = buildTimeline(show("A", [{ label: "e", kind: "empty" }, { label: "s", kind: "sound" }]), off);
    expect(t.segments).toEqual([]);
    expect(t.durationMs).toBe(0);
    expect(t.cues).toEqual([]);
  });
});

describe("frames", () => {
  it("counts frames and their start times", () => {
    expect(frameCount(0, 30)).toBe(0);
    expect(frameCount(10, 30)).toBe(1);
    expect(frameCount(1000, 30)).toBe(30);
    expect(frameCount(12_345, 30)).toBe(370);
    expect(frameTimeMs(30, 30)).toBe(1000);
  });

  it("finds the segment shown at a time", () => {
    const t = buildTimeline(show("A", [{ label: "a" }, { label: "b", effects: { draw: { effect: "wipe", speed: "medium" } } }]), file);
    expect(segmentAt(t.segments, 0)?.kind).toBe("hold");
    expect(segmentAt(t.segments, 4999)?.kind).toBe("hold");
    expect(segmentAt(t.segments, 5000)?.kind).toBe("draw");
    expect(segmentAt(t.segments, 5749)?.kind).toBe("draw");
    expect(segmentAt(t.segments, 5750)?.kind).toBe("hold");
    expect(segmentAt(t.segments, 1e9)?.picture).toBe(1);
    expect(segmentAt([], 0)).toBeNull();
  });

  it("gives a wipe's layers half way through", () => {
    const t = buildTimeline(show("A", [{ label: "a" }, { label: "b", effects: { draw: { effect: "wipe", direction: "right", speed: "medium" } } }]), file);
    // 5000 + 375 ms = frame 161.25 → frame 161 starts at 5366.7 ms (progress ≈ 0.489).
    const layers = frameLayers(t, 161, 30);
    expect(layers.map((l) => l.source)).toEqual([{ picture: 0 }, { picture: 1 }]);
    expect(layers[1].clip![0].w).toBeCloseTo((5366.6667 - 5000) / 750, 3);
    // The hold after it draws the new slide alone.
    expect(frameLayers(t, 200, 30).map((l) => l.source)).toEqual([{ picture: 1 }]);
  });

  it("gives equal keys to frames that look the same", () => {
    const t = buildTimeline(show("A", [{ label: "a" }, { label: "b", effects: { draw: { effect: "wipe", speed: "medium" } } }]), file);
    expect(frameKey(frameLayers(t, 0, 30))).toBe(frameKey(frameLayers(t, 100, 30)));
    expect(frameKey(frameLayers(t, 151, 30))).not.toBe(frameKey(frameLayers(t, 152, 30)));
    expect(frameKey(frameLayers(t, 200, 30))).toBe(frameKey(frameLayers(t, 250, 30)));
  });
});
