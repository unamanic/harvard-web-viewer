import { describe, expect, it } from "vitest";
import type { FrameContext } from "./compose";
import { ExportCancelled, type FrameInfo, type PictureStore, type Progress, type VideoSink, neededPictures, remainingMs, runExport } from "./encode";
import { show } from "./testing";
import { buildTimeline } from "./timeline";

function fakeContext(): FrameContext & { draws: string[] } {
  const draws: string[] = [];
  return {
    draws,
    fillStyle: "",
    fillRect: () => {},
    save: () => {},
    restore: () => {},
    beginPath: () => {},
    rect: () => {},
    clip: () => {},
    drawImage: (img) => draws.push((img as unknown as { name: string }).name),
  };
}

function fakePictures(): PictureStore & { prepared: string[]; cleared: number } {
  const ready = new Set<string>();
  const store = {
    prepared: [] as string[],
    cleared: 0,
    async prepare(needed: readonly { picture: number; transparent: boolean }[]) {
      for (const n of needed) {
        const key = `p${n.picture}${n.transparent ? "t" : ""}`;
        if (!ready.has(key)) store.prepared.push(key);
        ready.add(key);
      }
    },
    get(picture: number, transparent: boolean) {
      const key = `p${picture}${transparent ? "t" : ""}`;
      if (!ready.has(key)) throw new Error(`${key} not prepared`);
      return { name: key } as unknown as CanvasImageSource;
    },
    clear() {
      store.cleared++;
      ready.clear();
    },
  };
  return store;
}

function fakeSink(onFrame?: (f: FrameInfo) => void): VideoSink & { frames: FrameInfo[]; started: boolean; aborted: boolean; finishedAt: number | null } {
  const sink = {
    frames: [] as FrameInfo[],
    started: false,
    aborted: false,
    finishedAt: null as number | null,
    async start() {
      sink.started = true;
    },
    async waitForSlot() {},
    async addFrame(f: FrameInfo) {
      sink.frames.push(f);
      onFrame?.(f);
    },
    async finish(durationMs: number) {
      sink.finishedAt = durationMs;
      return new Blob(["video"], { type: "video/webm" });
    },
    abort() {
      sink.aborted = true;
    },
  };
  return sink;
}

const fxShow = () =>
  show("A", [
    { label: "a", waitForKey: false, displaySeconds: 1 },
    { label: "b", waitForKey: false, displaySeconds: 1, effects: { draw: { effect: "wipe", direction: "right", speed: "fast" } } },
  ]);

describe("runExport", () => {
  it("draws only frames that change and hands every frame to the sink with its time", async () => {
    const timeline = buildTimeline(fxShow(), { waitSeconds: 5, transitionMode: "file" });
    const ctx = fakeContext();
    const pictures = fakePictures();
    const sink = fakeSink();
    const progress: Progress[] = [];
    const blob = await runExport({ timeline, fps: 30, width: 64, height: 48, frame: ctx, pictures, sink, audio: null, onProgress: (p) => progress.push(p), now: () => 0 });
    expect(blob.type).toBe("video/webm");
    // 1 s + 0.3 s wipe + 1 s = 69 frames.
    expect(sink.frames).toHaveLength(69);
    expect(sink.frames[0]).toMatchObject({ index: 0, timestampUs: 0, durationUs: 33333, changed: true, keyFrame: true });
    expect(sink.frames[30].timestampUs).toBe(1_000_000);
    expect(sink.frames.filter((f) => f.keyFrame).map((f) => f.index)).toEqual([0]);
    // Changed: the first frame, the 9 wipe frames (1000..1300 ms) and the first frame of the hold after it.
    expect(sink.frames.filter((f) => f.changed).map((f) => f.index)).toEqual([0, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39]);
    expect(sink.finishedAt).toBe(2300);
    expect(pictures.prepared).toEqual(["p0", "p1"]);
    expect(pictures.cleared).toBe(1);
    expect(ctx.draws.slice(0, 4)).toEqual(["p0", "p0", "p0", "p1"]);
    expect(progress.at(-1)).toMatchObject({ done: 69, total: 69 });
  });

  it("stops on cancel: aborts the sink and frees the pictures", async () => {
    const timeline = buildTimeline(fxShow(), { waitSeconds: 5, transitionMode: "file" });
    const controller = new AbortController();
    const pictures = fakePictures();
    const sink = fakeSink((f) => f.index === 10 && controller.abort());
    await expect(
      runExport({ timeline, fps: 30, width: 64, height: 48, frame: fakeContext(), pictures, sink, audio: null, signal: controller.signal }),
    ).rejects.toBeInstanceOf(ExportCancelled);
    expect(sink.frames).toHaveLength(11);
    expect(sink.aborted).toBe(true);
    expect(sink.finishedAt).toBeNull();
    expect(pictures.cleared).toBe(1);
  });

  it("passes encoder errors on after aborting", async () => {
    const timeline = buildTimeline(fxShow(), { waitSeconds: 5, transitionMode: "file" });
    const sink = fakeSink((f) => {
      if (f.index === 3) throw new Error("encoder broke");
    });
    await expect(runExport({ timeline, fps: 30, width: 64, height: 48, frame: fakeContext(), pictures: fakePictures(), sink, audio: null })).rejects.toThrow("encoder broke");
    expect(sink.aborted).toBe(true);
  });

  it("refuses an empty show", async () => {
    const timeline = buildTimeline(show("A", [{ label: "e", kind: "empty" }]), { waitSeconds: 5, transitionMode: "off" });
    await expect(runExport({ timeline, fps: 30, width: 64, height: 48, frame: fakeContext(), pictures: fakePictures(), sink: fakeSink(), audio: null })).rejects.toThrow(
      "no slides",
    );
  });

  it("gives the sound track to the sink before the frames", async () => {
    const timeline = buildTimeline(fxShow(), { waitSeconds: 5, transitionMode: "off" });
    const order: string[] = [];
    const sink = fakeSink(() => order.push("frame"));
    sink.start = async (audio) => {
      order.push(audio ? "audio" : "none");
    };
    const audio = { sampleRate: 48000, channels: [new Float32Array(10)] };
    await runExport({ timeline, fps: 30, width: 64, height: 48, frame: fakeContext(), pictures: fakePictures(), sink, audio });
    expect(order[0]).toBe("audio");
    expect(order[1]).toBe("frame");
  });
});

describe("helpers", () => {
  it("estimates the time left from the pace", () => {
    expect(remainingMs(2, 100, 50)).toBeNull();
    expect(remainingMs(10, 100, 1000)).toBe(9000);
    expect(remainingMs(100, 100, 1000)).toBe(0);
  });

  it("lists the pictures a frame needs", () => {
    expect(
      neededPictures([
        { source: "blank", transparent: false },
        { source: { picture: 2 }, transparent: true },
      ]),
    ).toEqual([{ picture: 2, transparent: true }]);
  });
});
