import { describe, expect, it } from "vitest";
import { LANDSCAPE_VIEW_BOX, PORTRAIT_VIEW_BOX } from "../model/scene";
import {
  DEFAULT_WAIT_SECONDS,
  clampWaitSeconds,
  defaultVideoOptions,
  estimate,
  formatDuration,
  pickCodec,
  timelineFor,
  videoFileName,
  videoSize,
  webmCodecId,
} from "./options";
import { show, wavBytes } from "./testing";

describe("video options", () => {
  it("defaults: 5 s waits, transitions as the setting, sound when there is some, 640 wide WebM", () => {
    expect(defaultVideoOptions("file", true)).toEqual({ waitSeconds: 5, transitions: true, sound: true, width: 640, format: "webm" });
    expect(defaultVideoOptions("off", false)).toMatchObject({ transitions: false, sound: false });
  });

  it("keeps the wait time in range", () => {
    expect(clampWaitSeconds(-3)).toBe(0);
    expect(clampWaitSeconds(2.5)).toBe(2.5);
    expect(clampWaitSeconds(1e9)).toBe(600);
    expect(clampWaitSeconds(Number.NaN)).toBe(DEFAULT_WAIT_SECONDS);
  });

  it("sizes the video by the page shape, in even pixels", () => {
    expect(videoSize(640, LANDSCAPE_VIEW_BOX)).toEqual({ width: 640, height: 480 });
    expect(videoSize(1280, LANDSCAPE_VIEW_BOX)).toEqual({ width: 1280, height: 960 });
    expect(videoSize(640, PORTRAIT_VIEW_BOX)).toEqual({ width: 640, height: 854 });
    expect(videoSize(640, { minX: 0, minY: 0, width: 1000, height: 333 })).toEqual({ width: 640, height: 214 });
  });

  it("estimates length, slides, frames and sound", () => {
    const files: Record<string, Uint8Array> = { "A.WAV": wavBytes([[0]], 8000) };
    const p = show("S", [
      { label: "s", kind: "sound", fileName: "A.WAV" },
      { label: "m", kind: "sound", fileName: "B.MID" },
      { label: "a" },
      { label: "b", waitForKey: false, displaySeconds: 3, effects: { draw: { effect: "wipe", speed: "fast" } } },
    ]);
    const withFx = estimate(timelineFor(p, { waitSeconds: 4, transitions: true }, "file"), (n) => files[n] ?? null);
    expect(withFx).toMatchObject({ durationMs: 7300, slides: 2, frames: 219, sounds: 1, missing: ["B.MID"] });
    const plain = estimate(timelineFor(p, { waitSeconds: 4, transitions: false }, "file"), (n) => files[n] ?? null);
    expect(plain.durationMs).toBe(7000);
  });

  it("formats durations", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(83_500)).toBe("1:24");
    expect(formatDuration(3_723_000)).toBe("1:02:03");
  });

  it("names the file after the show", () => {
    expect(videoFileName("SALES93.SH3", "webm")).toBe("SALES93.webm");
    expect(videoFileName("my show.sh3", "mp4")).toBe("my_show.mp4");
    expect(videoFileName(".SH3", "webm")).toBe("_SH3.webm");
  });

  it("picks the first supported codec", async () => {
    expect(await pickCodec(["vp09.00.40.08", "vp8"], async (c) => c === "vp8")).toBe("vp8");
    expect(await pickCodec(["a", "b"], async () => false)).toBeNull();
    expect(
      await pickCodec(["bad", "ok"], async (c) => {
        if (c === "bad") throw new TypeError("invalid codec");
        return true;
      }),
    ).toBe("ok");
    expect(webmCodecId("vp09.00.40.08")).toBe("V_VP9");
    expect(webmCodecId("vp8")).toBe("V_VP8");
  });
});
